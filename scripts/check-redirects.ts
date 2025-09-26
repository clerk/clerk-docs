#!/usr/bin/env tsx

/**
 * Check Redirects Script
 *
 * This script validates that all redirect destinations in the dist/_redirects directory
 * point to pages that actually exist in the built documentation.
 *
 * What it does:
 * - Loads the directory.json file from dist/ to get all valid page URLs
 * - Loads both static.json and dynamic.jsonc redirect files from dist/_redirects/
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

interface Redirect {
  source: string
  destination: string
  permanent: boolean
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

async function loadRedirects(): Promise<Redirect[]> {
  try {
    const redirectsPath = path.join(process.cwd(), 'dist', '_redirects')

    // Load static redirects
    const staticPath = path.join(redirectsPath, 'static.json')
    const staticContent = await fs.readFile(staticPath, 'utf-8')
    const staticRedirectsObj = JSON.parse(staticContent) as Record<string, Redirect>
    const staticRedirects = Object.values(staticRedirectsObj)

    // Load dynamic redirects
    const dynamicPath = path.join(redirectsPath, 'dynamic.jsonc')
    const dynamicContent = await fs.readFile(dynamicPath, 'utf-8')
    const dynamicRedirects = parseJSONC(dynamicContent) as Redirect[]

    return [...staticRedirects, ...dynamicRedirects]
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

  const [validUrls, redirects] = await Promise.all([loadDirectory(), loadRedirects()])

  console.log(`📁 Found ${validUrls.size} valid pages`)
  console.log(`🔀 Found ${redirects.length} redirects to check`)
  console.log()

  const results: RedirectCheckResult[] = []
  let invalidCount = 0
  let externalCount = 0
  let dynamicCount = 0
  let hashFragmentCount = 0

  for (const redirect of redirects) {
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

    // Handle dynamic routes
    if (destination.includes(':')) {
      dynamicCount++
      // For dynamic routes, we can't validate the exact destination
      // but we can check if the base pattern makes sense
      const normalized = normalizeUrl(destination)
      const exists = validUrls.has(normalized)

      results.push({
        redirect,
        exists,
        error: exists ? undefined : `Dynamic route pattern may be invalid: ${destination}`,
      })

      if (!exists) {
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
  console.log(`   ✅ Valid redirects: ${redirects.length - invalidCount - externalCount}`)
  console.log(`   🌐 External redirects (skipped): ${externalCount}`)
  console.log(`   🔗 Hash fragment URLs: ${hashFragmentCount}`)
  console.log(`   🔀 Dynamic redirects: ${dynamicCount}`)
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
