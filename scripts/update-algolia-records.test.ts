import { describe, expect, test } from 'vitest'
import { VALID_SDKS } from './lib/schemas'
import {
  buildSweepFilters,
  buildSynonyms,
  cleanSynonym,
  CURATED_SYNONYMS,
  DEFAULT_ORPHAN_SWEEP_MAX,
  effectiveSweepMode,
  extractTooltipSynonym,
  INDEX_LIVE_BRANCHES,
  isAcronym,
  isStaleRecord,
  ONE_WAY_SYNONYMS,
  parseOrphanSweepMax,
  parseOrphanSweepMode,
  partitionOrphans,
  recordSDK,
  resolveSweepAllowlist,
  runOrphanSweep,
  STALE_RECORD_GRACE_MS,
  type TooltipFile,
} from './update-algolia-records'

describe('isAcronym', () => {
  test('accepts capitalized 3-8 char tokens', () => {
    expect(isAcronym('SSO')).toBe(true)
    expect(isAcronym('DKIM')).toBe(true)
    expect(isAcronym('WYSIWYG')).toBe(true)
    expect(isAcronym('OAuth2')).toBe(true)
  })

  test('trims surrounding whitespace before testing', () => {
    expect(isAcronym('  OTP  ')).toBe(true)
  })

  test('rejects lowercase, too-short, too-long, and multi-word tokens', () => {
    expect(isAcronym('sso')).toBe(false) // lowercase start
    expect(isAcronym('AB')).toBe(false) // only 2 chars
    expect(isAcronym('SUPERLONGACRONYM')).toBe(false) // > 8 chars
    expect(isAcronym('Single Sign-On')).toBe(false) // spaces / punctuation
  })
})

describe('cleanSynonym', () => {
  test('strips markdown links down to their text', () => {
    expect(cleanSynonym('Learn more about [DKIM](/glossary/dkim)')).toBe('Learn more about DKIM')
  })

  test('replaces ampersands with "and" and drops commas', () => {
    expect(cleanSynonym('read & write, please')).toBe('read and write please')
  })

  test('collapses whitespace and trims', () => {
    expect(cleanSynonym('  too    many\nspaces  ')).toBe('too many spaces')
  })
})

describe('extractTooltipSynonym', () => {
  test('Format A: **Acronym (Expansion)** where the acronym is on the left', () => {
    expect(
      extractTooltipSynonym(
        '**DKIM (DomainKeys Identified Mail)** is an email authentication method. Learn more about [DKIM](/glossary/dkim).',
      ),
    ).toEqual({ acronym: 'DKIM', expansion: 'DomainKeys Identified Mail' })
  })

  test('Format A: **Expansion (Acronym)** where the acronym is on the right', () => {
    expect(extractTooltipSynonym('A **one-time password (OTP)** is a code that authenticates a user.')).toEqual({
      acronym: 'OTP',
      expansion: 'one-time password',
    })
  })

  test("Format B: **Acronym** stands for 'Expansion'", () => {
    expect(extractTooltipSynonym("**WYSIWYG** stands for 'What You See Is What You Get'. Editors use it.")).toEqual({
      acronym: 'WYSIWYG',
      expansion: 'What You See Is What You Get',
    })
  })

  test('returns null when neither side of the paren is an acronym', () => {
    expect(extractTooltipSynonym('A **personal account (your own space)** belongs to one user.')).toBeNull()
  })

  test('returns null when there is no bold acronym at all', () => {
    expect(extractTooltipSynonym('This tooltip just describes a concept with no acronym.')).toBeNull()
  })

  test('returns the first acronym pair when several are present', () => {
    expect(extractTooltipSynonym('**SSO (Single Sign-On)** relates to **MFA (Multi-Factor Authentication)**.')).toEqual(
      { acronym: 'SSO', expansion: 'Single Sign-On' },
    )
  })
})

describe('buildSynonyms', () => {
  const tooltipFiles: TooltipFile[] = [
    {
      fileName: 'dkim.mdx',
      content: '**DKIM (DomainKeys Identified Mail)** is an email authentication method.',
    },
    { fileName: 'otp.mdx', content: 'A **one-time password (OTP)** is a code.' },
    { fileName: 'WYSIWYG.mdx', content: "**WYSIWYG** stands for 'What You See Is What You Get'." },
  ]

  test('derives a synonym record per tooltip, keyed by lowercased acronym', () => {
    const synonyms = buildSynonyms(tooltipFiles)
    expect(synonyms).toContainEqual({
      objectID: 'tooltip-dkim',
      type: 'synonym',
      synonyms: ['DKIM', 'DomainKeys Identified Mail'],
    })
    expect(synonyms).toContainEqual({
      objectID: 'tooltip-otp',
      type: 'synonym',
      synonyms: ['OTP', 'one-time password'],
    })
    expect(synonyms).toContainEqual({
      objectID: 'tooltip-wysiwyg',
      type: 'synonym',
      synonyms: ['WYSIWYG', 'What You See Is What You Get'],
    })
  })

  test('skips files without an .mdx extension', () => {
    const synonyms = buildSynonyms([{ fileName: 'dkim.txt', content: '**DKIM (DomainKeys Identified Mail)**' }])
    expect(synonyms.find((s) => s.objectID === 'tooltip-dkim')).toBeUndefined()
  })

  test('skips tooltips that contain no acronym pair', () => {
    const synonyms = buildSynonyms([{ fileName: 'slug.mdx', content: 'A slug is a URL-friendly identifier.' }])
    expect(synonyms.find((s) => s.objectID?.startsWith('tooltip-'))).toBeUndefined()
  })

  test('always includes the curated synonyms', () => {
    const synonyms = buildSynonyms([])
    for (const [objectID, expected] of Object.entries(CURATED_SYNONYMS)) {
      expect(synonyms).toContainEqual({ objectID, type: 'synonym', synonyms: expected })
    }
  })

  test('always includes the one-way synonyms', () => {
    const synonyms = buildSynonyms([])
    for (const oneWay of ONE_WAY_SYNONYMS) {
      expect(synonyms).toContainEqual(oneWay)
    }
  })

  test('tooltip IDs are namespaced, so they coexist with curated entries that share an acronym', () => {
    // A tooltip for "SSO" becomes `tooltip-sso`, which does not collide with the curated `sso` key.
    const synonyms = buildSynonyms([{ fileName: 'sso.mdx', content: '**SSO (Server-Side Only)** is made up.' }])
    expect(synonyms).toContainEqual({ objectID: 'tooltip-sso', type: 'synonym', synonyms: ['SSO', 'Server-Side Only'] })
    expect(synonyms).toContainEqual({ objectID: 'sso', type: 'synonym', synonyms: CURATED_SYNONYMS.sso })
  })

  test('the last tooltip wins when two files resolve to the same acronym', () => {
    const synonyms = buildSynonyms([
      { fileName: 'a.mdx', content: '**OTP (one time password)**' },
      { fileName: 'b.mdx', content: '**OTP (one-time passcode)**' },
    ])
    const otp = synonyms.filter((s) => s.objectID === 'tooltip-otp')
    expect(otp).toHaveLength(1)
    expect(otp[0]).toEqual({ objectID: 'tooltip-otp', type: 'synonym', synonyms: ['OTP', 'one-time passcode'] })
  })

  test('emits unique objectIDs', () => {
    const ids = buildSynonyms(tooltipFiles).map((s) => s.objectID)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('isStaleRecord', () => {
  const runStart = 1_800_000_000_000

  test('records older than the grace window are stale', () => {
    expect(isStaleRecord({ indexed_at: runStart - STALE_RECORD_GRACE_MS - 1 }, runStart)).toBe(true)
  })

  test('records inside the grace window are spared — a concurrent run must never be deleted', () => {
    expect(isStaleRecord({ indexed_at: runStart - STALE_RECORD_GRACE_MS + 1 }, runStart)).toBe(false)
    expect(isStaleRecord({ indexed_at: runStart - 1 }, runStart)).toBe(false)
  })

  test('records pushed after this run started are spared (a later concurrent run)', () => {
    expect(isStaleRecord({ indexed_at: runStart + 60_000 }, runStart)).toBe(false)
  })

  test('records exactly at the grace boundary are spared', () => {
    expect(isStaleRecord({ indexed_at: runStart - STALE_RECORD_GRACE_MS }, runStart)).toBe(false)
  })

  test('records predating the indexed_at field (no timestamp) are stale', () => {
    expect(isStaleRecord({}, runStart)).toBe(true)
    expect(isStaleRecord({ indexed_at: undefined }, runStart)).toBe(true)
  })
})

describe('resolveSweepAllowlist', () => {
  test('prod_docs allows main plus the live archive branches', () => {
    expect(resolveSweepAllowlist('prod_docs', 'main')).toEqual(new Set(['main', 'core-1', 'core-2']))
  })

  test('the current run branch is always allowlisted, even when not in the live set', () => {
    expect(resolveSweepAllowlist('dev_docs', 'nick/some-test-branch')).toEqual(
      new Set(['main', 'nick/some-test-branch']),
    )
  })

  test('an unknown index has no allowlist — the sweep must skip, never guess', () => {
    expect(resolveSweepAllowlist('manovotny_docs', 'main')).toBeNull()
    expect(resolveSweepAllowlist('some_throwaway', 'main')).toBeNull()
  })

  test('core-3 is not allowlisted anywhere', () => {
    for (const index of Object.keys(INDEX_LIVE_BRANCHES)) {
      expect(resolveSweepAllowlist(index, 'main')?.has('core-3')).toBe(false)
    }
  })
})

describe('parseOrphanSweepMode', () => {
  test('unset defaults to off — the sweep ships dark', () => {
    expect(parseOrphanSweepMode(undefined)).toBe('off')
  })

  test('garbage defaults to off, never to a destructive mode', () => {
    expect(parseOrphanSweepMode('yes')).toBe('off')
    expect(parseOrphanSweepMode('ON ')).toBe('off')
    expect(parseOrphanSweepMode('')).toBe('off')
  })

  test('recognizes the three modes exactly', () => {
    expect(parseOrphanSweepMode('off')).toBe('off')
    expect(parseOrphanSweepMode('dry')).toBe('dry')
    expect(parseOrphanSweepMode('on')).toBe('on')
  })
})

describe('parseOrphanSweepMax', () => {
  test('unset or invalid falls back to the default cap', () => {
    expect(parseOrphanSweepMax(undefined)).toBe(DEFAULT_ORPHAN_SWEEP_MAX)
    expect(parseOrphanSweepMax('not-a-number')).toBe(DEFAULT_ORPHAN_SWEEP_MAX)
    expect(parseOrphanSweepMax('-5')).toBe(DEFAULT_ORPHAN_SWEEP_MAX)
    expect(parseOrphanSweepMax('0')).toBe(DEFAULT_ORPHAN_SWEEP_MAX)
  })

  test('a positive integer can lower the cap', () => {
    expect(parseOrphanSweepMax('100')).toBe(100)
  })

  test('the env var can never RAISE the cap above the hardcoded ceiling', () => {
    expect(parseOrphanSweepMax('999999')).toBe(DEFAULT_ORPHAN_SWEEP_MAX)
  })
})

describe('effectiveSweepMode', () => {
  test('preview builds downgrade on to dry — never delete colleagues test branches', () => {
    expect(effectiveSweepMode('on', 'preview')).toBe('dry')
  })

  test('preview builds pass dry and off through unchanged', () => {
    expect(effectiveSweepMode('dry', 'preview')).toBe('dry')
    expect(effectiveSweepMode('off', 'preview')).toBe('off')
  })

  test('production and local runs keep the requested mode', () => {
    expect(effectiveSweepMode('on', 'production')).toBe('on')
    expect(effectiveSweepMode('on', undefined)).toBe('on')
    expect(effectiveSweepMode('dry', 'production')).toBe('dry')
  })
})

describe('partitionOrphans', () => {
  const runStart = 1_800_000_000_000
  const old = runStart - STALE_RECORD_GRACE_MS - 1

  test('legacy records with no indexed_at are candidates (the pre-#2893 orphans)', () => {
    const result = partitionOrphans([{ objectID: 'a', branch: 'core-3' }], runStart)
    expect(result.toDelete).toEqual(['a'])
    expect(result.sparedFresh).toBe(0)
    expect(result.byBranch).toEqual({ 'core-3': 1 })
  })

  test('fresh records inside the grace window are spared — a concurrent push is never deleted', () => {
    const result = partitionOrphans([{ objectID: 'b', branch: 'pr-123', indexed_at: runStart - 1 }], runStart)
    expect(result.toDelete).toEqual([])
    expect(result.sparedFresh).toBe(1)
    expect(result.byBranch).toEqual({})
  })

  test('old records past the grace window are candidates', () => {
    const result = partitionOrphans([{ objectID: 'c', branch: 'pr-123', indexed_at: old }], runStart)
    expect(result.toDelete).toEqual(['c'])
  })

  test('histogram aggregates per branch, counting only deletions', () => {
    const result = partitionOrphans(
      [
        { objectID: 'a', branch: 'core-3' },
        { objectID: 'b', branch: 'core-3', indexed_at: old },
        { objectID: 'c', branch: 'nick/test', indexed_at: old },
        { objectID: 'd', branch: 'nick/test', indexed_at: runStart - 1 },
      ],
      runStart,
    )
    expect(result.toDelete).toEqual(['a', 'b', 'c'])
    expect(result.sparedFresh).toBe(1)
    expect(result.byBranch).toEqual({ 'core-3': 2, 'nick/test': 1 })
  })

  test('records with no branch attribute are candidates, bucketed as <no branch>', () => {
    const result = partitionOrphans([{ objectID: 'e' }], runStart)
    expect(result.toDelete).toEqual(['e'])
    expect(result.byBranch).toEqual({ '<no branch>': 1 })
  })
})

describe('runOrphanSweep', () => {
  const runStart = 1_800_000_000_000
  const base = {
    gitBranch: 'main',
    runStart,
    cap: 50,
    browse: async () => [],
    deleteObjects: async () => 0,
  }

  test('an index with no allowlist entry is skipped — no browse, no delete', async () => {
    let browsed = false
    const result = await runOrphanSweep({
      ...base,
      indexName: 'someones_throwaway',
      mode: 'on',
      browse: async () => {
        browsed = true
        return []
      },
    })
    expect(result.outcome).toBe('skipped')
    expect(browsed).toBe(false)
  })

  test('browses with filters derived from the resolved allowlist', async () => {
    let seen: string[] = []
    await runOrphanSweep({
      ...base,
      indexName: 'prod_docs',
      mode: 'dry',
      browse: async (filters) => {
        seen = filters
        return []
      },
    })
    expect(new Set(seen)).toEqual(new Set(['branch:-main', 'branch:-core-1', 'branch:-core-2']))
  })

  test('a clean index reports clean', async () => {
    const result = await runOrphanSweep({ ...base, indexName: 'prod_docs', mode: 'on' })
    expect(result.outcome).toBe('clean')
  })

  test('dry mode never deletes', async () => {
    let deleted = false
    const result = await runOrphanSweep({
      ...base,
      indexName: 'prod_docs',
      mode: 'dry',
      browse: async () => [{ objectID: 'a', branch: 'core-3' }],
      deleteObjects: async () => {
        deleted = true
        return 1
      },
    })
    expect(result.outcome).toBe('dry')
    expect(result.candidates).toEqual(['a'])
    expect(deleted).toBe(false)
  })

  test('aborts above the cap without deleting — even in on mode', async () => {
    let deleted = false
    const hits = Array.from({ length: 51 }, (_, i) => ({ objectID: `x${i}`, branch: 'core-3' }))
    const result = await runOrphanSweep({
      ...base,
      indexName: 'prod_docs',
      mode: 'on',
      browse: async () => hits,
      deleteObjects: async () => {
        deleted = true
        return 0
      },
    })
    expect(result.outcome).toBe('aborted')
    expect(deleted).toBe(false)
  })

  test('on mode deletes exactly the stale candidates and spares fresh ones', async () => {
    let received: string[] = []
    const result = await runOrphanSweep({
      ...base,
      indexName: 'prod_docs',
      mode: 'on',
      browse: async () => [
        { objectID: 'old', branch: 'core-3' },
        { objectID: 'fresh', branch: 'core-3', indexed_at: runStart - 1 },
      ],
      deleteObjects: async (ids) => {
        received = ids
        return ids.length
      },
    })
    expect(result.outcome).toBe('swept')
    expect(received).toEqual(['old'])
    expect(result.sparedFresh).toBe(1)
  })
})

describe('buildSweepFilters', () => {
  test('produces one negated branch facet filter per allowlisted branch', () => {
    const filters = buildSweepFilters(new Set(['main', 'core-1', 'core-2']))
    expect(filters).toHaveLength(3)
    expect(filters).toContain('branch:-main')
    expect(filters).toContain('branch:-core-1')
    expect(filters).toContain('branch:-core-2')
  })

  test('derives from the allowlist — a duplicate run branch is not repeated (Set dedupes)', () => {
    expect(buildSweepFilters(new Set(['main']))).toEqual(['branch:-main'])
  })
})

describe('recordSDK', () => {
  test('per-SDK variants carry the single SDK the variant was built for', () => {
    expect(recordSDK('nextjs')).toBe('nextjs')
  })

  // Universal pages must tie (not lose to, not beat) SDK-scoped records on the `filters`
  // criterion, whichever SDK the client boosts — anything less buries exact-title pages like
  // "How Clerk works" under body-content matches (DOCS-11910).
  test('universal pages carry every current SDK key so the active-SDK boost always matches', () => {
    expect(recordSDK(undefined)).toEqual([...VALID_SDKS])
  })
})
