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
 * node scripts/move-doc.mjs /docs/old-path /docs/new-path
 *
 * @example Single file move:
 * node scripts/move-doc.mjs /docs/references/nextjs/overview /docs/references/nextjs/available-methods
 *
 * @example Batch move with glob patterns:
 * node scripts/move-doc.mjs "/docs/references/**" "/docs/reference/sdk/**"
 * node scripts/move-doc.mjs "/docs/quickstarts/*" "/docs/getting-started/*"
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

const DOCS_FILE = './redirects/static/docs.json'
const MANIFEST_FILE = './docs/manifest.json'
const DOCS_DIR = './docs'

const splitPathAndHash = (url) => {
  const [path, hash] = url.split('#')
  return { path, hash: hash ? `#${hash}` : '' }
}

// Escape a string for safe insertion inside a RegExp constructor
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const readJsonFile = async (filePath) => {
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(content)
  } catch (error) {
    console.error(`Error reading ${filePath}:`, error)
    throw error
  }
}

const writeJsonFile = async (filePath, data) => {
  try {
    await fs.writeFile(filePath, await prettier.format(JSON.stringify(data, null, 2), { parser: 'json' }))
  } catch (error) {
    console.error(`Error writing ${filePath}:`, error)
    throw error
  }
}

// Finds all redirects that point to a given path
const findRedirectChain = (redirects, targetPath) => {
  const chain = []
  const seen = new Set()

  const findSources = (path) => {
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
const updateManifestLinks = async (oldPath, newPath) => {
  const manifest = await readJsonFile(MANIFEST_FILE)

  // Update href's in link items
  const updateLinkItem = (item) => {
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

  const updateSubNavItem = (item) => {
    if (item.items) {
      return { ...item, items: updateNavigation(item.items) }
    }
    return item
  }

  const updateNavItem = (item) => {
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

  const updateNavGroup = (group) => {
    return group.map(updateNavItem)
  }

  const updateNavigation = (nav) => {
    return nav.map(updateNavGroup)
  }

  const updatedManifest = {
    ...manifest,
    navigation: updateNavigation(manifest.navigation),
  }

  await writeJsonFile(MANIFEST_FILE, updatedManifest)
}

const updateMdxLinks = async (oldPaths, newPath) => {
  const processFile = async (filePath) => {
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
  const processDirectory = async (dir) => {
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

const updateRedirects = async (oldPath, newPath) => {
  const redirects = await readJsonFile(DOCS_FILE)
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
    // Add new redirect from old path to new path
    updatedRedirects.push({
      source: oldPath,
      destination: newPath,
      permanent: true,
    })
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
const isGlobPattern = (pattern) => {
  return pattern.includes('*') || pattern.includes('?') || pattern.includes('[') || pattern.includes('{')
}

// Convert a glob pattern to a regex for extracting variable parts
const globToRegex = (pattern) => {
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
const mapSourceToDestination = (sourceFile, sourcePattern, destPattern) => {
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
const expandGlobPattern = async (pattern) => {
  // Remove leading slash and add .mdx extension if not present
  const searchPattern = pattern.replace(/^\//, '')
  const globPattern = searchPattern.endsWith('.mdx') ? searchPattern : `${searchPattern}.mdx`

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

async function fileExists(filePath) {
  try {
    await fs.access(filePath, fs.constants.F_OK)
    return true
  } catch (error) {
    return false
  }
}

const moveDoc = async (source, destination) => {
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

  try {
    // Create destination directory if it doesn't exist
    await fs.mkdir(path.dirname(destPath), { recursive: true })

    // Move the MDX file
    await fs.rename(`${sourcePath}.mdx`, `${destPath}.mdx`)
    console.log(`Moved ${sourcePath}.mdx to ${destPath}.mdx`)

    // For redirects and link updates, use the original paths (with /docs/ prefix)
    const pathsToUpdate = await updateRedirects(source, destination)
    console.log('Updated redirects in /static/docs.json')

    // Update manifest links
    await updateManifestLinks(source, destination)
    console.log('Updated links in clerk-docs/manifest.json')

    // Update links in other MDX files for all old paths
    await updateMdxLinks(pathsToUpdate, destination)
  } catch (error) {
    console.error('Error moving document:', error)
    throw error
  }
}

const main = async () => {
  const [source, destination] = process.argv.slice(2)

  if (!source) {
    throw new Error('Source path is required')
  }

  if (!destination) {
    throw new Error('Destination path is required')
  }

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

    console.log(`🔍 Expanding glob pattern: ${source}`)
    const sourceFiles = await expandGlobPattern(source)

    if (sourceFiles.length === 0) {
      console.log('❌ No files found matching the source pattern')
      return
    }

    console.log(`📁 Found ${sourceFiles.length} files to move:`)

    // Process each file
    const results = []
    for (const sourceFile of sourceFiles) {
      try {
        const destFile = mapSourceToDestination(sourceFile, source, destination)
        console.log(`   ${sourceFile} → ${destFile}`)

        await moveDoc(sourceFile, destFile)
        results.push({ source: sourceFile, destination: destFile, status: 'success' })
      } catch (error) {
        console.error(`❌ Failed to move ${sourceFile}: ${error.message}`)
        results.push({ source: sourceFile, destination: null, status: 'failed', error: error.message })
      }
    }

    // Summary
    const successful = results.filter((r) => r.status === 'success').length
    const failed = results.filter((r) => r.status === 'failed').length

    console.log(`\n📊 Batch move completed: ${successful} successful, ${failed} failed`)

    if (failed > 0) {
      console.log('\n❌ Failed moves:')
      results
        .filter((r) => r.status === 'failed')
        .forEach((r) => {
          console.log(`   ${r.source}: ${r.error}`)
        })
    }
  } else {
    // Handle single file move (existing behavior)
    await moveDoc(source, destination)
    console.log('Document move completed successfully')
  }
}

main().catch((error) => {
  console.error('Error:', error)
  process.exit(1)
})
