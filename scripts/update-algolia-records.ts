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
import { algoliasearch, type SynonymHit } from 'algoliasearch'
import 'dotenv/config'
import { execSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
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
import { VALID_SDKS } from './lib/schemas'

type RecordType = 'lvl0' | 'lvl1' | 'lvl2' | 'lvl3' | 'lvl4' | 'lvl5' | 'lvl6' | 'content' | 'property'

type SearchRecord = {
  objectID: string
  branch: string
  anchor: string
  content: string | null
  type: RecordType
  keywords: string[]
  availableSDKs: string[]
  // The SDK(s) the client's active-SDK optionalFilters boost can match on this record.
  // Per-SDK variants carry the single SDK the variant was built for (`activeSdk` frontmatter):
  // `availableSDKs` is the page's full support list and is identical across a page's
  // per-SDK variants, so it can't disambiguate them after `distinct` collapses the
  // group — `sdk` lets search boost the active SDK's variant as the representative.
  // Universal (non-SDK-scoped) pages carry every current SDK key — see recordSDK.
  sdk: string | string[]
  canonical: string
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
  // Epoch ms of the moment the record was pushed — stamped in main() immediately before the
  // chunkedBatch call (NOT at run start; generation takes a minute+), so it's optional on the
  // built record. The stale-record cleanup only deletes records older than the run's start minus
  // STALE_RECORD_GRACE_MS, so a concurrent run's fresh push can never be classified as stale.
  // Records indexed before this field existed have none (treated as stale).
  indexed_at?: number
}

// Dot-paths into a SearchRecord (e.g. `content`, `hierarchy.lvl0`, `weight.pageRank`). The Algolia
// settings below reference record fields as bare strings; deriving the allowed strings from the
// record shape makes a typo or a renamed/removed field a compile error instead of a silently broken
// index. Scalars and arrays are leaves; nested objects recurse into `parent.child` paths.
type Scalar = string | number | boolean | bigint | symbol | null | undefined
type RecordPath<T> = {
  [K in Extract<keyof T, string>]: NonNullable<T[K]> extends Scalar | ReadonlyArray<unknown>
    ? K
    : K | `${K}.${RecordPath<NonNullable<T[K]>>}`
}[Extract<keyof T, string>]
type SearchAttribute = RecordPath<SearchRecord>

// Typed wrappers for Algolia's attribute modifiers. The argument is constrained to a real record
// path, so the settings can only ever reference fields that exist.
const plain = <T extends SearchAttribute>(attribute: T) => attribute
const unordered = <T extends SearchAttribute>(attribute: T) => `unordered(${attribute})` as const
const filterOnly = <T extends SearchAttribute>(attribute: T) => `filterOnly(${attribute})` as const
const desc = <T extends SearchAttribute>(attribute: T) => `desc(${attribute})` as const
const asc = <T extends SearchAttribute>(attribute: T) => `asc(${attribute})` as const

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

// Which repo a Vercel build is running from — see the repo guard in main(). `VERCEL` is '1' on
// any Vercel build; the owner/slug pair distinguishes clerk/clerk from the clerk/clerk-docs mirror.
const VERCEL = process.env.VERCEL
const VERCEL_GIT_REPO_OWNER = process.env.VERCEL_GIT_REPO_OWNER
const VERCEL_GIT_REPO_SLUG = process.env.VERCEL_GIT_REPO_SLUG

// Parse command line arguments
const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')

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

// How much older than the current run's start a record must be before the cleanup may delete it.
// Thirty minutes: several times the worst-case overlap between concurrent Vercel builds (a build
// takes ~5 minutes) plus clock skew between build machines; short enough that true leftovers
// (records for removed pages) linger for at most half an hour before a later run cleans them.
// Lingering removed-page records are invisible to users; wrongly deleting a freshly pushed live
// set is an outage — when in doubt, size this up, not down.
export const STALE_RECORD_GRACE_MS = 30 * 60 * 1000

/**
 * Whether a record from another batch is genuinely stale — old enough to predate this run — as
 * opposed to a concurrent run's fresh push, which must be spared (see the cleanup in main()).
 * Records indexed before `indexed_at` existed carry no timestamp and are treated as stale.
 */
export function isStaleRecord(record: { indexed_at?: number }, runStart: number): boolean {
  return record.indexed_at === undefined || record.indexed_at < runStart - STALE_RECORD_GRACE_MS
}

// Branches whose records are LIVE in each shared index — everything else is orphaned accumulation
// (DOCS-11871). Hardcoded on purpose: the set changes roughly once per Core version, and a reviewed
// PR is the right (auditable) way to change what the sweep may delete — an env var typo must never
// be able to widen it. Each entry names its consumer:
//   prod_docs `main`            — clerk.com/docs; the client filters facetFilters ['branch:main']
//                                 (clerk/clerk src/app/docs/Search.tsx via DOCS_PRODUCTION_BRANCH).
//   prod_docs `core-1`/`core-2` — the archived Core docs (clerk-frozen-core-{1,2}.clerkstage.dev,
//                                 branch domains on the clerk Vercel project) query prod_docs with
//                                 branch:core-1 / branch:core-2. Frozen legacy sets; no writer
//                                 refreshes them; they must never be swept.
//   dev_docs `main`             — local dev + preview deploys read dev_docs filtering branch:main.
// core-3 is deliberately absent everywhere: merged into main, /docs/core-3 308-redirects to /docs,
// no deployment queries it.
export const INDEX_LIVE_BRANCHES: Record<string, readonly string[]> = {
  prod_docs: ['main', 'core-1', 'core-2'],
  dev_docs: ['main'],
}

/**
 * The effective allowlist for the orphan sweep: the index's live branches plus the current run's
 * own branch (belt-and-suspenders — its records also carry a fresh indexed_at, but the sweep must
 * never depend on a single guard). Returns null for an index with no INDEX_LIVE_BRANCHES entry
 * (personal/throwaway indexes): no allowlist means the sweep skips entirely rather than guessing.
 */
export function resolveSweepAllowlist(indexName: string, gitBranch: string): Set<string> | null {
  const liveBranches = INDEX_LIVE_BRANCHES[indexName]
  if (liveBranches === undefined) return null
  return new Set([...liveBranches, gitBranch])
}

/**
 * Negated facet filters selecting every record whose `branch` is NOT allowlisted. Array elements
 * are ANDed by Algolia, so ['branch:-main', 'branch:-core-1'] = NOT main AND NOT core-1. Records
 * with no `branch` attribute match every negation and are sweep candidates — correct, since every
 * query client filters on branch:<value>, which such records can never match.
 */
export function buildSweepFilters(allowlist: Set<string>): string[] {
  return [...allowlist].map((branch) => `branch:-${branch}`)
}

// Hard ceiling on how many records a single orphan sweep may delete. Sized between the largest
// legitimate orphan event (a full retired branch set — core-2 is ~34k) and index-wipe scale
// (branch:main alone is ~64k): a sweep that wants more than this is a bug or a tagging-scheme
// change, and it aborts without deleting anything. The env var can LOWER this, never raise it —
// a set above the ceiling needs a supervised cleanup (DOCS-11872), and no env typo may widen the
// blast radius.
export const DEFAULT_ORPHAN_SWEEP_MAX = 50_000

/** off = sweep code never runs (default) · dry = browse + log candidates, delete nothing · on = delete. */
export function parseOrphanSweepMode(value: string | undefined): 'off' | 'dry' | 'on' {
  return z.enum(['off', 'dry', 'on']).catch('off').parse(value)
}

export function parseOrphanSweepMax(value: string | undefined): number {
  const parsed = z.coerce.number().int().positive().catch(DEFAULT_ORPHAN_SWEEP_MAX).parse(value)
  return Math.min(parsed, DEFAULT_ORPHAN_SWEEP_MAX)
}

/**
 * Preview builds never delete: an `on` sweep during any DEBUG_SEARCH_BRANCH preview run would
 * sweep colleagues' >30-min-old dev_docs test branches, since dev_docs's allowlist only covers
 * main plus the run's own branch. Downgrade to dry — visibility without deletion. Supervised
 * dev_docs cleanups run locally instead, where VERCEL_ENV is unset.
 */
export function effectiveSweepMode(
  requested: 'off' | 'dry' | 'on',
  vercelEnv: string | undefined,
): 'off' | 'dry' | 'on' {
  return vercelEnv === 'preview' && requested === 'on' ? 'dry' : requested
}

export type SweepHit = { objectID: string; indexed_at?: number; branch?: string }

/**
 * Splits the orphan sweep's browse results into deletions and spared records. Hits arrive already
 * filtered to non-allowlisted branches (buildSweepFilters); this applies the same isStaleRecord
 * grace as the own-branch cleanup — a fresh push under an unexpected branch value is a concurrent
 * writer, not an orphan — and builds a per-branch histogram for the build-log audit trail.
 */
export function partitionOrphans(
  hits: SweepHit[],
  runStart: number,
): { toDelete: string[]; sparedFresh: number; byBranch: Record<string, number> } {
  const toDelete: string[] = []
  let sparedFresh = 0
  const byBranch: Record<string, number> = {}

  for (const hit of hits) {
    if (isStaleRecord(hit, runStart)) {
      toDelete.push(hit.objectID)
      const branch = hit.branch ?? '<no branch>'
      byBranch[branch] = (byBranch[branch] ?? 0) + 1
    } else {
      sparedFresh++
    }
  }

  return { toDelete, sparedFresh, byBranch }
}

/**
 * Orphan-branch sweep (DOCS-11871). The own-branch cleanup in main() only ever sees this run's
 * branch, so records under any OTHER branch value accumulate forever (e.g. 33k dead core-3 records
 * found 2026-06). This sweeps records whose branch is not in the index's live set, reusing the
 * same isStaleRecord grace window — a concurrent writer's fresh push under an unexpected branch is
 * spared. NOTE: for known-live archive branches (core-1/core-2) the allowlist is the ONLY guard —
 * their legacy records predate indexed_at — which is why INDEX_LIVE_BRANCHES is hardcoded and
 * PR-reviewed. Algolia access is injected (browse/deleteObjects) so every decision path is
 * unit-tested; the only untested code is the two thin wrappers at the call site.
 */
export async function runOrphanSweep(options: {
  indexName: string
  gitBranch: string
  runStart: number
  mode: 'dry' | 'on'
  cap: number
  browse: (facetFilters: string[]) => Promise<SweepHit[]>
  deleteObjects: (objectIDs: string[]) => Promise<number>
}): Promise<{
  outcome: 'skipped' | 'clean' | 'aborted' | 'dry' | 'swept'
  candidates: string[]
  sparedFresh: number
  byBranch: Record<string, number>
}> {
  const { indexName, gitBranch, runStart, mode, cap, browse, deleteObjects } = options

  const allowlist = resolveSweepAllowlist(indexName, gitBranch)
  if (allowlist === null) {
    console.log(`✓ Skipping orphan sweep — "${indexName}" has no INDEX_LIVE_BRANCHES entry (personal/throwaway index?)`)
    return { outcome: 'skipped', candidates: [], sparedFresh: 0, byBranch: {} }
  }

  const hits = await browse(buildSweepFilters(allowlist))
  const { toDelete, sparedFresh, byBranch } = partitionOrphans(hits, runStart)

  // The histogram is the audit trail: every non-off run records in the build log exactly which
  // branches would be (or were) deleted, and how many records each held.
  console.log(`Orphan sweep candidates: ${toDelete.length} ${JSON.stringify(byBranch)}`)
  if (sparedFresh > 0) {
    console.log(`⚠︎ Spared ${sparedFresh} recently indexed records under non-live branches — a concurrent writer?`)
  }

  const result = { candidates: toDelete, sparedFresh, byBranch }

  if (toDelete.length === 0) {
    console.log('✓ No orphaned records found')
    return { outcome: 'clean', ...result }
  }
  if (toDelete.length > cap) {
    console.warn(
      `⚠︎ ABORTING orphan sweep: ${toDelete.length} candidates exceed the ${cap} cap. ` +
        `Nothing deleted. A set this large needs a supervised cleanup (see DOCS-11872), not automation.`,
    )
    return { outcome: 'aborted', ...result }
  }
  if (mode === 'dry') {
    console.log(`⚠︎ DRY: would delete ${toDelete.length} orphaned records (no changes made)`)
    return { outcome: 'dry', ...result }
  }

  const sweptRecords = await deleteObjects(toDelete)
  console.log(`✓ Swept ${sweptRecords} orphaned records`)
  return { outcome: 'swept', ...result }
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
 * The `sdk` value written to a doc's records — what the client's active-SDK `optionalFilters`
 * boost can match. Per-SDK variants carry the single SDK the variant was built for (`activeSdk`
 * frontmatter). Universal (non-SDK-scoped) pages carry every current SDK key instead of nothing:
 * the `filters` ranking criterion sits above `attribute`/`exact` on this index, so a record
 * matching zero of the client's `sdk:` boosts structurally loses to ANY boosted record that
 * matches the query — exact-title universal pages ("How Clerk works") were buried under
 * body-content matches from SDK-scoped pages (DOCS-11910). Carrying the full list makes
 * universal records tie the active SDK's own records on `filters`, and the tie falls through
 * to `attribute`/`exact`, where title matches win.
 */
export function recordSDK(activeSdk: string | undefined): string | string[] {
  return activeSdk ?? [...VALID_SDKS]
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
  // The SDK(s) the active-SDK boost can match on this doc's records — see recordSDK
  const sdk = recordSDK(doc.frontmatter.activeSdk)
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
      sdk,
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

// Synonyms are codified and enforced every run (replaceExistingSynonyms), same model as ranking.
// Acronym ⇄ expansion pairs are auto-derived from the `_tooltips` glossary so they stay in sync as
// tooltips are added; a curated list covers product-rename/phrasing synonyms that aren't glossary
// definitions (e.g. "magic link" → "email link", "login" → "sign in"). Tooltip content is excluded
// from the search index, so without these these terms would miss entirely.
//
// The pure logic below (`buildSynonyms` + helpers) is split from the disk I/O (`readSynonyms`) so it
// can be unit-tested without the filesystem — see `update-algolia-records.test.ts`.

export type TooltipFile = {
  /** The tooltip file name, e.g. `dkim.mdx`. Used only to derive a stable objectID. */
  fileName: string
  content: string
}

export const isAcronym = (s: string) => /^[A-Z][A-Za-z0-9]{2,7}$/.test(s.trim())

export const cleanSynonym = (s: string) =>
  s
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // strip markdown links: [text](url) -> text
    .replace(/&/g, 'and')
    .replace(/,/g, '')
    .replace(/\s+/g, ' ')
    .trim()

// Curated product-rename / phrasing synonyms (not glossary acronyms).
export const CURATED_SYNONYMS: Record<string, string[]> = {
  'magic-link': ['magic link', 'email link'],
  i18n: ['i18n', 'internationalization', 'localization', 'l10n'],
  login: ['login', 'log in', 'sign in', 'signin'],
  logout: ['logout', 'log out', 'sign out'],
  signup: ['signup', 'sign up', 'register', 'registration'],
  'social-connection': ['social login', 'social connection'],
  sso: ['SSO', 'single sign-on'],
  rbac: ['RBAC', 'role-based access control'],
  mfa: ['MFA', '2FA', 'multi-factor authentication', 'two-factor authentication'],
  jwks: ['JWKS', 'JSON Web Key Set'],
  // Plural forms are required: Algolia synonyms are literal (ignorePlurals is off), and the
  // flagship page is titled "Organizations" — singular-only synonyms leave "org"/"orgs"
  // matching Backend Organization* reference pages instead (DOCS-11910).
  org: ['org', 'orgs', 'organization', 'organizations'],
  'multi-tenant': ['multi-tenant', 'multitenant', 'multi-tenancy', 'multitenancy'],
}

// one-way: searching "webauthn" should surface passkey docs, not the reverse.
export const ONE_WAY_SYNONYMS: SynonymHit[] = [
  { objectID: 'webauthn-passkey', type: 'oneWaySynonym', input: 'webauthn', synonyms: ['passkey', 'passkeys'] },
  // One-way on purpose: "b2b" should surface Organizations (the marketing framing at
  // clerk.com/organizations), but "organizations" queries must not start matching every
  // B2B-titled page — the billing-for-b2b guide already owns exact "b2b" title matches.
  { objectID: 'b2b-organizations', type: 'oneWaySynonym', input: 'b2b', synonyms: ['organizations'] },
]

// Extract the first acronym ⇄ expansion pair from a single tooltip's markdown, or null if none.
//
//   Format A: **X (Y)** — one of X/Y is the acronym (e.g. "DKIM (DomainKeys Identified Mail)").
//   Format B: **X** stands for 'Y' (e.g. "WYSIWYG stands for 'What You See Is What You Get'").
export function extractTooltipSynonym(content: string): { acronym: string; expansion: string } | null {
  for (const [, bold] of content.matchAll(/\*\*([^*]+?)\*\*/g)) {
    const paren = cleanSynonym(bold).match(/^(.+?)\s*\(([^)]+)\)\s*(.*)$/)
    if (!paren) continue
    const left = paren[1].trim()
    const right = `${paren[2]} ${paren[3]}`.trim()
    if (isAcronym(left) && !isAcronym(right)) return { acronym: left, expansion: right }
    if (isAcronym(right) && !isAcronym(left)) return { acronym: right, expansion: left }
  }

  const sf = content.match(/\*\*([^*]+?)\*\*\s+stands for\s+['"]([^'"]+)['"]/)
  if (sf && isAcronym(sf[1].trim())) return { acronym: sf[1].trim(), expansion: cleanSynonym(sf[2]) }

  return null
}

// Build the full set of synonyms from the tooltip glossary files plus the curated and one-way lists.
export function buildSynonyms(tooltipFiles: TooltipFile[]): SynonymHit[] {
  const byId = new Map<string, SynonymHit>()

  // 1. Auto-extract acronym ⇄ expansion pairs from the tooltip glossary.
  for (const { fileName, content } of tooltipFiles) {
    if (!fileName.endsWith('.mdx')) continue
    const pair = extractTooltipSynonym(content)
    if (!pair) continue
    const objectID = `tooltip-${pair.acronym.toLowerCase()}`
    byId.set(objectID, { objectID, type: 'synonym', synonyms: [pair.acronym, pair.expansion] })
  }

  // 2. Curated product-rename / phrasing synonyms (not glossary acronyms).
  for (const [objectID, synonyms] of Object.entries(CURATED_SYNONYMS)) {
    byId.set(objectID, { objectID, type: 'synonym', synonyms })
  }

  return [...byId.values(), ...ONE_WAY_SYNONYMS]
}

// Reads the `_tooltips` glossary off disk and hands the file contents to `buildSynonyms`.
async function readSynonyms(): Promise<SynonymHit[]> {
  const tooltipsDir = path.join(__dirname, '../docs/_tooltips')

  // A genuinely-absent directory is the only tolerable degrade-to-curated case (and the only one
  // where dropping the tooltip-derived synonyms is *correct*), so check for it up front and bail.
  // The reads below are deliberately left un-caught: saveSynonyms runs with replaceExistingSynonyms,
  // so swallowing a transient/permission failure (EACCES, EMFILE from the concurrent reads, …) would
  // silently wipe every branch's tooltip-derived synonyms index-wide (synonyms aren't branch-scoped).
  // Anything other than "not there" should fail the run loudly, not quietly ship half the set.
  if (!existsSync(tooltipsDir)) {
    console.warn('⚠︎ _tooltips directory not found; using the curated synonym list only')
    return buildSynonyms([])
  }

  const fileNames = (await fs.readdir(tooltipsDir)).filter((file) => file.endsWith('.mdx'))
  const tooltipFiles = await Promise.all(
    fileNames.map(async (fileName) => ({
      fileName,
      content: await fs.readFile(path.join(tooltipsDir, fileName), 'utf-8'),
    })),
  )

  return buildSynonyms(tooltipFiles)
}

async function main() {
  // Only clerk/clerk may index from Vercel. The clerk/clerk-docs repo is a public read-only
  // mirror of the clerk-docs folder, synced on every clerk/clerk main commit
  // (.github/workflows/sync-clerk-docs.yml in clerk/clerk), so its Vercel project builds the
  // same commit at the same time as clerk/clerk's. When both ran this script, the two runs
  // raced the stale-record cleanup below: each pushed the same objectIDs under a different
  // record_batch, and the later cleanup deleted the other run's entire push as "stale" —
  // which emptied every live record out of prod search on 2026-07-07. The mirror's
  // vercel.json buildCommand no longer runs search:update; this guard is defense in depth
  // for any other surface that builds a non-clerk/clerk checkout. Local runs (no VERCEL env)
  // are unaffected.
  if (VERCEL === '1' && !(VERCEL_GIT_REPO_OWNER === 'clerk' && VERCEL_GIT_REPO_SLUG === 'clerk')) {
    console.log(
      `Skipping search index update — indexing only runs from clerk/clerk, not ${VERCEL_GIT_REPO_OWNER}/${VERCEL_GIT_REPO_SLUG}`,
    )
    process.exit(0)
  }

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
  const runStart = Date.now()

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

  // Search settings the docs search depends on, codified here (not the dashboard) so every
  // index — prod, dev, and one-off test indexes — stays consistent and human-proof. These are the
  // source of truth: we overwrite them on every run, so any dashboard edit is reverted on the next
  // index run. `setSettings` is a top-level partial merge — it only replaces the keys passed below
  // and leaves everything else (typo tolerance, pagination, highlighting, etc.) untouched. We
  // declare the relevance settings we deliberately own — never a full settings snapshot, which
  // would also freeze Algolia's server-managed defaults.
  //
  // Scope: records (above) are branch-scoped — tagged `branch:` and filtered by the client, so many
  // branches share one index without colliding. Settings + synonyms (below) are index-WIDE; Algolia
  // has no per-branch settings, so a run from any branch re-applies them to every branch's records in
  // that index. Fine for these canonical codified values; to try *different* settings in isolation,
  // point ALGOLIA_INDEX_NAME at a personal throwaway index (we don't spin up one per branch).
  //
  // Searchable attributes — the search corpus and its attribute-level priority. Order matters: the
  // `attribute` ranking criterion (below) ranks by which attribute matched, in this order, so a
  // heading match (`hierarchy.lvlN`) outranks one only in `content` — the foundation the ranking
  // reorder relies on. Mirrors the DocSearch crawler layout; `unordered(...)` ignores word position
  // within an attribute. If a new searchable field is ever added to records, add it here too.
  const searchableAttributes = [
    unordered('hierarchy.lvl0'),
    unordered('hierarchy.lvl1'),
    unordered('hierarchy.lvl2'),
    unordered('hierarchy.lvl3'),
    unordered('hierarchy.lvl4'),
    unordered('hierarchy.lvl5'),
    unordered('hierarchy.lvl6'),
    plain('content'),
    unordered('keywords'),
  ]
  //
  // Faceting — `filterOnly` (filter, no facet counts) since these are only ever used to filter,
  // never shown as user-facing facets. Required: facetFilters/optionalFilters on a non-faceted
  // attribute fail or silently no-op.
  //   - `branch`       — facetFilter on the search query + the stale-record cleanup browse
  //   - `record_batch` — facetFilter in the stale-record cleanup browse
  //   - `sdk`          — the active-SDK boost (optionalFilters)
  // `availableSDKs` is deliberately NOT faceted: the client only retrieves it to render per-result
  // SDK icons (Search.tsx `SDKsIcon`), never filters or counts on it, and retrieval is independent
  // of faceting.
  const attributesForFaceting = [filterOnly('branch'), filterOnly('record_batch'), filterOnly('sdk')]
  //
  // Ranking: `attribute`/`exact` are moved above `proximity` (vs Algolia's default order) so a
  // query that matches a page's title/heading outranks one that only matches the same words in
  // body content. e.g. for "sign in page" the "Build your own sign-in page" guide and the
  // Quickstart surface above reference pages whose body merely mentions the phrase, while
  // reference-name queries like `auth()` still win on their exact title match. See the design doc.
  const ranking = ['typo', 'geo', 'words', 'filters', 'attribute', 'exact', 'proximity', 'custom']
  //
  // Custom ranking — the final tiebreaker (the `custom` criterion above). Matches the weights the
  // indexer actually writes to each record's `weight` object: `pageRank` (frontmatter `search.rank`),
  // `level` (heading depth), `position` (document order). `weight.popularity` is intentionally
  // absent — it's never written to records, so a `desc(weight.popularity)` entry (leftover on some
  // indexes) is dead config that ranks nothing.
  const customRanking = [desc('weight.pageRank'), desc('weight.level'), asc('weight.position')]
  //
  // Deduplication — the linchpin of the per-SDK variant model. Each SDK variant of a page emits its
  // own records sharing one `distinct_group` (canonical URL + anchor; see createRecord above).
  // Collapsing each group to a single representative makes a page appear once instead of once per
  // SDK, and the `sdk` optionalFilters boost lets the active SDK's variant win that collapse.
  // `attributeForDistinct` is index-level only — it CANNOT be set per query — so it must be codified
  // here; without it Algolia ignores `distinct` entirely and every page returns one result per SDK
  // variant. `distinct: true` defaults dedup on at the index level so it's enforced even if a query
  // omits the flag (the `clerk/clerk` client also passes `distinct: true`, but we don't rely on it).
  // Both must stay in sync with the `distinct_group` field written to each record.
  const attributeForDistinct = plain('distinct_group')
  const distinct = true

  // Settings deliberately do NOT forward to replicas, though synonyms (below) do. Synonyms should
  // always be identical across replicas; settings bundle ranking/customRanking, which a standard
  // replica may legitimately override for an alternate sort — forwarding would clobber it. No
  // replicas today; if any are added, declare them in this script rather than blanket-forwarding.
  console.log(`Applying search settings to ${ALGOLIA_INDEX_NAME}`)
  await algolia.setSettings({
    indexName: ALGOLIA_INDEX_NAME,
    indexSettings: {
      searchableAttributes,
      attributesForFaceting,
      ranking,
      customRanking,
      attributeForDistinct,
      distinct,
    },
  })

  // Synonyms (codified, enforced — replaceExistingSynonyms) — see readSynonyms above.
  const synonyms = await readSynonyms()
  console.log(`Setting ${synonyms.length} synonyms on ${ALGOLIA_INDEX_NAME}`)
  await algolia.saveSynonyms({
    indexName: ALGOLIA_INDEX_NAME,
    synonymHit: synonyms,
    forwardToReplicas: true,
    replaceExistingSynonyms: true,
  })

  // Push to Algolia
  console.log('\nPushing records to Algolia...')

  // Stamped here, not at runStart: record generation takes a minute or more, and a stalled run
  // must not push records that already look older than they are — indexed_at is what OTHER runs'
  // cleanups judge freshness by. (This run's own cleanup cutoff below uses runStart, which is
  // earlier and therefore the conservative side for deletions.)
  const indexedAt = Date.now()

  await algolia.chunkedBatch({
    indexName: ALGOLIA_INDEX_NAME,
    action: 'updateObject',
    waitForTasks: true,
    objects: allRecords.map((record) => ({
      ...record,
      objectID: record.objectID,
      indexed_at: indexedAt,
    })),
  })

  console.log('✓ All records pushed successfully!')

  // Clean up stale records
  console.log('\nCleaning up stale records...')

  // Browse this branch's records from other batches. A different batch alone is NOT enough to
  // call a record stale: a concurrent run of this script (two quick merges → overlapping Vercel
  // builds) pushes the same objectIDs under its own record_batch, and deleting on batch alone
  // raced exactly that way on 2026-07-07 — the later cleanup deleted the other run's entire
  // fresh push, emptying prod search. isStaleRecord additionally requires the record to predate
  // this run by STALE_RECORD_GRACE_MS, so another run's fresh push is always spared; its true
  // leftovers (removed pages) age past the window and get cleaned by a later run.
  const staleObjectIDs: string[] = []
  let sparedFresh = 0

  await algolia.browseObjects({
    indexName: ALGOLIA_INDEX_NAME,
    browseParams: {
      // We want records that are of the branch we are updating, but not the current batch
      facetFilters: [`record_batch:-${recordBatch}`, `branch:${gitBranch}`],
      attributesToRetrieve: ['objectID', 'indexed_at'],
    },
    aggregator: (response) => {
      for (const hit of response.hits as Array<{ objectID: string; indexed_at?: number }>) {
        if (isStaleRecord(hit, runStart)) {
          staleObjectIDs.push(hit.objectID)
        } else {
          sparedFresh++
        }
      }
    },
  })

  if (sparedFresh > 0) {
    console.log(`⚠︎ Spared ${sparedFresh} recently indexed records from another batch — likely a concurrent run`)
  }

  if (staleObjectIDs.length === 0) {
    console.log('✓ No stale records found')
  } else {
    // Tripwire: deleting more records than half of what this run just pushed is only expected
    // after a large restructure or a tagging-scheme change. Make it loud so a future mass
    // deletion is investigated from the build log instead of discovered as an empty search.
    if (staleObjectIDs.length > allRecords.length / 2) {
      console.warn(
        `⚠︎ Deleting ${staleObjectIDs.length} stale records — more than half of the ${allRecords.length} just pushed. Expected only after a big restructure; if search looks empty, check for competing indexing runs.`,
      )
    }
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

  // Resolved here, not at module top level: parseOrphanSweepMax closes over the mid-file
  // DEFAULT_ORPHAN_SWEEP_MAX const, which is in its temporal dead zone during module init.
  const requestedSweepMode = parseOrphanSweepMode(process.env.ALGOLIA_ORPHAN_SWEEP)
  const sweepMode = effectiveSweepMode(requestedSweepMode, VERCEL_ENV)

  if (sweepMode !== requestedSweepMode) {
    console.warn(
      `⚠︎ Downgrading orphan sweep to "dry" on a Preview build — "on" here could delete colleagues' ` +
        `DEBUG_SEARCH_BRANCH test records in dev_docs. Run supervised cleanups locally instead.`,
    )
  }

  if (sweepMode !== 'off') {
    console.log(`\nOrphan-branch sweep (mode: ${sweepMode})...`)
    await runOrphanSweep({
      indexName: ALGOLIA_INDEX_NAME,
      gitBranch,
      runStart,
      mode: sweepMode,
      cap: parseOrphanSweepMax(process.env.ALGOLIA_ORPHAN_SWEEP_MAX),
      browse: async (facetFilters) => {
        const hits: SweepHit[] = []
        await algolia.browseObjects({
          indexName: ALGOLIA_INDEX_NAME,
          browseParams: {
            facetFilters,
            attributesToRetrieve: ['objectID', 'indexed_at', 'branch'],
          },
          aggregator: (response) => {
            hits.push(...(response.hits as SweepHit[]))
          },
        })
        return hits
      },
      deleteObjects: async (objectIDs) => {
        const batches = await algolia.chunkedBatch({
          indexName: ALGOLIA_INDEX_NAME,
          action: 'deleteObject',
          waitForTasks: true,
          objects: objectIDs.map((objectID) => ({ objectID })),
        })
        return batches.reduce((acc, batch) => acc + batch.objectIDs.length, 0)
      },
    })
  }

  console.log('\n✓ Update complete!')
}

// Only run when executed directly (e.g. `bun ./scripts/update-algolia-records.ts`), not when this
// module is imported — e.g. by `update-algolia-records.test.ts`, which needs the exported helpers.
// `import.meta.main` is a bun runtime flag not present in the Node type defs, hence the cast.
if ((import.meta as { main?: boolean }).main) {
  main()
}
