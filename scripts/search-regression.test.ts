import { describe, expect, test } from 'vitest'
import { REGRESSION_CASES } from './search-regression-queries'
import {
  auditBoost,
  computePassRate,
  escapeQuery,
  evaluateCase,
  normalizeSettingsValue,
  parseArgs,
  urlFromObjectID,
} from './search-regression'

describe('escapeQuery', () => {
  test('escapes the same operator characters as Search.tsx', () => {
    expect(escapeQuery('auth()')).toBe('auth\\(\\)')
    expect(escapeQuery('<UserButton />')).toBe('\\<UserButton /\\>')
    expect(escapeQuery('plain words')).toBe('plain words')
  })
})

describe('urlFromObjectID', () => {
  test('recovers the URL path from a record objectID', () => {
    expect(urlFromObjectID('main-42-/docs/cli#main', 'main')).toBe('/docs/cli')
    expect(urlFromObjectID('main-0-/docs/guides/billing/overview#faq', 'main')).toBe('/docs/guides/billing/overview')
  })

  test('only strips the queried branch prefix — branch names with regex characters are safe', () => {
    expect(urlFromObjectID('nick/test.branch-7-/docs/cli#main', 'nick/test.branch')).toBe('/docs/cli')
  })
})

describe('evaluateCase', () => {
  const c = { urls: ['/docs/cli'], topN: 1 as const }

  test('passes when an expected URL is within the top N', () => {
    expect(evaluateCase(['/docs/cli', '/docs/other'], c)).toBe(true)
  })

  test('fails when the expected URL ranks below the top N', () => {
    expect(evaluateCase(['/docs/other', '/docs/cli'], c)).toBe(false)
  })

  test('any one of several expected URLs satisfies the case', () => {
    expect(evaluateCase(['/docs/b'], { urls: ['/docs/a', '/docs/b'], topN: 3 })).toBe(true)
  })

  test('fails on an empty result set', () => {
    expect(evaluateCase([], c)).toBe(false)
  })
})

describe('auditBoost', () => {
  test('SDK-scoped records boost their own SDK — a wrong-SDK boost demoting the page is the anti-bleed ranking working, not a finding', () => {
    expect(auditBoost('expressjs')).toBe('expressjs')
    expect(auditBoost('ios')).toBe('ios')
  })

  test('universal records (full-SDK-list array, post-parity) default to nextjs', () => {
    expect(auditBoost(['nextjs', 'react', 'vue'])).toBe('nextjs')
    expect(auditBoost(null)).toBe('nextjs')
    expect(auditBoost(undefined)).toBe('nextjs')
  })
})

describe('parseArgs', () => {
  test('requires an index from the flag or the environment', () => {
    expect(() => parseArgs([], {})).toThrow(/--index/)
    expect(parseArgs(['--index', 'my_docs'], {}).index).toBe('my_docs')
    expect(parseArgs([], { ALGOLIA_INDEX_NAME: 'env_docs' }).index).toBe('env_docs')
  })

  test('defaults: branch main, no audit, 99% gate, settings check on', () => {
    expect(parseArgs(['--index', 'x'], {})).toEqual({
      index: 'x',
      branch: 'main',
      audit: false,
      minPass: 99,
      skipSettingsCheck: false,
    })
  })

  test('flags are honored', () => {
    const args = parseArgs(
      ['--index', 'x', '--branch', 'b', '--audit', '--min-pass', '95', '--skip-settings-check'],
      {},
    )
    expect(args).toEqual({ index: 'x', branch: 'b', audit: true, minPass: 95, skipSettingsCheck: true })
  })

  // NaN comparisons are always false, so an unvalidated --min-pass would silently disable the
  // audit gate — the run must die instead.
  test('rejects non-numeric and out-of-range --min-pass values', () => {
    expect(() => parseArgs(['--index', 'x', '--min-pass', '9a'], {})).toThrow(/--min-pass/)
    expect(() => parseArgs(['--index', 'x', '--min-pass', '-1'], {})).toThrow(/--min-pass/)
    expect(() => parseArgs(['--index', 'x', '--min-pass', '101'], {})).toThrow(/--min-pass/)
    expect(parseArgs(['--index', 'x', '--min-pass', '0'], {}).minPass).toBe(0)
    expect(parseArgs(['--index', 'x', '--min-pass', '100'], {}).minPass).toBe(100)
  })

  // Number('') === 0, so an empty --min-pass value would set a 0% gate — present flags must
  // carry real values; silent defaults are how fail-opens sneak in.
  test('rejects a present flag with a missing, empty, or flag-shaped value', () => {
    expect(() => parseArgs(['--index', 'x', '--min-pass'], {})).toThrow(/--min-pass is missing a value/)
    expect(() => parseArgs(['--index', 'x', '--min-pass', ''], {})).toThrow(/--min-pass is missing a value/)
    expect(() => parseArgs(['--index', 'x', '--min-pass', '  '], {})).toThrow(/--min-pass is missing a value/)
    expect(() => parseArgs(['--index', '--audit'], {})).toThrow(/--index is missing a value/)
    expect(() => parseArgs(['--index', 'x', '--branch', '--audit'], {})).toThrow(/--branch is missing a value/)
  })
})

describe('normalizeSettingsValue', () => {
  // Faceting is a set — Algolia attaches no meaning to its order — so a reordered getSettings
  // response must not read as drift.
  test('sorts attributesForFaceting so order differences are not drift', () => {
    expect(normalizeSettingsValue('attributesForFaceting', ['filterOnly(sdk)', 'filterOnly(branch)'])).toEqual([
      'filterOnly(branch)',
      'filterOnly(sdk)',
    ])
  })

  // For every other key, order IS the priority — reorders there are exactly the drift to catch.
  test('leaves order-sensitive keys untouched', () => {
    expect(normalizeSettingsValue('ranking', ['filters', 'typo'])).toEqual(['filters', 'typo'])
    expect(normalizeSettingsValue('searchableAttributes', ['b', 'a'])).toEqual(['b', 'a'])
    expect(normalizeSettingsValue('distinct', true)).toBe(true)
  })
})

describe('computePassRate', () => {
  test('computes the percentage of passing pages', () => {
    expect(computePassRate(200, 1)).toBe(99.5)
    expect(computePassRate(10, 0)).toBe(100)
  })

  // 0/0 is NaN, and NaN passes every gate comparison — an empty corpus is a broken run, not a pass.
  test('throws on an empty corpus instead of yielding a gate-passing NaN', () => {
    expect(() => computePassRate(0, 0)).toThrow(/empty/)
  })
})

describe('REGRESSION_CASES', () => {
  test('every case names its source — the ledger is the point', () => {
    for (const c of REGRESSION_CASES) {
      expect(c.source, `case "${c.query}" is missing a source`).toBeTruthy()
      expect(c.urls.length).toBeGreaterThan(0)
    }
  })
})
