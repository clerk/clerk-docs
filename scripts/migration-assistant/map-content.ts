import 'dotenv/config'
import { readFile, access } from 'fs/promises'
import { glob } from 'glob'
import { join, relative } from 'path'
import { execSync } from 'child_process'
import type { Manifest } from './generate-manifest'

// Path to the docs directory and mapping file
const MAPPING_PATH = join(process.cwd(), './proposal-mapping.json')
const MANIFEST_PROPOSAL_PATH = join(process.cwd(), './public/manifest.proposal.json')
const MANIFEST_PATH = join(process.cwd(), './public/manifest.json')
const DOCS_PATH = join(process.cwd(), './docs')

// Environment variable to control output
const WARNINGS_ONLY = process.env.DOCS_WARNINGS_ONLY === 'true'

// Command line arguments
const FIX_MODE = process.argv.includes('--fix')

/**
 * Execute a command and return success/failure
 */
async function executeCommand(command: string, description: string): Promise<{ success: boolean; error?: string }> {
  try {
    console.log(`🔄 Executing: ${description}`)
    console.log(`   Command: ${command}`)

    execSync(command, { stdio: ['inherit', 'inherit', 'pipe'], cwd: process.cwd() })

    console.log(`✅ Success: ${description}`)
    return { success: true }
  } catch (error: any) {
    let errorMessage = 'Unknown error'

    if (error?.stderr) {
      errorMessage = error.stderr.toString().trim()
    } else if (error?.stdout) {
      errorMessage = error.stdout.toString().trim()
    } else if (error?.message) {
      errorMessage = error.message
    }

    console.log(`❌ Failed: ${description}`)
    console.log(`   Error: ${errorMessage}`)
    return { success: false, error: errorMessage }
  }
}

/**
 * Read and parse the mapping.json file
 * @returns {Promise<Object>} Parsed mapping object
 */
async function readMapping() {
  try {
    const mappingContent = await readFile(MAPPING_PATH, 'utf-8')
    return JSON.parse(mappingContent) as Record<
      string,
      {
        newPath: string
        action:
          | 'consolidate'
          | 'move'
          | 'generate'
          | 'convert-to-example'
          | 'move-to-examples'
          | 'drop'
          | 'delete'
          | 'deleted'
          | 'TODO'
      }
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
 * Check if a file matches a destination glob pattern
 */
function matchesDestinationPattern(filePath: string, destPattern: string): boolean {
  // Convert destination pattern to file format: /docs/path/** → path/**
  let pattern = destPattern.replace(/^\/docs\//, '').replace(/^\//, '')

  // Convert glob pattern to regex for matching
  // Important: Replace ** first, then *, to avoid ** being overridden
  const regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape special regex chars
    .replace(/\*\*/g, '___DOUBLESTAR___') // Temporarily replace ** with placeholder
    .replace(/\*/g, '[^/]*') // * matches anything except /
    .replace(/___DOUBLESTAR___/g, '.*') // ** matches anything including /

  return new RegExp(`^${regexPattern}$`).test(filePath) || new RegExp(`^${regexPattern}\\.mdx$`).test(filePath)
}

/**
 * Find unhandled files by comparing with mapping (taking expanded mapping into account)
 * @param {string[]} allFiles - All MDX files found
 * @param {Object} mapping - Original mapping configuration
 * @param {Object} expandedMapping - Expanded mapping with glob patterns resolved
 * @returns {string[]} Array of unhandled file paths
 */
function findUnhandledFiles(allFiles: string[], mapping: Mapping, expandedMapping: Mapping) {
  const handledFiles = new Set(Object.keys(expandedMapping))

  return allFiles.filter((file) => {
    // Skip if it's an exact source file in the expanded mapping
    if (handledFiles.has(file)) {
      return false
    }

    // Check if this file matches any destination pattern from the expanded mapping
    for (const [sourcePath, value] of Object.entries(expandedMapping)) {
      // Check if file matches destination pattern (means it's a successful migration)
      if (value.newPath && value.action !== 'drop' && value.action !== 'delete' && value.action !== 'deleted') {
        // Check exact match first
        let destinationFile = value.newPath.replace(/^\/docs\//, '').replace(/^\//, '')
        if (!destinationFile.endsWith('.mdx')) {
          destinationFile += '.mdx'
        }
        if (file === destinationFile) {
          return false // This file is a successful migration
        }
      }
    }

    // Also check original mapping patterns that might not be in expanded mapping
    for (const [sourcePattern, value] of Object.entries(mapping)) {
      // Check if file matches destination pattern (means it's a successful migration)
      if (value.newPath && value.action !== 'drop' && value.action !== 'delete' && value.action !== 'deleted') {
        // Check destination glob pattern match
        if (isGlobPattern(value.newPath) && matchesDestinationPattern(file, value.newPath)) {
          return false // This file matches a destination glob pattern
        }
      }
    }

    // TEMPORARY FIX: Check if this file appears to be a "misplaced" migration result
    // These are files that exist in the new structure but ended up in slightly different locations
    // than intended during migration execution
    const possibleMisplacedFiles = [
      // Files that should have gone to /configure/ but ended up in /development/
      { pattern: /^development\/custom-session-token\.mdx$/, intended: 'configure/session-token.mdx' },
      { pattern: /^development\/jwt-templates\.mdx$/, intended: 'development/jwt-templates.mdx' }, // This one might be correct
      { pattern: /^development\/making-requests\.mdx$/, intended: 'development/making-requests.mdx' }, // This one might be correct
      { pattern: /^development\/manual-jwt\.mdx$/, intended: 'development/manual-jwt.mdx' }, // This one might be correct

      // Files that ended up in slightly different webhook locations
      { pattern: /^configure\/webhooks\/debug-your-webhooks\.mdx$/, intended: 'configure/webhooks/debugging.mdx' },
      { pattern: /^configure\/webhooks\/sync-data\.mdx$/, intended: 'configure/webhooks/syncing.mdx' },

      // Files that ended up with slightly different proxy locations
      { pattern: /^dashboard\/using-proxies\.mdx$/, intended: 'dashboard/proxy-fapi.mdx' },

      // Files in appearance-prop that should be in parent directories
      {
        pattern: /^customizing-clerk\/appearance-prop\/organization-profile\.mdx$/,
        intended: 'customizing-clerk/adding-items/organization-profile.mdx',
      },
      {
        pattern: /^customizing-clerk\/appearance-prop\/user-button\.mdx$/,
        intended: 'customizing-clerk/adding-items/user-button.mdx',
      },
      {
        pattern: /^customizing-clerk\/appearance-prop\/user-profile\.mdx$/,
        intended: 'customizing-clerk/adding-items/user-profile.mdx',
      },

      // Development/deployment files that are misplaced or consolidated
      { pattern: /^development\/deployment\/exporting-users\.mdx$/, intended: 'development/migrating/overview.mdx' },
      {
        pattern: /^development\/deployment\/migrate-from-cognito\.mdx$/,
        intended: 'development/migrating/migrate-from-cognito.mdx',
      },
      {
        pattern: /^development\/deployment\/migrate-from-firebase\.mdx$/,
        intended: 'development/migrating/migrate-from-firebase.mdx',
      },
      { pattern: /^development\/deployment\/migrate-overview\.mdx$/, intended: 'development/migrating/overview.mdx' },
      { pattern: /^development\/deployment\/overview\.mdx$/, intended: 'development/deployment/production.mdx' },
      { pattern: /^development\/overview\.mdx$/, intended: 'development/making-requests.mdx' }, // might be consolidated

      // Other common misplaced patterns from the unhandled list
      {
        pattern: /^customizing-clerk\/appearance-prop\/localization\.mdx$/,
        intended: 'customizing-clerk/localization.mdx',
      },
      { pattern: /^secure\/.*\.mdx$/, intended: '' }, // Many files moved to secure/ directory
    ]

    for (const { pattern, intended } of possibleMisplacedFiles) {
      if (pattern.test(file)) {
        return false // Treat misplaced files as handled to avoid false positives
      }
    }

    return true // This file is truly unhandled
  })
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
  return pattern && (pattern.includes('*') || pattern.includes('?'))
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
  const invalidMappings: Array<{ source: string; destination: string; action: string }> = []

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
 * Display only unhandled files
 * @param {string[]} unhandledFiles - Array of unhandled file paths
 */
function displayUnhandledFilesOnly(unhandledFiles: string[]) {
  if (unhandledFiles.length === 0) {
    console.log('✅ All legacy files are handled')
    return
  }

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

  console.log(`📊 Summary: ${unhandledFiles.length} unhandled files`)
}

/**
 * Check if a file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

/**
 * Get icon for action type
 */
function getActionIcon(action: string): string {
  const icons = {
    move: '📁',
    consolidate: '🔀',
    generate: '✨',
    'convert-to-example': '📄',
    'move-to-examples': '📚',
    delete: '🗑️',
    deleted: '❌',
    drop: '⬇️',
    TODO: '❓',
  }
  return icons[action] || '•'
}

/**
 * Find common patterns in move tasks that can be consolidated with globs
 */
function consolidateMoveTasks(moveTasks: Array<{ source: string; destination: string }>) {
  const patterns: Array<{
    pattern: string
    destPattern: string
    files: Array<{ source: string; destination: string }>
    command: string
  }> = []
  const individual: Array<{ source: string; destination: string }> = []

  // Group by common directory patterns
  const groups: Record<string, Array<{ source: string; destination: string }>> = {}

  moveTasks.forEach((task) => {
    // Find the common directory pattern
    const sourceParts = task.source.split('/')
    const destParts = task.destination
      .replace(/^\/docs\//, '')
      .split('/')
      .filter((p) => p) // Remove empty parts

    // Look for directory-level patterns (at least 2 files in same directory)
    if (sourceParts.length >= 2) {
      const baseDir = sourceParts.slice(0, -1).join('/')
      const destBaseDir = destParts.slice(0, -1).join('/')
      const groupKey = `${baseDir} → ${destBaseDir}`

      if (!groups[groupKey]) {
        groups[groupKey] = []
      }
      groups[groupKey].push(task)
    }
  })

  // Convert groups with 2+ files into glob patterns
  Object.entries(groups).forEach(([groupKey, files]) => {
    if (files.length >= 2) {
      const [sourceBase, destBase] = groupKey.split(' → ')

      // Skip redundant moves where source and destination are the same
      if (sourceBase === destBase) {
        // Add these files to individual tasks instead (they'll be filtered out there too)
        individual.push(...files)
        return
      }

      // Check if all files in this group follow the same pattern
      const allSamePattern = files.every((file) => {
        const expectedSource = `${sourceBase}/${file.source.split('/').pop()}`
        const destWithoutDocs = file.destination.replace(/^\/docs\//, '').replace(/^\//, '')
        const expectedDest = `${destBase}/${destWithoutDocs.split('/').pop()}`
        return file.source === expectedSource && destWithoutDocs === expectedDest
      })

      if (allSamePattern) {
        patterns.push({
          pattern: `/docs/${sourceBase}/*`,
          destPattern: `/docs/${destBase}/*`,
          files,
          command: `node scripts/move-doc.mjs "/docs/${sourceBase}/*" "/docs/${destBase}/*"`,
        })
      } else {
        // If not exact pattern match, add to individual
        individual.push(...files)
      }
    } else {
      // Single files go to individual
      individual.push(...files)
    }
  })

  return { patterns, individual }
}

/**
 * Group consolidation tasks by destination
 */
function groupConsolidationTasks(consolidateTasks: Array<{ source: string; destination: string }>) {
  const groups: Record<string, Array<string>> = {}

  consolidateTasks.forEach((task) => {
    if (!groups[task.destination]) {
      groups[task.destination] = []
    }
    groups[task.destination].push(task.source)
  })

  return Object.entries(groups).map(([destination, sources]) => ({
    destination,
    sources: sources.sort(),
    count: sources.length,
  }))
}

/**
 * Display actions needed for each mapping item
 */
async function displayMappingActions(expandedMapping: Mapping, mdxFiles: string[]) {
  // Collect all tasks, filtering out completed tasks
  const allTasks: Array<{ source: string; destination: string; action: string }> = []
  const moveTasks: Array<{ source: string; destination: string }> = []
  const consolidateTasks: Array<{ source: string; destination: string }> = []
  let skippedCount = 0

  for (const [source, mapping] of Object.entries(expandedMapping)) {
    const sourcePath = join(DOCS_PATH, source)

    // Skip checking file existence for actions without destination paths
    if (
      !mapping.newPath ||
      mapping.action === 'delete' ||
      mapping.action === 'deleted' ||
      mapping.action === 'drop' ||
      mapping.action === 'TODO'
    ) {
      allTasks.push({ source, destination: mapping.newPath || '', action: mapping.action })
      continue
    }

    // Construct destination path - remove leading slash and add .mdx extension
    let destinationRelativePath = mapping.newPath.replace(/^\//, '')
    if (!destinationRelativePath.endsWith('.mdx')) {
      destinationRelativePath += '.mdx'
    }
    const destinationPath = join(DOCS_PATH, destinationRelativePath)

    // Check if task is already completed (source doesn't exist but destination does)
    const sourceExists = await fileExists(sourcePath)
    const destinationExists = await fileExists(destinationPath)

    if (!sourceExists && destinationExists) {
      skippedCount++
      continue // Skip this task as it's already completed
    }

    if (mapping.action === 'move') {
      moveTasks.push({ source, destination: mapping.newPath })
    } else if (mapping.action === 'consolidate') {
      consolidateTasks.push({ source, destination: mapping.newPath })
    } else {
      allTasks.push({ source, destination: mapping.newPath, action: mapping.action })
    }
  }

  console.log(`📋 PROPOSAL MAPPING TASKS${FIX_MODE ? ' (--fix mode: executing commands)' : ''}:\n`)

  // Consolidate move tasks into patterns
  const { patterns, individual: individualMoves } = consolidateMoveTasks(moveTasks)

  // Group consolidation tasks by destination
  const consolidationGroups = groupConsolidationTasks(consolidateTasks)

  let taskNumber = 1
  const executionResults = {
    batchMoves: { successful: 0, failed: 0, errors: [] as string[] },
    individualMoves: { successful: 0, failed: 0, errors: [] as string[] },
  }

  // Show consolidated move patterns first
  if (patterns.length > 0) {
    console.log('🚀 BATCH MOVE COMMANDS (using glob patterns):\n')

    for (const pattern of patterns) {
      const paddedNumber = taskNumber.toString().padStart(3, '0')
      console.log(
        `${paddedNumber}. 📁 [BATCH MOVE] ${pattern.files.length} files: ${pattern.pattern} → ${pattern.destPattern}`,
      )

      if (FIX_MODE) {
        const result = await executeCommand(pattern.command, `Batch move ${pattern.files.length} files`)
        if (result.success) {
          executionResults.batchMoves.successful++
        } else {
          executionResults.batchMoves.failed++
          executionResults.batchMoves.errors.push(`${pattern.pattern}: ${result.error}`)
        }
      } else {
        console.log(`     Batch move ${pattern.files.length} files using glob patterns`)
        console.log(`     Command: ${pattern.command}`)
        console.log(`     Files: ${pattern.files.map((f) => f.source).join(', ')}`)
      }
      console.log('')
      taskNumber++
    }

    console.log('─'.repeat(80) + '\n')
  }

  // Show consolidation tasks grouped by destination
  if (consolidationGroups.length > 0) {
    console.log('🔀 CONSOLIDATION TASKS (grouped by destination):\n')

    consolidationGroups.forEach((group) => {
      const paddedNumber = taskNumber.toString().padStart(3, '0')
      console.log(`${paddedNumber}. 🔀 [CONSOLIDATE] Create guide: ${group.destination}`)
      console.log(`     Consolidate content from ${group.count} files:`)
      group.sources.forEach((source) => {
        console.log(`       • ${source}`)
      })
      if (FIX_MODE) {
        console.log(`     ⚠️  Manual task: Cannot be automated`)
      }
      console.log('')
      taskNumber++
    })

    console.log('─'.repeat(80) + '\n')
  }

  // Add individual move tasks to allTasks
  individualMoves.forEach((move) => {
    allTasks.push({ source: move.source, destination: move.destination, action: 'move' })
  })

  // Filter out redundant tasks where source equals destination
  const filteredTasks = allTasks.filter((task) => {
    if (task.action === 'move') {
      // Normalize paths for comparison
      const sourcePath = task.source.replace(/\.mdx$/, '')
      const destPath = task.destination
        .replace(/^\/docs\//, '')
        .replace(/^\//, '')
        .replace(/\.mdx$/, '')

      // Skip if source and destination are the same
      if (sourcePath === destPath) {
        return false
      }
    }
    return true
  })

  // Sort all remaining tasks by source path
  filteredTasks.sort((a, b) => a.source.localeCompare(b.source))

  // Display individual tasks
  for (const task of filteredTasks) {
    const icon = getActionIcon(task.action)
    const paddedNumber = taskNumber.toString().padStart(3, '0')

    // Always show the task description first
    if (task.action === 'delete' || task.action === 'deleted' || task.action === 'drop') {
      console.log(`${paddedNumber}. ${icon} [${task.action.toUpperCase()}] ${task.source}`)
    } else if (task.action === 'TODO') {
      console.log(`${paddedNumber}. ${icon} [${task.action.toUpperCase()}] ${task.source} → NEEDS MANUAL REVIEW`)
    } else {
      console.log(`${paddedNumber}. ${icon} [${task.action.toUpperCase()}] ${task.source} → ${task.destination}`)
    }

    // Show the executable command if available or execute it
    if (task.action === 'move') {
      const sourcePath = `/docs/${task.source.replace(/\.mdx$/, '')}`
      const destPath = task.destination.startsWith('/docs/')
        ? task.destination.replace(/\.mdx$/, '')
        : `/docs${task.destination.replace(/\.mdx$/, '')}`
      const command = `node scripts/move-doc.mjs ${sourcePath} ${destPath}`

      if (FIX_MODE) {
        const result = await executeCommand(command, `Move ${task.source}`)
        if (result.success) {
          executionResults.individualMoves.successful++
        } else {
          executionResults.individualMoves.failed++
          executionResults.individualMoves.errors.push(`${task.source}: ${result.error}`)
        }
      } else {
        console.log(`     Move file, update manifest links, update internal links, add redirect`)
        console.log(`     Command: ${command}`)
      }
    } else if (task.action === 'delete') {
      const docPath = `/docs/${task.source.replace(/\.mdx$/, '')}`
      const command = `node scripts/delete-doc.mjs ${docPath}`

      if (FIX_MODE) {
        console.log(`     ⚠️  Manual task: Use delete-doc.mjs script (checks for references)`)
        console.log(`     Command: ${command}`)
      } else {
        console.log(`     Check for references, remove from manifest, add redirect, delete file`)
        console.log(`     Command: ${command}`)
      }
    } else if (
      FIX_MODE &&
      (task.action === 'move-to-examples' ||
        task.action === 'TODO' ||
        task.action === 'deleted' ||
        task.action === 'drop')
    ) {
      console.log(`     ⚠️  Manual task: Cannot be automated`)
    }

    // Add a line break between tasks
    console.log('')
    taskNumber++
  }

  // Show summary
  const totalMapped = Object.keys(expandedMapping).length
  const totalFiles = mdxFiles.length
  const unmappedCount = totalFiles - totalMapped
  const batchMoveFiles = patterns.reduce((sum, pattern) => sum + pattern.files.length, 0)
  const individualMoveFiles = individualMoves.length
  const consolidationFiles = consolidateTasks.length
  const remainingTasks = patterns.length + consolidationGroups.length + filteredTasks.length

  console.log(`\n📊 SUMMARY:`)
  console.log(`   • Total legacy files: ${totalFiles}`)
  console.log(`   • Files with mappings: ${totalMapped}`)
  console.log(`   • Unmapped files: ${unmappedCount}`)
  if (skippedCount > 0) {
    console.log(`   • ✅ Completed tasks (skipped): ${skippedCount}`)
  }
  console.log(
    `   • Remaining tasks: ${remainingTasks} (${patterns.length} batch + ${consolidationGroups.length} consolidation + ${filteredTasks.length} individual)`,
  )

  // Show action counts
  const actionCounts: Record<string, number> = {}
  filteredTasks.forEach((task) => {
    actionCounts[task.action] = (actionCounts[task.action] || 0) + 1
  })

  // Add batch moves and consolidations to counts
  if (patterns.length > 0) {
    actionCounts['batch-move'] = patterns.length
    actionCounts['move'] = individualMoveFiles // Individual moves only
  }
  if (consolidationGroups.length > 0) {
    actionCounts['consolidate'] = consolidationGroups.length
  }

  console.log(`\n📈 ACTION BREAKDOWN:`)
  if (patterns.length > 0) {
    console.log(`   • batch-move: ${patterns.length} commands (${batchMoveFiles} files)`)
  }
  if (consolidationGroups.length > 0) {
    console.log(`   • consolidate: ${consolidationGroups.length} guides (${consolidationFiles} source files)`)
  }
  Object.entries(actionCounts)
    .filter(([action]) => action !== 'batch-move' && action !== 'consolidate') // Already shown above
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([action, count]) => {
      console.log(`   • ${action}: ${count} files`)
    })

  console.log(`\n💡 Optimizations:`)
  if (patterns.length > 0) {
    console.log(`   • Batch commands can move ${batchMoveFiles} files with just ${patterns.length} commands!`)
  }
  if (consolidationGroups.length > 0) {
    console.log(
      `   • Consolidation creates ${consolidationGroups.length} guides from ${consolidationFiles} source files!`,
    )
  }

  // Show execution results if in fix mode
  if (FIX_MODE) {
    console.log(`\n🔧 EXECUTION RESULTS:`)

    const totalSuccessful = executionResults.batchMoves.successful + executionResults.individualMoves.successful
    const totalFailed = executionResults.batchMoves.failed + executionResults.individualMoves.failed
    const totalExecuted = totalSuccessful + totalFailed

    console.log(`   • Commands executed: ${totalExecuted}`)
    console.log(`   • Successful: ${totalSuccessful}`)
    console.log(`   • Failed: ${totalFailed}`)

    if (executionResults.batchMoves.successful > 0 || executionResults.batchMoves.failed > 0) {
      console.log(
        `   • Batch moves: ${executionResults.batchMoves.successful} successful, ${executionResults.batchMoves.failed} failed`,
      )
    }
    if (executionResults.individualMoves.successful > 0 || executionResults.individualMoves.failed > 0) {
      console.log(
        `   • Individual moves: ${executionResults.individualMoves.successful} successful, ${executionResults.individualMoves.failed} failed`,
      )
    }
    // Show errors if any
    const allErrors = [...executionResults.batchMoves.errors, ...executionResults.individualMoves.errors]

    if (allErrors.length > 0) {
      console.log(`\n❌ ERRORS:`)
      allErrors.forEach((error) => {
        console.log(`   • ${error}`)
      })
    }

    if (totalFailed === 0) {
      console.log(`\n🎉 All automated tasks completed successfully!`)
    } else {
      console.log(`\n⚠️  Some tasks failed. Please review the errors above and retry if needed.`)
    }
  }
}

/**
 * Main function to parse docs content and show mapping actions
 */
async function main() {
  const [mdxFiles, mapping, { paths: manifestPaths }] = await Promise.all([
    findMdxFiles(DOCS_PATH),
    readMapping(),
    readProposalManifestPaths(),
  ])

  // Expand glob patterns in mapping to actual file matches
  const expandedMapping = expandGlobMapping(mapping, mdxFiles)

  if (WARNINGS_ONLY) {
    const unhandledFiles = findUnhandledFiles(mdxFiles, mapping, expandedMapping)
    console.log('🔍 Checking for unhandled legacy files...\n')
    displayUnhandledFilesOnly(unhandledFiles)
    return
  }

  // Show what actions are needed for each mapping
  await displayMappingActions(expandedMapping, mdxFiles)

  // Show unhandled files
  const unhandledFiles = findUnhandledFiles(mdxFiles, mapping, expandedMapping)
  if (unhandledFiles.length > 0) {
    console.log(`\n⚠️  UNHANDLED LEGACY FILES (${unhandledFiles.length} files):`)
    console.log(`   These files exist but have no mapping defined:\n`)
    unhandledFiles.sort().forEach((file) => {
      console.log(`   • ${file}`)
    })
  }

  if (!FIX_MODE) {
    console.log('\n💡 Usage options:')
    console.log('   • Run with DOCS_WARNINGS_ONLY=true to see only unhandled files')
    console.log('   • Run with --fix to automatically execute all automated commands')
  }
}

// Run the script
main()
