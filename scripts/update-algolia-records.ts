#!/usr/bin/env bun

// Generates Algolia search records from the built docs in dist/ and pushes them directly
// Run `npm run build && npm run search:update`
//
// Options:
//   --dry-run  Run everything except actually pushing/updating the Algolia index
//
// Environment variables:
//   DEBUG_SEARCH_BRANCH  Set to enable search index updates on preview deployments.
//                        The value is used as the branch name for the records.
//                        Without this, the script exits early on preview deployments.
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

type RecordType = 'lvl0' | 'lvl1' | 'lvl2' | 'lvl3' | 'lvl4' | 'lvl5' | 'lvl6' | 'content' | 'property'

type SearchRecord = {
  objectID: string
  branch: string
  anchor: string
  content: string | null
  type: RecordType
  keywords: string[]
  availableSDKs: string[]
  canonical: string
  weight: {
    pageRank: number
    level: number
    position: number
    // Order-of-magnitude popularity bucket derived from PostHog pageviews (see fetchPageViews).
    // Used as a custom-ranking tie-breaker so popular pages get a gentle bump. 0 = no/unknown traffic.
    popularity: number
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

const frontmatterSchema = z.object({
  title: z.string().optional(),
  description: z.string().nullable(),
  sdk: z.string().optional(),
  availableSdks: z.string().optional(),
  activeSdk: z.string().optional(),
  redirectPage: z.string().optional(),
  search: z
    .object({
      exclude: z.boolean().optional(),
      keywords: z.array(z.string()).optional(),
      rank: z.number().optional(),
    })
    .optional(),
  canonical: z.string(),
})

type Frontmatter = z.infer<typeof frontmatterSchema>

const DIST_PATH = path.join(__dirname, '../dist')
const BASE_DOCS_URL = '/docs'
const ALGOLIA_OUTPUT_DIR = path.join(__dirname, '../.algolia')

const DEBUG_SEARCH_BRANCH = process.env.DEBUG_SEARCH_BRANCH
const VERCEL_ENV = process.env.VERCEL_ENV as 'production' | 'preview' | 'development' | undefined

// Parse command line arguments
const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')

// PostHog popularity signal.
// Reads a saved PostHog insight ("what users are viewing" — docs pageviews by path), re-runs its
// query fresh each build, and bakes an order-of-magnitude "popularity" bucket into each record so
// frequently-visited pages get a gentle ranking bump (see weight.popularity + customRanking).
// The insight is the source of truth: tune its date range / filters / breakdown in PostHog and the
// ranking follows. All optional: if creds are missing or any request fails we index with popularity
// 0 everywhere and ranking is unchanged — the search index must never fail to build over this.
const POSTHOG_API_KEY = process.env.DOCS_POSTHOG_API_KEY
const POSTHOG_PROJECT_ID = process.env.DOCS_POSTHOG_PROJECT_ID
const POSTHOG_HOST = (process.env.DOCS_POSTHOG_HOST ?? 'https://us.posthog.com').replace(/\/+$/, '')
// Insight that defines "what users are viewing". https://us.posthog.com/project/86309/insights/MymhKcxH
const POSTHOG_INSIGHT_ID = process.env.DOCS_POSTHOG_INSIGHT_ID ?? 'MymhKcxH'
// Highest popularity bucket. Buckets are log10(views), so this caps the bump at ~10^MAX views.
// Kept small on purpose: this is a tie-breaker nudge, not a re-sort by traffic.
const POPULARITY_MAX_BUCKET = 4

// Heading weights match Algolia DocSearch crawler configuration
const HEADING_WEIGHTS: Record<string, number> = {
  lvl1: 90,
  lvl2: 80,
  lvl3: 70,
  lvl4: 60,
  lvl5: 50,
  lvl6: 40,
  content: 0,
  property: -10, // De-prioritize API property/table definitions
}

function getGitBranch(): string {
  try {
    if (DEBUG_SEARCH_BRANCH !== undefined) {
      return DEBUG_SEARCH_BRANCH
    }

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
 * Strips callout syntax from content (e.g., [!NOTE], [!WARNING some-anchor], etc.)
 * These may appear with or without escaped brackets depending on processing stage
 * Callouts can optionally include an anchor ID after the type: [!NOTE anchor-id]
 */
function stripCalloutSyntax(str: string): string {
  return str.replace(/\\?\[!(NOTE|WARNING|IMPORTANT|TIP|CAUTION|QUIZ)(?:\s+[^\]]+)?\]/g, '').trim()
}

/**
 * Extracts the anchor ID from callout syntax if present
 * e.g., "[!NOTE browser-compatibility]" returns "browser-compatibility"
 * Returns undefined if no anchor ID is present
 */
function extractCalloutAnchor(str: string): string | undefined {
  const match = str.match(/\\?\[!(NOTE|WARNING|IMPORTANT|TIP|CAUTION|QUIZ)\s+([^\]]+)\]/)
  return match?.[2]?.trim()
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
 * Skips TooltipContent elements (hover-only content) but includes TooltipTrigger text
 */
function extractTextContent(node: Node): string {
  const parts: string[] = []

  mdastVisit(node, (child) => {
    // Skip TooltipContent - it's hover-only content that shouldn't be in search
    if (
      (child.type === 'mdxJsxTextElement' || child.type === 'mdxJsxFlowElement') &&
      'name' in child &&
      child.name === 'TooltipContent'
    ) {
      return 'skip'
    }

    if (child.type === 'text' && 'value' in child && typeof child.value === 'string') {
      parts.push(child.value)
    } else if (child.type === 'inlineCode' && 'value' in child && typeof child.value === 'string') {
      parts.push(child.value)
    }
  })

  return parts.join('').trim()
}

/**
 * Parses markdown table content from text
 * Returns headers and data rows, or null if not a table
 */
function parseMarkdownTable(text: string): { headers: string[]; rows: string[][] } | null {
  // Check if text looks like a markdown table (starts with |)
  if (!text.trim().startsWith('|')) return null

  // Split into lines
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.length < 3) return null // Need at least header, separator, and one data row

  const rows: string[][] = []

  for (const line of lines) {
    // Skip separator rows (only dashes and pipes)
    if (/^\|[\s-|]+\|$/.test(line)) continue

    // Split by | and filter empty cells
    const cells = line
      .split('|')
      .map((c) => c.trim())
      .filter(Boolean)

    if (cells.length > 0) {
      rows.push(cells)
    }
  }

  if (rows.length < 2) return null // Need at least header and one data row

  const headers = rows[0].map((h) => h.toLowerCase())
  const dataRows = rows.slice(1)

  return { headers, rows: dataRows }
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
  popularity: number,
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
  const canonical = doc.frontmatter.canonical
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
      keywords,
      availableSDKs: availableSdksList,
      canonical,
      weight: {
        pageRank: doc.frontmatter.search?.rank ?? 0,
        level: HEADING_WEIGHTS[type] ?? 0,
        position: position++,
        popularity,
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

    // Handle tables - combine each row into a single record
    if (node.type === 'table' && 'children' in node && Array.isArray(node.children)) {
      const rows = node.children as Node[]

      // Get header row to understand column structure (first row)
      const headerRow = rows[0]
      let headers: string[] = []
      if (headerRow && 'children' in headerRow && Array.isArray(headerRow.children)) {
        headers = (headerRow.children as Node[]).map((cell) => extractTextContent(cell).toLowerCase())
      }

      // Process data rows (skip header row)
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i]
        if (!row || !('children' in row) || !Array.isArray(row.children)) continue

        const cells = (row.children as Node[]).map((cell) => extractTextContent(cell))

        // Try to format intelligently based on common table structures
        let content: string

        // Common pattern: Name | Type | Description
        if (headers.length >= 3 && headers[0]?.includes('name') && headers[2]?.includes('description')) {
          const name = cells[0] || ''
          const type = cells[1] || ''
          const description = cells.slice(2).join(' ').trim()
          content = type ? `${name} (${type}) - ${description}` : `${name} - ${description}`
        }
        // Common pattern: Property | Description or Parameter | Description
        else if (
          headers.length === 2 &&
          (headers[0]?.includes('property') || headers[0]?.includes('parameter') || headers[0]?.includes('name'))
        ) {
          content = `${cells[0]} - ${cells[1]}`
        }
        // Fallback: join all cells
        else {
          content = cells.filter(Boolean).join(' - ')
        }

        content = content.trim()
        if (content.length > 0) {
          if (content.length >= 5000) {
            console.warn(`Skipping oversized table row (${content.length} chars) in ${doc.url}`)
          } else {
            records.push(createRecord('property', content, currentAnchor ?? 'main'))
          }
        }
      }

      return 'skip' // Don't process table children again
    }

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

    // Handle Properties component - combine each property into a single record
    if (
      (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') &&
      'name' in node &&
      node.name === 'Properties' &&
      'children' in node &&
      Array.isArray(node.children)
    ) {
      // Group children by thematic breaks (***) - each group is one property
      const propertyGroups: Node[][] = []
      let currentGroup: Node[] = []

      for (const child of node.children as Node[]) {
        if (child.type === 'thematicBreak') {
          if (currentGroup.length > 0) {
            propertyGroups.push(currentGroup)
            currentGroup = []
          }
        } else {
          currentGroup.push(child)
        }
      }
      // Don't forget the last group
      if (currentGroup.length > 0) {
        propertyGroups.push(currentGroup)
      }

      // Process each property group
      for (const group of propertyGroups) {
        const parts: string[] = []
        let propertyName: string | null = null
        let propertyType: string | null = null

        for (const child of group) {
          // List items contain property name and type (first two list items)
          if (child.type === 'list' && 'children' in child && Array.isArray(child.children)) {
            for (const listItem of child.children) {
              const text = extractTextContent(listItem as Node)
              if (text) {
                if (!propertyName) {
                  propertyName = text
                } else if (!propertyType) {
                  propertyType = text
                }
              }
            }
          }
          // Paragraphs contain description and CSS variable
          if (child.type === 'paragraph') {
            const text = extractTextContent(child)
            if (text) {
              parts.push(text)
            }
          }
        }

        // Combine into a single record: "propertyName (type) - description"
        if (propertyName) {
          let content = propertyName
          if (propertyType) {
            content += ` (${propertyType})`
          }
          if (parts.length > 0) {
            content += ' - ' + parts.join(' ')
          }

          if (content.length > 0) {
            if (content.length >= 5000) {
              console.warn(`Skipping oversized property (${content.length} chars) in ${doc.url}`)
            } else {
              records.push(createRecord('property', content, currentAnchor ?? 'main'))
            }
          }
        }
      }

      return 'skip' // Don't process children again
    }

    // Handle blockquotes (callouts) - check for custom anchor in callout syntax
    if (node.type === 'blockquote' && 'children' in node && Array.isArray(node.children)) {
      // Check if first child is a paragraph with callout syntax that has an anchor
      const firstChild = node.children[0]
      let calloutAnchor: string | undefined

      if (firstChild?.type === 'paragraph') {
        const firstText = extractTextContent(firstChild)
        calloutAnchor = extractCalloutAnchor(firstText)
      }

      // Use callout anchor if present, otherwise fall back to current anchor
      const anchorForCallout = calloutAnchor ?? currentAnchor ?? 'main'

      // Process all paragraphs within the blockquote
      for (const child of node.children) {
        if (child.type === 'paragraph') {
          const text = stripCalloutSyntax(extractTextContent(child))
          if (text && text.length > 0 && !text.startsWith('|')) {
            if (text.length >= 5000) {
              console.warn(`Skipping oversized blockquote content (${text.length} chars) in ${doc.url}`)
            } else {
              records.push(createRecord('content', text, anchorForCallout))
            }
          }
        }
      }

      return 'skip' // Don't process children again
    }

    // Handle paragraphs
    if (node.type === 'paragraph') {
      const text = stripCalloutSyntax(extractTextContent(node))

      // Try to parse as markdown table (inside JSX components, tables are parsed as paragraphs)
      if (text.startsWith('|')) {
        const table = parseMarkdownTable(text)
        if (table) {
          const { headers, rows } = table

          for (const cells of rows) {
            let content: string

            // Common pattern: Name | Type | Description
            if (headers.length >= 3 && headers[0]?.includes('name') && headers[2]?.includes('description')) {
              const name = cells[0] || ''
              const type = cells[1] || ''
              const description = cells.slice(2).join(' ').trim()
              content = type ? `${name} (${type}) - ${description}` : `${name} - ${description}`
            }
            // Common pattern: Property | Description or Parameter | Description
            else if (
              headers.length === 2 &&
              (headers[0]?.includes('property') || headers[0]?.includes('parameter') || headers[0]?.includes('name'))
            ) {
              content = `${cells[0]} - ${cells[1]}`
            }
            // Fallback: join all cells
            else {
              content = cells.filter(Boolean).join(' - ')
            }

            content = content.trim()
            if (content.length > 0) {
              if (content.length >= 5000) {
                console.warn(`Skipping oversized table row (${content.length} chars) in ${doc.url}`)
              } else {
                records.push(createRecord('property', content, currentAnchor ?? 'main'))
              }
            }
          }
          return
        }
      }

      // Regular paragraph content
      if (text && text.length > 0) {
        if (text.length >= 5000) {
          console.warn(`Skipping oversized paragraph (${text.length} chars) in ${doc.url}`)
        } else {
          records.push(createRecord('content', text, currentAnchor ?? 'main'))
        }
      }
      return
    }

    // Handle list items (but not those with nested lists)
    if (node.type === 'listItem' && !hasNestedBlockElements(node)) {
      const text = stripCalloutSyntax(extractTextContent(node))
      if (text && text.length > 0) {
        if (text.length >= 5000) {
          console.warn(`Skipping oversized list item (${text.length} chars) in ${doc.url}`)
        } else {
          records.push(createRecord('content', text, currentAnchor ?? 'main'))
        }
      }
      return 'skip'
    }
  })

  return records
}

/**
 * Normalizes a URL or path to a comparable docs pathname: strips origin, query string, and hash,
 * and removes a trailing slash. Used to match PostHog `pathname` values against built doc URLs.
 */
function normalizePathname(value: string): string {
  let pathname = value.trim()

  if (/^https?:\/\//i.test(pathname)) {
    try {
      pathname = new URL(pathname).pathname
    } catch {
      // not a parseable URL; fall through and treat the raw value as a path
    }
  }

  pathname = pathname.split('#')[0].split('?')[0]

  if (pathname.length > 1 && pathname.endsWith('/')) {
    pathname = pathname.slice(0, -1)
  }

  return pathname
}

/**
 * Converts a raw pageview count into a small, capped popularity bucket. Log10 so each bucket is an
 * order of magnitude of traffic: a popular page bumps a notch above a quiet one, but a page with
 * 50k views doesn't bury one with 5k. 0 (or unknown) views => 0.
 */
function popularityBucket(views: number): number {
  if (!Number.isFinite(views) || views <= 0) return 0
  return Math.min(POPULARITY_MAX_BUCKET, Math.floor(Math.log10(views)) + 1)
}

// A PostHog query node. Insights wrap their runnable query in a visualization node
// (InsightVizNode / DataTableNode) whose `source` is the actual query (TrendsQuery, HogQLQuery, …).
type PostHogQueryNode = {
  kind?: string
  source?: PostHogQueryNode
  breakdownFilter?: Record<string, unknown>
}

/**
 * Unwraps an insight's visualization node down to its runnable query, which is what the `/query/`
 * endpoint expects (it can't execute the InsightVizNode/DataTableNode wrappers directly).
 */
function unwrapInsightQuery(query: PostHogQueryNode): PostHogQueryNode {
  let node = query
  while (node && typeof node === 'object' && node.source) {
    node = node.source
  }
  return node
}

/**
 * Reads the saved PostHog insight (the source of truth for "what users are viewing"), re-runs its
 * query fresh, and returns a map of normalized pathname -> total views. Never throws: on missing
 * credentials or any API failure it logs a warning and returns an empty map, so indexing proceeds
 * with popularity 0.
 */
async function fetchPageViews(): Promise<Map<string, number>> {
  const views = new Map<string, number>()

  if (!POSTHOG_API_KEY || !POSTHOG_PROJECT_ID) {
    console.warn('⚠︎ Popularity signal disabled: set DOCS_POSTHOG_API_KEY and DOCS_POSTHOG_PROJECT_ID to enable')
    return views
  }

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${POSTHOG_API_KEY}`,
  }
  const projectApi = `${POSTHOG_HOST}/api/projects/${POSTHOG_PROJECT_ID}`

  try {
    // 1. Read the insight definition (needs the `insight:read` scope).
    const insightResponse = await fetch(`${projectApi}/insights/?short_id=${POSTHOG_INSIGHT_ID}`, { headers })
    if (!insightResponse.ok) {
      console.warn(
        `⚠︎ Popularity signal skipped: could not read insight ${POSTHOG_INSIGHT_ID} (${insightResponse.status} ${insightResponse.statusText}); key needs the 'insight:read' scope`,
      )
      return views
    }

    const insightJson = (await insightResponse.json()) as {
      results?: Array<{ name?: string; derived_name?: string; query?: PostHogQueryNode }>
    }
    const insight = insightJson.results?.[0]

    if (!insight?.query) {
      console.warn(`⚠︎ Popularity signal skipped: insight ${POSTHOG_INSIGHT_ID} has no query definition`)
      return views
    }

    const query = unwrapInsightQuery(insight.query)

    // Pull every path, not just the insight's display limit (a UI/perf setting, not relevant here).
    if (query.breakdownFilter) {
      query.breakdownFilter = { ...query.breakdownFilter, breakdown_limit: 10000 }
    }

    console.log(
      `Running insight ${POSTHOG_INSIGHT_ID}${insight.name ? ` ("${insight.name}")` : ''} [${query.kind ?? 'unknown'}]`,
    )

    // 2. Execute the insight's query fresh (avoids stale cached results; needs the `query:read` scope).
    const queryResponse = await fetch(`${projectApi}/query/`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query }),
    })
    if (!queryResponse.ok) {
      console.warn(
        `⚠︎ Popularity signal skipped: insight query failed (${queryResponse.status} ${queryResponse.statusText}); key needs the 'query:read' scope`,
      )
      return views
    }

    const data = (await queryResponse.json()) as {
      results?: Array<{
        label?: string
        breakdown_value?: string | string[]
        aggregated_value?: number
        count?: number
      }>
    }

    for (const row of data.results ?? []) {
      const rawPath = Array.isArray(row.breakdown_value) ? row.breakdown_value[0] : row.breakdown_value ?? row.label
      const count = row.aggregated_value ?? row.count ?? 0
      if (typeof rawPath !== 'string' || rawPath.length === 0) continue
      const pathname = normalizePathname(rawPath)
      // The insight may include non-docs paths; only docs paths can match a record anyway.
      if (!pathname.startsWith(BASE_DOCS_URL)) continue
      views.set(pathname, (views.get(pathname) ?? 0) + count)
    }

    console.log(`✓ Fetched pageviews for ${views.size} docs paths from insight ${POSTHOG_INSIGHT_ID}`)
  } catch (error) {
    console.warn(`⚠︎ Popularity signal skipped: ${(error as Error).message}`)
  }

  return views
}

async function main() {
  if (VERCEL_ENV === 'preview') {
    if (DEBUG_SEARCH_BRANCH !== undefined) {
      console.log(`⚠︎ DEBUG MODE - Using branch: ${DEBUG_SEARCH_BRANCH}`)
    } else {
      console.log(
        `To update the dev algolia search index on a preview deployment, you must set the DEBUG_SEARCH_BRANCH environment variable`,
      )
      process.exit(0)
    }
  }

  const gitBranch = getGitBranch()
  const recordBatch = randomUUID()

  if (DRY_RUN) {
    console.log('⚠︎ DRY RUN MODE - No changes will be made to Algolia\n')
  }

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

  // Pull popularity (pageviews per path) up front; looked up per doc by URL below.
  const pageViews = await fetchPageViews()
  const popularityHistogram = new Map<number, number>()

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

    frontmatter = frontmatterSchema.parse(frontmatter)

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
    const popularity = popularityBucket(pageViews.get(normalizePathname(url)) ?? 0)
    popularityHistogram.set(popularity, (popularityHistogram.get(popularity) ?? 0) + 1)

    const records = generateRecordsFromDoc(
      {
        filePath,
        url,
        frontmatter,
        node,
      },
      gitBranch,
      recordBatch,
      popularity,
    )
    allRecords.push(...records)
    processed++
  }

  console.log(`✓ Processed ${processed} files, skipped ${skipped}`)
  console.log(`✓ Generated ${allRecords.length} search records`)

  if (pageViews.size > 0) {
    const summary = Array.from(popularityHistogram.entries())
      .sort(([a], [b]) => a - b)
      .map(([bucket, count]) => `${bucket}:${count}`)
      .join('  ')
    console.log(`✓ Popularity buckets (bucket:pages) → ${summary}`)
  }

  if (DRY_RUN) {
    await fs.mkdir(ALGOLIA_OUTPUT_DIR, { recursive: true })
    await fs.writeFile(path.join(ALGOLIA_OUTPUT_DIR, 'records.json'), JSON.stringify(allRecords, null, 2))
    console.log(`⚠︎ DRY RUN: Wrote ${allRecords.length} records to .algolia/records.json`)
    return
  }

  const { ALGOLIA_API_KEY, ALGOLIA_APP_ID, ALGOLIA_INDEX_NAME } = z
    .object({
      ALGOLIA_API_KEY: z.string(),
      ALGOLIA_APP_ID: z.string(),
      ALGOLIA_INDEX_NAME: z.string(),
    })
    .parse(process.env)

  const algolia = algoliasearch(ALGOLIA_APP_ID, ALGOLIA_API_KEY)

  // The popularity signal only takes effect if the index `customRanking` includes
  // desc(weight.popularity) — ideally right after desc(weight.pageRank). This is managed manually
  // per index in the Algolia dashboard (dev_docs is done; prod_docs still needs it), not here.

  // Push to Algolia
  console.log('\nPushing records to Algolia...')

  await algolia.chunkedBatch({
    indexName: ALGOLIA_INDEX_NAME,
    action: 'updateObject',
    waitForTasks: true,
    objects: allRecords.map((record) => ({
      ...record,
      objectID: record.objectID,
    })),
  })

  console.log('✓ All records pushed successfully!')

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
