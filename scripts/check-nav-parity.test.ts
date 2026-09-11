import { describe, expect, it } from 'vitest'
import { compareDistManifests, formatCounts, normalizeDist, VIEWS } from './check-nav-parity'
import { VALID_SDKS } from './lib/schemas'

const page = (title: string, sdk?: string[]) => ({ title, href: `/docs/${title}`, ...(sdk ? { sdk } : {}) })

// `Guides` carries an sdk list that omits ios/android, exactly as the real manifest's
// top-level sections do; ios/android render from their own keyed flat entries.
const dist = {
  navigation: {
    default: {
      type: 'sectioned',
      sections: [{ title: 'Guides', sdk: ['nextjs', 'react'], items: [page('a'), page('b', ['ios'])] }],
    },
    ios: { type: 'flat', items: [page('m1'), { title: 'F', items: [page('m2', ['ios'])] }] },
    android: { type: 'flat', items: [page('m1'), { title: 'F', items: [page('m2', ['ios'])] }] },
  },
}

const clone = () => structuredClone(dist) as typeof dist
const withFlags = (navigation: typeof dist) => ({ flags: {}, ...navigation })

describe('view normalization', () => {
  it('android view excludes the ios-only page and the emptied folder', () => {
    const android = normalizeDist(dist, 'android')
    expect(JSON.stringify(android)).not.toContain('m2')
    expect(JSON.stringify(android)).not.toContain('"F"')
  })

  it('filters the sectioned tree by sdk for views without a keyed entry', () => {
    const sectioned = {
      navigation: {
        default: {
          type: 'sectioned',
          sections: [
            { title: 'Guides', items: [page('shared'), page('react-only', ['react']), page('next-only', ['nextjs'])] },
          ],
        },
      },
    }
    const nextjs = JSON.stringify(normalizeDist(sectioned, 'nextjs'))
    expect(nextjs).not.toContain('react-only')
    expect(nextjs).toContain('next-only')
    expect(normalizeDist(sectioned, 'nextjs')).not.toEqual(normalizeDist(sectioned))
  })

  it('drops sections left empty by the sdk filter', () => {
    const sectioned = {
      navigation: {
        default: {
          type: 'sectioned',
          sections: [
            { title: 'Guides', items: [page('shared')] },
            { title: 'iOS extras', sdk: ['ios'], items: [page('ios-only', ['ios'])] },
          ],
        },
      },
    }
    expect(JSON.stringify(normalizeDist(sectioned, 'nextjs'))).not.toContain('iOS extras')
    expect(JSON.stringify(normalizeDist(sectioned, 'ios'))).toContain('iOS extras')
  })

  it('keeps nested sections before items, as sections', () => {
    const nested = {
      navigation: {
        default: {
          type: 'sectioned',
          sections: [
            { title: 'Reference', sections: [{ title: 'SDK Reference', items: [page('r1')] }], items: [page('loose')] },
          ],
        },
      },
    }
    expect(normalizeDist(nested)[0].children?.map((child) => child.kind)).toEqual(['section', 'page'])
  })

  it('rejects a legacy array-of-arrays dist loudly instead of comparing nothing', () => {
    const legacy = { navigation: [[{ title: 'Guides', topNav: true, items: [[page('a')]] }]] }
    expect(() => normalizeDist(legacy, 'nextjs')).toThrow('No navigation entry for view "nextjs"')
  })
})

// Every field the sidebar renders has to survive normalization: a checker that silently
// drops one would report parity while the nav visibly changed. Each mutation changes a
// single field on a single node and must fail the comparison against the unmutated dist.
type Mutation = { field: string; mutate: (dist: ReturnType<typeof clone>) => void }

const mutations: Mutation[] = [
  { field: 'tag', mutate: (d) => void ((d.navigation.default.sections![0].items[0] as any).tag = '(Beta)') },
  {
    field: 'maintainer',
    mutate: (d) => void ((d.navigation.default.sections![0].items[0] as any).maintainer = 'community'),
  },
  { field: 'icon', mutate: (d) => void ((d.navigation.default.sections![0].items[0] as any).icon = 'book') },
  { field: 'wrap', mutate: (d) => void ((d.navigation.default.sections![0].items[0] as any).wrap = false) },
  { field: 'target', mutate: (d) => void ((d.navigation.default.sections![0].items[0] as any).target = '_blank') },
  { field: 'hideTitle (folder)', mutate: (d) => void ((d.navigation.ios.items![1] as any).hideTitle = true) },
  {
    field: 'heading-ness',
    mutate: (d) => {
      const item = d.navigation.default.sections![0].items[0] as any
      delete item.href
      item.type = 'heading'
    },
  },
  { field: 'section icon', mutate: (d) => void ((d.navigation.default.sections![0] as any).icon = 'book') },
  { field: 'section tag', mutate: (d) => void ((d.navigation.default.sections![0] as any).tag = '(Beta)') },
  { field: 'section sdk', mutate: (d) => void ((d.navigation.default.sections![0] as any).sdk = ['react']) },
  { field: 'title', mutate: (d) => void ((d.navigation.default.sections![0].items[0] as any).title = 'renamed') },
  {
    field: 'href',
    mutate: (d) => void ((d.navigation.default.sections![0].items[0] as any).href = '/docs/elsewhere'),
  },
  { field: 'order', mutate: (d) => d.navigation.default.sections![0].items.reverse() },
]

describe('field sensitivity', () => {
  it.each(mutations)('detects a changed $field', ({ mutate }) => {
    const mutated = clone()
    mutate(mutated)
    expect(compareDistManifests(withFlags(dist), withFlags(mutated)).ok).toBe(false)
    // sanity: the unmutated clone still matches, so the mutation is what broke it
    expect(compareDistManifests(withFlags(dist), withFlags(clone())).ok).toBe(true)
  })
})

describe('documented normalization', () => {
  it('sorts sdk arrays in the default tree so authoring order is not a diff', () => {
    const before = {
      navigation: {
        default: { type: 'sectioned', sections: [{ title: 'Guides', items: [page('a', ['ios', 'android'])] }] },
      },
    }
    const after = {
      navigation: {
        default: { type: 'sectioned', sections: [{ title: 'Guides', items: [page('a', ['android', 'ios'])] }] },
      },
    }
    expect(normalizeDist(after)).toEqual(normalizeDist(before))
  })

  it('strips fields equal to their build defaults', () => {
    const explicit = {
      navigation: {
        default: {
          type: 'sectioned',
          sections: [
            {
              title: 'Guides',
              items: [
                { ...page('a'), wrap: true },
                { title: 'F', hideTitle: false, items: [page('c')] },
              ],
            },
          ],
        },
      },
    }
    const stripped = {
      navigation: {
        default: {
          type: 'sectioned',
          sections: [{ title: 'Guides', items: [page('a'), { title: 'F', items: [page('c')] }] }],
        },
      },
    }
    expect(normalizeDist(explicit)).toEqual(normalizeDist(stripped))
    expect(normalizeDist(explicit, 'nextjs')).toEqual(normalizeDist(stripped, 'nextjs'))
  })

  it('keeps non-default wrap/hideTitle values', () => {
    const explicit = {
      navigation: {
        default: {
          type: 'sectioned',
          sections: [
            {
              title: 'Guides',
              items: [
                { ...page('a'), wrap: false },
                { title: 'F', hideTitle: true, items: [page('c')] },
              ],
            },
          ],
        },
      },
    }
    const stripped = {
      navigation: {
        default: {
          type: 'sectioned',
          sections: [{ title: 'Guides', items: [page('a'), { title: 'F', items: [page('c')] }] }],
        },
      },
    }
    expect(normalizeDist(explicit)).not.toEqual(normalizeDist(stripped))
    expect(normalizeDist(explicit, 'nextjs')).not.toEqual(normalizeDist(stripped, 'nextjs'))
  })
})

// The standing use: build a dist before a manifest-affecting change and one after, and prove
// the nav data is unmoved (a manifest edit that moves groups or changes what a page's
// frontmatter scopes is the case this exists for).
describe('compareDistManifests', () => {
  it('reports parity for two identical dists, one view per SDK', () => {
    const result = compareDistManifests(withFlags(clone()), withFlags(clone()))

    expect(result.ok).toBe(true)
    expect(result.diffs).toEqual([])
    expect(result.notes).toEqual([])
    expect(result.counts).toHaveLength(VIEWS.length)
  })

  it('reports per-view node counts so OK can never mean "compared nothing"', () => {
    const { counts } = compareDistManifests(withFlags(clone()), withFlags(clone()))
    const byView = Object.fromEntries(counts.map(({ view, old, new: next }) => [view, [old, next]]))

    expect(byView.nextjs).toEqual([2, 2]) // Guides + a (b is ios-only)
    expect(byView.ios).toEqual([3, 3]) // m1 + F + m2
    expect(byView.android).toEqual([1, 1]) // m1
    expect(formatCounts(counts)).toMatch(/nextjs\s+2 nodes/)
  })

  it('names the view a changed item title lives in', () => {
    const after = clone()
    after.navigation.default.sections![0].items[0].title = 'a-renamed'

    const result = compareDistManifests(withFlags(clone()), withFlags(after))

    expect(result.ok).toBe(false)
    // `nextjs` and every SDK view that renders from the default tree surface the rename.
    expect(result.diffs.map(({ view }) => view)).toContain('nextjs')
    expect(result.diffs.find(({ view }) => view === 'nextjs')?.diff).toContain('a-renamed')
  })

  it('names an SDK-keyed view when only that entry changed', () => {
    const after = clone()
    after.navigation.ios.items![0].title = 'm1-renamed'

    const result = compareDistManifests(withFlags(clone()), withFlags(after))

    expect(result.ok).toBe(false)
    expect(result.diffs.map(({ view }) => view)).toEqual(['ios'])
    expect(result.diffs[0].diff).toContain('m1')
  })

  it('reports a flags view diff when the flags objects differ', () => {
    const result = compareDistManifests(
      { flags: { experiment: false }, ...clone() },
      { flags: { experiment: true }, ...clone() },
    )
    expect(result.ok).toBe(false)
    expect(result.diffs.map(({ view }) => view)).toContain('flags')
    expect(result.diffs.find(({ view }) => view === 'flags')?.diff).toContain('experiment')
  })

  it('is insensitive to flags key order', () => {
    const result = compareDistManifests({ flags: { a: 1, b: 2 }, ...clone() }, { flags: { b: 2, a: 1 }, ...clone() })
    expect(result.ok).toBe(true)
  })

  it('fails the non-vacuity guard when both dists are empty', () => {
    const empty = { flags: {}, navigation: { default: { type: 'sectioned', sections: [] } } }
    const result = compareDistManifests(empty, structuredClone(empty))

    expect(result.ok).toBe(false)
    expect(result.diffs[0].view).toBe('non-vacuity')
    expect(result.diffs[0].diff).toContain('0 nodes')
  })

  it('fails a wrong-shaped dist that normalizes to nothing', () => {
    // An entry with no `type` and no sections still yields empty views that would compare
    // equal to a genuinely empty tree.
    const result = compareDistManifests({ flags: {}, navigation: { default: {} } }, withFlags(clone()))
    expect(result.ok).toBe(false)
    expect(result.diffs.map(({ view }) => view)).toContain('non-vacuity')
  })

  it('fails an all-SDK array becoming absent on an unscoped href unless the default change is allowed', () => {
    // Every hydrated SDK view still contains the item and the href has no placeholder, so no SDK
    // view differs. But the default tree's `sdk` array itself moved (present to absent), and that
    // tree is what renders before hydration: the comparison keeps literal arrays there and fails
    // the run. `allowDefaultChange` turns the failure into a note once the browser check is done.
    const before = {
      flags: {},
      navigation: {
        default: { type: 'sectioned', sections: [{ title: 'Guides', items: [page('a', [...VALID_SDKS])] }] },
      },
    }
    const after = {
      flags: {},
      navigation: { default: { type: 'sectioned', sections: [{ title: 'Guides', items: [page('a')] }] } },
    }
    const result = compareDistManifests(before, after)
    expect(result.ok).toBe(false)
    expect(result.diffs.map(({ view }) => view)).toEqual(['default (pre-hydration)'])
    expect(result.notes).toEqual([])

    const allowed = compareDistManifests(before, after, { allowDefaultChange: true })
    expect(allowed.ok).toBe(true)
    expect(allowed.diffs).toEqual([])
    expect(allowed.notes).toEqual(['default tree structure or sdk arrays changed; accepted via --allow-default-change'])
  })

  it('still reports present-vs-absent sdk on a :sdk: href (the placeholder renders differently)', () => {
    const scoped = { title: 'q', href: '/docs/:sdk:/q', sdk: [...VALID_SDKS] }
    const unscoped = { title: 'q', href: '/docs/:sdk:/q' }
    const before = {
      flags: {},
      navigation: { default: { type: 'sectioned', sections: [{ title: 'G', items: [scoped] }] } },
    }
    const after = {
      flags: {},
      navigation: { default: { type: 'sectioned', sections: [{ title: 'G', items: [unscoped] }] } },
    }
    const result = compareDistManifests(before, after)
    expect(result.ok).toBe(false)
    expect(result.diffs.map(({ view }) => view)).toContain('nextjs')
  })

  it('passes a folder merge that renders identically in every SDK view', () => {
    const before = {
      flags: {},
      navigation: {
        default: {
          type: 'sectioned',
          sections: [
            {
              title: 'Guides',
              items: [
                {
                  title: 'Getting started',
                  sdk: ['nextjs'],
                  items: [{ title: 'Quickstart (App Router)', href: '/docs/:sdk:/q', sdk: ['nextjs', 'react'] }],
                },
                {
                  title: 'Getting started',
                  sdk: ['react'],
                  items: [{ title: 'Quickstart', href: '/docs/:sdk:/q', sdk: ['nextjs', 'react'] }],
                },
              ],
            },
          ],
        },
      },
    }
    const after = {
      flags: {},
      navigation: {
        default: {
          type: 'sectioned',
          sections: [
            {
              title: 'Guides',
              items: [
                {
                  title: 'Getting started',
                  items: [
                    { title: 'Quickstart (App Router)', href: '/docs/:sdk:/q', sdk: ['nextjs'] },
                    { title: 'Quickstart', href: '/docs/:sdk:/q', sdk: ['react'] },
                  ],
                },
              ],
            },
          ],
        },
      },
    }
    const strict = compareDistManifests(before, after)
    expect(strict.ok).toBe(false)
    expect(strict.diffs.map(({ view }) => view)).toEqual(['default (pre-hydration)'])

    const result = compareDistManifests(before, after, { allowDefaultChange: true })
    expect(result.ok).toBe(true)
    expect(result.notes).toEqual(['default tree structure or sdk arrays changed; accepted via --allow-default-change'])
  })

  it('still fails when an SDK view loses an item', () => {
    const before = {
      flags: {},
      navigation: {
        default: { type: 'sectioned', sections: [{ title: 'G', items: [page('a'), page('b', ['react'])] }] },
      },
    }
    const after = {
      flags: {},
      navigation: { default: { type: 'sectioned', sections: [{ title: 'G', items: [page('a')] }] } },
    }
    const result = compareDistManifests(before, after)
    expect(result.ok).toBe(false)
    // The react view lost the item, and the default tree (which renders pre-hydration) lost it too.
    expect(result.diffs.map(({ view }) => view)).toEqual(['react', 'default (pre-hydration)'])
  })
})
