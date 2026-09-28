/**
 * Relocates MDX files (single file or batch using glob patterns).
 *
 * At a high level, the script does the following in the /clerk-docs repo:
 * 1. Moves the mdx file(s) to the new location(s)
 * 2. Updates the manifest.json file to update all links that point to the old location(s)
 * 3. Updates any links in other mdx files that point to the old location(s)
 * 4. Adds the redirect(s) to the redirects/static/docs.json file
 * 5. Updates any existing redirects to point to the new location(s)
 *
 * The format to run the script is:
 * node scripts/move-doc.ts /docs/old-path /docs/new-path
 *
 * @example Single file move:
 * node scripts/move-doc.ts /docs/references/nextjs/overview /docs/references/nextjs/available-methods
 *
 * @example Batch move with glob patterns:
 * node scripts/move-doc.ts "/docs/references/**" "/docs/reference/sdk/**"
 * node scripts/move-doc.ts "/docs/quickstarts/*" "/docs/getting-started/*"
 *
 * A glob move handles each matched file like a single file move, adding one static redirect per file.
 * It never adds dynamic redirects: they shadow static entries under their prefix and keep no record of
 * the pages they serve. SDK-scoped URLs need no entries of their own, because the app strips the SDK
 * segment before the lookup and restores it on the destination.
 *
 * Supported glob patterns:
 * - * matches any characters except /
 * - ** matches any characters including /
 * - ? matches any single character except /
 *
 * Note:
 * - The .mdx extension should be omitted from the paths as the script will add it
 * - When using glob patterns, both source and destination must be glob patterns
 * - Glob patterns should be quoted to prevent shell expansion
 */

import fs from 'fs/promises'
import path from 'path'
import prettier from 'prettier'
import { parse as parseJSONC } from 'jsonc-parser'
import { match } from 'path-to-regexp'
import { VALID_SDKS } from './lib/schemas'

const DOCS_FILE = './redirects/static/docs.json'
const DYNAMIC_DOCS_FILE = './redirects/dynamic/docs.jsonc'
const DOCS_DIR = './docs'

// Type definitions
interface PathWithHash {
  path: string
  hash: string
}

interface StaticRedirect {
  source: string
  destination: string
}

interface MoveResult {
  source: string
  destination: string | null
  status: 'success' | 'failed' | 'would-move'
  error?: string
}

interface MoveDocumentsResult {
  success: boolean
  message: string
  results: MoveResult[]
}

interface MoveDocumentsOptions {
  verbose?: boolean
  dryRun?: boolean
}

interface ManifestItem {
  title: string
  href: string
  [key: string]: any
}

const splitPathAndHash = (url: string): PathWithHash => {
  const [path, hash] = url.split('#')
  return { path, hash: hash ? `#${hash}` : '' }
}

// Escape a string for safe insertion inside a RegExp constructor
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const readJsonFile = async (filePath: string): Promise<any> => {
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(content)
  } catch (error) {
    console.error(`Error reading ${filePath}:`, error)
    throw error
  }
}

const writeJsonFile = async (filePath: string, data: any): Promise<void> => {
  try {
    await fs.writeFile(filePath, await prettier.format(JSON.stringify(data, null, 2), { parser: 'json' }))
  } catch (error) {
    console.error(`Error writing ${filePath}:`, error)
    throw error
  }
}

// Finds all redirects that point to a given path
const findRedirectChain = (redirects: StaticRedirect[], targetPath: string): StaticRedirect[] => {
  const chain: StaticRedirect[] = []
  const seen = new Set<string>()

  const findSources = (path: string): void => {
    redirects.forEach((redirect) => {
      const { path: destPath } = splitPathAndHash(redirect.destination)
      if (destPath === path && !seen.has(redirect.source)) {
        chain.push(redirect)
        seen.add(redirect.source)
        findSources(redirect.source)
      }
    })
  }

  findSources(targetPath)
  return chain
}

// Manifest filenames we treat as data: manifest.json plus per-SDK manifest.<sdk>.json for an
// SDK the build actually knows about. Built from VALID_SDKS rather than a loose `[a-z0-9-]+`
// so any other manifest.<something>.json dropped in docs/ — a JSON Schema document, a backup,
// a scratch file — is left alone instead of being parsed and rewritten as navigation data.
//
// scripts/delete-doc.mjs has the same helper. It is plain Node and cannot import this TS
// module, so it reads the equivalent list from docs/manifest.schema.json's sdk enum instead —
// the schema mirrors VALID_SDKS, so the two stay in sync through it.
const MANIFEST_FILENAME_PATTERN = new RegExp(`^manifest\\.(${VALID_SDKS.join('|')})\\.json$`)
const isManifestFilename = (filename: string): boolean =>
  filename === 'manifest.json' || MANIFEST_FILENAME_PATTERN.test(filename)

// Find all manifest files (manifest.json + manifest.<sdk>.json), excluding manifest.schema.json
const findAllManifestFiles = async (): Promise<string[]> => {
  const entries = await fs.readdir(DOCS_DIR)
  return entries.filter(isManifestFilename).map((entry) => path.join(DOCS_DIR, entry))
}

// Updates manifest links across all manifest files
const updateManifestLinks = async (oldPath: string, newPath: string): Promise<void> => {
  const manifestFiles = await findAllManifestFiles()

  // Update href's in link items
  const updateLinkItem = (item: ManifestItem): ManifestItem => {
    const { path: itemPath } = splitPathAndHash(item.href)
    const { path: oldBasePath } = splitPathAndHash(oldPath)
    if (itemPath === oldBasePath) {
      // Preserve any existing hash in the manifest item if new path doesn't specify one
      const { hash: itemHash } = splitPathAndHash(item.href)
      const { path: newBasePath, hash: newHash } = splitPathAndHash(newPath)
      const finalHash = newHash || itemHash || ''
      return { ...item, href: `${newBasePath}${finalHash}` }
    }
    return item
  }

  const updateSubNavItem = (item: any): any => {
    if (item.items) {
      return { ...item, items: updateNavigation(item.items) }
    }
    return item
  }

  const updateNavItem = (item: any): any => {
    // If it's a nested array, recurse into it
    if (Array.isArray(item)) {
      return updateNavigation(item)
    }
    // If it's a link item (has href)
    if ('href' in item) {
      return updateLinkItem(item)
    }
    // If it's a sub-nav item (has items)
    if ('items' in item) {
      return updateSubNavItem(item)
    }
    return item
  }

  const updateNavigation = (nav: any[]): any[] => {
    return nav.map(updateNavItem)
  }

  for (const manifestFile of manifestFiles) {
    const manifest = await readJsonFile(manifestFile)
    const updatedManifest = {
      ...manifest,
      navigation: updateNavigation(manifest.navigation),
    }
    await writeJsonFile(manifestFile, updatedManifest)
  }
}

const updateMdxLinks = async (oldPaths: string[], newPath: string): Promise<void> => {
  const processFile = async (filePath: string): Promise<void> => {
    const content = await fs.readFile(filePath, 'utf-8')
    let updatedContent = content

    // Update each old path to the new path
    oldPaths.forEach((oldPath) => {
      const { path: oldBasePath } = splitPathAndHash(oldPath)
      const { path: newBasePath, hash: newHash } = splitPathAndHash(newPath)

      // 1. Update markdown links
      const markdownLinkRegex = new RegExp(`\\[([^\\]]+)\\]\\(${oldBasePath}(?:#[^)]*)?\\)`, 'g')
      updatedContent = updatedContent.replace(markdownLinkRegex, (match, linkText) => {
        const existingHash = match.match(/#[^)]*(?=\))/)?.[0] || ''
        const finalHash = newHash || existingHash || ''
        return `[${linkText}](${newBasePath}${finalHash})`
      })

      // 2. Update JSX/TSX component link props
      // This regex looks for link="..." or link='...' patterns, being careful about quotes
      const jsxLinkRegex = new RegExp(`(link=["'])(${oldBasePath}(?:#[^"']*)?)(["'])`, 'g')
      updatedContent = updatedContent.replace(jsxLinkRegex, (_match, prefix, linkPath, suffix) => {
        const { hash: linkHash } = splitPathAndHash(linkPath)
        const finalHash = newHash || linkHash || ''
        return `${prefix}${newBasePath}${finalHash}${suffix}`
      })

      // 3. Update link prop in arrays
      const arrayLinkRegex = new RegExp(`(link:\\s*["'])(${oldBasePath}(?:#[^"']*)?)(["'])`, 'g')
      updatedContent = updatedContent.replace(arrayLinkRegex, (_match, prefix, linkPath, suffix) => {
        const { hash: linkHash } = splitPathAndHash(linkPath)
        const finalHash = newHash || linkHash || ''
        return `${prefix}${newBasePath}${finalHash}${suffix}`
      })

      // 4. Update reference-style link definitions
      // Examples:
      // [components-ref]: /docs/components/overview
      // [components-ref]: </docs/components/overview#hash> "Title"
      // We preserve angle brackets and optional titles, and prefer new hash if provided
      const refDefRegex = new RegExp(
        `(^\\s*\\[[^\\]]+\\]:\\s*)(<?)(${escapeRegExp(oldBasePath)}(?:#[^\\s>\"]*)?)(>?)((?:\\s+.+)?)$`,
        'gm',
      )
      updatedContent = updatedContent.replace(refDefRegex, (match, prefix, open, urlPath, close, trailing) => {
        const { path: defPath, hash: defHash } = splitPathAndHash(urlPath)
        if (defPath !== oldBasePath) return match
        const finalHash = newHash || defHash || ''
        const rebuiltUrl = `${newBasePath}${finalHash}`
        return `${prefix}${open}${rebuiltUrl}${close}${trailing || ''}`
      })
    })

    if (content !== updatedContent) {
      await fs.writeFile(filePath, updatedContent)
      console.log(`Updated links in ${filePath}`)
    }
  }

  // Recursively process all MDX files
  const processDirectory = async (dir: string): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        await processDirectory(fullPath)
      } else if (entry.name.endsWith('.mdx')) {
        await processFile(fullPath)
      }
    }
  }

  await processDirectory(DOCS_DIR)
}

const updateRedirects = async (oldPath: string, newPath: string): Promise<string[]> => {
  const redirects: StaticRedirect[] = await readJsonFile(DOCS_FILE)
  const { path: newPathBase, hash: newHash } = splitPathAndHash(newPath)
  const { path: oldPathBase } = splitPathAndHash(oldPath)

  // Find existing redirect for the source path
  const existingRedirect = redirects.find((r) => {
    const { path: sourcePath } = splitPathAndHash(r.source)
    return sourcePath === oldPathBase
  })

  // Find all redirects that point to our source
  const redirectChain = findRedirectChain(redirects, oldPathBase)

  let updatedRedirects = [...redirects]

  // Update any redirects that point to the old path, preserving their hash fragments
  updatedRedirects = updatedRedirects.map((redirect) => {
    const { path: destPath, hash: destHash } = splitPathAndHash(redirect.destination)

    if (destPath === oldPathBase) {
      // Use the new hash if provided, otherwise keep the existing destination hash
      const finalHash = newHash || destHash || ''
      return {
        ...redirect,
        destination: `${newPathBase}${finalHash}`,
      }
    }
    return redirect
  })

  if (existingRedirect) {
    // If we had an existing redirect, add a new redirect from its old destination
    const { path: existingDestPath, hash: existingDestHash } = splitPathAndHash(existingRedirect.destination)
    if (existingDestPath !== newPathBase) {
      updatedRedirects.push({
        source: existingRedirect.destination,
        destination: `${newPathBase}${newHash || existingDestHash || ''}`,
      })
    }
  } else {
    // Add new redirect from old path to new path (only if they're different)
    if (oldPath !== newPath) {
      updatedRedirects.push({
        source: oldPath,
        destination: newPath,
      })
    } else {
      console.log(`Skipped redundant static redirect: ${oldPath} -> ${newPath}`)
    }
  }

  // Update all redirects in the chain to point to the new destination
  redirectChain.forEach((chainRedirect) => {
    updatedRedirects = updatedRedirects.map((redirect) => {
      const { path: sourcePath } = splitPathAndHash(redirect.source)
      const { path: chainSource } = splitPathAndHash(chainRedirect.source)

      if (sourcePath === chainSource) {
        // Get the hash from the chain redirect's destination
        const { hash: chainDestHash } = splitPathAndHash(chainRedirect.destination)
        // Use new hash if provided, otherwise use chain destination hash
        const finalHash = newHash || chainDestHash || ''
        return {
          ...redirect,
          destination: `${newPathBase}${finalHash}`,
        }
      }
      return redirect
    })
  })

  await writeJsonFile(DOCS_FILE, updatedRedirects)

  // Return all paths that should be updated in MDX files
  const pathsToUpdate = [
    oldPath,
    ...(existingRedirect ? [existingRedirect.destination] : []),
    ...redirectChain.map((r) => r.source),
  ]

  // Remove duplicates and handle paths with different hashes
  return [...new Set(pathsToUpdate.map((p) => splitPathAndHash(p).path))]
}

// Check if a path contains glob patterns
const isGlobPattern = (pattern: string): boolean => {
  return pattern.includes('*') || pattern.includes('?') || pattern.includes('[') || pattern.includes('{')
}

// Convert a glob pattern to a regex for extracting variable parts
const globToRegex = (pattern: string): RegExp => {
  // Escape special regex characters except glob ones
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '§DOUBLESTAR§') // Temporary placeholder
    .replace(/\*/g, '([^/]*)') // Single * becomes capture group
    .replace(/§DOUBLESTAR§/g, '(.*?)') // ** becomes non-greedy capture group
    .replace(/\?/g, '([^/])') // ? becomes single char capture group

  return new RegExp(`^${escaped}$`)
}

// Map a source file to its destination using glob patterns
const mapSourceToDestination = (sourceFile: string, sourcePattern: string, destPattern: string): string => {
  const sourceRegex = globToRegex(sourcePattern)
  const matches = sourceFile.match(sourceRegex)

  if (!matches) {
    throw new Error(`Source file ${sourceFile} doesn't match pattern ${sourcePattern}`)
  }

  // Replace glob patterns in destination with captured groups
  let result = destPattern
  let captureIndex = 1

  // Replace ** patterns first (they capture more)
  result = result.replace(/\*\*/g, () => matches[captureIndex++] || '')
  // Then replace single * patterns
  result = result.replace(/\*/g, () => matches[captureIndex++] || '')
  // Then replace ? patterns
  result = result.replace(/\?/g, () => matches[captureIndex++] || '')

  return result
}

// Find all files matching a glob pattern
// Exclusion predicate for fs.glob. Node calls `exclude` on directories while walking
// (pruning subtrees); Bun calls it on matched file paths — checking every path segment
// covers both runtimes
const isExcludedFromGlob = (entryPath: string): boolean =>
  entryPath.split(/[\\/]/).some((segment) => segment === 'node_modules' || segment === '.git')

const expandGlobPattern = async (pattern: string): Promise<string[]> => {
  // Remove leading slash and add .mdx extension if not present
  const searchPattern = pattern.replace(/^\//, '')
  const globPattern = searchPattern.endsWith('**')
    ? `${searchPattern}/*.mdx`
    : searchPattern.endsWith('.mdx')
      ? searchPattern
      : `${searchPattern}.mdx`

  const files: string[] = []
  for await (const file of fs.glob(globPattern, {
    cwd: process.cwd(),
    exclude: isExcludedFromGlob,
  })) {
    // fs.glob yields platform-native separators; mapping patterns are '/'-delimited
    files.push(file.split(path.sep).join('/'))
  }

  // Return paths with leading slash and .mdx extension removed to match pattern format
  return files.map((file) => {
    // Remove .mdx extension but keep the full path structure
    const withoutExt = file.replace(/\.mdx$/, '')
    // Add leading slash to match pattern format like /docs/ai-prompts/react
    return `/${withoutExt}`
  })
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath, fs.constants.F_OK)
    return true
  } catch (error) {
    return false
  }
}

// Core file move functionality - handles the physical file move and link updates
const moveFile = async (source: string, destination: string): Promise<void> => {
  // If source and destination are the same, just return success without doing anything
  if (source === destination) {
    console.log(`Skipped moving ${source} to itself`)
    return
  }

  // Remove leading slash
  const sourcePath = source.replace(/^\//, '')
  const destPath = destination.replace(/^\//, '')

  if (!(await fileExists(`${sourcePath}.mdx`))) {
    throw new Error(`Source path does not exist: ${sourcePath}.mdx`)
  }

  if ((await fs.stat(`${sourcePath}.mdx`)).isDirectory()) {
    throw new Error(`Source path must be a file: ${sourcePath}.mdx`)
  }

  if (await fileExists(`${destPath}.mdx`)) {
    throw new Error(`Destination path already exists: ${destPath}.mdx`)
  }

  // Create destination directory if it doesn't exist
  await fs.mkdir(path.dirname(destPath), { recursive: true })

  // Move the MDX file
  await fs.rename(`${sourcePath}.mdx`, `${destPath}.mdx`)
  console.log(`Moved ${sourcePath}.mdx to ${destPath}.mdx`)

  // Update manifest links
  await updateManifestLinks(source, destination)

  // Update links in other MDX files
  await updateMdxLinks([source], destination)
}

// Dynamic redirects run before static ones, so a static redirect whose source a dynamic rule matches never
// takes effect. Returns each old path that a dynamic rule would intercept, with the rule that matches it.
const findShadowedSources = async (sourcePaths: string[]): Promise<string[]> => {
  const rules = parseJSONC(await fs.readFile(DYNAMIC_DOCS_FILE, 'utf-8')) as Array<{ source: string }>
  const matchers = rules.map((rule) => ({ source: rule.source, matches: match(rule.source) }))

  return sourcePaths.flatMap((sourcePath) =>
    matchers.filter(({ matches }) => matches(sourcePath)).map(({ source }) => `${sourcePath} (matched by ${source})`),
  )
}

const shadowedSourcesMessage = (shadowed: string[]): string =>
  `A dynamic redirect would intercept the static redirect for these paths, so the move would leave them pointing at the wrong page. Update or remove the dynamic rule in ${DYNAMIC_DOCS_FILE} first:\n${shadowed.map((entry) => `   ${entry}`).join('\n')}`

// Moves one document, records the move as a static redirect, and repoints links to every old path
const moveDocumentWithRedirects = async (source: string, destination: string): Promise<void> => {
  await moveFile(source, destination)
  const pathsToUpdate = await updateRedirects(source, destination)
  await updateMdxLinks(pathsToUpdate, destination)
}

// Export all the main functions for testing
export {
  findShadowedSources,
  moveFile,
  updateRedirects,
  updateManifestLinks,
  updateMdxLinks,
  expandGlobPattern,
  mapSourceToDestination,
  isGlobPattern,
  isExcludedFromGlob,
}

// Main function that can be called from tests or CLI
export async function moveDocuments(
  source: string,
  destination: string,
  options: MoveDocumentsOptions = {},
): Promise<MoveDocumentsResult> {
  const { verbose = true, dryRun = false } = options

  // Check if we're dealing with glob patterns
  const isSourceGlob = isGlobPattern(source)
  const isDestGlob = isGlobPattern(destination)

  if (isSourceGlob || isDestGlob) {
    // Handle glob patterns
    if (isSourceGlob && !isDestGlob) {
      throw new Error('If source is a glob pattern, destination must also be a glob pattern')
    }
    if (!isSourceGlob && isDestGlob) {
      throw new Error('If destination is a glob pattern, source must also be a glob pattern')
    }

    if (verbose) console.log(`🔍 Expanding glob pattern: ${source}`)
    const sourceFiles = await expandGlobPattern(source)

    if (sourceFiles.length === 0) {
      if (verbose) console.log('❌ No files found matching the source pattern')
      return { success: false, message: 'No files found matching the source pattern', results: [] }
    }

    if (verbose) console.log(`📁 Found ${sourceFiles.length} files to move:`)

    const shadowed = await findShadowedSources(sourceFiles)
    if (shadowed.length > 0) {
      const message = shadowedSourcesMessage(shadowed)
      if (verbose) console.error(`❌ ${message}`)
      return { success: false, message, results: [] }
    }

    if (dryRun) {
      if (verbose) console.log('🔍 Dry run - showing what would be moved:')
      const results: MoveResult[] = sourceFiles.map((sourceFile) => {
        const destFile = mapSourceToDestination(sourceFile, source, destination)
        if (verbose) console.log(`   ${sourceFile} → ${destFile}`)
        return { source: sourceFile, destination: destFile, status: 'would-move' }
      })
      return { success: true, message: `Dry run completed. Would move ${results.length} files`, results }
    }

    // Move each file like a single file move, with its own static redirect
    const results: MoveResult[] = []
    for (const sourceFile of sourceFiles) {
      try {
        const destFile = mapSourceToDestination(sourceFile, source, destination)
        if (verbose) console.log(`   ${sourceFile} → ${destFile}`)

        await moveDocumentWithRedirects(sourceFile, destFile)
        results.push({ source: sourceFile, destination: destFile, status: 'success' })
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        if (verbose) console.error(`❌ Failed to move ${sourceFile}: ${errorMessage}`)
        results.push({ source: sourceFile, destination: null, status: 'failed', error: errorMessage })
      }
    }

    // Summary
    const successful = results.filter((r) => r.status === 'success').length
    const failed = results.filter((r) => r.status === 'failed').length

    if (verbose) {
      console.log(`\n📊 Batch move completed: ${successful} successful, ${failed} failed`)

      if (failed > 0) {
        console.log('\n❌ Failed moves:')
        results
          .filter((r) => r.status === 'failed')
          .forEach((r) => {
            console.log(`   ${r.source}: ${r.error}`)
          })
      }
    }

    return {
      success: failed === 0,
      message: `Batch move completed: ${successful} successful, ${failed} failed`,
      results,
    }
  } else {
    // Handle single file move (existing behavior)
    try {
      const shadowed = await findShadowedSources([source])
      if (shadowed.length > 0) {
        throw new Error(shadowedSourcesMessage(shadowed))
      }

      if (dryRun) {
        if (verbose) console.log(`🔍 Dry run - would move: ${source} → ${destination}`)
        return {
          success: true,
          message: `Dry run completed. Would move ${source} to ${destination}`,
          results: [{ source, destination, status: 'would-move' }],
        }
      }

      await moveDocumentWithRedirects(source, destination)
      if (verbose) console.log('Updated redirects in /static/docs.json')

      if (verbose) console.log('Document move completed successfully')
      return {
        success: true,
        message: 'Document move completed successfully',
        results: [{ source, destination, status: 'success' }],
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      if (verbose) console.error(`❌ Failed to move document: ${errorMessage}`)
      return {
        success: false,
        message: errorMessage,
        results: [{ source, destination, status: 'failed', error: errorMessage }],
      }
    }
  }
}

// CLI entry point - only run if called directly
const main = async (): Promise<void> => {
  const [source, destination] = process.argv.slice(2)

  if (!source) {
    throw new Error('Source path is required')
  }

  if (!destination) {
    throw new Error('Destination path is required')
  }

  if (source === destination) {
    throw new Error('Source and destination paths cannot be the same')
  }

  const result = await moveDocuments(source, destination, {
    verbose: !process.argv.includes('--silent'),
    dryRun: process.argv.includes('--dry-run'),
  })

  if (!result.success) {
    process.exit(1)
  }
}

// Only invoke the main function if we run the script directly eg npm run move-doc
if (require.main === module) {
  main().catch((error) => {
    console.error('Error:', error)
    process.exit(1)
  })
}
