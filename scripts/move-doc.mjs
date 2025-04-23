/**
 * Relocates an MDX file.
 *
 * At a high level, the script does the following in the /clerk-docs repo:
 * 1. Moves the mdx file to the new location
 * 2. Updates the manifest.json file to update all links that point to the old location
 * 3. Updates any links in other mdx files that point to the old location
 * 4. Adds the redirect to the redirects/static/docs.json file
 * 5. Updates any existing redirects to point to the new location
 *
 * The format to run the script is:
 * node scripts/move-doc.mjs /docs/old-path /docs/new-path
 *
 * @example
 * node scripts/move-doc.mjs /docs/references/nextjs/overview /docs/references/nextjs/available-methods
 *
 * Note: The .mdx extension should be omitted from the paths as the script will add it
 */

import fs from 'fs/promises'
import path from 'path'
import prettier from 'prettier'

const DOCS_FILE = './redirects/static/docs.json'
const MANIFEST_FILE = './docs/manifest.json'
const DOCS_DIR = './docs'

const splitPathAndHash = (url) => {
  const [path, hash] = url.split('#')
  return { path, hash: hash ? `#${hash}` : '' }
}

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

  await moveDoc(source, destination)
  console.log('Document move completed successfully')
}

main().catch((error) => {
  console.error('Error:', error)
  process.exit(1)
})
