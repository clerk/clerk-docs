#!/usr/bin/env bun

/**
 * Extract Directory
 *
 * This script generates a flat list of all documentation pages from the docs folder
 * (excluding _partials and _tooltips) for navigation and search indexing.
 *
 * Usage:
 *   npm run extract-directory
 *
 * Output: dist/directory.json
 *
 * Structure:
 * - Array of objects with path and url properties
 * - Paths are relative to docs folder
 * - URLs are the public-facing URLs (with /docs prefix)
 */

import { readdirSync, statSync, readFileSync, writeFileSync } from 'fs'
import { join, dirname, basename, relative } from 'path'
import { fileURLToPath } from 'url'

// Get the directory of this script file (works in both Bun and Node.js)
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const projectRoot = join(__dirname, '..')

interface DirectoryEntry {
  path: string
  url: string
}

type Directory = DirectoryEntry[]

/**
 * Recursively finds all .mdx files in a directory, excluding partials and tooltips
 */
function findMdxFiles(dir: string, fileList: string[] = []): string[] {
  const files = readdirSync(dir)

  for (const file of files) {
    const filePath = join(dir, file)
    const stat = statSync(filePath)

    if (stat.isDirectory()) {
      // Skip _partials, _tooltips, _llms, _prompts, _redirects directories
      if (file.startsWith('_')) {
        continue
      }
      findMdxFiles(filePath, fileList)
    } else if (file.endsWith('.mdx')) {
      fileList.push(filePath)
    }
  }

  return fileList
}

/**
 * Converts a file path to a URL
 * e.g., "docs/guides/users/reading.mdx" -> "/docs/guides/users/reading"
 * e.g., "docs/index.mdx" -> "/docs/"
 */
function filePathToUrl(filePath: string, docsDir: string): string {
  // Get the path relative to the docs directory
  const relativePath = relative(docsDir, filePath)

  // Remove .mdx extension
  let url = relativePath.replace(/\.mdx$/, '')

  // Remove /index from the end
  url = url.replace(/\/index$/, '')

  // Add /docs prefix
  if (url === 'index' || url === '') {
    return '/docs/'
  }

  return `/docs/${url}`
}

/**
 * Main function to process all docs and generate the directory
 */
function extractDirectory(): Directory {
  const docsDir = join(projectRoot, 'docs')
  const mdxFiles = findMdxFiles(docsDir)

  console.log(`Found ${mdxFiles.length} MDX files in docs folder`)

  const directory: Directory = mdxFiles.map((filePath) => {
    const relativePath = relative(docsDir, filePath)
    const url = filePathToUrl(filePath, docsDir)

    return {
      path: relativePath,
      url,
    }
  })

  // Sort by URL for consistent output
  directory.sort((a, b) => a.url.localeCompare(b.url))

  return directory
}

/**
 * Runs the extraction and returns the directory
 */
export function run(): Directory {
  return extractDirectory()
}

/**
 * Runs the extraction and writes the output file
 */
function runAndWrite() {
  const startTime = Date.now()
  const directory = run()
  const outputPath = join(projectRoot, 'dist', 'directory.json')
  writeFileSync(outputPath, JSON.stringify(directory))
  const duration = Date.now() - startTime
  console.log(`\n✓ Generated ${outputPath} in ${duration}ms`)
  console.log(`  Total entries: ${directory.length}`)
}

// Only run when executed directly, not when imported
if (import.meta.main) {
  runAndWrite()
}
