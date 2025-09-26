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
import { compile, match } from 'path-to-regexp'

interface Redirect {
  source: string
  destination: string
  permanent: boolean
}

interface DynamicRedirect extends Redirect {
  matchesSource: (url: string) => any
  getDestination: (params: any) => string
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

    // Process dynamic redirects - use custom matching for patterns with :path* and :sdk
    const dynamicRedirects: DynamicRedirect[] = dynamicRedirectsRaw.map((redirect) => {
      // Use custom matching for patterns that don't work well with path-to-regexp
      if (redirect.source.includes(':path*') || redirect.source.includes(':sdk')) {
        return {
          ...redirect,
          matchesSource: (url: string) => {
            // Handle :path* patterns
            if (redirect.source.includes(':path*')) {
              const basePattern = redirect.source.replace(':path*', '')
              if (url.startsWith(basePattern)) {
                const capturedPath = url.substring(basePattern.length)
                return {
                  params: { path: capturedPath },
                  pathname: url,
                  pathnameBase: basePattern,
                  pattern: { pathname: redirect.source, caseSensitive: false, end: false },
                }
              }
            }

            // Handle :sdk patterns
            if (redirect.source.includes(':sdk')) {
              const parts = redirect.source.split('/')
              const urlParts = url.split('/')

              if (parts.length <= urlParts.length) {
                let matches = true
                const params: Record<string, string> = {}

                for (let i = 0; i < parts.length; i++) {
                  if (parts[i].startsWith(':')) {
                    const paramName = parts[i].substring(1)
                    if (paramName.endsWith('*')) {
                      // Handle wildcard parameters like :path*
                      const cleanParamName = paramName.replace('*', '')
                      params[cleanParamName] = urlParts.slice(i).join('/')
                      break
                    } else {
                      params[paramName] = urlParts[i]
                    }
                  } else if (parts[i] !== urlParts[i]) {
                    matches = false
                    break
                  }
                }

                if (matches) {
                  return {
                    params,
                    pathname: url,
                    pathnameBase: redirect.source.replace(/:[\w*]+/g, ''),
                    pattern: { pathname: redirect.source, caseSensitive: false, end: false },
                  }
                }
              }
            }

            return false
          },
          getDestination: (params: any) => {
            let destination = redirect.destination

            // Replace parameters in destination
            Object.keys(params || {}).forEach((key) => {
              destination = destination.replace(`:${key}*`, params[key])
              destination = destination.replace(`:${key}`, params[key])
            })

            return destination
          },
        }
      }

      // For simpler patterns, try using path-to-regexp
      try {
        return {
          ...redirect,
          matchesSource: match(redirect.source, { decode: decodeURIComponent }),
          getDestination: compile(redirect.destination, { encode: encodeURIComponent }),
        }
      } catch (error) {
        // Final fallback
        return {
          ...redirect,
          matchesSource: () => false,
          getDestination: () => redirect.destination,
        }
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

    // Check if destination exists in directory
    const exists = validUrls.has(destination)
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
