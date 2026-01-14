#!/usr/bin/env bun

// Generates Algolia search records from the built docs in dist/ and pushes them directly
// Run after build-docs.ts: bun ./scripts/update-algolia-records.ts
//
// This script reads the final processed MDX files from dist/ which have:
// - All partials embedded
// - All typedocs embedded
// - SDK-specific content already filtered
// - Final URLs and frontmatter

import { slugifyWithCounter } from '@sindresorhus/slugify'
import { algoliasearch } from 'algoliasearch'
import 'dotenv/config'
import { execSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import readdirp from 'readdirp'
import { remark } from 'remark'
import remarkFrontmatter from 'remark-frontmatter'
import remarkMdx from 'remark-mdx'
import { Node } from 'unist'
import { visit as mdastVisit } from 'unist-util-visit'
import yaml from 'yaml'
import { z } from 'zod'

type RecordType = 'lvl0' | 'lvl1' | 'lvl2' | 'lvl3' | 'lvl4' | 'lvl5' | 'lvl6' | 'content'

type SearchRecord = {
  objectID: string
  branch: string
  anchor: string
  content: string | null
  type: RecordType
  _tags: string[]
  keywords: string[]
  availableSDKs: string[]
  canonical: string | null
  weight: {
    pageRank: number
    level: number
    position: number
  }
  hierarchy: {
    lvl0: string
    lvl1: string | null
    lvl2: string | null
    lvl3: string | null
    lvl4: string | null
    lvl5: string | null
    lvl6: string | null
  }
  distinct_group: string
  record_batch: string
}

type Frontmatter = {
  title?: string
  description?: string
  sdk?: string
  availableSdks?: string
  activeSdk?: string
  redirectPage?: string
  search?: {
    exclude?: boolean
    keywords?: string[]
    rank?: number
  }
  canonical?: string
}

const DIST_PATH = path.join(__dirname, '../dist')
const BASE_DOCS_URL = '/docs'

const { ALGOLIA_API_KEY, ALGOLIA_APP_ID, ALGOLIA_INDEX_NAME } = z
  .object({
    ALGOLIA_API_KEY: z.string(),
    ALGOLIA_APP_ID: z.string(),
    ALGOLIA_INDEX_NAME: z.string(),
  })
  .parse(process.env)

// Heading weights match Algolia DocSearch crawler configuration
const HEADING_WEIGHTS: Record<string, number> = {
  lvl1: 90,
  lvl2: 80,
  lvl3: 70,
  lvl4: 60,
  lvl5: 50,
  lvl6: 40,
  content: 0,
}

function getGitBranch(): string {
  try {
    // Try to get branch from environment (CI systems often set this)
    const envBranch =
      process.env.VERCEL_GIT_COMMIT_REF ||
      process.env.GITHUB_REF_NAME ||
      process.env.CI_COMMIT_BRANCH ||
      process.env.BRANCH

    if (envBranch) return envBranch

    // Fall back to git command
    return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim()
  } catch {
    return 'unknown'
  }
}

/**
 * Strips backticks from a string (used for cleaning titles in search results)
 */
function stripBackticks(str: string): string {
  return str.replace(/`/g, '')
}

/**
 * Extracts custom heading ID from MDX annotation syntax
 * e.g., ## Heading {{ id: 'custom-id' }}
 */
function extractHeadingId(node: Node): string | undefined {
  if (!('children' in node) || !Array.isArray(node.children)) return undefined

  const mdxExpression = node.children.find((child: any) => child?.type === 'mdxTextExpression') as any

  if (!mdxExpression?.data?.estree?.body) return undefined

  const expressionStatement = mdxExpression.data.estree.body.find((child: any) => child?.type === 'ExpressionStatement')

  const idProp = expressionStatement?.expression?.properties?.find((prop: any) => prop?.key?.name === 'id')

  return idProp?.value?.value
}

/**
 * Extracts text content from an MDX AST node
 */
function extractTextContent(node: Node): string {
  const parts: string[] = []

  mdastVisit(node, (child) => {
    if (child.type === 'text' && 'value' in child && typeof child.value === 'string') {
      parts.push(child.value)
    } else if (child.type === 'inlineCode' && 'value' in child && typeof child.value === 'string') {
      parts.push(child.value)
    }
  })

  return parts.join('').trim()
}

/**
 * Checks if a list item contains nested block elements
 */
function hasNestedBlockElements(node: Node): boolean {
  if (node.type !== 'listItem') return false

  if ('children' in node && Array.isArray(node.children)) {
    for (const child of node.children) {
      if (child.type === 'list') return true
    }
  }
  return false
}

/**
 * Converts file path to URL
 */
function filePathToUrl(filePath: string, distPath: string): string {
  const relativePath = path.relative(distPath, filePath)
  const urlPath = relativePath
    .replace(/\.mdx$/, '')
    .replace(/\\/g, '/')
    .replace(/\/index$/, '')

  return `${BASE_DOCS_URL}/${urlPath}`.replace(/\/+/g, '/')
}

/**
 * Generates search records from a processed document
 */
function generateRecordsFromDoc(
  doc: {
    filePath: string
    url: string
    frontmatter: Frontmatter
    node: Node
  },
  gitBranch: string,
  recordBatch: string,
): SearchRecord[] {
  const records: SearchRecord[] = []
  const slugify = slugifyWithCounter()

  const baseUrl = doc.url

  // Initialize hierarchy
  const hierarchy: SearchRecord['hierarchy'] = {
    lvl0: 'Documentation',
    lvl1: doc.frontmatter.title ? stripBackticks(doc.frontmatter.title) : null,
    lvl2: null,
    lvl3: null,
    lvl4: null,
    lvl5: null,
    lvl6: null,
  }

  let currentAnchor: string | null = null
  let position = 0

  // Parse SDK info from frontmatter
  const availableSdksRaw = doc.frontmatter.availableSdks?.split(',').filter(Boolean)
  // Use ["all"] for non-SDK-scoped docs (no availableSdks in frontmatter)
  const availableSdksList = availableSdksRaw && availableSdksRaw.length > 0 ? availableSdksRaw : ['all']
  const canonical = doc.frontmatter.canonical || null
  const keywords = doc.frontmatter.search?.keywords?.map((keyword) => keyword.trim()).filter(Boolean) ?? []

  // Helper to create a record
  const createRecord = (type: RecordType, content: string | null, anchor: string): SearchRecord => {
    const objectID = `${gitBranch}-${position}-${baseUrl}#${anchor}`

    // distinct_group uses canonical URL (with :sdk: placeholder) + anchor for deduplication
    const distinctBase = canonical || baseUrl
    const distinct_group = `${distinctBase}#${anchor}`

    return {
      objectID,
      branch: gitBranch,
      anchor,
      content,
      type,
      _tags: ['docs'],
      keywords,
      availableSDKs: availableSdksList,
      canonical,
      weight: {
        pageRank: doc.frontmatter.search?.rank ?? 0,
        level: HEADING_WEIGHTS[type] ?? 0,
        position: position++,
      },
      hierarchy: { ...hierarchy },
      distinct_group,
      record_batch: recordBatch,
    }
  }

  // First record: the page title (lvl1)
  if (hierarchy.lvl1) {
    records.push(createRecord('lvl1', null, 'main'))
  }

  // Walk the AST
  mdastVisit(doc.node, (node) => {
    // Skip YAML frontmatter
    if (node.type === 'yaml') return

    // Skip tables - they're too large for Algolia and crawler excludes them
    if (node.type === 'table') return 'skip'

    // Skip code blocks - crawler doesn't index code
    if (node.type === 'code') return 'skip'

    // Handle headings
    if (node.type === 'heading' && 'depth' in node) {
      const depth = node.depth as number
      const headingText = extractTextContent(node)

      // Check for custom ID or generate slug
      const customId = extractHeadingId(node)
      const anchor = customId ?? slugify(headingText)

      // Clear hierarchy levels below this one
      for (let i = depth + 1; i <= 6; i++) {
        const key = `lvl${i}` as 'lvl1' | 'lvl2' | 'lvl3' | 'lvl4' | 'lvl5' | 'lvl6'
        hierarchy[key] = null
      }

      // Set current level
      const levelKey = `lvl${depth}` as keyof typeof hierarchy
      hierarchy[levelKey] = stripBackticks(headingText)
      currentAnchor = anchor

      // Create heading record
      records.push(createRecord(`lvl${depth}` as RecordType, null, anchor))
      return
    }

    // Handle paragraphs
    if (node.type === 'paragraph') {
      const text = extractTextContent(node)
      // Skip empty content, table-like content (starts with |), and overly long content
      if (text && text.length > 0 && text.length < 5000 && !text.startsWith('|')) {
        records.push(createRecord('content', text, currentAnchor ?? 'main'))
      }
      return
    }

    // Handle list items (but not those with nested lists)
    if (node.type === 'listItem' && !hasNestedBlockElements(node)) {
      const text = extractTextContent(node)
      // Skip empty content and overly long content
      if (text && text.length > 0 && text.length < 5000) {
        records.push(createRecord('content', text, currentAnchor ?? 'main'))
      }
      return 'skip'
    }
  })

  return records
}

async function main() {
  const gitBranch = getGitBranch()
  const recordBatch = randomUUID()
  console.log(`Building search records from dist/... (branch: ${gitBranch}, batch: ${recordBatch})`)

  // Find all MDX files in dist
  const mdxFiles = await readdirp.promise(DIST_PATH, {
    type: 'files',
    fileFilter: '*.mdx',
    directoryFilter: (entry) => {
      // Skip internal directories
      return !entry.basename.startsWith('_')
    },
  })

  console.log(`Found ${mdxFiles.length} MDX files`)

  const allRecords: SearchRecord[] = []
  let skipped = 0
  let processed = 0

  for (const file of mdxFiles) {
    const filePath = file.fullPath
    const content = await fs.readFile(filePath, 'utf-8')

    // Extract frontmatter
    let frontmatter: Frontmatter | undefined = undefined

    // Parse MDX to AST
    let node: Node | null = null
    try {
      await remark()
        .use(remarkFrontmatter)
        .use(remarkMdx)
        .use(() => (tree) => {
          node = tree
        })
        .use(() => (tree, vfile) => {
          mdastVisit(
            tree,
            (node) => node.type === 'yaml' && 'value' in node,
            (node) => {
              if (!('value' in node)) return
              if (typeof node.value !== 'string') return

              frontmatter = yaml.parse(node.value)
            },
          )
        })
        .process(content)
    } catch (error) {
      console.warn(`Skipping ${file.path}: Parse error`)
      skipped++
      continue
    }

    if (!frontmatter) {
      console.warn(`Skipping ${file.path}: No frontmatter`)
      skipped++
      continue
    }

    frontmatter = frontmatter as Frontmatter

    // Skip redirect pages
    if (frontmatter.redirectPage === 'true') {
      skipped++
      continue
    }

    // Skip if search.exclude is true
    if (frontmatter.search?.exclude) {
      console.warn(`Skipping ${file.path}: Search excluded`)
      skipped++
      continue
    }

    // Skip if no title
    if (!frontmatter.title) {
      console.warn(`Skipping ${file.path}: No title in frontmatter`)
      skipped++
      continue
    }

    if (!node) {
      console.warn(`Skipping ${file.path}: No node`)
      skipped++
      continue
    }

    const url = filePathToUrl(filePath, DIST_PATH)

    const records = generateRecordsFromDoc(
      {
        filePath,
        url,
        frontmatter,
        node,
      },
      gitBranch,
      recordBatch,
    )
    allRecords.push(...records)
    processed++
  }

  console.log(`✓ Processed ${processed} files, skipped ${skipped}`)
  console.log(`✓ Generated ${allRecords.length} search records`)

  // Push to Algolia
  console.log('\nPushing records to Algolia...')

  const algolia = algoliasearch(ALGOLIA_APP_ID, ALGOLIA_API_KEY)

  await algolia.chunkedBatch({
    indexName: ALGOLIA_INDEX_NAME,
    action: 'updateObject',
    waitForTasks: true,
    objects: allRecords.map((record) => ({
      ...record,
      objectID: record.objectID,
    })),
  })

  console.log('\n✓ All records pushed successfully!')

  // Clean up stale records
  console.log('\nCleaning up stale records...')

  // Browse all records and find stale ones (different batch or branch)

  const staleObjectIDs: string[] = []

  await algolia.browseObjects({
    indexName: ALGOLIA_INDEX_NAME,
    browseParams: {
      // We want records that are of the branch we are updating, but not the current batch
      facetFilters: [`record_batch:-${recordBatch}`, `branch:${gitBranch}`],
      attributesToRetrieve: ['objectID'],
    },
    aggregator: (response) => {
      for (const hit of response.hits) {
        staleObjectIDs.push(hit.objectID)
      }
    },
  })

  if (staleObjectIDs.length === 0) {
    console.log('✓ No stale records found')
  } else {
    console.log(`Found ${staleObjectIDs.length} stale records to delete`)

    const deletedRecordsBatches = await algolia.chunkedBatch({
      indexName: ALGOLIA_INDEX_NAME,
      action: 'deleteObject',
      waitForTasks: true,
      objects: staleObjectIDs.map((objectID) => ({ objectID })),
    })

    const deletedRecords = deletedRecordsBatches.reduce((acc, batch) => acc + batch.objectIDs.length, 0)

    console.log(`✓ Deleted ${deletedRecords} stale records`)
  }

  console.log('\n✓ Update complete!')
}

main()
