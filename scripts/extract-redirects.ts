#!/usr/bin/env bun

/**
 * Extract Redirects
 *
 * This script processes redirect files, optimizes them (resolves redirect chains),
 * and outputs them to the dist folder for use in routing.
 *
 * Usage:
 *   npm run extract-redirects
 *
 * Output: dist/_redirects/static.json and dist/_redirects/dynamic.jsonc
 *
 * Processing:
 * - Reads static redirects from redirects/static/docs.json
 * - Reads dynamic redirects from redirects/dynamic/docs.jsonc
 * - Optimizes static redirects (resolves redirect chains to final destinations)
 * - Transforms static redirects to object format (keyed by source)
 * - Writes optimized redirects to dist folder
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { parse as parseJSONC } from 'jsonc-parser'

// Get the directory of this script file (works in both Bun and Node.js)
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const projectRoot = join(__dirname, '..')

export interface Redirect {
  source: string
  destination: string
  permanent: boolean
}

interface RedirectsOutput {
  static: Record<string, Redirect>
  dynamic: Redirect[]
}

/**
 * Analyzes and fixes redirect chains by pointing all redirects to their final destination
 */
function analyzeAndFixRedirects(redirects: Redirect[]): Redirect[] {
  const redirectMap = new Map(redirects.map((r) => [r.source, r.destination]))
  const finalDestinations = new Map<string, string>()

  // Find final destinations for each redirect
  for (const { source, destination } of redirects) {
    let current = destination
    const visited = new Set([source])

    while (redirectMap.has(current) && !visited.has(current)) {
      visited.add(current)
      current = redirectMap.get(current)!
    }

    finalDestinations.set(source, current)
  }

  // Create new redirects pointing to final destinations
  return redirects.map(({ source, permanent }) => ({
    source,
    destination: finalDestinations.get(source)!,
    permanent,
  }))
}

/**
 * Transforms an array of redirects into an object keyed by source
 */
function transformRedirectsToObject(redirects: Redirect[]): Record<string, Redirect> {
  return Object.fromEntries(redirects.map((item) => [item.source, item]))
}

/**
 * Main function to process redirects
 */
function extractRedirects(): RedirectsOutput {
  const staticInputPath = join(projectRoot, 'redirects', 'static', 'docs.json')
  const dynamicInputPath = join(projectRoot, 'redirects', 'dynamic', 'docs.jsonc')

  // Read redirect files
  const staticContent = readFileSync(staticInputPath, 'utf-8')
  const dynamicContent = readFileSync(dynamicInputPath, 'utf-8')

  const staticRedirects = JSON.parse(staticContent) as Redirect[]
  const dynamicRedirects = parseJSONC(dynamicContent) as Redirect[]

  console.log(`Read ${staticRedirects.length} static redirects`)
  console.log(`Read ${dynamicRedirects.length} dynamic redirects`)

  // Optimize static redirects (resolve redirect chains)
  const optimizedStaticRedirects = analyzeAndFixRedirects(staticRedirects)

  // Transform static redirects to object format
  const transformedStaticRedirects = transformRedirectsToObject(optimizedStaticRedirects)

  return {
    static: transformedStaticRedirects,
    dynamic: dynamicRedirects,
  }
}

/**
 * Runs the extraction and returns the redirects
 */
export function run(): RedirectsOutput {
  return extractRedirects()
}

/**
 * Runs the extraction and writes the output files
 */
function runAndWrite() {
  const startTime = Date.now()
  const redirects = run()

  const staticOutputPath = join(projectRoot, 'dist', '_redirects', 'static.json')
  const dynamicOutputPath = join(projectRoot, 'dist', '_redirects', 'dynamic.jsonc')

  // Ensure output directory exists
  mkdirSync(dirname(staticOutputPath), { recursive: true })

  // Write output files
  writeFileSync(staticOutputPath, JSON.stringify(redirects.static))
  writeFileSync(dynamicOutputPath, JSON.stringify(redirects.dynamic))

  const duration = Date.now() - startTime
  console.log(`\n✓ Generated redirect files in ${duration}ms`)
  console.log(`  ${staticOutputPath}`)
  console.log(`  ${dynamicOutputPath}`)
  console.log(`  Static redirects: ${Object.keys(redirects.static).length}`)
  console.log(`  Dynamic redirects: ${redirects.dynamic.length}`)
}

// Only run when executed directly, not when imported
if (import.meta.main) {
  runAndWrite()
}
