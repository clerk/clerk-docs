#!/usr/bin/env bun
// Generates Algolia search records from the built docs in dist/ and pushes them directly
// Run after build-docs.ts: bun ./scripts/update-algolia-records.ts
//
// This script reads the final processed MDX files from dist/ which have:
// - All partials embedded
// - All typedocs embedded
// - SDK-specific content already filtered
// - Final URLs and frontmatter

import 'dotenv/config'
import fs from 'node:fs/promises'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { remark } from 'remark'
import remarkFrontmatter from 'remark-frontmatter'
import remarkMdx from 'remark-mdx'
import { slugifyWithCounter } from '@sindresorhus/slugify'
import { toString } from 'mdast-util-to-string'
import { Node } from 'unist'
import { visit as mdastVisit } from 'unist-util-visit'
import yaml from 'yaml'
import readdirp from 'readdirp'
import { algoliasearch } from 'algoliasearch'
import type { PushTaskRecords } from 'algoliasearch'
import { z } from 'zod'

// ============================================================================
// Git Helpers
// ============================================================================

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

// ============================================================================
// Types
// ============================================================================

interface SearchRecord {
  version: string
  tags: string[]
  branch: string
  objectID: string
  url: string
  url_without_variables: string
  url_without_anchor: string
  anchor: string
  content: string | null
  content_camel: string | null
  lang: string
  language: string
  type: 'lvl0' | 'lvl1' | 'lvl2' | 'lvl3' | 'lvl4' | 'lvl5' | 'lvl6' | 'content'
  no_variables: boolean
  _tags: string[]
  keywords: string[]
  sdk: string[]
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
  recordVersion: string
  distinct_group: string
  record_batch: string
}

interface Frontmatter {
  title?: string
  description?: string
  sdk?: string
  availableSdks?: string
  activeSdk?: string
  redirectPage?: string
  search?: {
    exclude?: boolean
  }
  canonical?: string
  pageRank?: number
}

interface ProcessedDoc {
  filePath: string
  url: string
  frontmatter: Frontmatter
  node: Node
}

// ============================================================================
// Constants
// ============================================================================

const DIST_PATH = path.join(__dirname, '../dist')
const BASE_DOCS_URL = '/docs'
const MAX_CHUNK_SIZE = 4.5 * 1024 * 1024 // 4.5MB in bytes

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

// ============================================================================
// Utility Functions
// ============================================================================

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

// ============================================================================
// Record Generation
// ============================================================================

/**
 * Generates search records from a processed document
 */
function generateRecordsFromDoc(doc: ProcessedDoc, gitBranch: string, recordBatch: string): SearchRecord[] {
  const records: SearchRecord[] = []
  const slugify = slugifyWithCounter()

  const baseUrl = doc.url
  const urlWithoutAnchor = baseUrl

  // Initialize hierarchy
  const hierarchy: SearchRecord['hierarchy'] = {
    lvl0: 'Documentation',
    lvl1: doc.frontmatter.title || null,
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
  const activeSdk = doc.frontmatter.activeSdk
  const sdk = activeSdk ? [activeSdk] : []
  const canonical = doc.frontmatter.canonical || null

  // Helper to create a record
  const createRecord = (type: SearchRecord['type'], content: string | null, anchor: string): SearchRecord => {
    const url = anchor !== 'main' ? `${baseUrl}#${anchor}` : baseUrl
    const objectID = `${position}-${baseUrl}#${anchor}`

    // distinct_group uses canonical URL (with :sdk: placeholder) + anchor for deduplication
    const distinctBase = canonical || baseUrl
    const distinct_group = `${distinctBase}#${anchor}`

    return {
      version: '',
      tags: [],
      branch: gitBranch,
      objectID,
      url,
      url_without_variables: url,
      url_without_anchor: urlWithoutAnchor,
      anchor,
      content,
      content_camel: content,
      lang: 'en',
      language: 'en',
      type,
      no_variables: false,
      _tags: ['docs'],
      keywords: [],
      sdk,
      availableSDKs: availableSdksList,
      canonical,
      weight: {
        pageRank: doc.frontmatter.pageRank ?? 0,
        level: HEADING_WEIGHTS[type] ?? 0,
        position: position++,
      },
      hierarchy: { ...hierarchy },
      recordVersion: 'v3',
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
      const headingText = toString(node).trim()

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
      hierarchy[levelKey] = headingText
      currentAnchor = anchor

      // Create heading record
      records.push(createRecord(`lvl${depth}` as SearchRecord['type'], null, anchor))
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

// ============================================================================
// Main Script
// ============================================================================

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

    const doc: ProcessedDoc = {
      filePath,
      url,
      frontmatter,
      node,
    }

    const records = generateRecordsFromDoc(doc, gitBranch, recordBatch)
    allRecords.push(...records)
    processed++
  }

  console.log(`✓ Processed ${processed} files, skipped ${skipped}`)
  console.log(`✓ Generated ${allRecords.length} search records`)

  // Push to Algolia
  console.log('\nPushing records to Algolia...')

  const searchClient = algoliasearch(ALGOLIA_APP_ID, ALGOLIA_API_KEY)

  const result = await searchClient.chunkedBatch({
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

  await searchClient.browseObjects({
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

    // Delete in batches of 1000 (Algolia limit)
    const BATCH_SIZE = 1000
    for (let i = 0; i < staleObjectIDs.length; i += BATCH_SIZE) {
      const batch = staleObjectIDs.slice(i, i + BATCH_SIZE)
      console.log(
        `Deleting batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(staleObjectIDs.length / BATCH_SIZE)} (${batch.length} records)...`,
      )

      await searchClient.deleteObjects({
        indexName: ALGOLIA_INDEX_NAME,
        objectIDs: batch,
      })
    }

    console.log(`✓ Deleted ${staleObjectIDs.length} stale records`)
  }

  console.log('\n✓ Update complete!')
}

main().catch((error) => {
  console.error('Error:', error)
  process.exit(1)
})
