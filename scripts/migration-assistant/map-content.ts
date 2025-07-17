import { readFile } from 'fs/promises'
import { glob } from 'glob'
import { join, relative } from 'path'
import type { Manifest } from './generate-manifest'

// Path to the docs directory and mapping file
const MAPPING_PATH = join(process.cwd(), './proposal-mapping.json')
const MANIFEST_PROPOSAL_PATH = join(process.cwd(), './public/manifest.proposal.json')
const MANIFEST_PATH = join(process.cwd(), './public/manifest.json')
const DOCS_PATH = join(process.cwd(), './docs')

// Environment variable to control output
const WARNINGS_ONLY = process.env.DOCS_IA_WARNINGS_ONLY === 'true'

/**
 * Read and parse the mapping.json file
 * @returns {Promise<Object>} Parsed mapping object
 */
async function readMapping() {
  try {
    const mappingContent = await readFile(MAPPING_PATH, 'utf-8')
    return JSON.parse(mappingContent) as Record<
      string,
      { newPath: string; action: 'consolidate' | 'move' | 'generate' | 'convert-to-example' | 'drop' }
    >
  } catch (error) {
    console.error(`❌ Error reading mapping.json: ${error.message}`)
    return {}
  }
}

type Mapping = Awaited<ReturnType<typeof readMapping>>

/**
 * Read all manifest files and extract destination paths
 * @returns {Promise<string[]>} Array of all destination paths from manifests
 */
async function readProposalManifestPaths() {
  const content = await readFile(MANIFEST_PROPOSAL_PATH, 'utf-8')
  const manifest = JSON.parse(content) as { navigation: Manifest }
  return { manifest, paths: parseManifestPaths(manifest) }
}

async function getManifestPaths() {
  const content = await readFile(MANIFEST_PATH, 'utf-8')
  const manifest = JSON.parse(content) as { navigation: Manifest }
  return { manifest, paths: parseManifestPaths(manifest) }
}

function parseManifestPaths(manifest: { navigation: Manifest }) {
  const manifestPaths: string[] = []

  // Extract paths from navigation structure
  const extractPaths = (groups: Manifest) => {
    for (const group of groups) {
      for (const item of group) {
        if ('href' in item) {
          manifestPaths.push(item.href)
        }

        if ('items' in item) {
          extractPaths(item.items)
        }
      }
    }
  }

  extractPaths(manifest.navigation)

  return [...new Set(manifestPaths)].sort() // Remove duplicates and sort
}

/**
 * Recursively find all .mdx files in a directory
 * @param {string} dir - Directory to search
 * @param {string} baseDir - Base directory for relative paths
 * @returns {Promise<string[]>} Array of relative file paths
 */
async function findMdxFiles(dir: string, baseDir = dir) {
  const files = await glob(`${dir}/**/*.mdx`, { ignore: ['**/_*/**'] })
  return files.map((file) => relative(baseDir, file))
}

/**
 * Find unhandled files by comparing with mapping
 * @param {string[]} allFiles - All MDX files found
 * @param {Object} mapping - Mapping configuration
 * @returns {string[]} Array of unhandled file paths
 */
function findUnhandledFiles(allFiles: string[], mapping: Mapping) {
  const handledFiles = new Set(Object.keys(mapping))
  return allFiles.filter((file) => !handledFiles.has(file))
}

/**
 * Find pages that need to be created (in manifest but no mapping source)
 * @param manifestPaths - All paths from manifest files
 * @param mapping - Mapping configuration
 * @returns Array of paths that need new content
 */
function findPagesToCreate(manifestPaths: string[], mapping: Mapping) {
  const mappedDestinations = new Set(Object.values(mapping).map((entry) => entry.newPath))

  // Also collect manifest paths that are explicitly marked for dropping
  const droppedPaths = new Set()
  for (const [key, value] of Object.entries(mapping)) {
    if (value.action === 'drop' && key.startsWith('/docs/')) {
      droppedPaths.add(key)
    }
  }

  return manifestPaths.filter((path) => !mappedDestinations.has(path) && !droppedPaths.has(path))
}

/**
 * Display warnings for unhandled files and pages to create
 * @param {string[]} unhandledFiles - Array of unhandled file paths
 * @param {string[]} pagesToCreate - Array of paths that need new content
 * @param {Object} expandedMapping - Expanded mapping configuration
 * @param {Array} invalidMappings - Array of invalid mapping objects
 */
function displayWarnings(
  unhandledFiles: string[],
  pagesToCreate: string[],
  expandedMapping: Mapping,
  invalidMappings: InvalidMapping,
) {
  let hasWarnings = false

  if (unhandledFiles.length > 0) {
    hasWarnings = true
    console.log(`⚠️  Found ${unhandledFiles.length} unhandled legacy files:\n`)

    // Group by directory for better readability
    const groupedFiles: Record<string, string[]> = {}
    unhandledFiles.forEach((file) => {
      const dir = file.includes('/') ? file.split('/')[0] : 'root'
      if (!groupedFiles[dir]) groupedFiles[dir] = []
      groupedFiles[dir].push(file)
    })

    // Display grouped warnings
    Object.entries(groupedFiles)
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([dir, files]) => {
        console.log(`📁 ${dir}/ (${files.length} files)`)
        files.sort().forEach((file) => {
          console.log(`   • ${file}`)
        })
        console.log()
      })
  }

  if (invalidMappings.length > 0) {
    hasWarnings = true
    if (unhandledFiles.length > 0) console.log('\n' + '─'.repeat(60) + '\n')

    console.log(`❌ Found ${invalidMappings.length} invalid mappings (destinations not in manifests):\n`)

    // Group by destination directory for better readability
    const groupedMappings: Record<string, InvalidMapping> = {}
    invalidMappings.forEach((mapping) => {
      const parts = mapping.destination.split('/')
      const section = parts.length > 2 ? parts[2] : 'root' // /docs/[section]/...
      if (!groupedMappings[section]) groupedMappings[section] = []
      groupedMappings[section].push(mapping)
    })

    // Display grouped invalid mappings
    Object.entries(groupedMappings)
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([section, mappings]) => {
        console.log(`📂 ${section}/ (${mappings.length} mappings)`)
        mappings.forEach((mapping) => {
          console.log(`   • ${mapping.source} → ${mapping.destination} (${mapping.action})`)
        })
        console.log()
      })
  }

  if (pagesToCreate.length > 0) {
    hasWarnings = true
    if (unhandledFiles.length > 0 || invalidMappings.length > 0) console.log('\n' + '─'.repeat(60) + '\n')

    console.log(`📝 Found ${pagesToCreate.length} pages that need new content:\n`)

    // Group by section for better readability
    const groupedPages: Record<string, string[]> = {}
    pagesToCreate.forEach((path) => {
      const parts = path.split('/')
      const section = parts.length > 2 ? parts[2] : 'root' // /docs/[section]/...
      if (!groupedPages[section]) groupedPages[section] = []
      groupedPages[section].push(path)
    })

    // Display grouped pages to create
    Object.entries(groupedPages)
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([section, paths]) => {
        console.log(`📂 ${section}/ (${paths.length} pages)`)
        paths.sort().forEach((path) => {
          console.log(`   • ${path}`)
        })
        console.log()
      })
  }

  if (!hasWarnings) {
    console.log('✅ All legacy files are handled, all mappings are valid, and all manifest pages have content sources')
    return
  }

  // Count files that need to be converted to examples
  const convertToExampleFiles = Object.values(expandedMapping).filter(
    (mapping) => mapping.action === 'convert-to-example',
  ).length

  // Count files that will be generated
  const generateFiles = Object.values(expandedMapping).filter((mapping) => mapping.action === 'generate').length

  console.log(
    `\n📊 Summary: ${unhandledFiles.length} unhandled files, ${invalidMappings.length} invalid mappings, ${pagesToCreate.length} pages need new content, ${convertToExampleFiles} convert to examples, ${generateFiles} pages need to be generated, ${Object.keys(expandedMapping).length} files mapped`,
  )
}

/**
 * Check if a pattern is a glob pattern
 * @param {string} pattern - The pattern to check
 * @returns {boolean} - Whether the pattern contains glob characters
 */
function isGlobPattern(pattern: string) {
  return pattern.includes('*') || pattern.includes('?')
}

/**
 * Convert a glob pattern to a regex
 * @param {string} pattern - The glob pattern
 * @returns {RegExp} - The corresponding regex
 */
function globToRegex(pattern: string) {
  // Escape special regex characters except * and ?
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '§DOUBLESTAR§') // Temporary placeholder
    .replace(/\*/g, '[^/]*') // Single * matches anything except /
    .replace(/§DOUBLESTAR§/g, '.*') // ** matches anything including /
    .replace(/\?/g, '[^/]') // ? matches single char except /

  return new RegExp(`^${escaped}$`)
}

/**
 * Apply glob pattern to generate new path
 * @param {string} filePath - The source file path
 * @param {string} globPattern - The glob pattern used as key
 * @param {string} newPathPattern - The new path pattern (may contain globs)
 * @returns {string} - The generated new path
 */
function applyGlobMapping(filePath: string, globPattern: string, newPathPattern: string) {
  // If newPathPattern doesn't contain globs, return as-is
  if (!isGlobPattern(newPathPattern)) {
    return newPathPattern
  }

  // Handle ** glob replacement
  if (globPattern.includes('**') && newPathPattern.includes('**')) {
    const globPrefix = globPattern.split('**')[0]
    const newPathPrefix = newPathPattern.split('**')[0]
    const newPathSuffix = newPathPattern.split('**')[1] || ''

    if (filePath.startsWith(globPrefix)) {
      const matchedPart = filePath.slice(globPrefix.length)
      return newPathPrefix + matchedPart.replace(/\.mdx$/, '') + newPathSuffix
    }
  }

  // Handle single * replacement (simplified)
  if (globPattern.includes('*') && newPathPattern.includes('*')) {
    const globParts = globPattern.split('*')
    const newPathParts = newPathPattern.split('*')

    if (globParts.length === 2 && newPathParts.length === 2) {
      const [globPrefix, globSuffix] = globParts
      const [newPrefix, newSuffix] = newPathParts

      if (filePath.startsWith(globPrefix) && filePath.endsWith(globSuffix)) {
        const matchedPart = filePath.slice(globPrefix.length, -globSuffix.length || undefined)
        return newPrefix + matchedPart + newSuffix
      }
    }
  }

  return newPathPattern
}

/**
 * Expand glob patterns in mapping to actual file matches
 * @param {Object} mapping - The mapping configuration
 * @param {string[]} allFiles - All available files
 * @returns {Object} - Expanded mapping with actual file paths
 */
function expandGlobMapping(mapping: Mapping, allFiles: string[]) {
  const expandedMapping: Mapping = {}

  for (const [key, value] of Object.entries(mapping)) {
    if (isGlobPattern(key)) {
      const regex = globToRegex(key)
      const matchingFiles = allFiles.filter((file) => regex.test(file))

      for (const file of matchingFiles) {
        expandedMapping[file] = {
          ...value,
          newPath: applyGlobMapping(file, key, value.newPath),
        }
      }
    } else {
      // Include non-glob patterns as-is
      expandedMapping[key] = value
    }
  }

  return expandedMapping
}

/**
 * Find invalid mapping destinations (mapped to paths that don't exist in manifests)
 * @param {Object} expandedMapping - Expanded mapping configuration
 * @param {string[]} manifestPaths - All paths from manifest files
 * @returns {string[]} Array of invalid mapping destinations
 */
function findInvalidMappings(expandedMapping: Mapping, manifestPaths: string[]) {
  const manifestPathsSet = new Set(manifestPaths)
  const invalidMappings: Array<{ source: string; destination: string; action: 'consolidate' | 'move' }> = []

  for (const [sourcePath, mapping] of Object.entries(expandedMapping)) {
    // Skip drop actions - they're intentionally removing paths
    // Skip generate actions - they're creating new content that won't exist in manifests yet
    // Skip convert-to-example actions - they're converting to examples that won't exist as specific manifest paths
    if (mapping.action === 'drop' || mapping.action === 'generate' || mapping.action === 'convert-to-example') {
      continue
    }

    if (!manifestPathsSet.has(mapping.newPath)) {
      invalidMappings.push({
        source: sourcePath,
        destination: mapping.newPath,
        action: mapping.action,
      })
    }
  }

  return invalidMappings
}

type InvalidMapping = Awaited<ReturnType<typeof findInvalidMappings>>

/**
 * Main function to parse docs content and check mappings
 */
async function main() {
  if (!WARNINGS_ONLY) {
    console.log('🔍 Scanning for MDX files in ./docs')
  }

  try {
    const [mdxFiles, mapping, { paths: manifestPaths }] = await Promise.all([
      findMdxFiles(DOCS_PATH),
      readMapping(),
      readProposalManifestPaths(),
    ])

    // Expand glob patterns in mapping to actual file matches
    const expandedMapping = expandGlobMapping(mapping, mdxFiles)

    const unhandledFiles = findUnhandledFiles(mdxFiles, expandedMapping)
    const pagesToCreate = findPagesToCreate(manifestPaths, expandedMapping)
    const invalidMappings = findInvalidMappings(expandedMapping, manifestPaths)

    if (WARNINGS_ONLY) {
      console.log('🔍 Checking for unhandled legacy files and pages to create...\n')
      displayWarnings(unhandledFiles, pagesToCreate, expandedMapping, invalidMappings)
    } else {
      // Simplified output mode
      console.log('📋 UNHANDLED LEGACY FILES:\n')
      if (unhandledFiles.length > 0) {
        unhandledFiles.sort().forEach((file) => {
          console.log(`   • ${file}`)
        })
      } else {
        console.log('   ✅ All legacy files are handled')
      }

      console.log('\n❌ INVALID MAPPINGS (destinations not in manifests):\n')
      if (invalidMappings.length > 0) {
        invalidMappings.forEach((mapping) => {
          console.log(`   • ${mapping.source} → ${mapping.destination} (${mapping.action})`)
        })
      } else {
        console.log('   ✅ All mappings point to valid manifest paths')
      }

      console.log('\n📝 MANIFEST PATHS:\n')
      manifestPaths.forEach((path) => {
        console.log(`   • ${path}`)
      })

      // Count files that need to be converted to examples
      const convertToExampleFiles = Object.values(expandedMapping).filter(
        (mapping) => mapping.action === 'convert-to-example',
      ).length

      // Count files that will be generated
      const generateFiles = Object.values(expandedMapping).filter((mapping) => mapping.action === 'generate').length

      console.log('\n📊 SUMMARY:')
      console.log(`   • Legacy files: ${mdxFiles.length}`)
      console.log(`   • Manifest paths: ${manifestPaths.length}`)
      console.log(`   • Original mapping entries: ${Object.keys(mapping).length}`)
      console.log(`   • Expanded mapping entries: ${Object.keys(expandedMapping).length}`)
      console.log(`   • Handled files: ${Object.keys(expandedMapping).length}`)
      console.log(`   • Unhandled files: ${unhandledFiles.length}`)
      console.log(`   • Pages needing new content: ${pagesToCreate.length}`)
      console.log(`   • Convert to examples: ${convertToExampleFiles}`)
      console.log(`   • Pages need to be generated: ${generateFiles}`)
      console.log(`   • Invalid mappings: ${invalidMappings.length}`)

      if (unhandledFiles.length > 0 || pagesToCreate.length > 0) {
        console.log('\n💡 Run with DOCS_IA_WARNINGS_ONLY=true to see detailed warnings and grouped files')
      }
    }
  } catch (error) {
    console.error('❌ Error scanning docs:', error.message)
    process.exit(1)
  }
}

// Run the script
main()
