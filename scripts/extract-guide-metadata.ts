#!/usr/bin/env bun

/**
 * Extract Guide Metadata
 *
 * This script extracts frontmatter metadata from all documentation pages in the /docs folder
 * (excluding _partials and _tooltips) and generates a JSON file mapping guide hrefs to their
 * documents and SDK support.
 *
 * Usage:
 *   npm run extract-guide-metadata
 *
 * Output: dist/guide-metadata.json
 *
 * Structure:
 * - Groups documents by guide href (e.g., /docs/guides/users/reading)
 * - Handles SDK-specific variants (e.g., reading.expo.mdx, reading.react.mdx)
 * - Tracks SDK support from both frontmatter and filename variants
 * - Generic guides (no SDK specified) support all SDKs
 */

import { readdirSync, statSync, readFileSync, writeFileSync } from 'fs'
import { join, dirname, basename } from 'path'
import { fileURLToPath } from 'url'
import matter from 'gray-matter'

// Get the directory of this script file (works in both Bun and Node.js)
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const projectRoot = join(__dirname, '..')

interface Frontmatter {
  sdk?: string
}

interface Document {
  sourceFile: string
  sdks: string[]
}

interface Guide {
  documents: Document[]
  sdks: string[]
}

interface GuideMetadata {
  [href: string]: Guide
}

/**
 * Recursively finds all .mdx files in a directory, excluding partials and tooltips
 */
function findMdxFiles(dir: string, fileList: string[] = []): string[] {
  const files = readdirSync(dir)

  for (const file of files) {
    const filePath = join(dir, file)
    const stat = statSync(filePath)

    if (stat.isDirectory()) {
      // Skip _partials and _tooltips directories
      if (file === '_partials' || file === '_tooltips') {
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
 * Extracts the base name and SDK variant from a filename
 * e.g., "reading.expo.mdx" -> { baseName: "reading", sdkVariant: "expo" }
 * e.g., "reading.mdx" -> { baseName: "reading", sdkVariant: null }
 */
function parseFilename(filename: string): {
  baseName: string
  sdkVariant: string | null
} {
  const parts = filename.replace('.mdx', '').split('.')

  if (parts.length > 1) {
    // Has a variant suffix like .expo or .react
    const sdk = parts[parts.length - 1]
    const baseName = parts.slice(0, -1).join('.')
    return { baseName, sdkVariant: sdk }
  }

  return { baseName: parts[0], sdkVariant: null }
}

/**
 * Converts a file path to an href
 * e.g., "/Users/nick/dev/clerk-docs/docs/guides/users/reading.mdx" -> "/docs/guides/users/reading"
 */
function filePathToHref(filePath: string, docsDir: string): string {
  // Get the path relative to the docs directory
  const relativePath = filePath.replace(docsDir + '/', '')
  const parsed = parseFilename(basename(relativePath))
  const dir = dirname(relativePath)

  // Build the href
  let href: string
  if (dir === '.') {
    // File is in the root of docs
    href = join('/docs', parsed.baseName)
  } else {
    href = join('/docs', dir, parsed.baseName)
  }

  return href.replace(/\\/g, '/') // Normalize for Windows
}

/**
 * Main function to process all docs and generate the JSON output
 */
function extractGuideMetadata(): GuideMetadata {
  const docsDir = join(projectRoot, 'docs')
  const mdxFiles = findMdxFiles(docsDir)

  console.log(`Found ${mdxFiles.length} MDX files (excluding partials and tooltips)`)

  // Group files by their href (base guide)
  const guideMap: {
    [href: string]: {
      href: string
      documents: Array<{
        sourceFile: string
        sdkVariant: string | null
        sdkFromFrontmatter: string | null
        frontmatter: Frontmatter
      }>
      sdks: Set<string>
    }
  } = {}

  for (const filePath of mdxFiles) {
    try {
      const content = readFileSync(filePath, 'utf-8')
      const { data: frontmatter } = matter(content) as { data: Frontmatter }

      const href = filePathToHref(filePath, docsDir)
      const filename = basename(filePath)
      const { sdkVariant } = parseFilename(filename)

      // Get SDK from frontmatter or variant suffix
      const sdkFromFrontmatter = frontmatter.sdk || null

      // Initialize guide if it doesn't exist
      if (!guideMap[href]) {
        guideMap[href] = {
          href,
          documents: [],
          sdks: new Set<string>(),
        }
      }

      // Add document to the guide
      const doc = {
        sourceFile: filePath.replace(projectRoot + '/', ''),
        sdkVariant: sdkVariant,
        sdkFromFrontmatter: sdkFromFrontmatter,
        frontmatter: frontmatter,
      }

      guideMap[href].documents.push(doc)

      // Track SDKs for this guide
      if (sdkFromFrontmatter) {
        guideMap[href].sdks.add(sdkFromFrontmatter)
      }
    } catch (error) {
      console.error(`Error processing ${filePath}:`, (error as Error).message)
    }
  }

  // Convert Sets to Arrays and format the final output
  const output: GuideMetadata = {}

  for (const [href, guide] of Object.entries(guideMap)) {
    output[href] = {
      documents: guide.documents.map((doc) => ({
        sourceFile: doc.sourceFile,
        sdks: doc.sdkFromFrontmatter ? [doc.sdkFromFrontmatter] : [],
      })),
      sdks: Array.from(guide.sdks),
    }
  }

  return output
}

/**
 * Runs the extraction and returns the metadata
 */
export function run(): GuideMetadata {
  return extractGuideMetadata()
}

/**
 * Runs the extraction and writes the output file
 */
function runAndWrite() {
  const startTime = Date.now()
  const metadata = run()
  const outputPath = join(projectRoot, 'dist', 'guide-metadata.json')
  writeFileSync(outputPath, JSON.stringify(metadata, null, 2))
  const duration = Date.now() - startTime
  console.log(`\n✓ Generated ${outputPath} in ${duration}ms`)
  console.log(`  Total guides: ${Object.keys(metadata).length}`)
}

// Only run when executed directly, not when imported
if (import.meta.main) {
  runAndWrite()
}
