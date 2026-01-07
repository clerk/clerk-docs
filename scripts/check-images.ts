#!/usr/bin/env bun

/**
 * Check Images Script
 *
 * This script scans all markdown files in the docs folder and validates that
 * all referenced images exist in the public/images directory.
 *
 * What it does:
 * - Recursively finds all .mdx files in the docs/ folder using readdirp
 * - Extracts image references using remark AST:
 *   - Markdown syntax: ![alt](/docs/images/path.svg)
 *   - JSX img tags: <img src="/docs/images/path.png">
 * - Resolves paths from /docs/images/... to public/images/...
 * - Checks if the image files exist
 * - Reports missing images with their source file location using vfile-reporter
 *
 * Usage:
 *   bun scripts/check-images.ts
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import readdirp from 'readdirp'
import { remark } from 'remark'
import remarkFrontmatter from 'remark-frontmatter'
import remarkMdx from 'remark-mdx'
import { Node, Position } from 'unist'
import { visit } from 'unist-util-visit'
import { VFile } from 'vfile'
import reporter from 'vfile-reporter'

interface ImageReference {
  file: string
  imagePath: string
  resolvedPath: string
  type: 'markdown' | 'jsx-img'
  position?: Position
}

/**
 * Extract src attribute from JSX img element
 */
function extractSrcFromJsxImg(node: Node): string | undefined {
  if (node.type !== 'mdxJsxFlowElement' && node.type !== 'mdxJsxTextElement') {
    return undefined
  }

  if (!('name' in node) || node.name !== 'img') {
    return undefined
  }

  if (!('attributes' in node) || !Array.isArray(node.attributes)) {
    return undefined
  }

  const srcAttribute = node.attributes.find((attr: any) => attr.type === 'mdxJsxAttribute' && attr.name === 'src')

  if (!srcAttribute || !('value' in srcAttribute)) {
    return undefined
  }

  // Handle string values
  if (typeof srcAttribute.value === 'string') {
    return srcAttribute.value
  }

  // Handle JSX expression values (like {imageSrc})
  if (typeof srcAttribute.value === 'object' && srcAttribute.value !== null && 'value' in srcAttribute.value) {
    return typeof srcAttribute.value.value === 'string' ? srcAttribute.value.value : undefined
  }

  return undefined
}

/**
 * Extract image references from markdown AST
 */
function extractImageReferences(filePath: string, tree: Node): ImageReference[] {
  const references: ImageReference[] = []

  visit(tree, (node) => {
    // Handle markdown image syntax: ![alt](url)
    if (node.type === 'image') {
      if ('url' in node && typeof node.url === 'string') {
        const imagePath = node.url
        // Remove any trailing MDX attributes like {{ style }}
        const cleanPath = imagePath.split('{{')[0].trim()

        if (cleanPath.startsWith('/docs/images/')) {
          const resolvedPath = path.join(process.cwd(), 'public', cleanPath.replace('/docs/images/', 'images/'))

          references.push({
            file: filePath,
            imagePath: cleanPath,
            resolvedPath,
            type: 'markdown',
            position: node.position,
          })
        }
      }
      return
    }

    // Handle JSX img tags: <img src="..." />
    const src = extractSrcFromJsxImg(node)
    if (src && src.startsWith('/docs/images/')) {
      const resolvedPath = path.join(process.cwd(), 'public', src.replace('/docs/images/', 'images/'))

      references.push({
        file: filePath,
        imagePath: src,
        resolvedPath,
        type: 'jsx-img',
        position: node.position,
      })
    }
  })

  return references
}

/**
 * Check if a file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

/**
 * Main function to check all images
 */
async function checkImages(): Promise<{ totalFiles: number; totalReferences: number; vfiles: VFile[] }> {
  console.log('🔎 Scanning markdown files for image references...')

  // Find all .mdx files in docs folder using readdirp
  const files = await readdirp.promise('docs', {
    type: 'files',
    fileFilter: (entry) => entry.path.endsWith('.mdx'),
  })

  console.log(`📁 Found ${files.length} markdown files`)
  console.log()

  const vfiles: VFile[] = []
  let totalReferences = 0

  // Process each file
  for (const fileEntry of files) {
    const filePath = path.join(process.cwd(), 'docs', fileEntry.path)
    const relativeFilePath = `docs/${fileEntry.path}`
    const content = await fs.readFile(filePath, 'utf-8')

    const vfile = new VFile({
      path: relativeFilePath,
      value: content,
    })

    try {
      // Parse the markdown file
      const tree = await remark().use(remarkFrontmatter).use(remarkMdx).parse(vfile)

      // Extract image references from AST
      const references = extractImageReferences(relativeFilePath, tree)
      totalReferences += references.length

      // Check which images exist and add messages to vfile
      for (const ref of references) {
        const exists = await fileExists(ref.resolvedPath)
        if (!exists) {
          const relativeResolvedPath = path.relative(process.cwd(), ref.resolvedPath)
          vfile.message(`Image not found: ${ref.imagePath}\nExpected at: ${relativeResolvedPath}`, ref.position)
        }
      }

      // Only add vfile if it has messages (errors or warnings)
      if (vfile.messages.length > 0) {
        vfiles.push(vfile)
      }
    } catch (error) {
      vfile.message(`Failed to parse markdown file: ${error instanceof Error ? error.message : String(error)}`)
      vfiles.push(vfile)
    }
  }

  return {
    totalFiles: files.length,
    totalReferences,
    vfiles,
  }
}

/**
 * Main entry point
 */
async function main() {
  try {
    const result = await checkImages()

    // Report results
    console.log('📊 Results:')
    console.log(`   📄 Files scanned: ${result.totalFiles}`)
    console.log(`   🖼️  Image references found: ${result.totalReferences}`)
    console.log(`   ❌ Files with missing images: ${result.vfiles.length}`)
    console.log()

    if (result.vfiles.length > 0) {
      // Use vfile-reporter to format the output
      const report = reporter(result.vfiles, {
        quiet: false,
      })

      console.log(report)
      process.exitCode = 1
    } else {
      console.log('✅ All image references point to existing files!')
    }
  } catch (error) {
    console.error('💥 Error checking images:', error)
    process.exitCode = 1
  }
}

// Run the script if called directly
main()
