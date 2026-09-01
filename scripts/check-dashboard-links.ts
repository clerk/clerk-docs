import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const DASHBOARD_ORIGIN = 'https://dashboard.clerk.com'
const DASHBOARD_APP_ROOT = path.join('apps', 'dashboard', 'app')
const INSTANCE_ROUTE_PREFIX = '/apps/:/instances/:'
const CONTENT_DIRECTORIES = ['clerk-typedoc', 'data', 'docs', 'prompts']
const SOURCE_EXTENSIONS = new Set(['.js', '.json', '.jsx', '.md', '.mdx', '.mjs', '.ts', '.tsx', '.yaml', '.yml'])
const IGNORED_DIRECTORIES = new Set(['.git', '.next', 'dist', 'node_modules'])
// Match the whole URL candidate — host suffix, port, and path included — and let `URL.origin`
// be the sole gatekeeper below. Capturing the full token (rather than boundary-matching the
// host) is what lets a look-alike like `dashboard.clerk.com.evil` or a non-default port parse
// to a different origin and get rejected, while a trailing sentence period trims away and a
// default `:443` normalizes to the real origin. Case-insensitive so uppercase hosts still match.
const DASHBOARD_URL_PATTERN = /https:\/\/dashboard\.clerk\.com[^\s<>"'`)\]}*]*/gi
const DASHBOARD_REPOSITORY = 'clerk/dashboard'

// Dashboard links come in two namespaces that must not cross-validate:
//   - instance: `/~/…` shortcuts that resolve inside the active instance
//   - global:   direct URLs to non-instance pages (setup flows, org/account pages)
// A route removed from one namespace should fail its links even if the other still has it.
type RouteNamespace = 'instance' | 'global'

export interface DashboardLink {
  column: number
  file: string
  line: number
  namespace: RouteNamespace
  route: string
  url: string
}

export interface DashboardRoutes {
  global: string[]
  instance: string[]
}

interface RouteManifest {
  routes: DashboardRoutes
  source: {
    generatedAt: string
    repository: string
    revision: string
  }
}

function walkFiles(root: string): string[] {
  const files: string[] = []

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue

    const entryPath = path.join(root, entry.name)
    if (entry.isDirectory()) files.push(...walkFiles(entryPath))
    else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) files.push(entryPath)
  }

  return files.sort()
}

function trimUrl(url: string): string {
  return url.replace(/[),.;:]+$/, '')
}

export function normalizeDashboardLink(rawUrl: string): { namespace: RouteNamespace; route: string } | null {
  let url: URL
  try {
    url = new URL(trimUrl(rawUrl))
  } catch {
    // A malformed candidate (e.g. a stray percent-sign) isn't a Dashboard link — skip it
    // rather than crashing the whole lint.
    return null
  }
  if (url.origin !== DASHBOARD_ORIGIN) return null

  // `/~/…` resolves within the active instance, so it validates against instance routes.
  if (url.pathname === '/~' || url.pathname === '/~/') return { namespace: 'instance', route: '/' }
  if (url.pathname.startsWith('/~/')) {
    return { namespace: 'instance', route: `/${url.pathname.slice(3).replace(/\/+$/, '')}` }
  }

  // Everything else is a direct, global URL. `/last-active?path=…` normalizes to the real
  // `/last-active` Dashboard page, so it validates as that page — the `path` target itself isn't
  // re-checked. Migrating the remaining `/last-active` links to `/~/` and then rejecting
  // `/last-active` outright is tracked in DOCS-12082.
  return { namespace: 'global', route: url.pathname.replace(/\/+$/, '') || '/' }
}

export function extractDashboardLinks(content: string, file: string): DashboardLink[] {
  const links: DashboardLink[] = []

  for (const match of content.matchAll(DASHBOARD_URL_PATTERN)) {
    const url = trimUrl(match[0])
    const normalized = normalizeDashboardLink(url)
    if (!normalized) continue

    const before = content.slice(0, match.index)
    const lines = before.split('\n')
    links.push({
      column: lines[lines.length - 1].length + 1,
      file,
      line: lines.length,
      namespace: normalized.namespace,
      route: normalized.route,
      url,
    })
  }

  return links
}

function normalizeRouteSegment(segment: string): string | null {
  if ((segment.startsWith('(') && segment.endsWith(')')) || segment.startsWith('@')) return null
  if (/^\[\[\.\.\..+]]$/.test(segment) || /^:[^/]+[?*]$/.test(segment)) return '**'
  if (/^\[\.\.\..+]$/.test(segment) || /^:[^/]+\+$/.test(segment)) return '*'
  if (/^\[.+]$/.test(segment) || /^:[^/]+$/.test(segment)) return ':'
  return segment
}

export function normalizeRoutePattern(route: string): string {
  const normalizedRoute = route.replace(/\(\.\*\)$/, '/**')
  const segments = normalizedRoute
    .split('/')
    .map(normalizeRouteSegment)
    .filter((segment): segment is string => Boolean(segment))

  return `/${segments.join('/')}`
}

export function routePatternFromPage(relativePagePath: string): string {
  return normalizeRoutePattern(relativePagePath.split(path.sep).slice(0, -1).join('/'))
}

// Capture a `{…}` or `[…]` block by matching delimiters, so extraction doesn't depend on
// what follows the block (e.g. whether `redirects()` is the last async method). `startPattern`
// must end at the opening delimiter. Throws when the block is absent or unbalanced, so an
// upstream refactor fails the refresh loudly instead of silently shipping a smaller snapshot.
function sliceBalancedBlock(source: string, startPattern: RegExp, label: string): string {
  const match = startPattern.exec(source)
  if (!match) throw new Error(`Could not locate ${label} in the Dashboard source — the extractor needs updating.`)

  const openIndex = match.index + match[0].length - 1
  const open = source[openIndex]
  const close = open === '{' ? '}' : ']'
  let depth = 0

  for (let index = openIndex; index < source.length; index += 1) {
    if (source[index] === open) depth += 1
    else if (source[index] === close) {
      depth -= 1
      if (depth === 0) return source.slice(openIndex + 1, index)
    }
  }

  throw new Error(`Unbalanced ${label} in the Dashboard source — the extractor needs updating.`)
}

export function extractRedirectRoutes(nextConfig: string): DashboardRoutes {
  const redirects = sliceBalancedBlock(nextConfig, /async redirects\(\)\s*\{/, 'the redirects() block')
  const pathChanges = sliceBalancedBlock(nextConfig, /const pathChanges\s*=\s*\[/, 'the pathChanges array')

  const global: string[] = []
  const instance: string[] = []
  for (const match of `${redirects}\n${pathChanges}`.matchAll(
    /source:\s*(?:`\/\$\{basePath}([^`]*)`|'([^']+)'|"([^"]+)")/g,
  )) {
    // The basePath template branch is instance-scoped; a plain string source is global.
    if (match[1] !== undefined) instance.push(normalizeRoutePattern(match[1]))
    else global.push(normalizeRoutePattern(match[2] ?? match[3]))
  }

  return { global, instance }
}

export function extractProxyRoutes(proxy: string): string[] {
  return (
    [...proxy.matchAll(/createRouteMatcher\(\[([^\]]+)]\)/gs)]
      .flatMap((matcher) =>
        [...matcher[1].matchAll(/['"]([^'"]+)['"]/g)].map((route) => normalizeRoutePattern(route[1])),
      )
      // Keep only exact entry points that rewrite to a page (e.g. `/setup/supabase`). A wildcard
      // matcher such as `/apps/claim(.*)` classifies requests for auth; it is not a linkable page.
      .filter((route) => !route.includes('*'))
  )
}

export function extractOrgLevelShortcuts(content: string): string[] {
  const shortcuts = sliceBalancedBlock(content, /ORG_LEVEL_PATHS[^=]*=\s*\{/, 'the ORG_LEVEL_PATHS map')
  return [...shortcuts.matchAll(/^\s*['"]([^'"]+)['"]\s*:/gm)].map((match) => `/${match[1]}`)
}

function dedupeSorted(routes: string[]): string[] {
  return routes.sort().filter((route, index, sorted) => route !== sorted[index - 1])
}

export function discoverDashboardRoutes(dashboardRoot: string): DashboardRoutes {
  const appRoot = path.join(dashboardRoot, DASHBOARD_APP_ROOT)
  if (!fs.existsSync(appRoot)) {
    throw new Error(`Could not find the Dashboard App Router at ${appRoot}`)
  }

  const pageRoutes = walkFiles(appRoot)
    .filter((file) => /^page\.(?:js|jsx|ts|tsx)$/.test(path.basename(file)))
    .map((file) => routePatternFromPage(path.relative(appRoot, file)))

  const isInstanceRoute = (route: string) =>
    route === INSTANCE_ROUTE_PREFIX || route.startsWith(`${INSTANCE_ROUTE_PREFIX}/`)
  // Instance pages are the routes `/~/…` resolves to, addressed without the instance prefix.
  const instancePageRoutes = pageRoutes
    .filter(isInstanceRoute)
    .map((route) => route.slice(INSTANCE_ROUTE_PREFIX.length) || '/')
  const globalPageRoutes = pageRoutes.filter((route) => !isInstanceRoute(route))

  const nextConfigPath = path.join(dashboardRoot, 'apps', 'dashboard', 'next.config.ts')
  if (!fs.existsSync(nextConfigPath)) throw new Error(`Could not find ${nextConfigPath}`)
  const redirects = extractRedirectRoutes(fs.readFileSync(nextConfigPath, 'utf8'))

  const proxyPath = path.join(dashboardRoot, 'apps', 'dashboard', 'proxy.ts')
  if (!fs.existsSync(proxyPath)) throw new Error(`Could not find ${proxyPath}`)
  const proxyRoutes = extractProxyRoutes(fs.readFileSync(proxyPath, 'utf8'))

  const shortcutPath = path.join(appRoot, '(routes)', '~', '[[...rest]]', 'content.tsx')
  if (!fs.existsSync(shortcutPath)) throw new Error(`Could not find the /~/ shortcut source at ${shortcutPath}`)
  const orgLevelShortcuts = extractOrgLevelShortcuts(fs.readFileSync(shortcutPath, 'utf8'))

  return {
    global: dedupeSorted([...globalPageRoutes, ...redirects.global, ...proxyRoutes]),
    instance: dedupeSorted([...instancePageRoutes, ...redirects.instance, ...orgLevelShortcuts]),
  }
}

function segmentsMatch(routeSegments: string[], patternSegments: string[], routeIndex = 0, patternIndex = 0): boolean {
  const patternSegment = patternSegments[patternIndex]

  if (patternSegment === undefined) return routeIndex === routeSegments.length
  if (patternSegment === '**') {
    return Array.from({ length: routeSegments.length - routeIndex + 1 }, (_, offset) => routeIndex + offset).some(
      (nextRouteIndex) => segmentsMatch(routeSegments, patternSegments, nextRouteIndex, patternIndex + 1),
    )
  }
  if (patternSegment === '*') {
    return Array.from({ length: routeSegments.length - routeIndex }, (_, offset) => routeIndex + offset + 1).some(
      (nextRouteIndex) => segmentsMatch(routeSegments, patternSegments, nextRouteIndex, patternIndex + 1),
    )
  }
  if (routeSegments[routeIndex] === undefined) return false
  if (patternSegment !== ':' && patternSegment !== routeSegments[routeIndex]) return false

  return segmentsMatch(routeSegments, patternSegments, routeIndex + 1, patternIndex + 1)
}

export function routeMatches(route: string, pattern: string): boolean {
  return segmentsMatch(route.split('/').filter(Boolean), pattern.split('/').filter(Boolean))
}

export function findInvalidDashboardLinks(links: DashboardLink[], routes: DashboardRoutes): DashboardLink[] {
  return links.filter((link) => !routes[link.namespace].some((route) => routeMatches(link.route, route)))
}

function parseArg(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  if (index === -1) return undefined

  const value = process.argv[index + 1]
  if (!value || value.startsWith('-')) throw new Error(`${name} requires a value`)
  return value
}

function showHelp(): void {
  console.log(`
Usage: tsx scripts/check-dashboard-links.ts [options]

Options:
  --dashboard-root <path>  Derive routes from a clerk/dashboard checkout instead of the snapshot
  --source-revision <sha>  Record a source revision when updating (defaults to the checkout HEAD)
  --update                 Update the checked-in snapshot if the route set changed
  --snapshot-only          Skip docs validation after updating (requires --update)
  -h, --help               Show this help message
`)
}

function dashboardRevision(dashboardRoot: string): string {
  return execFileSync('git', ['-C', dashboardRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
}

function routesEqual(left: DashboardRoutes, right: DashboardRoutes): boolean {
  // Default to [] so a legacy flat-array snapshot (no .global/.instance) reads as changed
  // and gets rewritten into the current shape rather than throwing.
  const listsEqual = (a: string[] = [], b: string[] = []) =>
    a.length === b.length && a.every((route, index) => route === b[index])
  return listsEqual(left.global, right.global) && listsEqual(left.instance, right.instance)
}

function run(): void {
  if (process.argv.includes('-h') || process.argv.includes('--help')) {
    showHelp()
    return
  }

  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
  const docsRoot = path.resolve(scriptDirectory, '..')
  const manifestPath = path.join(scriptDirectory, 'dashboard-routes.json')
  const dashboardRootArg = parseArg('--dashboard-root')
  const sourceRevisionArg = parseArg('--source-revision')
  const shouldUpdate = process.argv.includes('--update')
  const snapshotOnly = process.argv.includes('--snapshot-only')

  if (shouldUpdate && !dashboardRootArg) throw new Error('--update requires --dashboard-root')
  if (sourceRevisionArg && !shouldUpdate) throw new Error('--source-revision requires --update')
  if (snapshotOnly && !shouldUpdate) throw new Error('--snapshot-only requires --update')

  const existingManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as RouteManifest
  const dashboardRoot = dashboardRootArg ? path.resolve(process.cwd(), dashboardRootArg) : undefined
  const routes = dashboardRoot ? discoverDashboardRoutes(dashboardRoot) : existingManifest.routes

  if (shouldUpdate && dashboardRoot) {
    if (routesEqual(routes, existingManifest.routes)) {
      console.log(`Dashboard routes are unchanged from ${existingManifest.source.revision}`)
    } else {
      const manifest: RouteManifest = {
        routes,
        source: {
          generatedAt: new Date().toISOString(),
          repository: DASHBOARD_REPOSITORY,
          revision: sourceRevisionArg ?? dashboardRevision(dashboardRoot),
        },
      }
      fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
      const total = routes.global.length + routes.instance.length
      console.log(`Updated ${path.relative(process.cwd(), manifestPath)} with ${total} Dashboard routes`)
    }
  }

  if (snapshotOnly) return

  const links = CONTENT_DIRECTORIES.flatMap((directory) => {
    const contentRoot = path.join(docsRoot, directory)
    if (!fs.existsSync(contentRoot)) return []
    return walkFiles(contentRoot).flatMap((file) =>
      extractDashboardLinks(fs.readFileSync(file, 'utf8'), path.relative(docsRoot, file)),
    )
  })
  const invalidLinks = findInvalidDashboardLinks(links, routes)

  if (invalidLinks.length > 0) {
    console.error(`Found ${invalidLinks.length} Dashboard link(s) that do not match a current route:\n`)
    for (const link of invalidLinks) console.error(`  ${link.file}:${link.line}:${link.column}  ${link.url}`)
    console.error(
      '\nIf Dashboard routes intentionally changed, update the links and refresh the route snapshot with ' +
        '`pnpm dashboard-routes:update` from clerk-docs/.',
    )
    process.exitCode = 1
    return
  }

  const uniqueUrls = new Set(links.map((link) => link.url))
  const total = routes.global.length + routes.instance.length
  console.log(`Checked ${links.length} Dashboard links (${uniqueUrls.size} unique) against ${total} routes`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) run()
