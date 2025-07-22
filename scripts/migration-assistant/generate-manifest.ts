import fs from 'fs/promises'
import path from 'path'
import { z } from 'zod'

const PROPOSAL_PATH = path.join(process.cwd(), './proposal.md')
const OUTPUT_PATH = path.join(process.cwd(), './public/manifest.proposal.json')

// Convert to lowercase and replace spaces with hyphens
const slugify = (str: string) =>
  str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

// Type definition for the parsing state
type ParseState = {
  navigation: Manifest
  currentTopLevelGroup: ManifestGroup | null
  currentTopLevelCustomSlug: string | null
  currentSubGroup: ManifestGroup | null
  currentSubGroupCustomSlug: string | null
  currentItemGroup: (ManifestItem | ManifestGroup)[]
  pathStack: string[]
}

// Pure utility function - only needs text input
const parseBracketSyntax = (text: string): { title: string; customSlug: string | null } => {
  const bracketMatch = text.match(/^(.+?)\s*\[([^\]]+)\]$/)
  if (bracketMatch) {
    return {
      title: bracketMatch[1].trim(),
      customSlug: bracketMatch[2].trim(),
    }
  }
  return {
    title: text.trim(),
    customSlug: null,
  }
}

// Only needs the relevant group data
const addItemGroupToSubGroup = (
  currentItemGroup: (ManifestItem | ManifestGroup)[],
  currentSubGroup: ManifestGroup | null,
): ManifestGroup | null => {
  if (currentItemGroup.length > 0 && currentSubGroup) {
    return {
      ...currentSubGroup,
      items: [...currentSubGroup.items, [...currentItemGroup]],
    }
  }
  return currentSubGroup
}

// Only needs the relevant group data
const addSubGroupToTopLevel = (
  currentSubGroup: ManifestGroup | null,
  currentTopLevelGroup: ManifestGroup | null,
): ManifestGroup | null => {
  if (currentSubGroup && currentTopLevelGroup) {
    return {
      ...currentTopLevelGroup,
      items: [...currentTopLevelGroup.items, [currentSubGroup]],
    }
  }
  return currentTopLevelGroup
}

// Only needs navigation array and top level group
const addTopLevelGroupToNavigation = (navigation: Manifest, currentTopLevelGroup: ManifestGroup | null): Manifest => {
  if (currentTopLevelGroup) {
    return [...navigation, [currentTopLevelGroup]]
  }
  return navigation
}

// Pure function - only needs the specific data it operates on
const findOrCreateParentContainer = (
  currentItemGroup: (ManifestItem | ManifestGroup)[],
  targetLevel: number,
): (ManifestItem | ManifestGroup)[] => {
  if (targetLevel === 0) {
    return currentItemGroup
  }

  let currentContainer = currentItemGroup
  if (!currentContainer || currentContainer.length === 0) {
    return []
  }

  for (let level = 1; level <= targetLevel; level++) {
    const parentItem = currentContainer[currentContainer.length - 1]
    if (!parentItem) {
      return []
    }

    // Convert the parent item to a group if it's not already one
    if (!('items' in parentItem)) {
      // Transform ManifestItem to ManifestGroup, preserving the href
      const newGroup: ManifestGroup = {
        title: parentItem.title,
        href: parentItem.href, // Preserve the original href
        items: [[]],
        collapse: true,
      }
      // Replace the item in the container
      currentContainer[currentContainer.length - 1] = newGroup
    }

    // Now we know it's a ManifestGroup
    const parentGroup = currentContainer[currentContainer.length - 1] as ManifestGroup
    if (!parentGroup.items || parentGroup.items.length === 0) {
      parentGroup.items = [[]]
    }

    const lastSubGroup = parentGroup.items[parentGroup.items.length - 1]
    currentContainer = lastSubGroup
  }

  return currentContainer
}

// Calculate indentation level - pure function
const calculateIndentLevel = (line: string): number => {
  const leadingSpaces = line.length - line.trimStart().length
  return Math.floor(leadingSpaces / 2)
}

// Update path stack - pure function
const updatePathStack = (currentPathStack: string[], indentLevel: number, itemSlug: string): string[] => {
  return [...currentPathStack.slice(0, indentLevel), itemSlug]
}

// Create navigation item - pure function
const createNavigationItem = (
  title: string,
  itemSlug: string,
  subGroupTitle?: string,
  subGroupCustomSlug?: string,
): ManifestItem => ({
  title,
  href: generateHref(title, subGroupTitle, undefined, undefined, itemSlug, subGroupCustomSlug),
})

// Simplified function to add items to the current group
const addItemToContainer = (
  currentItemGroup: (ManifestItem | ManifestGroup)[],
  newItem: ManifestItem | ManifestGroup,
  indentLevel: number,
): (ManifestItem | ManifestGroup)[] => {
  // For most cases, items should be added directly to the current group
  if (indentLevel === 0) {
    return [...currentItemGroup, newItem]
  }

  // Only use complex nesting for actually indented items
  const targetContainer = findOrCreateParentContainer(currentItemGroup, indentLevel)
  const newCurrentItemGroup = [...currentItemGroup]

  if (targetContainer) {
    targetContainer.push(newItem)
  }

  return newCurrentItemGroup
}

// Compose the finishing operations
const finishAllGroups = (
  currentItemGroup: (ManifestItem | ManifestGroup)[],
  currentSubGroup: ManifestGroup | null,
  currentTopLevelGroup: ManifestGroup | null,
  navigation: Manifest,
) => {
  let updatedSubGroup = addItemGroupToSubGroup(currentItemGroup, currentSubGroup)
  let updatedTopLevelGroup = currentTopLevelGroup

  // If there's no subsection but we have items and a top-level group,
  // add the items directly to the top-level group
  if (!updatedSubGroup && currentItemGroup.length > 0 && currentTopLevelGroup) {
    updatedTopLevelGroup = {
      ...currentTopLevelGroup,
      items: [...currentTopLevelGroup.items, [...currentItemGroup]],
    }
  } else {
    updatedTopLevelGroup = addSubGroupToTopLevel(updatedSubGroup, currentTopLevelGroup)
  }

  const updatedNavigation = addTopLevelGroupToNavigation(navigation, updatedTopLevelGroup)

  return {
    navigation: updatedNavigation,
    currentTopLevelGroup: null,
    currentTopLevelCustomSlug: null,
    currentSubGroup: null,
    currentSubGroupCustomSlug: null,
    currentItemGroup: [],
    pathStack: [],
  }
}

// Handle different line types
const processTopLevelSection = (state: ParseState, line: string): ParseState => {
  const finishedState = finishAllGroups(
    state.currentItemGroup,
    state.currentSubGroup,
    state.currentTopLevelGroup,
    state.navigation,
  )

  const { title, customSlug } = parseBracketSyntax(line.substring(3))
  const itemSlug = customSlug || slugify(title)

  // Generate href for the top-level group
  const href = generateHref(title, undefined, undefined, undefined, itemSlug, customSlug || undefined)

  return {
    ...finishedState,
    currentTopLevelGroup: { title, href, items: [] },
    currentTopLevelCustomSlug: customSlug,
  }
}

const processSubSection = (state: ParseState, line: string): ParseState => {
  const updatedSubGroup = addItemGroupToSubGroup(state.currentItemGroup, state.currentSubGroup)
  const updatedTopLevelGroup = addSubGroupToTopLevel(updatedSubGroup, state.currentTopLevelGroup)

  const { title, customSlug } = parseBracketSyntax(line.substring(4))
  const itemSlug = customSlug || slugify(title)

  // Generate href for the subsection group (without parent section in URL)
  const href = generateHref(
    title,
    undefined, // Don't include parent section in subsection URLs
    undefined,
    undefined,
    itemSlug,
    customSlug || undefined,
  )

  return {
    ...state,
    currentTopLevelGroup: updatedTopLevelGroup,
    currentSubGroup: { title, href, items: [] },
    currentSubGroupCustomSlug: customSlug,
    currentItemGroup: [],
    pathStack: [],
  }
}

const processListItem = (state: ParseState, line: string): ParseState => {
  const trimmed = line.trim()
  // Calculate actual indentation (most items under subsections should be level 0)
  const lineIndent = calculateIndentLevel(line)
  // For items directly under subsections (###), treat as level 0
  const indentLevel = lineIndent <= 2 ? 0 : lineIndent - 2

  const { title, customSlug } = parseBracketSyntax(trimmed.substring(2))
  const itemSlug = customSlug || slugify(title)

  const newPathStack = updatePathStack(state.pathStack, indentLevel, itemSlug)

  // Determine the context for href generation
  // If we have a currentSubGroup, use that; otherwise use the top-level group
  const contextTitle = state.currentSubGroup?.title || state.currentTopLevelGroup?.title
  const contextSlug = state.currentSubGroupCustomSlug || state.currentTopLevelCustomSlug

  const newItem = createNavigationItem(title, itemSlug, contextTitle, contextSlug || undefined)
  const newCurrentItemGroup = addItemToContainer(state.currentItemGroup, newItem, indentLevel)

  return {
    ...state,
    currentItemGroup: newCurrentItemGroup,
    pathStack: newPathStack,
  }
}

const processLine = (state: ParseState, line: string): ParseState => {
  const trimmed = line.trim()

  if (!trimmed || trimmed === '# Top Level Links') {
    return state
  }

  if (trimmed.startsWith('## ')) {
    return processTopLevelSection(state, trimmed)
  }

  if (trimmed.startsWith('### ')) {
    return processSubSection(state, trimmed)
  }

  if (trimmed.startsWith('- ')) {
    return processListItem(state, line)
  }

  return state
}

/**
 * Functional Programming version - Parse markdown content using pure functions with minimal parameters
 * @param {string} content - The markdown content
 * @returns {Object} - Object containing navigation structure
 */
function parseMarkdownToManifest(content: string): { navigation: Manifest } {
  const finalState = content.split('\n').reduce(processLine, {
    navigation: [],
    currentTopLevelGroup: null,
    currentTopLevelCustomSlug: null,
    currentSubGroup: null,
    currentSubGroupCustomSlug: null,
    currentItemGroup: [],
    pathStack: [],
  } as ParseState)

  const { navigation } = finishAllGroups(
    finalState.currentItemGroup,
    finalState.currentSubGroup,
    finalState.currentTopLevelGroup,
    finalState.navigation,
  )

  return { navigation }
}

/**
 * Generate href from title and context
 * @param {string} title - The item title
 * @param {string} topLevel - The section title (formerly subsection)
 * @param {string} section - Unused (kept for backward compatibility)
 * @param {string} manifestKey - The manifest key for separate manifests
 * @param {string} customSlug - The custom slug for the item
 * @param {string} topLevelCustomSlug - The custom slug for the top-level section
 * @returns {string} - The generated href
 */
function generateHref(
  title: string,
  topLevel?: string,
  section?: string,
  manifestKey?: string,
  customSlug?: string,
  topLevelCustomSlug?: string,
) {
  let href = '/docs'

  // If this is a separate manifest, use the manifest key as the base path
  if (manifestKey) {
    href += `/${manifestKey}`
  }

  // Add the section path (what used to be subsection, now top-level)
  if (topLevel) {
    // Use custom slug if provided, otherwise slugify the title
    const sectionSlug = topLevelCustomSlug || slugify(topLevel)
    href += `/${sectionSlug}`
  }

  // Use custom slug for the item if provided, otherwise slugify the title
  const itemSlug = customSlug || slugify(title)
  href += `/${itemSlug}`

  return href
}

export type ManifestItem = {
  title: string
  href: string
}

export type ManifestGroup = {
  title: string
  href?: string
  items: Manifest
  collapse?: boolean
}

export type Manifest = (ManifestItem | ManifestGroup)[][]

const manifestItem: z.ZodType<ManifestItem> = z
  .object({
    title: z.string(),
    href: z.string(),
  })
  .strict()

const manifestGroup: z.ZodType<ManifestGroup> = z
  .object({
    title: z.string(),
    href: z.string().optional(),
    items: z.lazy(() => manifestSchema),
    collapse: z.boolean().optional(),
  })
  .strict()

const manifestSchema: z.ZodType<Manifest> = z.array(z.array(z.union([manifestItem, manifestGroup])))

/**
 * Validate the manifest against the schema
 * @param {Object} manifest - The manifest to validate
 * @returns {boolean} - Whether the manifest is valid
 */
function validateManifest(manifest: object) {
  const result = z.object({ navigation: manifestSchema }).safeParse(manifest)

  if (!result.success) {
    console.error('Validation errors:')
    console.error(result.error.errors)
    return false
  }

  return true
}

/**
 * Main function to generate the manifest
 */
async function generateManifest() {
  console.log('🚀 Starting manifest generation...')

  // Read the ia-proposal.md file
  const proposalContent = await fs.readFile(PROPOSAL_PATH, 'utf-8')
  console.log(`✅ Read ${PROPOSAL_PATH}`)

  // Parse markdown to multiple navigation structures
  const manifest = parseMarkdownToManifest(proposalContent)
  console.log('✅ Parsed markdown structure')

  // Validate manifest against schema
  if (!validateManifest(manifest)) {
    console.error('❌ Manifest validation failed')
    process.exit(1)
  }
  console.log('✅ Main manifest validation passed')

  // Write the main manifest.new.json file
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(manifest))
  console.log('✅ Written manifest.proposal.json')
}

async function watchAndRebuild() {
  const { argv } = process

  if (argv.includes('--watch')) {
    const watcher = fs.watch(PROPOSAL_PATH)
    for await (const event of watcher) {
      generateManifest()
    }
  }
}

// Run the bootstrap if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  generateManifest()
  watchAndRebuild()
}
