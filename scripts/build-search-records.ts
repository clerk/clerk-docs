#!/usr/bin/env bun
// Generates Algolia search records from the built docs in dist/
// Run after build-docs.ts: bun ./scripts/build-search-records.ts
//
// This script reads the final processed MDX files from dist/ which have:
// - All partials embedded
// - All typedocs embedded
// - SDK-specific content already filtered
// - Final URLs and frontmatter

import fs from 'node:fs/promises'
import path from 'node:path'
import { remark } from 'remark'
import remarkFrontmatter from 'remark-frontmatter'
import remarkMdx from 'remark-mdx'
import { slugifyWithCounter } from '@sindresorhus/slugify'
import { toString } from 'mdast-util-to-string'
import { Node } from 'unist'
import { visit as mdastVisit } from 'unist-util-visit'
import yaml from 'yaml'
import readdirp from 'readdirp'

// ============================================================================
// Types
// ============================================================================

interface SearchRecord {
  version: string
  tags: string[]
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
const OUTPUT_PATH = path.join(DIST_PATH, '_search/records.json')
const BASE_DOCS_URL = '/docs'

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

  const mdxExpression = node.children.find(
    (child: any) => child?.type === 'mdxTextExpression'
  ) as any

  if (!mdxExpression?.data?.estree?.body) return undefined

  const expressionStatement = mdxExpression.data.estree.body.find(
    (child: any) => child?.type === 'ExpressionStatement'
  )

  const idProp = expressionStatement?.expression?.properties?.find(
    (prop: any) => prop?.key?.name === 'id'
  )

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
 * Extracts frontmatter from MDX content
 */
function extractFrontmatter(content: string): Frontmatter | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return null

  try {
    return yaml.parse(match[1]) as Frontmatter
  } catch {
    return null
  }
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
function generateRecordsFromDoc(doc: ProcessedDoc): SearchRecord[] {
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

  // Create tags
  const tags = ['docs']
  if (baseUrl.includes('/core-1')) {
    tags.push('core_1')
  }

  // Helper to create a record
  const createRecord = (
    type: SearchRecord['type'],
    content: string | null,
    anchor: string,
  ): SearchRecord => {
    const url = anchor !== 'main' ? `${baseUrl}#${anchor}` : baseUrl
    const objectID = `${position}-${baseUrl}#${anchor}`

    // distinct_group uses canonical URL (with :sdk: placeholder) + anchor for deduplication
    const distinctBase = canonical || baseUrl
    const distinct_group = `${distinctBase}#${anchor}`

    return {
      version: '',
      tags: [],
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
      _tags: tags,
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
        hierarchy[`lvl${i}` as keyof typeof hierarchy] = null
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
  console.log('Building search records from dist/...')

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
    const frontmatter = extractFrontmatter(content)

    if (!frontmatter) {
      console.warn(`Skipping ${file.path}: No frontmatter`)
      skipped++
      continue
    }

    // Skip redirect pages
    if (frontmatter.redirectPage === 'true') {
      skipped++
      continue
    }

    // Skip if search.exclude is true
    if (frontmatter.search?.exclude) {
      skipped++
      continue
    }

    // Skip if no title
    if (!frontmatter.title) {
      console.warn(`Skipping ${file.path}: No title in frontmatter`)
      skipped++
      continue
    }

    // Parse MDX to AST
    let node: Node | null = null
    try {
      await remark()
        .use(remarkFrontmatter)
        .use(remarkMdx)
        .use(() => (tree) => {
          node = tree
        })
        .process(content)
    } catch (error) {
      console.warn(`Skipping ${file.path}: Parse error`)
      skipped++
      continue
    }

    if (!node) {
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

    const records = generateRecordsFromDoc(doc)
    allRecords.push(...records)
    processed++
  }

  // Write records to file
  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true })
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(allRecords, null, 2))

  console.log(`✓ Processed ${processed} files, skipped ${skipped}`)
  console.log(`✓ Generated ${allRecords.length} search records`)
  console.log(`✓ Output: ${OUTPUT_PATH}`)
}

main().catch((error) => {
  console.error('Error:', error)
  process.exit(1)
})

