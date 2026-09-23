import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  collectDashboardLinks,
  extractDashboardLinks,
  findInvalidDashboardLinks,
  loadLinkManifest,
  normalizeDashboardLink,
  parseLinkManifest,
} from './check-dashboard-links'

const temporaryDirectories: string[] = []

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { force: true, recursive: true })
})

describe('normalizeDashboardLink', () => {
  it('reduces a URL to the path Dashboard lists, ignoring query strings and trailing slashes', () => {
    expect(normalizeDashboardLink('https://dashboard.clerk.com/~/api-keys?tab=react')).toBe('/~/api-keys')
    expect(normalizeDashboardLink('https://dashboard.clerk.com/~/')).toBe('/~')
    expect(normalizeDashboardLink('https://dashboard.clerk.com/setup/supabase/')).toBe('/setup/supabase')
    expect(normalizeDashboardLink('${process.env.NEXT_PUBLIC_DASHBOARD_URL}/~/plan-billing')).toBe('/~/plan-billing')
    expect(normalizeDashboardLink('https://dashboard.clerk.com/last-active?path=billing/plans/')).toBe('/last-active')
  })

  it('rejects look-alike hosts and accepts uppercase ones', () => {
    expect(normalizeDashboardLink('https://dashboard.clerk.com.evil/not-a-route')).toBeNull()
    expect(normalizeDashboardLink('https://DASHBOARD.CLERK.COM/~/api-keys')).toBe('/~/api-keys')
  })

  it('trims a trailing sentence period and handles ports via the origin check', () => {
    // A bare origin ending a sentence: the period trims off, leaving the real origin.
    expect(normalizeDashboardLink('https://dashboard.clerk.com.')).toBe('/')
    // The default HTTPS port normalizes to the real origin; a non-default port does not.
    expect(normalizeDashboardLink('https://dashboard.clerk.com:443/~/api-keys')).toBe('/~/api-keys')
    expect(normalizeDashboardLink('https://dashboard.clerk.com:8443/not-a-route')).toBeNull()
  })
})

describe('extractDashboardLinks', () => {
  it('reports source positions and trims Markdown punctuation', () => {
    const links = extractDashboardLinks(
      'First line\nOpen [API keys](https://dashboard.clerk.com/~/api-keys).',
      'example.mdx',
    )

    expect(links).toEqual([
      {
        column: 17,
        file: 'example.mdx',
        line: 2,
        path: '/~/api-keys',
        url: 'https://dashboard.clerk.com/~/api-keys',
      },
    ])
  })

  it('extracts Dashboard URLs built from the public Dashboard environment variable', () => {
    expect(
      extractDashboardLinks(
        'const url = `${process.env.NEXT_PUBLIC_DASHBOARD_URL}/last-active?path=/plan-billing`',
        'example.ts',
      ),
    ).toMatchObject([{ path: '/last-active' }])
  })

  it('does not extract look-alike hosts', () => {
    expect(extractDashboardLinks('[x](https://dashboard.clerk.com.evil/anything)', 'example.mdx')).toEqual([])
  })

  it('collects links from configured roots without treating test fixtures as content', () => {
    const contentRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-content-'))
    temporaryDirectories.push(contentRoot)
    fs.writeFileSync(path.join(contentRoot, 'page.ts'), 'https://dashboard.clerk.com/~/api-keys')
    fs.writeFileSync(path.join(contentRoot, 'page.test.ts'), 'https://dashboard.clerk.com/last-active?path=api-keys')

    expect(collectDashboardLinks([{ base: contentRoot, excludeTests: true, root: contentRoot }])).toMatchObject([
      { file: 'page.ts', path: '/~/api-keys' },
    ])
  })
})

describe('parseLinkManifest', () => {
  const manifest = { links: ['/settings', '/~/api-keys'], redirects: { '/billing': '/settings/billing' }, version: 1 }

  it('accepts a current manifest', () => {
    expect(parseLinkManifest(JSON.stringify(manifest), 'test').links).toEqual(manifest.links)
  })

  it('rejects a sign-in page served in place of the manifest', () => {
    expect(() => parseLinkManifest('<!doctype html><title>Sign in</title>', 'test')).toThrow(/did not return JSON/)
  })

  it('rejects a manifest version it does not understand', () => {
    expect(() => parseLinkManifest(JSON.stringify({ ...manifest, version: 2 }), 'test')).toThrow(/version 2/)
  })

  it('rejects an empty link list instead of flagging every link', () => {
    expect(() => parseLinkManifest(JSON.stringify({ ...manifest, links: [] }), 'test')).toThrow(/non-empty/)
  })

  it('rejects a manifest without redirects', () => {
    expect(() => parseLinkManifest(JSON.stringify({ links: manifest.links, version: 1 }), 'test')).toThrow(/redirects/)
  })
})

describe('loadLinkManifest', () => {
  it('reads a manifest from a local file', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-manifest-'))
    temporaryDirectories.push(directory)
    const file = path.join(directory, 'links.json')
    fs.writeFileSync(file, JSON.stringify({ links: ['/'], redirects: {}, version: 1 }))

    expect((await loadLinkManifest(file)).links).toEqual(['/'])
  })
})

describe('loadLinkManifest over HTTP', () => {
  const url = 'https://dashboard.clerk.com/links.json'

  it('says the manifest is not published on a 404, without retrying', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('Not found', { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(loadLinkManifest(url)).rejects.toThrow(/HTTP 404: no Dashboard link manifest is published/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('names the sign-in wall on a redirect, without following or retrying it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { headers: { Location: '/sign-in' }, status: 307 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(loadLinkManifest(url)).rejects.toThrow(/redirected \(HTTP 307\).*sign-in wall/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(url, expect.objectContaining({ redirect: 'manual' }))
  })

  it('retries a server error and reports it as an availability problem', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response('Bad gateway', { status: 502 })))
    vi.stubGlobal('fetch', fetchMock)

    const result = expect(loadLinkManifest(url)).rejects.toThrow(/after 3 attempts \(HTTP 502\).*rerun the check/)
    await vi.runAllTimersAsync()
    await result
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('recovers when a retry succeeds', async () => {
    vi.useFakeTimers()
    const body = JSON.stringify({ links: ['/'], redirects: {}, version: 1 })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('Bad gateway', { status: 502 }))
      .mockResolvedValueOnce(new Response(body, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = loadLinkManifest(url)
    await vi.runAllTimersAsync()
    expect((await result).links).toEqual(['/'])
  })
})

describe('findInvalidDashboardLinks', () => {
  const manifest = {
    links: ['/settings/billing', '/~/api-keys'],
    redirects: { '/billing': '/settings/billing' },
    version: 1,
  }

  it('flags links the manifest does not list', () => {
    const links = extractDashboardLinks(
      '[valid](https://dashboard.clerk.com/~/api-keys) [invalid](https://dashboard.clerk.com/~/renamed)',
      'example.mdx',
    )

    expect(findInvalidDashboardLinks(links, manifest)).toMatchObject([{ path: '/~/renamed' }])
  })

  it('does not let a direct path validate its /~/ shortcut', () => {
    const links = extractDashboardLinks('[x](https://dashboard.clerk.com/~/settings/billing)', 'example.mdx')
    expect(findInvalidDashboardLinks(links, manifest)).toMatchObject([{ path: '/~/settings/billing' }])
  })

  it('fails a redirected link and names where it moved', () => {
    const links = extractDashboardLinks('[x](https://dashboard.clerk.com/billing)', 'example.mdx')
    expect(findInvalidDashboardLinks(links, manifest)).toMatchObject([
      { movedTo: '/settings/billing', path: '/billing' },
    ])
  })
})
