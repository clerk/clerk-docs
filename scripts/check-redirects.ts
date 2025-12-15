#!/usr/bin/env tsx

/**
 * Check Redirects Script
 *
 * This script validates that all redirect destinations in the dist/_redirects directory
 * point to pages that actually exist in the built documentation.
 * Uses production-like redirect matching with path-to-regexp for accurate validation.
 *
 * What it does:
 * - Loads the directory.json file from dist/ to get all valid page URLs
 * - Loads both static.json and dynamic.jsonc redirect files from dist/_redirects/
 * - Processes dynamic redirects using the same logic as production (path-to-regexp)
 * - Validates each redirect destination against the directory of valid pages
 * - Handles special cases:
 *   - External URLs (skipped)
 *   - Hash fragment URLs (validates base URL only)
 *   - Dynamic routes with parameters like :path* and :sdk (validates pattern)
 *
 * Usage:
 *   npx tsx scripts/check-redirects.ts
 *   npm run lint:check-redirects
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { parse as parseJSONC } from 'jsonc-parser'
import { compile, match, MatchFunction, PathFunction } from 'path-to-regexp'

interface Redirect {
  source: string
  destination: string
  permanent: boolean
}

interface DynamicRedirect extends Redirect {
  matchesSource: MatchFunction<Record<string, string>>
  getDestination: PathFunction<Record<string, string>>
}

interface StaticRedirect extends Redirect {
  // Static redirects are just the base interface
}

interface DirectoryEntry {
  path: string
  url: string
}

interface RedirectCheckResult {
  redirect: Redirect
  exists: boolean
  error?: string
}

interface ProtectedRoute {
  path: string
  isPattern: boolean
  basePath: string // For pattern routes, the path prefix to check
}

// Protected routes that should not be shadowed by redirects
// These are Next.js API routes and special paths that need to remain accessible
const PROTECTED_ROUTES = [
  '/docs/api/instance_keys',
  '/docs/core-1/[[...slug]]',
  '/docs/experiment-create_account_from_docs_quickstart/[experiment]',
  '/docs/experiment-nextjs_quickstart_template/[experiment]',
  '/docs/images/[[...slug]]',
  '/docs/llms-full.txt',
  '/docs/llms.txt',
  '/docs/pr/[number]/[[...slug]]',
  '/docs/pr/[number]/experiment-create_account_from_docs_quickstart/[experiment]',
  '/docs/pr/[number]/experiment-nextjs_quickstart_template/[experiment]',
  '/docs/pr/[number]/llms-full.txt',
  '/docs/pr/[number]/llms.txt',
  '/docs/pr/[number]/quickstart',
  '/docs/pr/[number]/raw/[[...slug]]',
  '/docs/quickstart',
  '/docs/raw/[[...slug]]',
  '/docs/reference/backend-api/[[...slug]]',
  '/docs/reference/frontend-api/[[...slug]]',
  '/docs/reference/spec/[api]/[version]',
  '/docs/reference/spec/invalidate',
  '/docs/revalidate',
]

function parseProtectedRoutes(): ProtectedRoute[] {
  return PROTECTED_ROUTES.map((path) => {
    const isPattern = path.includes('[')
    let basePath = path

    if (isPattern) {
      // Extract the base path up to the first bracket
      const bracketIndex = path.indexOf('[')
      basePath = path.substring(0, bracketIndex)
    }

    return {
      path,
      isPattern,
      basePath,
    }
  })
}

function checkProtectedRoutes(staticRedirects: Record<string, StaticRedirect>): {
  violations: Array<{ source: string; protectedRoute: string; reason: string }>
  count: number
} {
  const protectedRoutes = parseProtectedRoutes()
  const violations: Array<{ source: string; protectedRoute: string; reason: string }> = []

  for (const [source, redirect] of Object.entries(staticRedirects)) {
    for (const protectedRoute of protectedRoutes) {
      if (protectedRoute.isPattern) {
        // For pattern routes, check if source starts with the base path
        if (source.startsWith(protectedRoute.basePath)) {
          violations.push({
            source,
            protectedRoute: protectedRoute.path,
            reason: `Source starts with protected pattern base path: ${protectedRoute.basePath}`,
          })
        }
      } else {
        // For exact routes, check for exact match only
        if (source === protectedRoute.path) {
          violations.push({
            source,
            protectedRoute: protectedRoute.path,
            reason: 'Source exactly matches protected route',
          })
        }
      }
    }
  }

  return {
    violations,
    count: violations.length,
  }
}

async function loadDirectory(): Promise<Set<string>> {
  try {
    const directoryPath = path.join(process.cwd(), 'dist', 'directory.json')
    const content = await fs.readFile(directoryPath, 'utf-8')
    const directory: DirectoryEntry[] = JSON.parse(content)

    // Create a set of all valid URLs for fast lookup
    const validUrls = new Set<string>()

    for (const entry of directory) {
      validUrls.add(entry.url)
      // Also add the URL without trailing slash if it has one
      if (entry.url.endsWith('/') && entry.url !== '/') {
        validUrls.add(entry.url.slice(0, -1))
      }
      // Also add the URL with trailing slash if it doesn't have one
      if (!entry.url.endsWith('/') && entry.url !== '/docs') {
        validUrls.add(entry.url + '/')
      }
    }

    return validUrls
  } catch (error) {
    throw new Error(`Failed to load directory.json: ${error}`)
  }
}

async function loadRedirects(): Promise<{
  staticRedirects: Record<string, StaticRedirect>
  dynamicRedirects: DynamicRedirect[]
}> {
  try {
    const redirectsPath = path.join(process.cwd(), 'dist', '_redirects')

    // Load static redirects
    const staticPath = path.join(redirectsPath, 'static.json')
    const staticContent = await fs.readFile(staticPath, 'utf-8')
    const staticRedirectsObj = JSON.parse(staticContent) as Record<string, StaticRedirect>

    // Load dynamic redirects
    const dynamicPath = path.join(redirectsPath, 'dynamic.jsonc')
    const dynamicContent = await fs.readFile(dynamicPath, 'utf-8')
    const dynamicRedirectsRaw = parseJSONC(dynamicContent) as Redirect[]

    // Process dynamic redirects with native path-to-regexp support
    const dynamicRedirects: DynamicRedirect[] = dynamicRedirectsRaw.map((redirect) => {
      try {
        // Use native path-to-regexp support for :path* patterns
        const matcher = match<Record<string, string>>(redirect.source, { decode: decodeURIComponent })
        const compiler = compile(redirect.destination, { encode: (str) => str, validate: false })

        return {
          ...redirect,
          matchesSource: (url: string) => {
            return matcher(url)
          },
          getDestination: (params: Record<string, any> | undefined) => {
            return compiler(params || {})
          },
        }
      } catch (error) {
        // Fallback for patterns that don't work with path-to-regexp
        console.warn(`Warning: Could not compile pattern ${redirect.source}: ${error}`)
        return {
          ...redirect,
          matchesSource: () => false,
          getDestination: () => redirect.destination,
        } as DynamicRedirect
      }
    })

    return {
      staticRedirects: staticRedirectsObj,
      dynamicRedirects,
    }
  } catch (error) {
    throw new Error(`Failed to load redirects: ${error}`)
  }
}

function normalizeUrl(url: string): string {
  // Remove hash fragments for validation
  const urlWithoutHash = url.split('#')[0]

  // Handle dynamic routes with :path* syntax
  if (urlWithoutHash.includes(':path*')) {
    // For validation purposes, replace :path* with a sample path
    return urlWithoutHash.replace(':path*', 'sample')
  }

  // Handle other dynamic parameters like :sdk
  if (urlWithoutHash.includes(':')) {
    return urlWithoutHash.replace(/:[\w-]+/g, 'sample')
  }

  return urlWithoutHash
}

function hasHashFragment(url: string): boolean {
  return url.includes('#')
}

function isExternalUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://')
}

async function checkRedirects(): Promise<void> {
  console.log('🔎 Loading directory and redirects...')

  const [validUrls, { staticRedirects, dynamicRedirects }] = await Promise.all([loadDirectory(), loadRedirects()])

  // Create a flat list of all redirects for counting and reporting
  const allRedirects = [...Object.values(staticRedirects), ...dynamicRedirects]

  console.log(`📁 Found ${validUrls.size} valid pages`)
  console.log(`🔀 Found ${allRedirects.length} redirects to check`)
  console.log()

  // Check for protected route violations
  console.log('🛡️  Checking for protected route violations...')
  const protectedRouteCheck = checkProtectedRoutes(staticRedirects)

  if (protectedRouteCheck.count > 0) {
    console.log(`❌ Found ${protectedRouteCheck.count} protected route violation(s):`)
    console.log()

    for (const violation of protectedRouteCheck.violations) {
      console.log(`   Source: ${violation.source}`)
      console.log(`   Conflicts with: ${violation.protectedRoute}`)
      console.log(`   Reason: ${violation.reason}`)
      console.log()
    }

    process.exitCode = 1
    return
  }

  console.log(`✅ No protected route violations found`)
  console.log()

  // Check for redirects that shadow existing pages
  console.log('📄 Checking for redirects that shadow existing pages...')
  const shadowedPages: Array<{ source: string; destination: string }> = []

  for (const [source, redirect] of Object.entries(staticRedirects)) {
    if (validUrls.has(source)) {
      shadowedPages.push({ source, destination: redirect.destination })
    }
  }

  if (shadowedPages.length > 0) {
    console.log(`❌ Found ${shadowedPages.length} redirect(s) that shadow existing pages:`)
    console.log()
    for (const { source, destination } of shadowedPages) {
      console.log(`   Source: ${source}`)
      console.log(`   Destination: ${destination}`)
      console.log(`   Problem: A page already exists at this URL`)
      console.log()
    }
    process.exitCode = 1
    return
  }

  console.log('✅ No redirects shadow existing pages')
  console.log()

  const results: RedirectCheckResult[] = []
  let invalidCount = 0
  let externalCount = 0
  let dynamicPatternCount = 0
  let hashFragmentCount = 0

  for (const redirect of allRedirects) {
    const { destination } = redirect

    // Skip external URLs
    if (isExternalUrl(destination)) {
      externalCount++
      continue
    }

    // Handle URLs with hash fragments
    if (hasHashFragment(destination)) {
      hashFragmentCount++
      const baseUrl = normalizeUrl(destination)
      const exists = validUrls.has(baseUrl)

      results.push({
        redirect,
        exists,
        error: exists ? undefined : `Base URL not found (hash fragment URLs cannot be fully validated): ${destination}`,
      })

      if (!exists) {
        invalidCount++
      }
      continue
    }

    // Handle dynamic route patterns - these can't be directly validated as URLs
    if (destination.includes(':')) {
      dynamicPatternCount++

      // For dynamic destination patterns, we should validate the base structure
      // by checking if similar paths exist, rather than treating them as invalid
      let isValidPattern = true
      let errorMessage: string | undefined

      if (destination.includes(':sdk')) {
        // For :sdk patterns, validate by checking if SDK-specific paths exist
        // Extract the pattern and test with known SDKs
        const knownSDKs = [
          'nextjs',
          'react',
          'vue',
          'nuxt',
          'remix',
          'astro',
          'expo',
          'react-router',
          'tanstack-react-start',
          'chrome-extension',
        ]

        let hasValidSDKPath = false
        for (const sdk of knownSDKs) {
          let testDestination = destination.replace(':sdk', sdk)
          if (testDestination.includes(':path*')) {
            // For patterns with both :sdk and :path*, check if the base SDK path exists
            const testBasePath = testDestination.replace(':path*', '')
            if (validUrls.has(testBasePath) || Array.from(validUrls).some((url) => url.startsWith(testBasePath))) {
              hasValidSDKPath = true
              break
            }
          } else {
            // For patterns with just :sdk, check if the exact path exists
            if (validUrls.has(testDestination)) {
              hasValidSDKPath = true
              break
            }
          }
        }

        if (!hasValidSDKPath) {
          isValidPattern = false
          errorMessage = `No valid SDK paths found for pattern: ${destination}`
        }
      } else if (destination.includes(':path*')) {
        // For :path* patterns (without :sdk), check if the base path exists or if similar paths exist
        const basePath = destination.replace(':path*', '')
        const hasBasePath = validUrls.has(basePath)
        const hasSimilarPaths = Array.from(validUrls).some((url) => url.startsWith(basePath))

        if (!hasBasePath && !hasSimilarPaths) {
          isValidPattern = false
          errorMessage = `Dynamic pattern base path may be invalid: ${destination} (no similar paths found)`
        }
      } else {
        // Other dynamic parameters - mark as potentially invalid for review
        isValidPattern = false
        errorMessage = `Unknown dynamic parameter pattern: ${destination}`
      }

      results.push({
        redirect,
        exists: isValidPattern,
        error: errorMessage,
      })

      if (!isValidPattern) {
        invalidCount++
      }
      continue
    }

    // Check if destination exists in directory (check both encoded and decoded versions)
    const decodedDestination = decodeURIComponent(destination)
    const exists = validUrls.has(destination) || validUrls.has(decodedDestination)
    results.push({
      redirect,
      exists,
    })

    if (!exists) {
      invalidCount++
    }
  }

  // Report results
  console.log(`📊 Results:`)
  console.log(`   ✅ Valid redirects: ${allRedirects.length - invalidCount - externalCount}`)
  console.log(`   🌐 External redirects (skipped): ${externalCount}`)
  console.log(`   🔗 Hash fragment URLs: ${hashFragmentCount}`)
  console.log(`   🔀 Dynamic pattern destinations: ${dynamicPatternCount}`)
  console.log(`   ❌ Invalid redirects: ${invalidCount}`)
  console.log()

  // Show invalid redirects
  if (invalidCount > 0) {
    console.log('❌ Invalid redirect destinations:')
    console.log()

    for (const result of results) {
      if (!result.exists) {
        console.log(`   Source: ${result.redirect.source}`)
        console.log(`   Destination: ${result.redirect.destination}`)
        if (result.error) {
          console.log(`   Error: ${result.error}`)
        } else {
          console.log(`   Error: Destination page does not exist`)
        }
        console.log()
      }
    }

    process.exitCode = 1
  } else {
    console.log('✅ All redirect destinations point to valid pages!')
  }
}

async function main() {
  try {
    await checkRedirects()
  } catch (error) {
    console.error('💥 Error checking redirects:', error)
    process.exitCode = 1
  }
}

// Run the script if called directly
main()
