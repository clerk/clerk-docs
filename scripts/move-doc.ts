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
 * @example SDK-scoped batch moves:
 * When moving files that have SDK frontmatter, both basic and SDK-scoped redirects are created
 *
 * Note: When using glob patterns, the script will:
 * 1. Always add a basic dynamic redirect (e.g., /docs/references/:path* -> /docs/reference/:path*)
 * 2. If any files have SDK frontmatter, also add SDK-scoped redirect (/docs/:sdk/references/:path* -> /docs/:sdk/reference/:path*)
 * 3. Update any existing static redirects that would conflict with the dynamic redirects
 * 4. Move the individual files and update their specific redirects/links
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
import { glob } from 'glob'
import { parse as parseJSONC } from 'jsonc-parser'

const DOCS_FILE = './redirects/static/docs.json'
const DYNAMIC_DOCS_FILE = './redirects/dynamic/docs.jsonc'
const MANIFEST_FILE = './docs/manifest.json'
const DOCS_DIR = './docs'

// Type definitions
interface PathWithHash {
  path: string
  hash: string
}

interface Redirect {
  source: string
  destination: string
  permanent: boolean
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

interface ManifestGroup {
  title?: string
  items: (ManifestItem | ManifestItem[])[]
  [key: string]: any
}

type Manifest = ManifestGroup[]

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

const readJsoncFile = async (filePath: string): Promise<any> => {
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    return parseJSONC(content)
  } catch (error) {
    console.error(`Error reading ${filePath}:`, error)
    throw error
  }
}

const writeJsoncFile = async (filePath: string, data: any): Promise<void> => {
  try {
    const formatted = JSON.stringify(data, null, 2)
    await fs.writeFile(filePath, formatted)
  } catch (error) {
    console.error(`Error writing ${filePath}:`, error)
    throw error
  }
}

// Check if any files have SDK frontmatter
const hasSDKFrontmatter = async (filePaths: string[]): Promise<boolean> => {
  for (const filePath of filePaths) {
    try {
      // Convert path to file system path
      const fsPath = `${filePath.replace(/^\//, '')}.mdx`
      const content = await fs.readFile(fsPath, 'utf-8')

      // Extract frontmatter
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/)
      if (frontmatterMatch) {
        const frontmatter = frontmatterMatch[1]
        // Check for SDK line in frontmatter
        if (/^sdk:\s*.+$/m.test(frontmatter)) {
          return true
        }
      }
    } catch (error) {
      // File doesn't exist or can't be read, skip
      continue
    }
  }
  return false
}

// Finds all redirects that point to a given path
const findRedirectChain = (redirects: Redirect[], targetPath: string): Redirect[] => {
  const chain: Redirect[] = []
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

// Updates manifest.json links
const updateManifestLinks = async (oldPath: string, newPath: string): Promise<void> => {
  const manifest: { navigation: Manifest } = await readJsonFile(MANIFEST_FILE)

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

  const updateNavGroup = (group: any[]): any[] => {
    return group.map(updateNavItem)
  }

  const updateNavigation = (nav: any[]): any[] => {
    return nav.map(updateNavGroup)
  }

  const updatedManifest = {
    ...manifest,
    navigation: updateNavigation(manifest.navigation),
  }

  await writeJsonFile(MANIFEST_FILE, updatedManifest)
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
      updatedContent = updatedContent.replace(jsxLinkRegex, (match, prefix, linkPath, suffix) => {
        const { hash: linkHash } = splitPathAndHash(linkPath)
        const finalHash = newHash || linkHash || ''
        return `${prefix}${newBasePath}${finalHash}${suffix}`
      })

      // 3. Update link prop in arrays
      const arrayLinkRegex = new RegExp(`(link:\\s*["'])(${oldBasePath}(?:#[^"']*)?)(["'])`, 'g')
      updatedContent = updatedContent.replace(arrayLinkRegex, (match, prefix, linkPath, suffix) => {
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
  const redirects: Redirect[] = await readJsonFile(DOCS_FILE)
  const { path: newPathBase, hash: newHash } = splitPathAndHash(newPath)
  const { path: oldPathBase } = splitPathAndHash(oldPath)

  // Find redirects that need updating - those with destinations matching oldPathBase
  const redirectsToUpdate = redirects.filter((redirect) => {
    const { path: destPath } = splitPathAndHash(redirect.destination)
    return destPath === oldPathBase
  })

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
        permanent: true,
      })
    }
  } else {
    // Add new redirect from old path to new path (only if they're different)
    if (oldPath !== newPath) {
      updatedRedirects.push({
        source: oldPath,
        destination: newPath,
        permanent: true,
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

// Convert a glob pattern to a basic dynamic redirect pattern
const globToDynamicPattern = (globPattern: string): string => {
  // Convert glob patterns to Next.js dynamic route patterns
  // Examples:
  // /docs/references/** -> /docs/references/:path*
  // /docs/quickstarts/* -> /docs/quickstarts/:path*

  // Use a more systematic approach to avoid double replacements
  let result = globPattern

  // Replace all glob patterns with a temporary placeholder first
  result = result.replace(/\*\*/g, '__DOUBLE_STAR__')
  result = result.replace(/\*/g, '__SINGLE_STAR__')

  // Then replace placeholders with the correct Next.js patterns
  result = result.replace(/__DOUBLE_STAR__/g, ':path*')
  result = result.replace(/__SINGLE_STAR__/g, ':path*')

  return result
}

// Convert a glob pattern to an SDK-scoped dynamic redirect pattern
const globToSDKScopedPattern = (globPattern: string): string => {
  // Convert glob patterns to SDK-scoped Next.js dynamic route patterns
  // Examples:
  // /docs/references/** -> /docs/:sdk/references/:path*
  // /docs/quickstarts/* -> /docs/:sdk/quickstarts/:path*

  // First convert basic glob patterns
  let result = globToDynamicPattern(globPattern)

  // Then inject :sdk after /docs/
  if (result.startsWith('/docs/')) {
    result = result.replace('/docs/', '/docs/:sdk/')
  }

  return result
}

// Add or update dynamic redirects (both basic and SDK-scoped if needed)
const updateDynamicRedirects = async (
  sourcePattern: string,
  destPattern: string,
  sourceFiles: string[],
): Promise<string[]> => {
  const dynamicRedirects: Redirect[] = await readJsoncFile(DYNAMIC_DOCS_FILE)
  const addedPatterns: string[] = []

  // Always add the basic dynamic redirect
  const sourceDynamicPattern = globToDynamicPattern(sourcePattern)
  const destDynamicPattern = globToDynamicPattern(destPattern)

  // Skip if source and destination are the same (would create redundant redirect)
  if (sourceDynamicPattern !== destDynamicPattern) {
    const basicRedirect: Redirect = {
      source: sourceDynamicPattern,
      destination: destDynamicPattern,
      permanent: true,
    }

    // Check if basic redirect already exists
    const basicExistingIndex = dynamicRedirects.findIndex((redirect) => redirect.source === sourceDynamicPattern)

    if (basicExistingIndex >= 0) {
      dynamicRedirects[basicExistingIndex] = basicRedirect
      console.log(`Updated dynamic redirect: ${sourceDynamicPattern} -> ${destDynamicPattern}`)
    } else {
      dynamicRedirects.push(basicRedirect)
      console.log(`Added dynamic redirect: ${sourceDynamicPattern} -> ${destDynamicPattern}`)
    }
    addedPatterns.push(sourceDynamicPattern)
  } else {
    console.log(`Skipped redundant basic redirect: ${sourceDynamicPattern} -> ${destDynamicPattern}`)
  }

  // Check if any files have SDK frontmatter
  const hasSDK = await hasSDKFrontmatter(sourceFiles)

  if (hasSDK) {
    // Also add SDK-scoped redirect
    const sourceSDKPattern = globToSDKScopedPattern(sourcePattern)
    const destSDKPattern = globToSDKScopedPattern(destPattern)

    // Skip if source and destination are the same (would create redundant redirect)
    if (sourceSDKPattern !== destSDKPattern) {
      const sdkRedirect: Redirect = {
        source: sourceSDKPattern,
        destination: destSDKPattern,
        permanent: true,
      }

      // Check if SDK redirect already exists
      const sdkExistingIndex = dynamicRedirects.findIndex((redirect) => redirect.source === sourceSDKPattern)

      if (sdkExistingIndex >= 0) {
        dynamicRedirects[sdkExistingIndex] = sdkRedirect
        console.log(`Updated SDK-scoped dynamic redirect: ${sourceSDKPattern} -> ${destSDKPattern}`)
      } else {
        dynamicRedirects.push(sdkRedirect)
        console.log(`Added SDK-scoped dynamic redirect: ${sourceSDKPattern} -> ${destSDKPattern}`)
      }
      addedPatterns.push(sourceSDKPattern)
    } else {
      console.log(`Skipped redundant SDK-scoped redirect: ${sourceSDKPattern} -> ${destSDKPattern}`)
    }
  }

  await writeJsoncFile(DYNAMIC_DOCS_FILE, dynamicRedirects)

  return addedPatterns
}

// Update static redirects to account for new dynamic redirects
const updateStaticRedirectsForDynamic = async (
  sourceDynamicPatterns: string[],
  destPattern: string,
  sourcePattern: string,
): Promise<void> => {
  const staticRedirects: Redirect[] = await readJsonFile(DOCS_FILE)

  // Find static redirects that would be affected by the new dynamic redirects
  // We need to update any static redirects that have sources or destinations that would be handled by the dynamic redirects
  const updatedRedirects = staticRedirects.map((redirect) => {
    const { path: destPath, hash: destHash } = splitPathAndHash(redirect.destination)
    const { path: sourcePath, hash: sourceHash } = splitPathAndHash(redirect.source)

    // Check each dynamic pattern to see if it would match this static redirect
    for (const sourceDynamicPattern of sourceDynamicPatterns) {
      // Convert dynamic pattern to regex for matching, handling both :sdk and :path* parameters
      const dynamicRegex = sourceDynamicPattern
        .replace(/:sdk/g, '([^/]+)') // :sdk captures one path segment
        .replace(/:path\*/g, '(.*)') // :path* captures everything
        .replace(/\//g, '\\/')

      const regex = new RegExp(`^${dynamicRegex}$`)

      // Check if the static redirect's source would be caught by our dynamic redirect
      const sourceMatch = sourcePath.match(regex)
      if (sourceMatch) {
        // The source of this static redirect would be caught by our dynamic redirect
        // Update the source to point to where the dynamic redirect would send it
        const newSource = mapSourceToDestination(sourcePath, sourcePattern, destPattern) + (sourceHash || '')

        // Also check if the destination needs to be updated (if it's also being moved)
        let newDestination = redirect.destination
        const destMatch = destPath.match(regex)
        if (destMatch) {
          newDestination = mapSourceToDestination(destPath, sourcePattern, destPattern) + (destHash || '')
          console.log(
            `Updated static redirect source and destination due to dynamic redirect: ${redirect.source} -> ${newSource}, ${redirect.destination} -> ${newDestination}`,
          )
        } else {
          console.log(`Updated static redirect source due to dynamic redirect: ${redirect.source} -> ${newSource}`)
        }

        return {
          ...redirect,
          source: newSource,
          destination: newDestination,
        }
      }

      // Check if the static redirect's destination would be caught by our dynamic redirect
      const destMatch = destPath.match(regex)
      if (destMatch) {
        // This static redirect's destination would be caught by our dynamic redirect
        // Update it to point to the new destination using the same mapping logic as file moves
        const newDestination = mapSourceToDestination(destPath, sourcePattern, destPattern) + (destHash || '')

        console.log(`Updated static redirect destination: ${redirect.destination} -> ${newDestination}`)
        return {
          ...redirect,
          destination: newDestination,
        }
      }
    }

    // Also check if this static redirect's destination points to a path that will be moved by our dynamic redirect
    // If so, update the destination to point to the new location
    const sourceDynamicRegex = globToDynamicPattern(sourcePattern)
      .replace(/:sdk/g, '([^/]+)') // :sdk captures one path segment
      .replace(/:path\*/g, '(.*)') // :path* captures everything
      .replace(/\//g, '\\/')

    const sourceRegex = new RegExp(`^${sourceDynamicRegex}$`)
    const sourceMatch = destPath.match(sourceRegex)

    if (sourceMatch) {
      // This static redirect points to a path that will be moved by our dynamic redirect
      // Update its destination to point to the new location using the same mapping logic as file moves
      const newDestination = mapSourceToDestination(destPath, sourcePattern, destPattern) + (destHash || '')

      console.log(
        `Updated static redirect destination due to dynamic redirect: ${redirect.destination} -> ${newDestination}`,
      )
      return {
        ...redirect,
        destination: newDestination,
      }
    }

    return redirect
  })

  await writeJsonFile(DOCS_FILE, updatedRedirects)
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
const expandGlobPattern = async (pattern: string): Promise<string[]> => {
  // Remove leading slash and add .mdx extension if not present
  const searchPattern = pattern.replace(/^\//, '')
  const globPattern = searchPattern.endsWith('**')
    ? `${searchPattern}/*.mdx`
    : searchPattern.endsWith('.mdx')
      ? searchPattern
      : `${searchPattern}.mdx`

  const files = await glob(globPattern, {
    cwd: process.cwd(),
    ignore: ['**/node_modules/**', '**/.git/**'],
  })

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

// Export all the main functions for testing
export {
  moveFile,
  updateDynamicRedirects,
  updateStaticRedirectsForDynamic,
  updateRedirects,
  updateManifestLinks,
  updateMdxLinks,
  hasSDKFrontmatter,
  globToDynamicPattern,
  globToSDKScopedPattern,
  expandGlobPattern,
  mapSourceToDestination,
  isGlobPattern,
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

    if (dryRun) {
      if (verbose) console.log('🔍 Dry run - showing what would be moved:')
      const results: MoveResult[] = sourceFiles.map((sourceFile) => {
        const destFile = mapSourceToDestination(sourceFile, source, destination)
        if (verbose) console.log(`   ${sourceFile} → ${destFile}`)
        return { source: sourceFile, destination: destFile, status: 'would-move' }
      })
      return { success: true, message: `Dry run completed. Would move ${results.length} files`, results }
    }

    // First, add the dynamic redirects for the glob pattern (both basic and SDK-scoped if needed)
    if (verbose) console.log(`🔄 Adding dynamic redirects for pattern: ${source} -> ${destination}`)
    const sourceDynamicPatterns = await updateDynamicRedirects(source, destination, sourceFiles)

    // Update static redirects to account for the new dynamic redirects
    if (verbose) console.log(`🔄 Updating static redirects to account for dynamic redirects`)
    await updateStaticRedirectsForDynamic(sourceDynamicPatterns, destination, source)

    // Process each file (using simple move without static redirects since we have dynamic redirects)
    const results: MoveResult[] = []
    for (const sourceFile of sourceFiles) {
      try {
        const destFile = mapSourceToDestination(sourceFile, source, destination)
        if (verbose) console.log(`   ${sourceFile} → ${destFile}`)

        await moveFile(sourceFile, destFile)
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
      if (dryRun) {
        if (verbose) console.log(`🔍 Dry run - would move: ${source} → ${destination}`)
        return {
          success: true,
          message: `Dry run completed. Would move ${source} to ${destination}`,
          results: [{ source, destination, status: 'would-move' }],
        }
      }

      // Move the file
      await moveFile(source, destination)

      // Handle static redirects for single file moves
      const pathsToUpdate = await updateRedirects(source, destination)
      if (verbose) console.log('Updated redirects in /static/docs.json')

      // Update links in other MDX files for all old paths
      await updateMdxLinks(pathsToUpdate, destination)

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
