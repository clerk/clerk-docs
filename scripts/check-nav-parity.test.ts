import { describe, expect, it } from 'vitest'
import {
  compareDistManifests,
  detectMode,
  formatCounts,
  normalizeNewDist,
  normalizeOldDist,
  VIEWS,
} from './check-nav-parity'

const page = (title: string, sdk?: string[]) => ({ title, href: `/docs/${title}`, ...(sdk ? { sdk } : {}) })

// `Guides` carries an sdk list that omits ios/android, exactly as the real manifest's
// top-level sections do. That is load-bearing: FlatNav walks the WHOLE manifest, so a section
// visible for a flat SDK belongs in that SDK's view — see 'walks the whole manifest' below.
const oldDist = {
  navigation: [
    [{ title: 'Guides', topNav: true, sdk: ['nextjs', 'react'], items: [[page('a')], [page('b', ['ios'])]] }],
    [
      {
        title: 'Mobile Navigation',
        flatNav: true,
        hideTitle: true,
        sdk: ['ios', 'android'],
        items: [[page('m1'), { title: 'F', items: [[page('m2', ['ios'])]] }]],
      },
    ],
  ],
}
const newDist = {
  navigation: {
    default: {
      type: 'sectioned',
      sections: [{ title: 'Guides', sdk: ['nextjs', 'react'], items: [page('a'), page('b', ['ios'])] }],
    },
    ios: { type: 'flat', items: [page('m1'), { title: 'F', items: [page('m2', ['ios'])] }] },
    android: { type: 'flat', items: [page('m1'), { title: 'F', items: [page('m2', ['ios'])] }] },
  },
}

describe('parity normalization', () => {
  it('default sectioned views normalize identically', () => {
    expect(normalizeNewDist(newDist)).toEqual(normalizeOldDist(oldDist))
  })
  it('flat SDK views normalize identically (unwrap, sdk-filter, drop empty folders)', () => {
    expect(normalizeNewDist(newDist, 'ios')).toEqual(normalizeOldDist(oldDist, 'ios'))
    expect(normalizeNewDist(newDist, 'android')).toEqual(normalizeOldDist(oldDist, 'android'))
  })
  it('android view excludes the ios-only page and the emptied folder', () => {
    const android = normalizeNewDist(newDist, 'android')
    expect(JSON.stringify(android)).not.toContain('m2')
    expect(JSON.stringify(android)).not.toContain('"F"')
  })
})

// Every field the sidebar renders has to survive normalization: a checker that silently
// drops one would report parity while the nav visibly changed. Each mutation changes a
// single field on a single node of the new dist and must break equality with the old dist.
type Mutation = { field: string; sdk?: string; mutate: (dist: typeof newDist) => void }

const mutations: Mutation[] = [
  { field: 'tag', mutate: (d) => void ((d.navigation.default.sections![0].items[0] as any).tag = '(Beta)') },
  {
    field: 'maintainer',
    mutate: (d) => void ((d.navigation.default.sections![0].items[0] as any).maintainer = 'community'),
  },
  { field: 'icon', mutate: (d) => void ((d.navigation.default.sections![0].items[0] as any).icon = 'book') },
  { field: 'wrap', mutate: (d) => void ((d.navigation.default.sections![0].items[0] as any).wrap = false) },
  { field: 'target', mutate: (d) => void ((d.navigation.default.sections![0].items[0] as any).target = '_blank') },
  {
    field: 'hideTitle (folder)',
    sdk: 'ios',
    mutate: (d) => void ((d.navigation.ios.items![1] as any).hideTitle = true),
  },
  {
    field: 'heading-ness',
    mutate: (d) => {
      const item = d.navigation.default.sections![0].items[0] as any
      delete item.href
      item.type = 'heading'
    },
  },
  { field: 'section icon', mutate: (d) => void ((d.navigation.default.sections![0] as any).icon = 'book') },
  { field: 'section sdk', mutate: (d) => void ((d.navigation.default.sections![0] as any).sdk = ['react']) },
  { field: 'title', mutate: (d) => void ((d.navigation.default.sections![0].items[0] as any).title = 'renamed') },
  {
    field: 'href',
    mutate: (d) => void ((d.navigation.default.sections![0].items[0] as any).href = '/docs/elsewhere'),
  },
  { field: 'order', mutate: (d) => d.navigation.default.sections![0].items.reverse() },
]

describe('field sensitivity', () => {
  it.each(mutations)('detects a changed $field', ({ sdk, mutate }) => {
    const mutated = structuredClone(newDist) as typeof newDist
    mutate(mutated)
    expect(normalizeNewDist(mutated, sdk)).not.toEqual(normalizeOldDist(oldDist, sdk))
    // sanity: the unmutated clone still matches, so the mutation is what broke it
    expect(normalizeNewDist(structuredClone(newDist) as typeof newDist, sdk)).toEqual(normalizeOldDist(oldDist, sdk))
  })
})

describe('compareDistManifests', () => {
  it('reports ok for matching dists, one view per SDK plus default', () => {
    const result = compareDistManifests({ flags: {}, ...oldDist }, { flags: {}, ...newDist })
    expect(result.ok).toBe(true)
    expect(result.diffs).toEqual([])
    expect(result.counts).toHaveLength(VIEWS.length)
  })

  it('reports per-view node counts so OK can never mean "compared nothing"', () => {
    const { counts } = compareDistManifests({ flags: {}, ...oldDist }, { flags: {}, ...newDist })
    const byView = Object.fromEntries(counts.map(({ view, old, new: next }) => [view, [old, next]]))

    expect(byView.default).toEqual([3, 3]) // Guides + a + b
    expect(byView.nextjs).toEqual([2, 2]) // Guides + a (b is ios-only)
    expect(byView.ios).toEqual([3, 3]) // m1 + F + m2
    expect(byView.android).toEqual([1, 1]) // m1
    expect(formatCounts(counts)).toContain('default')
    expect(formatCounts(counts)).toMatch(/default\s+3 nodes/)
  })

  it('fails two structurally-empty dists instead of calling them parity', () => {
    const result = compareDistManifests(
      { flags: {}, navigation: [] },
      { flags: {}, navigation: { default: { type: 'sectioned', sections: [] } } },
    )
    expect(result.ok).toBe(false)
    expect(result.diffs[0].view).toBe('non-vacuity')
    expect(result.diffs[0].diff).toContain('0 nodes')
  })

  it('fails a wrong-shaped old dist that normalizes to nothing', () => {
    // A well-formed new-format dist on the left is detected and normalized as one (see the
    // new-vs-new block below); this is the genuinely broken input — an entry with no `type`
    // and no sections — which still yields 17 empty views that would compare equal.
    const result = compareDistManifests({ flags: {}, navigation: { default: {} } }, { flags: {}, ...newDist })
    expect(result.ok).toBe(false)
    expect(result.diffs.map(({ view }) => view)).toContain('non-vacuity')
  })

  it('reports a flags view diff when the flags objects differ', () => {
    const result = compareDistManifests(
      { flags: { experiment: false }, ...oldDist },
      { flags: { experiment: true }, ...newDist },
    )
    expect(result.ok).toBe(false)
    expect(result.diffs.map(({ view }) => view)).toContain('flags')
    expect(result.diffs.find(({ view }) => view === 'flags')?.diff).toContain('experiment')
  })

  it('is insensitive to flags key order', () => {
    const result = compareDistManifests({ flags: { a: 1, b: 2 }, ...oldDist }, { flags: { b: 2, a: 1 }, ...newDist })
    expect(result.ok).toBe(true)
  })

  it('names the SDK view a difference lives in', () => {
    const broken = structuredClone(newDist) as typeof newDist
    broken.navigation.android.items = []
    const result = compareDistManifests({ flags: {}, ...oldDist }, { flags: {}, ...broken })
    expect(result.ok).toBe(false)
    expect(result.diffs.map(({ view }) => view)).toEqual(['android'])
    expect(result.diffs[0].diff).toContain('m1')
  })
})

describe('old-side flat nav semantics', () => {
  // hasVisibleChildren checks a folder's own sdk before recursing, so an sdk-excluded
  // topNav/hideTitle folder is dropped folder-and-children — never unwrapped in to the view.
  const ancestorExcluded = {
    navigation: [
      [
        {
          title: 'Mobile Navigation',
          flatNav: true,
          hideTitle: true,
          sdk: ['ios', 'android'],
          items: [[{ title: 'iOS only', topNav: true, sdk: ['ios'], items: [[page('inner')]] }]],
        },
      ],
    ],
  }

  it('drops an sdk-excluded ancestor before unwrapping it', () => {
    expect(JSON.stringify(normalizeOldDist(ancestorExcluded, 'android'))).not.toContain('inner')
  })

  it('unwraps the same ancestor for the sdk it covers', () => {
    expect(JSON.stringify(normalizeOldDist(ancestorExcluded, 'ios'))).toContain('inner')
  })

  it('walks the whole manifest, not just the flatNav group', () => {
    // Nav.tsx hands FlatNav the ENTIRE manifest; processItems unwraps every visible topNav
    // group. A section that covers a flat SDK is therefore part of that SDK's old nav, and
    // the checker has to see it — today's Guides/Reference merely happen to exclude ios.
    const withVisibleSection = {
      navigation: [
        [{ title: 'Guides', topNav: true, sdk: ['ios', 'nextjs'], items: [[page('shared-guide')]] }],
        [
          {
            title: 'Mobile Navigation',
            flatNav: true,
            hideTitle: true,
            sdk: ['ios'],
            items: [[page('m1')]],
          },
        ],
      ],
    }
    const ios = normalizeOldDist(withVisibleSection, 'ios')

    expect(ios.map(({ title }) => title)).toEqual(['shared-guide', 'm1'])
    // and the new format dropping it is a reported diff, not a silent loss
    const droppedInNew = { navigation: { ios: { type: 'flat', items: [page('m1')] } } }
    expect(normalizeNewDist(droppedInNew, 'ios')).not.toEqual(ios)
  })

  it('still excludes a top-level section the flat SDK is not listed on', () => {
    const withExcludedSection = {
      navigation: [
        [{ title: 'Guides', topNav: true, sdk: ['nextjs'], items: [[page('web-only')]] }],
        [{ title: 'Mobile Navigation', flatNav: true, hideTitle: true, sdk: ['ios'], items: [[page('m1')]] }],
      ],
    }
    expect(normalizeOldDist(withExcludedSection, 'ios').map(({ title }) => title)).toEqual(['m1'])
  })

  it('unwraps hideTitle folders too', () => {
    const dist = {
      navigation: [
        [
          {
            title: 'Mobile Navigation',
            flatNav: true,
            hideTitle: true,
            sdk: ['ios'],
            items: [[{ title: 'Wrapper', hideTitle: true, items: [[page('unwrapped')]] }]],
          },
        ],
      ],
    }
    expect(normalizeOldDist(dist, 'ios')).toEqual([{ kind: 'page', title: 'unwrapped', href: '/docs/unwrapped' }])
  })
})

describe('non-flat SDK views', () => {
  const sectionedOld = {
    navigation: [
      [
        {
          title: 'Guides',
          topNav: true,
          items: [[page('shared'), page('react-only', ['react']), page('next-only', ['nextjs'])]],
        },
      ],
    ],
  }
  const sectionedNew = {
    navigation: {
      default: {
        type: 'sectioned',
        sections: [
          { title: 'Guides', items: [page('shared'), page('react-only', ['react']), page('next-only', ['nextjs'])] },
        ],
      },
    },
  }

  it('filters the sectioned tree by sdk on both sides', () => {
    expect(normalizeNewDist(sectionedNew, 'nextjs')).toEqual(normalizeOldDist(sectionedOld, 'nextjs'))
    const nextjs = JSON.stringify(normalizeNewDist(sectionedNew, 'nextjs'))
    expect(nextjs).not.toContain('react-only')
    expect(nextjs).toContain('next-only')
  })

  it('differs from the unfiltered default view', () => {
    expect(normalizeNewDist(sectionedNew, 'nextjs')).not.toEqual(normalizeNewDist(sectionedNew))
  })

  it('drops sections left empty by the sdk filter', () => {
    const old = {
      navigation: [
        [{ title: 'Guides', topNav: true, items: [[page('shared')]] }],
        [{ title: 'iOS extras', topNav: true, sdk: ['ios'], items: [[page('ios-only', ['ios'])]] }],
      ],
    }
    const next = {
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
    expect(normalizeNewDist(next, 'nextjs')).toEqual(normalizeOldDist(old, 'nextjs'))
    expect(JSON.stringify(normalizeNewDist(next, 'nextjs'))).not.toContain('iOS extras')
  })
})

describe('documented normalization deltas', () => {
  it('compares sdk arrays strictly in the default view', () => {
    const strictOld = { navigation: [[{ title: 'Guides', topNav: true, items: [[page('a', ['ios', 'android'])]] }]] }
    const strictNew = {
      navigation: { default: { type: 'sectioned', sections: [{ title: 'Guides', items: [page('a', ['ios'])] }] } },
    }
    expect(normalizeNewDist(strictNew)).not.toEqual(normalizeOldDist(strictOld))
  })

  it('sorts sdk arrays in the default view so authoring order is not a diff', () => {
    const unsortedOld = {
      navigation: [[{ title: 'Guides', topNav: true, items: [[page('a', ['ios', 'android'])]] }]],
    }
    const sortedNew = {
      navigation: {
        default: { type: 'sectioned', sections: [{ title: 'Guides', items: [page('a', ['android', 'ios'])] }] },
      },
    }
    expect(normalizeNewDist(sortedNew)).toEqual(normalizeOldDist(unsortedOld))
  })

  it('treats an sdk view item sdk array as its visibility outcome, not its literal members', () => {
    // Delta 1: flat entries in the new format carry the per-SDK root scope, while the old
    // dist carried the Mobile group's ios+android inheritance. Within one SDK view both
    // render identically, and every SDK gets its own view, so nothing can hide here.
    const inheritedOld = {
      navigation: [
        [
          {
            title: 'Mobile Navigation',
            flatNav: true,
            hideTitle: true,
            sdk: ['ios', 'android'],
            items: [[page('m1', ['ios', 'android'])]],
          },
        ],
      ],
    }
    const scopedNew = { navigation: { ios: { type: 'flat', items: [page('m1', ['ios'])] } } }
    expect(normalizeNewDist(scopedNew, 'ios')).toEqual(normalizeOldDist(inheritedOld, 'ios'))
  })

  it('still distinguishes present-vs-absent sdk in an sdk view', () => {
    // `sdkScopeHref` leaves a raw /:sdk:/ placeholder when sdk is undefined, so the
    // universal/scoped distinction is render-affecting and must not be normalized away.
    const universalOld = {
      navigation: [[{ title: 'M', flatNav: true, hideTitle: true, sdk: ['ios'], items: [[page('m1')]] }]],
    }
    const scopedNew = { navigation: { ios: { type: 'flat', items: [page('m1', ['ios'])] } } }
    expect(normalizeNewDist(scopedNew, 'ios')).not.toEqual(normalizeOldDist(universalOld, 'ios'))
  })

  it('strips fields equal to their build defaults on both sides', () => {
    const explicitOld = {
      navigation: [
        [
          {
            title: 'Guides',
            topNav: true,
            items: [
              [
                { ...page('a'), wrap: true },
                { title: 'F', hideTitle: false, items: [[page('c')]] },
              ],
            ],
          },
        ],
      ],
    }
    const strippedNew = {
      navigation: {
        default: {
          type: 'sectioned',
          sections: [{ title: 'Guides', items: [page('a'), { title: 'F', items: [page('c')] }] }],
        },
      },
    }
    expect(normalizeNewDist(strippedNew)).toEqual(normalizeOldDist(explicitOld))
  })

  it('keeps non-default wrap/hideTitle values', () => {
    const explicitOld = {
      navigation: [
        [
          {
            title: 'Guides',
            topNav: true,
            items: [
              [
                { ...page('a'), wrap: false },
                { title: 'F', hideTitle: true, items: [[page('c')]] },
              ],
            ],
          },
        ],
      ],
    }
    const strippedNew = {
      navigation: {
        default: {
          type: 'sectioned',
          sections: [{ title: 'Guides', items: [page('a'), { title: 'F', items: [page('c')] }] }],
        },
      },
    }
    expect(normalizeNewDist(strippedNew)).not.toEqual(normalizeOldDist(explicitOld))
  })

  it('compares section-level presentation fields strictly (buildSections drops them)', () => {
    // Delta 3: buildSections copies only title/icon/sdk on to a section, so a tag or
    // hideTitle authored on a topNav group is a real behaviour change, not noise.
    const taggedOld = { navigation: [[{ title: 'Guides', topNav: true, tag: '(Beta)', items: [[page('a')]] }]] }
    const untaggedNew = {
      navigation: { default: { type: 'sectioned', sections: [{ title: 'Guides', items: [page('a')] }] } },
    }
    expect(normalizeNewDist(untaggedNew)).not.toEqual(normalizeOldDist(taggedOld))
  })

  it('maps nested topNav groups to nested sections', () => {
    const nestedOld = {
      navigation: [
        [
          {
            title: 'Reference',
            topNav: true,
            items: [[{ title: 'SDK Reference', topNav: true, items: [[page('r1')]] }, page('loose')]],
          },
        ],
      ],
    }
    const nestedNew = {
      navigation: {
        default: {
          type: 'sectioned',
          sections: [
            {
              title: 'Reference',
              sections: [{ title: 'SDK Reference', items: [page('r1')] }],
              items: [page('loose')],
            },
          ],
        },
      },
    }
    expect(normalizeNewDist(nestedNew)).toEqual(normalizeOldDist(nestedOld))
    expect(normalizeOldDist(nestedOld)[0].children?.map((child) => child.kind)).toEqual(['section', 'page'])
  })
})

// The old-vs-new mode had one job and it is done. The standing use is new-vs-new: build a
// dist before a manifest-affecting change and one after, and prove the nav data is unmoved
// (DOCS-11971's SDK-group de-dup PRs are the case this exists for).
describe('new-vs-new mode', () => {
  it('detects the mode from the first dist rather than assuming', () => {
    expect(detectMode(oldDist)).toBe('old-vs-new')
    expect(detectMode(newDist)).toBe('new-vs-new')
    expect(compareDistManifests({ flags: {}, ...oldDist }, { flags: {}, ...newDist }).mode).toBe('old-vs-new')
    expect(compareDistManifests({ flags: {}, ...newDist }, { flags: {}, ...newDist }).mode).toBe('new-vs-new')
  })

  it('reports parity for two identical new-format dists', () => {
    const before = structuredClone(newDist) as typeof newDist
    const after = structuredClone(newDist) as typeof newDist
    const result = compareDistManifests({ flags: {}, ...before }, { flags: {}, ...after })

    expect(result.mode).toBe('new-vs-new')
    expect(result.ok).toBe(true)
    expect(result.diffs).toEqual([])
    expect(result.counts).toHaveLength(VIEWS.length)
    // Both sides run through the same normalizer, so the counts are the shared new-format ones.
    expect(Object.fromEntries(result.counts.map(({ view, old, new: next }) => [view, [old, next]])).default).toEqual([
      3, 3,
    ])
  })

  it('names the view a changed item title lives in', () => {
    const before = structuredClone(newDist) as typeof newDist
    const after = structuredClone(newDist) as typeof newDist
    after.navigation.default.sections![0].items[0].title = 'a-renamed'

    const result = compareDistManifests({ flags: {}, ...before }, { flags: {}, ...after })

    expect(result.mode).toBe('new-vs-new')
    expect(result.ok).toBe(false)
    // `default` and every SDK view that renders from it surface the rename.
    expect(result.diffs.map(({ view }) => view)).toContain('default')
    expect(result.diffs.find(({ view }) => view === 'default')?.diff).toContain('a-renamed')
  })

  it('names an SDK-keyed view when only that entry changed', () => {
    const before = structuredClone(newDist) as typeof newDist
    const after = structuredClone(newDist) as typeof newDist
    after.navigation.ios.items![0].title = 'm1-renamed'

    const result = compareDistManifests({ flags: {}, ...before }, { flags: {}, ...after })

    expect(result.ok).toBe(false)
    expect(result.diffs.map(({ view }) => view)).toEqual(['ios'])
  })

  it('still fails the non-vacuity guard when both new dists are empty', () => {
    const empty = { flags: {}, navigation: { default: { type: 'sectioned', sections: [] } } }
    const result = compareDistManifests(empty, structuredClone(empty))

    expect(result.mode).toBe('new-vs-new')
    expect(result.ok).toBe(false)
    expect(result.diffs[0].view).toBe('non-vacuity')
  })

  it('honours an explicit new-vs-new override (the --new-both flag)', () => {
    const pinned = compareDistManifests({ flags: {}, ...newDist }, { flags: {}, ...newDist }, 'new-vs-new')
    expect(pinned.mode).toBe('new-vs-new')
    expect(pinned.ok).toBe(true)

    // The override pins the mode, it does not reinterpret the data: forced on to a legacy dist
    // it fails loudly rather than reporting parity over a tree it could not read.
    expect(() => compareDistManifests({ flags: {}, ...oldDist }, { flags: {}, ...newDist }, 'new-vs-new')).toThrow(
      'No navigation entry for view "default"',
    )
  })
})
