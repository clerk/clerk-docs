/**
 * Deletes MDX files and cleans up references.
 *
 * At a high level, the script does the following in the /clerk-docs repo:
 * 1. Updates any links in MDX files that point to the deleted path
 * 2. Removes the file from the manifest.json
 * 3. Adds a redirect to the redirects/static/docs.json file
 * 4. Deletes the MDX file
 *
 * The format to run the script is:
 * node scripts/delete-doc.mjs /docs/path-to-delete [redirect-destination]
 *
 * @example Delete with default redirect:
 * node scripts/delete-doc.mjs /docs/some/old-page
 * (redirects to /docs/)
 *
 * @example Delete with custom redirect:
 * node scripts/delete-doc.mjs /docs/some/old-page /docs/better-page
 *
 * Note:
 * - The .mdx extension should be omitted from the paths as the script will add it
 * - The script will fail if any existing docs link to the file being deleted
 * - Redirect destination defaults to /docs/ if not provided
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

// Check if any MDX files reference the path to be deleted
const checkMdxReferences = async (targetPath) => {
  const { path: targetBasePath } = splitPathAndHash(targetPath)
  const referencingFiles = []

  const processFile = async (filePath) => {
    const content = await fs.readFile(filePath, 'utf-8')

    // Check for various link patterns
    const patterns = [
      // 1. Markdown links
      new RegExp(`\\[[^\\]]+\\]\\(${targetBasePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:#[^)]*)?\\)`, 'g'),
      // 2. JSX/TSX component link props
      new RegExp(`link=["']${targetBasePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:#[^"']*)?["']`, 'g'),
      // 3. Link prop in arrays
      new RegExp(`link:\\s*["']${targetBasePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:#[^"']*)?["']`, 'g'),
      // 4. Reference-style link definitions (e.g., [ref]: /docs/path or </docs/path#hash> "Title")
      new RegExp(
        `(^\\s*\\[[^\\]]+\\]:\\s*)(<?)(${escapeRegExp(targetBasePath)}(?:#[^\\s>\"]*)?)(>?)((?:\\s+.+)?)$`,
        'gm',
      ),
    ]

    for (const pattern of patterns) {
      if (pattern.test(content)) {
        referencingFiles.push(filePath)
        break // No need to check other patterns for this file
      }
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
  return referencingFiles
}

const updateMdxLinks = async (deletedPath, newPath) => {
  const processFile = async (filePath) => {
    const content = await fs.readFile(filePath, 'utf-8')
    let updatedContent = content

    const { path: oldBasePath } = splitPathAndHash(deletedPath)
    const { path: newBasePath, hash: newHash } = splitPathAndHash(newPath)

    // 1. Update markdown links
    const markdownLinkRegex = new RegExp(`\\[([^\\]]+)\\]\\(${oldBasePath}(?:#[^)]*)?\\)`, 'g')
    updatedContent = updatedContent.replace(markdownLinkRegex, (match, linkText) => {
      const existingHash = match.match(/#[^)]*(?=\))/)?.[0] || ''
      if (existingHash) {
        console.log(
          `⚠️ Hash found in markdown link: ${existingHash}. Ensure that the new path has the same hash, or update the hash accordingly.`,
        )
      }
      const finalHash = newHash || existingHash || ''
      return `[${linkText}](${newBasePath}${finalHash})`
    })

    // 2. Update JSX/TSX component link props
    // This regex looks for link="..." or link='...' patterns, being careful about quotes
    const jsxLinkRegex = new RegExp(`(link=["'])(${oldBasePath}(?:#[^"']*)?)(["'])`, 'g')
    updatedContent = updatedContent.replace(jsxLinkRegex, (match, prefix, linkPath, suffix) => {
      const { hash: linkHash } = splitPathAndHash(linkPath)
      if (linkHash) {
        console.log(
          `⚠️ Hash found in JSX link: ${linkHash}. Ensure that the new path has the same hash, or update the hash accordingly.`,
        )
      }
      const finalHash = newHash || linkHash || ''
      return `${prefix}${newBasePath}${finalHash}${suffix}`
    })

    // 3. Update link prop in arrays
    const arrayLinkRegex = new RegExp(`(link:\\s*["'])(${oldBasePath}(?:#[^"']*)?)(["'])`, 'g')
    updatedContent = updatedContent.replace(arrayLinkRegex, (match, prefix, linkPath, suffix) => {
      const { hash: linkHash } = splitPathAndHash(linkPath)
      if (linkHash) {
        console.log(
          `⚠️ Hash found in array link: ${linkHash}. Ensure that the new path has the same hash, or update the hash accordingly.`,
        )
      }
      const finalHash = newHash || linkHash || ''
      return `${prefix}${newBasePath}${finalHash}${suffix}`
    })

    // 4. Update reference-style link definitions
    // Examples:
    // [components-ref]: /docs/components/overview
    // [components-ref]: </docs/components/overview#hash> "Title"
    // Preserve angle brackets and optional titles, favoring new hash if provided
    const refDefRegex = new RegExp(
      `(^\\s*\\[[^\\]]+\\]:\\s*)(<?)(${escapeRegExp(oldBasePath)}(?:#[^\\s>\"]*)?)(>?)((?:\\s+.+)?)$`,
      'gm',
    )
    updatedContent = updatedContent.replace(refDefRegex, (match, prefix, open, urlPath, close, trailing) => {
      const { path: defPath, hash: defHash } = splitPathAndHash(urlPath)
      if (defPath !== oldBasePath) return match
      if (defHash) {
        console.log(
          `⚠️ Hash found in reference definition: ${defHash}. Ensure that the new path has the same hash, or update the hash accordingly.`,
        )
      }
      const finalHash = newHash || defHash || ''
      const rebuiltUrl = `${newBasePath}${finalHash}`
      return `${prefix}${open}${rebuiltUrl}${close}${trailing || ''}`
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

// Remove the path from manifest.json
const removeFromManifest = async (targetPath) => {
  const manifest = await readJsonFile(MANIFEST_FILE)
  const { path: targetBasePath } = splitPathAndHash(targetPath)
  let removed = false

  // Remove href's in link items
  const updateLinkItem = (item) => {
    const { path: itemPath } = splitPathAndHash(item.href)
    if (itemPath === targetBasePath) {
      removed = true
      return null // Mark for removal
    }
    return item
  }

  const updateSubNavItem = (item) => {
    if (item.items) {
      const updatedItems = updateNavigation(item.items)
      if (updatedItems.length === 0) {
        return null // Remove empty sub-nav items
      }
      return { ...item, items: updatedItems }
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
    return group.map(updateNavItem).filter((item) => item !== null)
  }

  const updateNavigation = (nav) => {
    return nav.map(updateNavGroup).filter((group) => group.length > 0)
  }

  const updatedManifest = {
    ...manifest,
    navigation: updateNavigation(manifest.navigation),
  }

  await writeJsonFile(MANIFEST_FILE, updatedManifest)

  if (!removed) {
    console.warn(`Warning: Path ${targetBasePath} was not found in manifest.json`)
  }

  return removed
}

// Add redirect for the deleted path
const addRedirect = async (deletedPath, redirectTo) => {
  const redirects = await readJsonFile(DOCS_FILE)

  // Check if a redirect already exists for this path
  const existingRedirect = redirects.find(
    (redirect) => splitPathAndHash(redirect.source).path === splitPathAndHash(deletedPath).path,
  )

  if (existingRedirect) {
    console.log(`Redirect already exists for ${deletedPath}, updating destination to ${redirectTo}`)
    existingRedirect.destination = redirectTo
  } else {
    redirects.push({
      source: deletedPath,
      destination: redirectTo,
      permanent: true,
    })
  }

  await writeJsonFile(DOCS_FILE, redirects)
}

// Check if file exists
const fileExists = async (filePath) => {
  try {
    await fs.access(filePath, fs.constants.F_OK)
    return true
  } catch (error) {
    return false
  }
}

const deleteDoc = async (targetPath, redirectTo = '/docs/') => {
  // Remove leading slash and add .mdx extension
  const targetFilePath = `${targetPath.replace(/^\//, '')}.mdx`
  const fullPath = path.join(DOCS_DIR, targetFilePath.replace('docs/', ''))

  // Check if file exists
  if (!(await fileExists(fullPath))) {
    throw new Error(`Target file does not exist: ${fullPath}`)
  }

  // console.log(`🔍 Checking for references to ${targetPath}...`)

  // // Check if any files reference this path
  // const referencingFiles = await checkMdxReferences(targetPath)

  // if (referencingFiles.length > 0) {
  //   console.error(`❌ Cannot delete ${targetPath} - it is referenced by the following files:`)
  //   referencingFiles.forEach((file) => console.error(`   • ${file}`))
  //   throw new Error(`File ${targetPath} is still referenced by ${referencingFiles.length} other files`)
  // }

  // console.log(`✅ No references found to ${targetPath}`)

  try {
    // Update links in MDX files
    console.log(`🔗 Updating links in MDX files...`)
    await updateMdxLinks(targetPath, redirectTo)

    // Remove from manifest
    console.log(`📝 Removing ${targetPath} from manifest.json...`)
    await removeFromManifest(targetPath)

    // Add redirect
    console.log(`🔄 Adding redirect: ${targetPath} → ${redirectTo}`)
    await addRedirect(targetPath, redirectTo)

    // Delete the file
    console.log(`🗑️ Deleting file: ${fullPath}`)
    await fs.unlink(fullPath)

    console.log(`✅ Successfully deleted ${targetPath}`)
  } catch (error) {
    console.error('Error during deletion:', error)
    throw error
  }
}

const main = async () => {
  const [targetPath, redirectTo = '/docs/'] = process.argv.slice(2)

  if (!targetPath) {
    throw new Error(
      'Target path is required. Usage: node scripts/delete-doc.mjs /docs/path-to-delete [redirect-destination]',
    )
  }

  console.log(`🗑️  Deleting document: ${targetPath}`)
  console.log(`📍 Redirect destination: ${redirectTo}`)
  console.log('')

  await deleteDoc(targetPath, redirectTo)
}

main().catch((error) => {
  console.error('Error:', error.message)
  process.exit(1)
})
