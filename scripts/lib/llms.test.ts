import { describe, expect, test } from 'vitest'
import { filterOutputDocsForSdk, sdkPrefixOfPath, type OutputtedDocsFile } from './llms'
import type { SDK } from './schemas'

const VALID_SDKS_FIXTURE = ['nextjs', 'react', 'react-router', 'js-frontend'] as const satisfies readonly SDK[]

const makeDoc = (overrides: Partial<OutputtedDocsFile> & Pick<OutputtedDocsFile, 'path'>): OutputtedDocsFile => ({
  url: '/docs/' + overrides.path.replace(/\.mdx$/, ''),
  content: '',
  title: 'Title',
  sdkScoped: false,
  availableSdks: null,
  ...overrides,
})

describe('sdkPrefixOfPath', () => {
  test('returns null for paths with no SDK prefix', () => {
    expect(sdkPrefixOfPath('getting-started/index.mdx', VALID_SDKS_FIXTURE)).toBeNull()
    expect(sdkPrefixOfPath('index.mdx', VALID_SDKS_FIXTURE)).toBeNull()
  })

  test('returns the matching SDK for a prefixed path', () => {
    expect(sdkPrefixOfPath('nextjs/api-doc.mdx', VALID_SDKS_FIXTURE)).toBe('nextjs')
    expect(sdkPrefixOfPath('js-frontend/api-doc.mdx', VALID_SDKS_FIXTURE)).toBe('js-frontend')
  })

  test('does not confuse SDKs that share a prefix segment', () => {
    expect(sdkPrefixOfPath('react-router/api-doc.mdx', VALID_SDKS_FIXTURE)).toBe('react-router')
    expect(sdkPrefixOfPath('react/api-doc.mdx', VALID_SDKS_FIXTURE)).toBe('react')
  })

  test('does not match an SDK name that only happens to be a substring', () => {
    expect(sdkPrefixOfPath('reactish/api-doc.mdx', VALID_SDKS_FIXTURE)).toBeNull()
  })
})

describe('filterOutputDocsForSdk', () => {
  test('keeps non-SDK-scoped docs that have no SDK variants', () => {
    const docs = [makeDoc({ path: 'index.mdx' }), makeDoc({ path: 'getting-started.mdx' })]

    expect(filterOutputDocsForSdk(docs, 'nextjs', VALID_SDKS_FIXTURE)).toEqual(docs)
  })

  test('drops the core landing-redirect when a target-SDK variant exists', () => {
    const landing = makeDoc({ path: 'api-doc.mdx', sdkScoped: false })
    const nextjsVariant = makeDoc({ path: 'nextjs/api-doc.mdx', sdkScoped: true, availableSdks: ['nextjs', 'react'] })
    const reactVariant = makeDoc({ path: 'react/api-doc.mdx', sdkScoped: true, availableSdks: ['nextjs', 'react'] })
    const docs = [landing, nextjsVariant, reactVariant]

    expect(filterOutputDocsForSdk(docs, 'nextjs', VALID_SDKS_FIXTURE)).toEqual([nextjsVariant])
  })

  test('drops core landing-redirects even when the target SDK has no variant for that doc', () => {
    const docs = [
      makeDoc({ path: 'api-doc.mdx', sdkScoped: false }),
      makeDoc({ path: 'nextjs/api-doc.mdx', sdkScoped: true, availableSdks: ['nextjs', 'react'] }),
      makeDoc({ path: 'react/api-doc.mdx', sdkScoped: true, availableSdks: ['nextjs', 'react'] }),
    ]

    expect(filterOutputDocsForSdk(docs, 'js-frontend', VALID_SDKS_FIXTURE)).toEqual([])
  })

  test('drops single-SDK docs (no variant dir) for SDKs not in their availableSdks', () => {
    const nextjsOnly = makeDoc({ path: 'api-doc.mdx', sdkScoped: true, availableSdks: ['nextjs'] })

    expect(filterOutputDocsForSdk([nextjsOnly], 'nextjs', VALID_SDKS_FIXTURE)).toEqual([nextjsOnly])
    expect(filterOutputDocsForSdk([nextjsOnly], 'react', VALID_SDKS_FIXTURE)).toEqual([])
  })

  test('drops files belonging to other SDKs', () => {
    const docs = [
      makeDoc({ path: 'index.mdx' }),
      makeDoc({ path: 'nextjs/api-doc.mdx', sdkScoped: true, availableSdks: ['nextjs', 'react'] }),
      makeDoc({ path: 'react/api-doc.mdx', sdkScoped: true, availableSdks: ['nextjs', 'react'] }),
    ]

    expect(filterOutputDocsForSdk(docs, 'nextjs', VALID_SDKS_FIXTURE).map((d) => d.path)).toEqual([
      'index.mdx',
      'nextjs/api-doc.mdx',
    ])
  })

  test('handles SDKs that share a prefix segment without leakage', () => {
    const docs = [
      makeDoc({ path: 'guides/setup.mdx' }),
      makeDoc({
        path: 'react-router/guides/setup.mdx',
        sdkScoped: true,
        availableSdks: ['react', 'react-router'],
      }),
      makeDoc({ path: 'react/guides/setup.mdx', sdkScoped: true, availableSdks: ['react', 'react-router'] }),
    ]

    expect(filterOutputDocsForSdk(docs, 'react-router', VALID_SDKS_FIXTURE).map((d) => d.path)).toEqual([
      'react-router/guides/setup.mdx',
    ])
  })
})
