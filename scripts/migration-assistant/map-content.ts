import 'dotenv/config'
import { readFile, access } from 'fs/promises'
import { glob } from 'glob'
import { join, relative } from 'path'
import type { Manifest } from './generate-manifest'

// Path to the docs directory and mapping file
const MAPPING_PATH = join(process.cwd(), './proposal-mapping.json')
const MANIFEST_PROPOSAL_PATH = join(process.cwd(), './public/manifest.proposal.json')
const MANIFEST_PATH = join(process.cwd(), './public/manifest.json')
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

  console.log('📋 PROPOSAL MAPPING TASKS:\n')

  // Consolidate move tasks into patterns
  const { patterns, individual: individualMoves } = consolidateMoveTasks(moveTasks)

  // Group consolidation tasks by destination
  const consolidationGroups = groupConsolidationTasks(consolidateTasks)

  let taskNumber = 1

  // Show consolidated move patterns first
  if (patterns.length > 0) {
    console.log('🚀 BATCH MOVE COMMANDS (using glob patterns):\n')

    patterns.forEach((pattern) => {
      const paddedNumber = taskNumber.toString().padStart(3, '0')
      console.log(
        `${paddedNumber}. 📁 [BATCH MOVE] ${pattern.files.length} files: ${pattern.pattern} → ${pattern.destPattern}`,
      )
      console.log(`     ${pattern.command}`)
      console.log(`     Files: ${pattern.files.map((f) => f.source).join(', ')}`)
      console.log('')
      taskNumber++
    })

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
      console.log('')
      taskNumber++
    })

    console.log('─'.repeat(80) + '\n')
  }

  // Add individual move tasks to allTasks
  individualMoves.forEach((move) => {
    allTasks.push({ source: move.source, destination: move.destination, action: 'move' })
  })

  // Sort all remaining tasks by source path
  allTasks.sort((a, b) => a.source.localeCompare(b.source))

  // Display individual tasks
  allTasks.forEach((task) => {
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

    // Show the executable command if available
    if (task.action === 'move') {
      const sourcePath = `/docs/${task.source.replace(/\.mdx$/, '')}`
      const destPath = task.destination.startsWith('/docs/')
        ? task.destination.replace(/\.mdx$/, '')
        : `/docs${task.destination.replace(/\.mdx$/, '')}`
      console.log(`     node scripts/move-doc.mjs ${sourcePath} ${destPath}`)
    } else if (task.action === 'delete') {
      const filePath = `docs/${task.source}`
      console.log(`     rm ${filePath}`)
    }

    // Add a line break between tasks
    console.log('')
    taskNumber++
  })

  // Show summary
  const totalMapped = Object.keys(expandedMapping).length
  const totalFiles = mdxFiles.length
  const unmappedCount = totalFiles - totalMapped
  const batchMoveFiles = patterns.reduce((sum, pattern) => sum + pattern.files.length, 0)
  const individualMoveFiles = individualMoves.length
  const consolidationFiles = consolidateTasks.length
  const remainingTasks = patterns.length + consolidationGroups.length + allTasks.length

  console.log(`\n📊 SUMMARY:`)
  console.log(`   • Total legacy files: ${totalFiles}`)
  console.log(`   • Files with mappings: ${totalMapped}`)
  console.log(`   • Unmapped files: ${unmappedCount}`)
  if (skippedCount > 0) {
    console.log(`   • ✅ Completed tasks (skipped): ${skippedCount}`)
  }
  console.log(
    `   • Remaining tasks: ${remainingTasks} (${patterns.length} batch + ${consolidationGroups.length} consolidation + ${allTasks.length} individual)`,
  )

  // Show action counts
  const actionCounts: Record<string, number> = {}
  allTasks.forEach((task) => {
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
  const [mdxFiles, mapping, { paths: manifestPaths }] = await Promise.all([
    findMdxFiles(DOCS_PATH),
    readMapping(),
    readProposalManifestPaths(),
  ])

  // Expand glob patterns in mapping to actual file matches
  const expandedMapping = expandGlobMapping(mapping, mdxFiles)

  if (WARNINGS_ONLY) {
    const unhandledFiles = findUnhandledFiles(mdxFiles, expandedMapping)
    console.log('🔍 Checking for unhandled legacy files...\n')
    displayUnhandledFilesOnly(unhandledFiles)
    return
  }

  // Show what actions are needed for each mapping
  await displayMappingActions(expandedMapping, mdxFiles)

  // Show unhandled files
  const unhandledFiles = findUnhandledFiles(mdxFiles, expandedMapping)
  if (unhandledFiles.length > 0) {
    console.log(`\n⚠️  UNHANDLED LEGACY FILES (${unhandledFiles.length} files):`)
    console.log(`   These files exist but have no mapping defined:\n`)
    unhandledFiles.sort().forEach((file) => {
      console.log(`   • ${file}`)
    })
  }

  console.log('\n💡 Run with DOCS_WARNINGS_ONLY=true to see only unhandled files')
}

// Run the script
main()
