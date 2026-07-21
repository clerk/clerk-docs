#!/usr/bin/env bun

// Search relevance regression suite. Replays every ranking promise in
// `search-regression-queries.ts` against a live Algolia index, mirroring the clerk/clerk search
// client's query shape (facetFilters branch, active-SDK optionalFilters boost, distinct).
//
// This is the required gate for any change to relevance settings, synonyms, boosts, or
// `search.rank`/`search.keywords` frontmatter — run it against a personal test index carrying the
// candidate change before merging, and add a golden entry for any new ranking a PR advertises.
//
// Usage:
//   pnpm search:regression --index <name>              # golden-query run (exit 1 on any failure)
//   pnpm search:regression --index <name> --audit      # corpus self-rank audit (every page queried
//                                                      # by its own title; fails under --min-pass %)
//   ALGOLIA_INDEX_NAME=<name> pnpm search:regression   # --index falls back to ALGOLIA_INDEX_NAME
//
// Options:
//   --branch <name>       branch facet to query (default: main)
//   --min-pass <pct>      audit pass-rate gate (default: 99)
//   --skip-settings-check trust the index without asserting its settings match the codified ones
//
// Environment: ALGOLIA_APP_ID + ALGOLIA_API_KEY (same as the indexer; loaded via dotenv). The
// settings assertion needs a key with the `settings` ACL — with a search-only key the run FAILS
// unless --skip-settings-check is passed explicitly (results from an index whose settings
// drifted or haven't propagated can lie).

import { algoliasearch } from 'algoliasearch'
import 'dotenv/config'
import { REGRESSION_CASES, type RegressionCase } from './search-regression-queries'
import {
  ATTRIBUTE_FOR_DISTINCT,
  ATTRIBUTES_FOR_FACETING,
  CUSTOM_RANKING,
  DISTINCT,
  RANKING,
  SEARCHABLE_ATTRIBUTES,
} from './update-algolia-records'

// --- pure helpers (unit-tested in search-regression.test.ts) ---

// Mirrors Search.tsx: characters Algolia treats as operators are escaped before querying.
export const escapeQuery = (query: string) => query.replace(/[()<>]/g, '\\$&')

// A record's URL path, recovered from its objectID (`<branch>-<position>-<url>#<anchor>`).
export const urlFromObjectID = (objectID: string, branch: string) =>
  objectID.replace(new RegExp(`^${branch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d+-`), '').replace(/#.*$/, '')

// PASS when at least one expected URL is among the top `topN` result URLs.
export const evaluateCase = (resultUrls: string[], c: Pick<RegressionCase, 'urls' | 'topN'>) =>
  resultUrls.slice(0, c.topN).some((url) => c.urls.includes(url))

// The audit boosts each page by its own record's `sdk` — "a reader of this SDK searches this
// title" — so an SDK-scoped page isn't unfairly demoted by a wrong-SDK boost (e.g. the Express
// `getAuth()` page losing to Next.js's under a nextjs boost is the anti-bleed ranking working,
// not a finding). Universal records carry the full SDK list (an array, post-parity) and match any
// boost equally, so they default to nextjs, the docs' default SDK.
export const auditBoost = (sdk: string | string[] | null | undefined) => (typeof sdk === 'string' ? sdk : 'nextjs')

type Args = { index: string; branch: string; audit: boolean; minPass: number; skipSettingsCheck: boolean }

export const parseArgs = (argv: string[], env: Record<string, string | undefined>): Args => {
  // A present flag must have a real value: a bare flag, an empty string, or a following flag
  // (`--index --audit`) all throw instead of silently falling back to a default — a silent
  // default is how `--min-pass ""` (Number('') === 0) would disable the audit gate, and how
  // `--branch --audit` would quietly query the wrong branch.
  const get = (flag: string) => {
    const i = argv.indexOf(flag)
    if (i === -1) return undefined
    const value = argv[i + 1]
    if (value === undefined || value.trim() === '' || value.startsWith('--')) {
      throw new Error(`${flag} is missing a value${value !== undefined ? ` (got: ${JSON.stringify(value)})` : ''}`)
    }
    return value
  }
  const index = get('--index') ?? env.ALGOLIA_INDEX_NAME
  if (!index) throw new Error('No index: pass --index <name> or set ALGOLIA_INDEX_NAME')
  // NaN silently disables the gate (every NaN comparison is false), so reject anything that
  // isn't a real 0-100 percentage instead of letting a typo'd flag report success.
  const minPass = Number(get('--min-pass') ?? 99)
  if (!Number.isFinite(minPass) || minPass < 0 || minPass > 100) {
    throw new Error(`--min-pass must be a percentage between 0 and 100, got: ${get('--min-pass')}`)
  }
  return {
    index,
    branch: get('--branch') ?? 'main',
    audit: argv.includes('--audit'),
    minPass,
    skipSettingsCheck: argv.includes('--skip-settings-check'),
  }
}

// Normalizes a settings value for drift comparison. `attributesForFaceting` is semantically a
// SET — Algolia attaches no meaning to its order — so it's sorted before comparing to avoid
// false drift if getSettings ever returns it reordered. Every other compared key stays
// order-sensitive on purpose: for searchableAttributes, ranking, and customRanking the order IS
// the priority, and a reorder there is exactly the drift the guard exists to catch.
export const normalizeSettingsValue = (key: string, value: unknown): unknown =>
  key === 'attributesForFaceting' && Array.isArray(value) ? [...value].sort() : value

// The audit's pass rate — split out so the divide-by-zero contract is testable: an empty corpus
// is a broken run (wrong index/branch, or a record-schema drift emptied the lvl1 scan), never a
// pass. 0/0 would yield NaN, which every gate comparison treats as passing.
export const computePassRate = (total: number, failed: number): number => {
  if (total <= 0)
    throw new Error('Audit corpus is empty — check --index, --branch, and that records carry type/hierarchy.lvl1')
  return ((total - failed) / total) * 100
}

// --- main ---

async function main() {
  const args = parseArgs(process.argv.slice(2), process.env)
  const { ALGOLIA_APP_ID, ALGOLIA_API_KEY } = process.env
  if (!ALGOLIA_APP_ID || !ALGOLIA_API_KEY) {
    console.error('Missing ALGOLIA_APP_ID / ALGOLIA_API_KEY in the environment')
    process.exit(1)
  }
  const client = algoliasearch(ALGOLIA_APP_ID, ALGOLIA_API_KEY)

  // Guard: results from an index whose settings drifted from the codified ones (or are still
  // propagating after a setSettings) are meaningless — fail loudly instead of lying.
  if (!args.skipSettingsCheck) {
    try {
      const live = await client.getSettings({ indexName: args.index })
      const expected: Record<string, unknown> = {
        searchableAttributes: SEARCHABLE_ATTRIBUTES,
        attributesForFaceting: ATTRIBUTES_FOR_FACETING,
        ranking: RANKING,
        customRanking: CUSTOM_RANKING,
        attributeForDistinct: ATTRIBUTE_FOR_DISTINCT,
        distinct: DISTINCT,
      }
      const drift = Object.entries(expected).filter(
        ([key, value]) =>
          JSON.stringify(normalizeSettingsValue(key, live[key as keyof typeof live])) !==
          JSON.stringify(normalizeSettingsValue(key, value)),
      )
      if (drift.length > 0) {
        console.error(`✗ Index settings on ${args.index} do not match the codified settings:`)
        for (const [key, value] of drift) {
          console.error(
            `  ${key}:\n    codified: ${JSON.stringify(value)}\n    live:     ${JSON.stringify(live[key as keyof typeof live])}`,
          )
        }
        console.error('\nRe-run the indexer against this index (or pass --skip-settings-check if intentional).')
        process.exit(1)
      }
      console.log(`✓ Index settings on ${args.index} match the codified settings`)
    } catch (error) {
      const status = (error as { status?: number }).status
      if (status === 403) {
        // Continuing here would let a drifted index report green — the exact lie this guard
        // exists to prevent. Skipping must be an explicit, visible choice.
        console.error(
          '✗ API key cannot read settings (403). Use a key with the `settings` ACL, or pass --skip-settings-check to explicitly run without the settings assertion.',
        )
        process.exit(1)
      }
      throw error
    }
  }

  const search = async (query: string, boost: string, hitsPerPage: number) => {
    const res = await client.searchSingleIndex({
      indexName: args.index,
      searchParams: {
        query: escapeQuery(query),
        hitsPerPage,
        facetFilters: [`branch:${args.branch}`],
        optionalFilters: [`sdk:${boost}`],
        distinct: true,
        attributesToRetrieve: ['objectID'],
        analytics: false,
      },
    })
    return res.hits.map((hit) => urlFromObjectID(hit.objectID, args.branch))
  }

  if (args.audit) {
    await runAudit(client, args, search)
    return
  }

  console.log(`Replaying ${REGRESSION_CASES.length} golden queries against ${args.index} (branch: ${args.branch})\n`)
  const failures: { c: RegressionCase; found: string[] }[] = []
  for (const c of REGRESSION_CASES) {
    const found = await search(c.query, c.boost, c.topN)
    if (evaluateCase(found, c)) {
      console.log(`✓ "${c.query}" (${c.boost})`)
    } else {
      failures.push({ c, found })
      console.log(`✗ "${c.query}" (${c.boost})`)
    }
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length}/${REGRESSION_CASES.length} golden queries FAILED:\n`)
    for (const { c, found } of failures) {
      console.error(`✗ "${c.query}" (${c.boost}) — promised by ${c.source}`)
      console.error(`  expected one of ${JSON.stringify(c.urls)} in the top ${c.topN}`)
      console.error(`  got: ${JSON.stringify(found)}\n`)
    }
    process.exit(1)
  }
  console.log(`\n✓ All ${REGRESSION_CASES.length} golden queries pass`)
}

// Corpus-wide safety net: query every page by its own title and expect the page itself in the
// top 3. Catches broad regressions the golden set can't (it only guards promises already made).
// Known-acceptable failures exist — ambiguous reference titles like `list()` have a dozen
// identically-titled siblings — hence a pass-rate gate rather than per-page assertions
// (99.4% measured at DOCS-11910 time).
async function runAudit(
  client: ReturnType<typeof algoliasearch>,
  args: Args,
  search: (query: string, boost: string, hitsPerPage: number) => Promise<string[]>,
) {
  console.log(`Collecting pages from ${args.index} (branch: ${args.branch})...`)
  const pages = new Map<string, { title: string; sdk: string | string[] | null | undefined }>()
  const browse = () =>
    client.browseObjects({
      indexName: args.index,
      browseParams: {
        filters: `branch:${args.branch}`,
        // Small pages: universal records carry the full SDK list, and oversized responses have
        // been observed to truncate mid-body on this ~64k-record browse.
        attributesToRetrieve: ['objectID', 'type', 'hierarchy.lvl1', 'sdk'],
        hitsPerPage: 250,
      },
      aggregator: (res) => {
        for (const hit of res.hits as {
          objectID: string
          type?: string
          hierarchy?: { lvl1?: string | null }
          sdk?: string | string[] | null
        }[]) {
          if (hit.type === 'lvl1' && hit.hierarchy?.lvl1) {
            pages.set(urlFromObjectID(hit.objectID, args.branch), { title: hit.hierarchy.lvl1, sdk: hit.sdk })
          }
        }
      },
    })
  try {
    await browse()
  } catch (error) {
    console.warn(`⚠︎ Browse failed (${(error as Error).message}) — retrying once from the start`)
    pages.clear()
    await browse()
  }
  console.log(`Auditing ${pages.size} pages (self-rank: own title → own URL in top 3)\n`)

  const entries = [...pages.entries()]
  const failures: { url: string; title: string; found: string[] }[] = []
  const BATCH = 10
  for (let i = 0; i < entries.length; i += BATCH) {
    await Promise.all(
      entries.slice(i, i + BATCH).map(async ([url, { title, sdk }]) => {
        const found = await search(title, auditBoost(sdk), 3)
        if (!found.includes(url)) failures.push({ url, title, found })
      }),
    )
    if ((i / BATCH) % 20 === 0 && i > 0) console.log(`  ...${i}/${entries.length}`)
  }

  const passRate = computePassRate(entries.length, failures.length)
  console.log(`\nSelf-rank pass rate: ${passRate.toFixed(1)}% (${entries.length - failures.length}/${entries.length})`)
  if (failures.length > 0) {
    console.log(`\nPages not in their own title's top 3:`)
    for (const f of failures.sort((a, b) => a.url.localeCompare(b.url))) {
      console.log(`  "${f.title}" (${f.url}) — got ${JSON.stringify(f.found)}`)
    }
  }
  if (passRate < args.minPass) {
    console.error(`\n✗ Pass rate ${passRate.toFixed(1)}% is below the --min-pass gate (${args.minPass}%)`)
    process.exit(1)
  }
  console.log(`\n✓ Pass rate meets the ${args.minPass}% gate`)
}

// Only run when executed directly, not when imported (the test file needs the exported helpers).
if ((import.meta as { main?: boolean }).main) {
  main()
}
