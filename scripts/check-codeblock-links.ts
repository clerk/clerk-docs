#!/usr/bin/env tsx

/**
 * Check Codeblock Links Script
 *
 * This script validates that clerk.com/docs URLs in code block comments
 * are up-to-date and don't redirect to different locations.
 *
 * What it does:
 * - Scans MDX files for code blocks containing clerk.com/docs URLs in comments
 * - Uses built docs (dist/directory.json) and redirects (dist/_redirects/) to check validity
 * - Reports URLs that would redirect to different locations (suggesting outdated links)
 * - Optionally fixes the URLs in-place with --fix flag
 *
 * Usage:
 *   npx tsx scripts/check-codeblock-links.ts
 *   npm run lint:check-codeblock-links
 *   npm run lint:check-codeblock-links -- --fix
 */

import fs from 'node:fs'
import { readFile } from 'node:fs/promises'
import { glob } from 'node:fs/promises'
import path from 'node:path'
import { parse as parseJSONC } from 'jsonc-parser'
import { compile, match, type MatchFunction, type PathFunction } from 'path-to-regexp'

const DOCS_DIR = 'docs'
const CLERK_DOCS_URL_PATTERN = /https?:\/\/clerk\.com\/docs[^\s\)\]"'`}]*/g

const args = process.argv.slice(2)
const fix = args.includes('--fix')
const verbose = args.includes('--verbose') || args.includes('-v')

type Color = 'red' | 'green' | 'yellow' | 'blue' | 'gray' | 'cyan'

const colorCodes: Record<Color, string> = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  gray: '\x1b[90m',
  cyan: '\x1b[36m',
}

function log(color: Color, message: string, indent = 0): void {
  const padding = '  '.repeat(indent)
  console.log(`${colorCodes[color]}${padding}${message}\x1b[0m`)
}

function showHelp(): void {
  console.log(`
Usage: tsx scripts/check-codeblock-links.ts [options]

Options:
  --fix          Update outdated links to their redirect destinations
  -v, --verbose  Show all URLs being checked
  -h, --help     Show this help message

Requires: Run 'npm run build' first to generate dist/directory.json and dist/_redirects/

Examples:
  npm run lint:check-codeblock-links
  npm run lint:check-codeblock-links -- --fix
  npm run lint:check-codeblock-links -- --verbose
`)
}

interface UrlLocation {
  file: string
  line: number
  url: string
}

interface Redirect {
  source: string
  destination: string
  permanent: boolean
}

interface StaticRedirect extends Redirect {}

interface DynamicRedirect extends Redirect {
  matchesSource: MatchFunction<Record<string, string>>
  getDestination: PathFunction<Record<string, string>>
}

interface DirectoryEntry {
  path: string
  url: string
}

interface CheckResults {
  total: number
  checked: number
  redirects: UrlLocation[]
  notFound: UrlLocation[]
  redirectMap: Map<string, string>
}

/**
 * Split a URL into base URL and hash fragment
 */
function splitUrlHash(url: string): { baseUrl: string; hash: string | null } {
  const hashIndex = url.indexOf('#')
  if (hashIndex === -1) {
    return { baseUrl: url, hash: null }
  }
  return {
    baseUrl: url.slice(0, hashIndex),
    hash: url.slice(hashIndex),
  }
}

/**
 * Clean a URL by removing trailing punctuation that might have been captured
 */
function cleanUrl(url: string): string {
  return url.replace(/[,;:\.]+$/, '').replace(/\)+$/, '')
}

/**
 * Convert a full clerk.com/docs URL to a local path (e.g., /docs/foo/bar)
 */
function urlToLocalPath(url: string): string {
  const { baseUrl } = splitUrlHash(url)
  return baseUrl.replace('https://clerk.com', '').replace('http://clerk.com', '')
}

/**
 * Load the directory of valid pages from dist/directory.json
 */
async function loadDirectory(): Promise<Set<string>> {
  try {
    const directoryPath = path.join(process.cwd(), 'dist', 'directory.json')
    const content = await readFile(directoryPath, 'utf-8')
    const directory: DirectoryEntry[] = JSON.parse(content)

    const validUrls = new Set<string>()

    for (const entry of directory) {
      validUrls.add(entry.url)
      // Also add without trailing slash
      if (entry.url.endsWith('/') && entry.url !== '/') {
        validUrls.add(entry.url.slice(0, -1))
      }
      // Also add with trailing slash
      if (!entry.url.endsWith('/') && entry.url !== '/docs') {
        validUrls.add(entry.url + '/')
      }
    }

    return validUrls
  } catch (error) {
    throw new Error(`Failed to load dist/directory.json. Run 'npm run build' first.\n${error}`)
  }
}

/**
 * Load redirects from dist/_redirects/
 */
async function loadRedirects(): Promise<{
  staticRedirects: Record<string, StaticRedirect>
  dynamicRedirects: DynamicRedirect[]
}> {
  try {
    const redirectsPath = path.join(process.cwd(), 'dist', '_redirects')

    // Load static redirects
    const staticPath = path.join(redirectsPath, 'static.json')
    const staticContent = await readFile(staticPath, 'utf-8')
    const staticRedirectsObj = JSON.parse(staticContent) as Record<string, StaticRedirect>

    // Load dynamic redirects
    const dynamicPath = path.join(redirectsPath, 'dynamic.jsonc')
    const dynamicContent = await readFile(dynamicPath, 'utf-8')
    const dynamicRedirectsRaw = parseJSONC(dynamicContent) as Redirect[]

    // Process dynamic redirects with path-to-regexp
    const dynamicRedirects: DynamicRedirect[] = dynamicRedirectsRaw
      .map((redirect) => {
        try {
          const matcher = match<Record<string, string>>(redirect.source, {
            decode: decodeURIComponent,
          })
          const compiler = compile(redirect.destination, {
            encode: (str) => str,
            validate: false,
          })

          return {
            ...redirect,
            matchesSource: (url: string) => matcher(url),
            getDestination: (params: Record<string, any> | undefined) => compiler(params || {}),
          }
        } catch {
          return null
        }
      })
      .filter((r): r is DynamicRedirect => r !== null)

    return { staticRedirects: staticRedirectsObj, dynamicRedirects }
  } catch (error) {
    throw new Error(`Failed to load dist/_redirects/. Run 'npm run build' first.\n${error}`)
  }
}

/**
 * Check if a path redirects and return the destination
 */
function checkRedirect(
  localPath: string,
  staticRedirects: Record<string, StaticRedirect>,
  dynamicRedirects: DynamicRedirect[],
): string | null {
  // Check static redirects first
  const staticRedirect = staticRedirects[localPath]
  if (staticRedirect) {
    return staticRedirect.destination
  }

  // Check dynamic redirects
  for (const redirect of dynamicRedirects) {
    const matchResult = redirect.matchesSource(localPath)
    if (matchResult) {
      try {
        return redirect.getDestination(matchResult.params)
      } catch {
        return redirect.destination
      }
    }
  }

  return null
}

/**
 * Follow redirect chain to get final destination
 */
function followRedirectChain(
  localPath: string,
  staticRedirects: Record<string, StaticRedirect>,
  dynamicRedirects: DynamicRedirect[],
  maxRedirects = 10,
): string | null {
  let currentPath = localPath
  let redirectCount = 0

  while (redirectCount < maxRedirects) {
    const destination = checkRedirect(currentPath, staticRedirects, dynamicRedirects)
    if (!destination) {
      // No more redirects
      return currentPath !== localPath ? currentPath : null
    }

    // Skip external redirects
    if (destination.startsWith('http://') || destination.startsWith('https://')) {
      return currentPath !== localPath ? currentPath : null
    }

    currentPath = destination
    redirectCount++
  }

  return currentPath
}

/**
 * Find all clerk.com/docs URLs in code blocks within MDX files
 */
async function findCodeblockUrls(): Promise<UrlLocation[]> {
  const urls: UrlLocation[] = []

  for await (const entry of glob(`${DOCS_DIR}/**/*.{md,mdx}`)) {
    const file = entry.toString()
    const content = fs.readFileSync(file, 'utf8')
    const lines = content.split('\n')

    let inCodeBlock = false

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const lineNumber = i + 1

      // Check for code block start/end
      if (line.trim().startsWith('```')) {
        inCodeBlock = !inCodeBlock
        continue
      }

      // Only check lines inside code blocks that look like comments
      if (inCodeBlock) {
        const isComment = line.includes('//') || line.includes('#') || line.includes('/*') || line.includes('*/')

        if (isComment) {
          const matches = line.matchAll(CLERK_DOCS_URL_PATTERN)
          for (const match of matches) {
            const cleanedUrl = cleanUrl(match[0])
            const url = cleanedUrl.startsWith('http://') ? cleanedUrl.replace('http://', 'https://') : cleanedUrl

            urls.push({ file, line: lineNumber, url })
          }
        }
      }
    }
  }

  return urls
}

/**
 * Fix URLs in files by replacing old URLs with new ones
 */
function fixUrls(redirectMap: Map<string, string>, urlLocations: UrlLocation[]): number {
  const fileChanges = new Map<string, Map<string, string>>()

  for (const loc of urlLocations) {
    const newUrl = redirectMap.get(loc.url)
    if (newUrl) {
      if (!fileChanges.has(loc.file)) {
        fileChanges.set(loc.file, new Map())
      }
      fileChanges.get(loc.file)!.set(loc.url, newUrl)
    }
  }

  let fixedCount = 0

  for (const [file, changes] of fileChanges) {
    let content = fs.readFileSync(file, 'utf8')
    let modified = false

    for (const [oldUrl, newUrl] of changes) {
      if (content.includes(oldUrl)) {
        content = content.split(oldUrl).join(newUrl)
        modified = true
        fixedCount++
      }
    }

    if (modified) {
      fs.writeFileSync(file, content)
      log('gray', `  Updated ${file}`)
    }
  }

  return fixedCount
}

async function main(): Promise<void> {
  log('blue', 'Checking codeblock links...\n')

  try {
    // Load built docs data
    const [validUrls, { staticRedirects, dynamicRedirects }] = await Promise.all([loadDirectory(), loadRedirects()])

    log('gray', `Loaded ${validUrls.size} valid pages from dist/directory.json`)
    log('gray', `Loaded ${Object.keys(staticRedirects).length} static redirects`)

    // Find all URLs in codeblocks
    const urlLocations = await findCodeblockUrls()
    const uniqueUrls = [...new Set(urlLocations.map((loc) => loc.url))]

    log('gray', `Found ${urlLocations.length} clerk.com/docs URLs in code comments`)
    log('gray', `Checking ${uniqueUrls.length} unique URLs...\n`)

    const results: CheckResults = {
      total: urlLocations.length,
      checked: uniqueUrls.length,
      redirects: [],
      notFound: [],
      redirectMap: new Map(),
    }

    // Check each unique URL
    for (const url of uniqueUrls) {
      const { baseUrl, hash } = splitUrlHash(url)
      const localPath = urlToLocalPath(url)

      if (verbose) {
        process.stdout.write(`  Checking ${localPath}...`)
      }

      // Check if the path exists directly
      if (validUrls.has(localPath)) {
        if (verbose) {
          console.log(' ✓')
        }
        continue
      }

      // Check if it redirects
      const finalPath = followRedirectChain(localPath, staticRedirects, dynamicRedirects)

      if (finalPath && validUrls.has(finalPath)) {
        // URL redirects to a valid page
        const newUrl = `https://clerk.com${finalPath}${hash || ''}`
        if (verbose) {
          console.log(` → ${finalPath}`)
        }
        results.redirectMap.set(url, newUrl)
        for (const loc of urlLocations) {
          if (loc.url === url) {
            results.redirects.push(loc)
          }
        }
      } else {
        // URL not found
        if (verbose) {
          console.log(' ✗ not found')
        }
        for (const loc of urlLocations) {
          if (loc.url === url) {
            results.notFound.push(loc)
          }
        }
      }
    }

    if (verbose) {
      console.log()
    }

    // Handle --fix mode
    if (fix && results.redirects.length > 0) {
      log('yellow', `Fixing ${results.redirectMap.size} redirecting URL(s)...\n`)
      const fixedCount = fixUrls(results.redirectMap, results.redirects)
      log('green', `✓ Fixed ${fixedCount} URL occurrence(s)\n`)
    }

    // Report results
    const hasRedirects = !fix && results.redirects.length > 0
    const hasNotFound = results.notFound.length > 0

    if (hasRedirects) {
      log('yellow', `⚠ URLs that redirect to different locations:`)

      for (const [oldUrl, newUrl] of results.redirectMap) {
        log('yellow', `\n  ${oldUrl}`)
        log('cyan', `  → ${newUrl}`)

        const locations = results.redirects.filter((loc) => loc.url === oldUrl)
        for (const loc of locations) {
          log('gray', `    ${loc.file}:${loc.line}`, 1)
        }
      }
      console.log()
    }

    if (hasNotFound) {
      log('red', `✗ URLs not found (no valid page or redirect):`)

      const uniqueNotFound = [...new Set(results.notFound.map((loc) => loc.url))]
      for (const url of uniqueNotFound) {
        log('red', `\n  ${url}`)
        const locations = results.notFound.filter((loc) => loc.url === url)
        for (const loc of locations) {
          log('gray', `    ${loc.file}:${loc.line}`, 1)
        }
      }
      console.log()
    }

    // Summary
    if (hasRedirects || hasNotFound) {
      const redirectCount = hasRedirects ? results.redirectMap.size : 0
      const notFoundCount = hasNotFound ? new Set(results.notFound.map((e) => e.url)).size : 0
      log('red', `✗ Found ${redirectCount + notFoundCount} URL issue(s)`)

      if (hasRedirects) {
        log('gray', `  ${redirectCount} URL(s) redirect to different locations`, 1)
        log('gray', `  Run with --fix to update them automatically`, 1)
      }
      if (hasNotFound) {
        log('gray', `  ${notFoundCount} URL(s) not found`, 1)
      }

      process.exit(1)
    } else {
      log('green', '✓ All codeblock links are up-to-date!')
      log('gray', `  Checked ${results.checked} unique URLs`, 1)
      process.exit(0)
    }
  } catch (error) {
    log('red', `Error: ${(error as Error).message}`)
    process.exit(1)
  }
}

if (args.includes('--help') || args.includes('-h')) {
  showHelp()
  process.exit(0)
}

main()
