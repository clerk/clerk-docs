import { describe, expect, it } from 'vitest'
import { migrateManifest, unwrapNav } from './migrate-manifest'

const page = (title: string, extra: Record<string, unknown> = {}) => ({ title, href: `/docs/${title}`, ...extra })

describe('unwrapNav', () => {
  it('concatenates inner groups in order, at every nesting level', () => {
    const old = [[page('a'), { title: 'f', items: [[page('b')], [page('c')]] }], [page('d')]]
    expect(unwrapNav(old)).toEqual([page('a'), { title: 'f', items: [page('b'), page('c')] }, page('d')])
  })

  it('preserves headings and every passthrough field', () => {
    const item = page('a', {
      tag: '(Beta)',
      icon: 'book',
      wrap: false,
      target: '_blank',
      sdk: ['nextjs'],
    })
    const old = [[{ title: 'h', type: 'heading' }, item]]
    expect(unwrapNav(old)).toEqual([{ title: 'h', type: 'heading' }, item])
  })

  it('drops flatNav flags but keeps hideTitle on ordinary folders', () => {
    const old = [[{ title: 'f', hideTitle: true, flatNav: true, items: [[page('a')]] }]]
    expect(unwrapNav(old)).toEqual([{ title: 'f', hideTitle: true, items: [page('a')] }])
  })
})

describe('migrateManifest', () => {
  const mobileGroup = {
    title: 'Mobile Navigation',
    flatNav: true,
    hideTitle: true,
    sdk: ['ios', 'android'],
    items: [
      [
        page('shared'),
        { title: 'Getting started', type: 'heading' },
        page('ios-only', { sdk: ['ios'] }),
        page('android-only', { sdk: ['android'] }),
        page('multi', { sdk: ['ios', 'android'] }),
        { title: 'folder', items: [[page('child-ios', { sdk: ['ios'] })]] },
      ],
    ],
  }
  const old = {
    flags: {},
    navigation: [[{ title: 'Guides', topNav: true, items: [[page('quickstart')]] }], [mobileGroup]],
  }

  it('emits sectioned main manifest without the flatNav group', () => {
    const { main } = migrateManifest(old)
    expect(main.navigationType).toBe('sectioned')
    expect(main.navigation).toEqual([{ title: 'Guides', topNav: true, items: [page('quickstart')] }])
  })

  it('splits the flatNav group per SDK by authored sdk fields only', () => {
    const { sdkManifests } = migrateManifest(old)
    expect(Object.keys(sdkManifests).sort()).toEqual(['android', 'ios'])
    expect(sdkManifests.ios).toEqual({
      navigationType: 'flat',
      navigation: [
        page('shared'),
        { title: 'Getting started', type: 'heading' },
        page('ios-only'), // sdk === [target] → field dropped
        page('multi', { sdk: ['ios', 'android'] }), // broader than target → kept
        { title: 'folder', items: [page('child-ios')] },
      ],
    })
    // android: ios-only page and the now-empty folder are gone
    expect(sdkManifests.android.navigation).toEqual([
      page('shared'),
      { title: 'Getting started', type: 'heading' },
      page('android-only'),
      page('multi', { sdk: ['ios', 'android'] }),
    ])
  })

  it('refuses an already-migrated manifest', () => {
    expect(() => migrateManifest({ navigationType: 'sectioned', navigation: [] } as never)).toThrow(/already/)
  })

  it('refuses a flatNav group with no sdk list (silently dropping it would lose content)', () => {
    const bad = { navigation: [[{ title: 'Mobile', flatNav: true, items: [[page('a')]] }]] }
    expect(() => migrateManifest(bad)).toThrow(/sdk/)
  })
})
