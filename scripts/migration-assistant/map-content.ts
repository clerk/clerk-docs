import 'dotenv/config'
import { readFile, access } from 'fs/promises'
import { glob } from 'glob'
import { join, relative } from 'path'
import type { Manifest } from './generate-manifest'

/**
 * Migration Assistant - Map Content Script
 *
 * This script validates content mapping configurations against the PROPOSAL manifest structure
 * to ensure that planned migrations move docs in the direction of the proposed new structure.
 *
 * Key features:
 * - Shows migration tasks needed for each mapping
 * - Identifies invalid mappings (destinations not in proposal manifest)
 * - Identifies new pages needed for proposal structure
 * - Identifies unhandled legacy files
 * - Can execute migration commands with --fix flag
 */

// Path to the docs directory and mapping file
const MAPPING_PATH = join(process.cwd(), './proposal-mapping.json')
const MANIFEST_PROPOSAL_PATH = join(process.cwd(), './public/manifest.proposal.json')
const MANIFEST_PATH = join(process.cwd(), './docs/manifest.json')
const DOCS_PATH = join(process.cwd(), './docs')

// Environment variable to control output
const WARNINGS_ONLY = process.env.DOCS_WARNINGS_ONLY === 'true'

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
    console.error(`❌ Error reading mapping.json: ${error instanceof Error ? error.message : String(error)}`)
    return {}
  }
}

type Mapping = Awaited<ReturnType<typeof readMapping>>

/**
 * Convert href path to relative docs path
 */
function hrefToDocsPath(href: string): string {
  return href.replace(/^\/docs\//, '')
}

/**
 * Read all manifest files and extract destination paths
 * @returns {Promise<string[]>} Array of all destination paths from manifests
 */
async function readProposalManifestPaths() {
  const content = await readFile(MANIFEST_PROPOSAL_PATH, 'utf-8')
  const manifest = JSON.parse(content) as { navigation: Manifest }
  return { manifest, paths: parseManifestPaths(manifest) }
}

async function readManifestPaths() {
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
          // Convert /docs/path to path (relative to docs folder)
          manifestPaths.push(hrefToDocsPath(item.href))
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
 * @returns {Promise<string[]>} Array of relative file paths without .mdx extension
 */
async function findMdxFiles(dir: string, baseDir = dir) {
  const files = await glob(`${dir}/**/*.mdx`, { ignore: ['**/_*/**'] })
  return files.map((file) => relative(baseDir, file).replace(/\.mdx$/, ''))
}

/**
 * Check if a file matches a destination glob pattern
 */
function matchesDestinationPattern(filePath: string, destPattern: string): boolean {
  // Convert destination pattern to file format
  let pattern = destPattern

  // Convert glob pattern to regex for matching
  // Important: Replace ** first, then *, to avoid ** being overridden
  const regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape special regex chars
    .replace(/\*\*/g, '___DOUBLESTAR___') // Temporarily replace ** with placeholder
    .replace(/\*/g, '[^/]*') // * matches anything except /
    .replace(/___DOUBLESTAR___/g, '.*') // ** matches anything including /

  return new RegExp(`^${regexPattern}$`).test(filePath)
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
        let destinationFile = value.newPath
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

    return true // This file is truly unhandled
  })
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

    console.log(`❌ Found ${invalidMappings.length} invalid mappings (destinations not in proposal manifest):\n`)

    // Group by destination directory for better readability
    const groupedMappings: Record<string, InvalidMapping> = {}
    invalidMappings.forEach((mapping) => {
      if (!mapping.destination) return // Skip mappings without destinations
      const parts = mapping.destination.split('/')
      const section = parts.length > 1 ? parts[1] : 'root' // guides/[section]/...
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

    console.log(`📝 Found ${pagesToCreate.length} pages that need new content in proposal:\n`)

    // Group by section for better readability
    const groupedPages: Record<string, string[]> = {}
    pagesToCreate.forEach((path) => {
      const parts = path.split('/')
      const section = parts.length > 1 ? parts[1] : 'root' // guides/[section]/...
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
    console.log(
      '✅ All legacy files are handled, all mappings are valid against proposal, and all proposal pages have content sources',
    )
    return
  }

  // Count files that need to be converted to examples
  const convertToExampleFiles = Object.values(expandedMapping).filter(
    (mapping) => mapping.action === 'convert-to-example',
  ).length

  // Count files that will be generated
  const generateFiles = Object.values(expandedMapping).filter((mapping) => mapping.action === 'generate').length

  console.log(
    `\n📊 Summary: ${unhandledFiles.length} unhandled files, ${invalidMappings.length} invalid mappings (against proposal), ${pagesToCreate.length} proposal pages need new content, ${convertToExampleFiles} convert to examples, ${generateFiles} pages need to be generated, ${Object.keys(expandedMapping).length} files mapped`,
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
      return newPathPrefix + matchedPart + newPathSuffix
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
 * Find invalid mapping destinations (mapped to paths that don't exist in proposal manifests)
 * @param {Object} expandedMapping - Expanded mapping configuration
 * @param {string[]} proposalManifestPaths - All paths from proposal manifest files
 * @returns {string[]} Array of invalid mapping destinations
 */
function findInvalidMappings(expandedMapping: Mapping, proposalManifestPaths: string[]) {
  const proposalPathsSet = new Set(proposalManifestPaths)
  const invalidMappings: Array<{ source: string; destination: string; action: string }> = []

  for (const [sourcePath, mapping] of Object.entries(expandedMapping)) {
    // Skip drop actions - they're intentionally removing paths
    // Skip generate actions - they're creating new content that won't exist in manifests yet
    // Skip convert-to-example actions - they're converting to examples that won't exist as specific manifest paths
    if (mapping.action === 'drop' || mapping.action === 'generate' || mapping.action === 'convert-to-example') {
      continue
    }

    if (!proposalPathsSet.has(mapping.newPath)) {
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
 * Find pages that need to be created (in proposal manifest but no mapping source)
 * @param proposalManifestPaths - All paths from proposal manifest files
 * @param mapping - Mapping configuration
 * @returns Array of paths that need new content
 */
function findPagesToCreate(proposalManifestPaths: string[], mapping: Mapping) {
  const mappedDestinations = new Set(Object.values(mapping).map((entry) => entry.newPath))

  // Also collect proposal manifest paths that are explicitly marked for dropping
  const droppedPaths = new Set()
  for (const [key, value] of Object.entries(mapping)) {
    if (value.action === 'drop') {
      droppedPaths.add(key)
    }
  }

  return proposalManifestPaths.filter((path) => !mappedDestinations.has(path) && !droppedPaths.has(path))
}

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
  const icons: Record<string, string> = {
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
    const destParts = task.destination.split('/').filter((p) => p) // Remove empty parts

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
        const expectedDest = `${destBase}/${file.destination.split('/').pop()}`
        return file.source === expectedSource && file.destination === expectedDest
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
    const sourcePath = join(DOCS_PATH, source + '.mdx')

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

    // Construct destination path
    const destinationPath = join(DOCS_PATH, mapping.newPath + '.mdx')

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

  console.log(`📋 PROPOSAL MAPPING TASKS:\n`)

  // Consolidate move tasks into patterns
  const { patterns, individual: individualMoves } = consolidateMoveTasks(moveTasks)

  // Group consolidation tasks by destination
  const consolidationGroups = groupConsolidationTasks(consolidateTasks)

  let taskNumber = 1

  // Show consolidated move patterns first
  if (patterns.length > 0) {
    console.log('🚀 BATCH MOVE COMMANDS (using glob patterns):\n')

    for (const pattern of patterns) {
      const paddedNumber = taskNumber.toString().padStart(3, '0')
      console.log(
        `${paddedNumber}. 📁 [BATCH MOVE] ${pattern.files.length} files: ${pattern.pattern} → ${pattern.destPattern}`,
      )

      console.log(`     Batch move ${pattern.files.length} files using glob patterns`)
      console.log(`     Command: ${pattern.command}`)
      console.log(`     Files: ${pattern.files.map((f) => f.source).join(', ')}`)
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
      console.log(`${paddedNumber}. 🔀 [CONSOLIDATE] Create guide: /docs/${group.destination}`)
      console.log(`     Consolidate content from ${group.count} files:`)
      group.sources.forEach((source) => {
        console.log(`       • ${source}`)
      })
      console.log(`     ⚠️  Manual task: Cannot be automated`)
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
      const sourcePath = task.source
      const destPath = task.destination

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

    // Show the executable command
    if (task.action === 'move') {
      const sourcePath = `/docs/${task.source}`
      const destPath = `/docs/${task.destination}`
      const command = `node scripts/move-doc.mjs ${sourcePath} ${destPath}`

      console.log(`     Move file, update manifest links, update internal links, add redirect`)
      console.log(`     Command: ${command}`)
    } else if (task.action === 'delete') {
      const docPath = `/docs/${task.source}`
      const command = `node scripts/delete-doc.mjs ${docPath}`

      console.log(`     Check for references, remove from manifest, add redirect, delete file`)
      console.log(`     Command: ${command}`)
    } else if (
      task.action === 'move-to-examples' ||
      task.action === 'TODO' ||
      task.action === 'deleted' ||
      task.action === 'drop'
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
}

/**
 * Main function to parse docs content and show mapping actions
 */
async function main() {
  const [mdxFiles, mapping, { paths: proposalManifestPaths }] = await Promise.all([
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

  // Find invalid mappings (against proposal manifest)
  const invalidMappings = findInvalidMappings(expandedMapping, proposalManifestPaths)

  // Find pages that need to be created (from proposal manifest)
  const pagesToCreate = findPagesToCreate(proposalManifestPaths, mapping)

  // Show unhandled files and validation results
  const unhandledFiles = findUnhandledFiles(mdxFiles, mapping, expandedMapping)

  // Show warnings section
  console.log('\n' + '═'.repeat(80) + '\n')
  displayWarnings(unhandledFiles, pagesToCreate, expandedMapping, invalidMappings)

  console.log('\n💡 Usage options:')
  console.log('   • Run with DOCS_WARNINGS_ONLY=true to see only unhandled files')
}

// Run the script
main()
