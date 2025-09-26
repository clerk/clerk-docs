#!/usr/bin/env tsx

/**
 * Trace Redirect Script
 *
 * This script traces a URL through the redirect chain to show where it ultimately leads.
 * It follows redirects step by step, detects loops, and validates the final destination.
 * Uses production-like redirect matching with path-to-regexp for accurate results.
 *
 * What it does:
 * - Takes a URL as input (command line argument)
 * - Loads redirect rules from dist/_redirects/ (static.json and dynamic.jsonc)
 * - Follows the redirect chain step by step using production-like matching logic
 * - Handles complex patterns like :path*, :sdk, and other dynamic parameters
 * - Detects infinite loops and circular redirects
 * - Shows the complete redirect path with matched rules
 * - Validates the final destination against directory.json
 * - Reports if the final destination is valid or would result in a 404
 *
 * Usage:
 *   npx tsx scripts/trace-redirect.ts "/docs/some-old-path"
 *   npm run trace-redirect "/docs/some-old-path"
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
  matchesSource: ReturnType<typeof match>
  getDestination: ReturnType<typeof compile>
}

interface StaticRedirect extends Redirect {
  // Static redirects are just the base interface
}

interface DirectoryEntry {
  path: string
  url: string
}

interface RedirectStep {
  step: number
  from: string
  to: string
  permanent: boolean
  matchedRule: string
}

interface TraceResult {
  inputUrl: string
  steps: RedirectStep[]
  finalDestination: string
  isLoop: boolean
  loopDetectedAt?: number
  destinationExists: boolean
  totalHops: number
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

function findRedirect(
  url: string,
  staticRedirects: Record<string, StaticRedirect>,
  dynamicRedirects: DynamicRedirect[],
): { redirect: Redirect; destination: string; matchedRule: string } | null {
  // Check dynamic redirects first (like production)
  for (const dynamicRedirect of dynamicRedirects) {
    const matchResult = dynamicRedirect.matchesSource(url)
    if (matchResult) {
      const destination = dynamicRedirect.getDestination(matchResult.params)
      return {
        redirect: dynamicRedirect,
        destination,
        matchedRule: dynamicRedirect.source,
      }
    }
  }

  // Check static redirects second
  const staticRedirect = staticRedirects[url]
  if (staticRedirect) {
    return {
      redirect: staticRedirect,
      destination: staticRedirect.destination,
      matchedRule: staticRedirect.source,
    }
  }

  return null
}

function isExternalUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://')
}

function normalizeUrl(url: string): string {
  // Remove hash fragments for validation
  return url.split('#')[0]
}

async function traceRedirect(inputUrl: string): Promise<TraceResult> {
  const [validUrls, { staticRedirects, dynamicRedirects }] = await Promise.all([loadDirectory(), loadRedirects()])

  const steps: RedirectStep[] = []
  const visitedUrls = new Set<string>()
  let currentUrl = inputUrl
  let stepNumber = 1
  let isLoop = false
  let loopDetectedAt: number | undefined

  // Follow the redirect chain
  while (true) {
    // Check for loops
    if (visitedUrls.has(currentUrl)) {
      isLoop = true
      loopDetectedAt = stepNumber
      break
    }

    visitedUrls.add(currentUrl)

    // Check if this URL has a redirect using the new production-like logic
    const redirectMatch = findRedirect(currentUrl, staticRedirects, dynamicRedirects)

    if (!redirectMatch) {
      // No more redirects, this is the final destination
      break
    }

    // Skip external URLs - we can't follow them
    if (isExternalUrl(redirectMatch.destination)) {
      steps.push({
        step: stepNumber,
        from: currentUrl,
        to: redirectMatch.destination,
        permanent: redirectMatch.redirect.permanent,
        matchedRule: redirectMatch.matchedRule,
      })
      currentUrl = redirectMatch.destination
      break
    }

    // Add this step to our trace
    steps.push({
      step: stepNumber,
      from: currentUrl,
      to: redirectMatch.destination,
      permanent: redirectMatch.redirect.permanent,
      matchedRule: redirectMatch.matchedRule,
    })

    currentUrl = redirectMatch.destination
    stepNumber++

    // Safety check to prevent infinite loops in case our loop detection fails
    if (stepNumber > 50) {
      isLoop = true
      loopDetectedAt = stepNumber
      break
    }
  }

  // Check if final destination exists (only for internal URLs)
  const finalDestination = currentUrl
  const normalizedFinal = normalizeUrl(finalDestination)
  const destinationExists = isExternalUrl(finalDestination) || validUrls.has(normalizedFinal)

  return {
    inputUrl,
    steps,
    finalDestination,
    isLoop,
    loopDetectedAt,
    destinationExists,
    totalHops: steps.length,
  }
}

function formatTraceResult(result: TraceResult): void {
  console.log(`🔍 Tracing redirect for: ${result.inputUrl}`)
  console.log()

  if (result.totalHops === 0) {
    console.log('📍 No redirects found - URL has no redirect rules')
    console.log(`   Final destination: ${result.finalDestination}`)
    console.log(`   Status: ${result.destinationExists ? '✅ Valid page' : '❌ Would result in 404'}`)
    return
  }

  console.log(`🔀 Redirect chain (${result.totalHops} hop${result.totalHops === 1 ? '' : 's'}):`)
  console.log()

  for (const step of result.steps) {
    const permanentLabel = step.permanent ? '(permanent)' : '(temporary)'
    console.log(`   ${step.step}. ${step.from}`)
    console.log(`      → ${step.to} ${permanentLabel}`)
    console.log(`      Rule: ${step.matchedRule}`)
    console.log()
  }

  if (result.isLoop) {
    console.log(`🔄 Redirect loop detected at step ${result.loopDetectedAt}!`)
    console.log(`   The URL ${result.finalDestination} redirects back to a previously visited URL.`)
  } else {
    console.log(`📍 Final destination: ${result.finalDestination}`)

    if (isExternalUrl(result.finalDestination)) {
      console.log(`   Status: 🌐 External URL (cannot validate)`)
    } else {
      console.log(`   Status: ${result.destinationExists ? '✅ Valid page' : '❌ Would result in 404'}`)
    }
  }
}

async function main() {
  const url = process.argv[2]

  if (!url) {
    console.error('❌ Please provide a URL to trace')
    console.error('Usage: npx tsx scripts/trace-redirect.ts "/docs/some-path"')
    process.exitCode = 1
    return
  }

  // Ensure URL starts with /docs if it doesn't already
  const normalizedUrl = url.startsWith('/docs') ? url : `/docs/${url.replace(/^\//, '')}`

  try {
    console.log('🔎 Loading redirects and directory...')
    console.log()

    const result = await traceRedirect(normalizedUrl)
    formatTraceResult(result)

    // Exit with error code if there's a problem
    if (result.isLoop || (!result.destinationExists && !isExternalUrl(result.finalDestination))) {
      process.exitCode = 1
    }
  } catch (error) {
    console.error('💥 Error tracing redirect:', error)
    process.exitCode = 1
  }
}

// Run the script if called directly
main()
