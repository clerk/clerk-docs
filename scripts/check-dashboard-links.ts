import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DASHBOARD_ORIGIN = 'https://dashboard.clerk.com'
const DASHBOARD_ENV_ORIGIN = '${process.env.NEXT_PUBLIC_DASHBOARD_URL}'
const CONTENT_DIRECTORIES = ['clerk-typedoc', 'data', 'docs', 'prompts']
const SOURCE_EXTENSIONS = new Set(['.js', '.json', '.jsx', '.md', '.mdx', '.mjs', '.ts', '.tsx', '.yaml', '.yml'])
const IGNORED_DIRECTORIES = new Set(['.git', '.next', 'dist', 'node_modules'])
// Match the whole URL candidate — host suffix, port, and path included — and let `URL.origin`
// be the sole gatekeeper below. Capturing the full token (rather than boundary-matching the
// host) is what lets a look-alike like `dashboard.clerk.com.evil` or a non-default port parse
// to a different origin and get rejected, while a trailing sentence period trims away and a
// default `:443` normalizes to the real origin. Case-insensitive so uppercase hosts still match.
const DASHBOARD_URL_PATTERN =
  /(?:https:\/\/dashboard\.clerk\.com|\$\{process\.env\.NEXT_PUBLIC_DASHBOARD_URL\})[^\s<>"'`)\]}*]*/gi
// Dashboard publishes the links it serves, rebuilt with every deployment, so this URL always
// describes dashboard.clerk.com right now — the same idea as clerk.com/docs/links.json. The
// generator lives in clerk/dashboard at apps/dashboard/app/(routes)/(unauthenticated)/links.json.
const DASHBOARD_LINKS_URL = `${DASHBOARD_ORIGIN}/links.json`
const SUPPORTED_MANIFEST_VERSION = 1
const FETCH_ATTEMPTS = 3
const FETCH_TIMEOUT_MS = 10_000

export interface DashboardLink {
  column: number
  file: string
  line: number
  // The link as Dashboard lists it: origin, query, hash, and trailing slash removed.
  path: string
  url: string
}

export interface LinkManifest {
  generatedAt?: string
  // Every path static content can link to. Instance pages are listed as `/~/…` shortcuts.
  links: string[]
  // Paths that still resolve but have moved, mapped to where they land.
  redirects: Record<string, string>
  sourceRevision?: string | null
  version: number
}

export interface InvalidDashboardLink extends DashboardLink {
  // Set when the link still works through a redirect. Link to this instead.
  movedTo?: string
}

interface ContentRoot {
  base: string
  excludeTests: boolean
  root: string
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

export function normalizeDashboardLink(rawUrl: string): string | null {
  let url: URL
  try {
    const resolvedUrl = rawUrl.startsWith(DASHBOARD_ENV_ORIGIN)
      ? `${DASHBOARD_ORIGIN}${rawUrl.slice(DASHBOARD_ENV_ORIGIN.length)}`
      : rawUrl
    url = new URL(trimUrl(resolvedUrl))
  } catch {
    // A malformed candidate (e.g. a stray percent-sign) isn't a Dashboard link — skip it
    // rather than crashing the whole lint.
    return null
  }
  if (url.origin !== DASHBOARD_ORIGIN) return null

  // Legacy `/last-active?path=…` links normalize to `/last-active`, which Dashboard
  // deliberately leaves out of its manifest so they fail validation.
  return url.pathname.replace(/\/+$/, '') || '/'
}

export function extractDashboardLinks(content: string, file: string): DashboardLink[] {
  const links: DashboardLink[] = []

  for (const match of content.matchAll(DASHBOARD_URL_PATTERN)) {
    const url = trimUrl(match[0])
    const linkPath = normalizeDashboardLink(url)
    if (!linkPath) continue

    const before = content.slice(0, match.index)
    const lines = before.split('\n')
    links.push({
      column: lines[lines.length - 1].length + 1,
      file,
      line: lines.length,
      path: linkPath,
      url,
    })
  }

  return links
}

export function collectDashboardLinks(contentRoots: ContentRoot[]): DashboardLink[] {
  return contentRoots.flatMap(({ base, excludeTests, root }) => {
    if (!fs.existsSync(root)) return []
    return walkFiles(root)
      .filter((file) => !excludeTests || !/\.test\.[cm]?[jt]sx?$/.test(file))
      .flatMap((file) => extractDashboardLinks(fs.readFileSync(file, 'utf8'), path.relative(base, file)))
  })
}

// A redirected link fails too. It works today, but a redirect is a grace period: the link
// should point at the page itself before Dashboard retires the old path.
export function findInvalidDashboardLinks(links: DashboardLink[], manifest: LinkManifest): InvalidDashboardLink[] {
  const valid = new Set(manifest.links)

  return links.flatMap((link) => {
    if (valid.has(link.path)) return []
    const movedTo = manifest.redirects[link.path]
    return [movedTo ? { ...link, movedTo } : link]
  })
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
  --links <url|path>  Read the link manifest from another deployment or a local file
                      (defaults to ${DASHBOARD_LINKS_URL})
  -h, --help           Show this help message
`)
}

// Throws on anything that isn't a usable manifest, so a Dashboard regression (an auth wall
// serving HTML, an emptied route list, a breaking format change) fails the check loudly
// instead of passing or flagging every link.
export function parseLinkManifest(body: string, source: string): LinkManifest {
  let manifest: Partial<LinkManifest>
  try {
    manifest = JSON.parse(body) as Partial<LinkManifest>
  } catch {
    throw new Error(`${source} did not return JSON — the Dashboard link manifest may be behind auth or missing.`)
  }

  if (manifest.version !== SUPPORTED_MANIFEST_VERSION) {
    throw new Error(
      `${source} is manifest version ${String(manifest.version)}, but this check reads version ` +
        `${SUPPORTED_MANIFEST_VERSION} — update check-dashboard-links.ts for the new format.`,
    )
  }

  const { links, redirects } = manifest
  if (!Array.isArray(links) || links.length === 0 || !links.every((link) => typeof link === 'string')) {
    throw new Error(`${source} is missing a non-empty links list.`)
  }
  if (!redirects || typeof redirects !== 'object' || Array.isArray(redirects)) {
    throw new Error(`${source} is missing its redirects map.`)
  }

  return manifest as LinkManifest
}

// The server answered, and the answer is that the manifest isn't there: a 4xx, or a redirect
// to the sign-in wall. Retrying can't change that, and calling it a network problem sends the
// reader looking in the wrong place.
class ManifestNotPublishedError extends Error {}

async function fetchManifestBody(url: string): Promise<string> {
  let lastError: unknown
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt += 1) {
    try {
      // `redirect: 'manual'` hands back the 3xx itself. Following it would land on the sign-in
      // page, and `redirect: 'error'` would hide the status behind a generic fetch failure.
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        redirect: 'manual',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      if (response.status >= 300 && response.status < 400) {
        throw new ManifestNotPublishedError(
          `${url} redirected (HTTP ${response.status}) instead of returning the Dashboard link manifest. ` +
            'The manifest is never behind a redirect, so this is most likely the sign-in wall: /links.json ' +
            "may have dropped out of Dashboard's unauthenticated routes. Use --links to check against another deployment.",
        )
      }
      // 408 and 429 are the two 4xx codes that describe the moment, not the URL.
      const isPermanent = response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status)
      if (isPermanent) {
        throw new ManifestNotPublishedError(
          `${url} returned HTTP ${response.status}: no Dashboard link manifest is published at that URL. ` +
            'Either the deployment predates /links.json, the URL is wrong, or /links.json dropped out of ' +
            "Dashboard's unauthenticated routes (Dashboard answers signed-out JSON requests with a 404). " +
            'Use --links to check against another deployment.',
        )
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return await response.text()
    } catch (error) {
      if (error instanceof ManifestNotPublishedError) throw error
      lastError = error
      if (attempt < FETCH_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, attempt * 1000))
    }
  }

  const reason = lastError instanceof Error ? lastError.message : String(lastError)
  throw new Error(
    `Could not fetch the Dashboard link manifest from ${url} after ${FETCH_ATTEMPTS} attempts (${reason}). ` +
      'This is a network or Dashboard availability problem, not a docs problem — rerun the check.',
  )
}

export async function loadLinkManifest(source: string): Promise<LinkManifest> {
  const body = /^https?:\/\//.test(source)
    ? await fetchManifestBody(source)
    : fs.readFileSync(path.resolve(process.cwd(), source), 'utf8')
  return parseLinkManifest(body, source)
}

async function run(): Promise<void> {
  if (process.argv.includes('-h') || process.argv.includes('--help')) {
    showHelp()
    return
  }

  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
  const docsRoot = path.resolve(scriptDirectory, '..')
  const repositoryRoot = path.resolve(docsRoot, '..')
  const manifestSource = parseArg('--links') ?? DASHBOARD_LINKS_URL
  const manifest = await loadLinkManifest(manifestSource)

  const contentRoots = [
    ...CONTENT_DIRECTORIES.map((directory) => ({
      base: docsRoot,
      excludeTests: false,
      root: path.join(docsRoot, directory),
    })),
    { base: repositoryRoot, excludeTests: true, root: path.join(repositoryRoot, 'src') },
  ]
  const links = collectDashboardLinks(contentRoots)
  const invalidLinks = findInvalidDashboardLinks(links, manifest)

  if (invalidLinks.length > 0) {
    console.error(`Found ${invalidLinks.length} Dashboard link(s) that ${manifestSource} does not list:\n`)
    for (const link of invalidLinks) {
      const hint = link.movedTo ? `  → moved to ${DASHBOARD_ORIGIN}${link.movedTo}` : ''
      console.error(`  ${link.file}:${link.line}:${link.column}  ${link.url}${hint}`)
    }
    console.error('\nUpdate each link to a path in that manifest. A moved link still redirects, but only for now.')
    process.exitCode = 1
    return
  }

  const uniqueUrls = new Set(links.map((link) => link.url))
  console.log(
    `Checked ${links.length} Dashboard links (${uniqueUrls.size} unique) against ${manifest.links.length} links from ${manifestSource}`,
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
