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
import { compile, match, MatchFunction, PathFunction } from 'path-to-regexp'
import { VALID_SDKS } from './lib/schemas'

interface Redirect {
  source: string
  destination: string
  permanent: boolean
}

interface DynamicRedirect extends Redirect {
  matchesSource: MatchFunction<Record<string, string>>
  getDestination: PathFunction<Record<string, string>>
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
  urlAfterSDKStripping: string
  sdkStripped: string | null
  steps: RedirectStep[]
  finalDestination: string
  isLoop: boolean
  loopDetectedAt?: number
  destinationExists: boolean
  totalHops: number
}

async function loadDirectory() {
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

async function loadRedirects() {
  try {
    const redirectsPath = path.join(process.cwd(), 'dist', '_redirects')

    // Load static redirects
    const staticPath = path.join(redirectsPath, 'static.json')
    const staticContent = await fs.readFile(staticPath, 'utf-8')
    const staticRedirectsObj = JSON.parse(staticContent) as Record<
      string,
      {
        source: string
        destination: string
        permanent: boolean
      }
    >

    // Load dynamic redirects
    const dynamicPath = path.join(redirectsPath, 'dynamic.jsonc')
    const dynamicContent = await fs.readFile(dynamicPath, 'utf-8')
    const dynamicRedirectsRaw = parseJSONC(dynamicContent) as {
      source: string
      destination: string
      permanent: boolean
    }[]

    // Process dynamic redirects with path-to-regexp v6 syntax
    const dynamicRedirects = dynamicRedirectsRaw.map((redirect) => {
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

function isExternalUrl(url: string) {
  return url.startsWith('http://') || url.startsWith('https://')
}

function stripSDKFromUrl(url: string): { strippedUrl: string; sdkStripped: string | null } {
  // Parse URL segments: /docs/[segment]/[rest]
  const segments = url.split('/')

  // Must start with /docs and have at least one more segment
  if (segments.length < 3 || segments[1] !== 'docs') {
    return { strippedUrl: url, sdkStripped: null }
  }

  const potentialSDK = segments[2]

  // Check if this segment is a known SDK
  if (VALID_SDKS.includes(potentialSDK as any)) {
    // Remove the SDK segment and rejoin
    // segments = ['', 'docs', 'nextjs', 'middleware'] -> ['', 'docs', 'middleware']
    const strippedSegments = [segments[0], segments[1], ...segments.slice(3)]
    return {
      strippedUrl: strippedSegments.join('/'),
      sdkStripped: potentialSDK,
    }
  }

  return { strippedUrl: url, sdkStripped: null }
}

function findRedirect(
  url: string,
  staticRedirects: Record<string, Redirect>,
  dynamicRedirects: DynamicRedirect[],
): { redirect: Redirect; destination: string; matchedRule: string } | null {
  // Check dynamic redirects first (like production)
  for (const dynamicRedirect of dynamicRedirects) {
    const matchResult = dynamicRedirect.matchesSource(url)
    if (matchResult) {
      const destination = dynamicRedirect.getDestination(matchResult.params || {})
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

function normalizeUrl(url: string) {
  // Remove hash fragments for validation
  return url.split('#')[0]
}

async function traceRedirect(inputUrl: string) {
  const [validUrls, { staticRedirects, dynamicRedirects }] = await Promise.all([loadDirectory(), loadRedirects()])

  // Strip SDK from URL before redirect matching (mirrors production behavior)
  const { strippedUrl, sdkStripped } = stripSDKFromUrl(inputUrl)

  const steps: RedirectStep[] = []
  const visitedUrls = new Set<string>()
  let currentUrl = strippedUrl // Start with the stripped URL, not the original
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
  // Decode URL for comparison since directory.json contains unencoded URLs
  const decodedFinal = decodeURIComponent(normalizedFinal)
  const destinationExists =
    isExternalUrl(finalDestination) || validUrls.has(normalizedFinal) || validUrls.has(decodedFinal)

  return {
    inputUrl,
    urlAfterSDKStripping: strippedUrl,
    sdkStripped,
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

  // Show SDK stripping if it occurred
  if (result.sdkStripped) {
    console.log(`   SDK detected and stripped: "${result.sdkStripped}"`)
    console.log(`   URL after SDK stripping: ${result.urlAfterSDKStripping}`)
  }

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
