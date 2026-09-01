import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  discoverDashboardRoutes,
  extractDashboardLinks,
  extractOrgLevelShortcuts,
  extractProxyRoutes,
  extractRedirectRoutes,
  findInvalidDashboardLinks,
  normalizeDashboardLink,
  normalizeRoutePattern,
  routeMatches,
  routePatternFromPage,
} from './check-dashboard-links'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { force: true, recursive: true })
})

describe('normalizeDashboardLink', () => {
  it('normalizes instance shortcuts and ignores query strings', () => {
    expect(normalizeDashboardLink('https://dashboard.clerk.com/~/api-keys?tab=react')).toEqual({
      namespace: 'instance',
      route: '/api-keys',
    })
    expect(normalizeDashboardLink('https://dashboard.clerk.com/~/')).toEqual({ namespace: 'instance', route: '/' })
  })

  it('treats direct URLs as global and no longer resolves the legacy last-active format', () => {
    expect(normalizeDashboardLink('https://dashboard.clerk.com/setup/supabase')).toEqual({
      namespace: 'global',
      route: '/setup/supabase',
    })
    // /last-active?path=… maps to the real global `/last-active` page; the path target isn't re-checked (see DOCS-12082).
    expect(normalizeDashboardLink('https://dashboard.clerk.com/last-active?path=billing/plans/')).toEqual({
      namespace: 'global',
      route: '/last-active',
    })
  })

  it('rejects look-alike hosts and accepts uppercase ones', () => {
    expect(normalizeDashboardLink('https://dashboard.clerk.com.evil/not-a-route')).toBeNull()
    expect(normalizeDashboardLink('https://DASHBOARD.CLERK.COM/~/api-keys')).toEqual({
      namespace: 'instance',
      route: '/api-keys',
    })
  })

  it('trims a trailing sentence period and handles ports via the origin check', () => {
    // A bare origin ending a sentence: the period trims off, leaving the real origin.
    expect(normalizeDashboardLink('https://dashboard.clerk.com.')).toEqual({ namespace: 'global', route: '/' })
    // The default HTTPS port normalizes to the real origin; a non-default port does not.
    expect(normalizeDashboardLink('https://dashboard.clerk.com:443/~/api-keys')).toEqual({
      namespace: 'instance',
      route: '/api-keys',
    })
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
        namespace: 'instance',
        route: '/api-keys',
        url: 'https://dashboard.clerk.com/~/api-keys',
      },
    ])
  })

  it('does not extract look-alike hosts', () => {
    expect(extractDashboardLinks('[x](https://dashboard.clerk.com.evil/anything)', 'example.mdx')).toEqual([])
  })
})

describe('route normalization', () => {
  it('removes route groups and converts App Router dynamic segments', () => {
    expect(routePatternFromPage('(configure-no-sidebar)/billing/plans/[planId]/page.tsx')).toBe('/billing/plans/:')
    expect(routePatternFromPage('(configure)/customization/email/[[...category]]/page.tsx')).toBe(
      '/customization/email/**',
    )
  })

  it('normalizes Next.js redirect parameters', () => {
    expect(normalizeRoutePattern('/billing/:path*')).toBe('/billing/**')
    expect(normalizeRoutePattern('/connections/:connectionId')).toBe('/connections/:')
    expect(normalizeRoutePattern('/files/:parts+')).toBe('/files/*')
  })
})

describe('extractRedirectRoutes', () => {
  it('splits instance and global redirects and normalizes their parameters', () => {
    const config = `
      const basePath = 'apps/:applicationId/instances/:instanceId'
      const config = {
        async redirects() {
          return [{ source: '/prepare-account', destination: '/' }]
        },
        async headers() {
          return [{ source: '/(.*)', headers: [] }]
        },
      }
      const pathChanges = [
        { source: \`/\${basePath}/jwt-template/:slug\`, destination: '/somewhere' },
        { source: '/billing/:path*', destination: '/settings/billing/:path*' },
      ]
    `

    expect(extractRedirectRoutes(config)).toEqual({
      global: ['/prepare-account', '/billing/**'],
      instance: ['/jwt-template/:'],
    })
  })

  it('captures the redirects() block even when it is the last async method', () => {
    const config = `
      const config = {
        async rewrites() {
          return []
        },
        async redirects() {
          return [{ source: '/prepare-account', destination: '/' }]
        },
      }
      const pathChanges = []
    `

    expect(extractRedirectRoutes(config)).toEqual({ global: ['/prepare-account'], instance: [] })
  })

  it('throws when an expected block is missing instead of silently returning nothing', () => {
    expect(() => extractRedirectRoutes('const config = {}')).toThrow(/redirects\(\) block/)
  })
})

describe('extractProxyRoutes', () => {
  it('keeps exact proxy entry points and drops classification wildcards', () => {
    const proxy = `
      createRouteMatcher(unauthenticatedRoutes)
      createRouteMatcher(['/apps/claim(.*)'])
      createRouteMatcher(['/setup/supabase'])
    `

    expect(extractProxyRoutes(proxy)).toEqual(['/setup/supabase'])
  })
})

describe('extractOrgLevelShortcuts', () => {
  it('extracts the aliases handled by the last-active shortcut page', () => {
    const content = `
      const ORG_LEVEL_PATHS: Record<string, string> = {
        'admin-logs': '/settings/admin-logs',
      }
    `

    expect(extractOrgLevelShortcuts(content)).toEqual(['/admin-logs'])
  })
})

describe('discoverDashboardRoutes', () => {
  it('combines pages, shortcuts, redirects, and explicit proxy entry points by namespace', () => {
    const dashboardRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-routes-'))
    temporaryDirectories.push(dashboardRoot)
    const appRoot = path.join(dashboardRoot, 'apps', 'dashboard', 'app')
    fs.mkdirSync(path.join(appRoot, '(routes)', 'apps', '[applicationId]', 'instances', '[instanceId]', 'api-keys'), {
      recursive: true,
    })
    fs.writeFileSync(
      path.join(appRoot, '(routes)', 'apps', '[applicationId]', 'instances', '[instanceId]', 'api-keys', 'page.tsx'),
      '',
    )
    fs.mkdirSync(path.join(appRoot, '(routes)', 'apps', 'setup', 'convex'), { recursive: true })
    fs.writeFileSync(path.join(appRoot, '(routes)', 'apps', 'setup', 'convex', 'page.tsx'), '')
    fs.writeFileSync(
      path.join(dashboardRoot, 'apps', 'dashboard', 'next.config.ts'),
      `
        const config = {
          async redirects() {
            return [{ source: '/prepare-account', destination: '/' }]
          },
          async rewrites() { return [] },
        }
        const pathChanges = [
          { source: '/billing/:path*', destination: '/settings/billing/:path*' },
        ]
      `,
    )
    fs.writeFileSync(
      path.join(dashboardRoot, 'apps', 'dashboard', 'proxy.ts'),
      "createRouteMatcher(['/setup/supabase'])",
    )
    const shortcutDirectory = path.join(appRoot, '(routes)', '~', '[[...rest]]')
    fs.mkdirSync(shortcutDirectory, { recursive: true })
    fs.writeFileSync(
      path.join(shortcutDirectory, 'content.tsx'),
      "const ORG_LEVEL_PATHS = { 'admin-logs': '/settings/admin-logs' }",
    )

    expect(discoverDashboardRoutes(dashboardRoot)).toEqual({
      global: ['/apps/setup/convex', '/billing/**', '/prepare-account', '/setup/supabase'],
      instance: ['/admin-logs', '/api-keys'],
    })
  })
})

describe('routeMatches', () => {
  it('matches static, dynamic, required catch-all, and optional catch-all routes', () => {
    expect(routeMatches('/api-keys', '/api-keys')).toBe(true)
    expect(routeMatches('/billing/plans/plan_123', '/billing/plans/:')).toBe(true)
    expect(routeMatches('/files/a/b/edit', '/files/*/edit')).toBe(true)
    expect(routeMatches('/customization/email', '/customization/email/**')).toBe(true)
    expect(routeMatches('/customization/email/waitlist', '/customization/email/**')).toBe(true)
    expect(routeMatches('/billing/settings', '/billing/plans')).toBe(false)
  })
})

describe('findInvalidDashboardLinks', () => {
  it('validates each link against its own namespace', () => {
    const links = extractDashboardLinks(
      '[valid](https://dashboard.clerk.com/~/api-keys) [invalid](https://dashboard.clerk.com/~/renamed) [global](https://dashboard.clerk.com/setup/supabase)',
      'example.mdx',
    )

    expect(findInvalidDashboardLinks(links, { global: ['/setup/supabase'], instance: ['/api-keys'] })).toMatchObject([
      { namespace: 'instance', route: '/renamed' },
    ])
  })

  it('does not let a global route validate an instance link', () => {
    const links = extractDashboardLinks('[x](https://dashboard.clerk.com/~/settings)', 'example.mdx')
    expect(findInvalidDashboardLinks(links, { global: ['/settings'], instance: [] })).toMatchObject([
      { namespace: 'instance', route: '/settings' },
    ])
  })
})
