import fs from 'fs/promises'
import path from 'path'
import { z } from 'zod'

const PROPOSAL_PATH = path.join(process.cwd(), './proposal.md')
const OUTPUT_PATH = path.join(process.cwd(), './public/manifest.proposal.json')

/**
 * Parse title and custom slug from text
 * Supports formats like:
 * - "Title [slug]"
 * - "Title"
 * Parentheses are treated as part of the title.
 */
function parseTextWithSlug(text: string): {
  title: string
  customSlug: string | null
} {
  // Match pattern: Title [slug]
  const match = text.match(/^(.+?)(?:\s*\[([^\]]+)\])?$/)

  if (!match) {
    return { title: text.trim(), customSlug: null }
  }

  const [, titlePart, slugPart] = match
  const title = titlePart.trim()
  const customSlug = slugPart?.trim()

  return {
    title,
    customSlug: customSlug || null,
  }
}

/**
 * Extract a trailing JSON object from the end of a line of text.
 * Example: "My Title {\"abc\":\"xyz\"}" -> { baseText: "My Title", extraProps: { abc: "xyz" } }
 */
function extractTrailingJson(text: string): { baseText: string; extraProps: Record<string, unknown> | null } {
  const trimmedText = text.trim()
  // Quick exit if it doesn't end with a closing brace
  if (!trimmedText.endsWith('}')) {
    return { baseText: text, extraProps: null }
  }

  // Find the last opening brace and try to parse from there
  const lastOpenIndex = trimmedText.lastIndexOf('{')
  if (lastOpenIndex === -1) {
    return { baseText: text, extraProps: null }
  }

  const possibleJson = trimmedText.slice(lastOpenIndex)
  try {
    const parsed = JSON.parse(possibleJson)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const baseText = trimmedText.slice(0, lastOpenIndex).trim()
      return { baseText, extraProps: parsed as Record<string, unknown> }
    }
    return { baseText: text, extraProps: null }
  } catch {
    // Not valid JSON – ignore silently and fall back to original text
    return { baseText: text, extraProps: null }
  }
}

// Convert to lowercase and replace spaces with hyphens
const slugify = (str: string) =>
  str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

/**
 * Parse markdown content and convert to a single navigation structure
 * @param {string} content - The markdown content
 * @returns {Object} - Object containing navigation structure
 */
function parseMarkdownToManifest(content: string) {
  const lines = content.split('\n')
  const navigation: any[] = []
  const topLevelLinksMap = new Map<string, { icon?: string; customSlug?: string }>() // Store top-level links info
  let currentTopLevelGroup: { title: string; items: any[] } | null = null
  let currentTopLevelCustomSlug: string | null = null
  let currentSubGroup: { title: string; items: any[] } | null = null
  let currentSubGroupCustomSlug: string | null = null
  let currentItemGroup: any[] = []
  let pathStack: string[] = [] // Stack to track nested path components
  let inTopLevelLinksSection = false // Track if we're in the Top Level Links section

  const finishCurrentItemGroup = () => {
    if (currentItemGroup && currentItemGroup.length > 0) {
      if (currentSubGroup) {
        currentSubGroup.items.push([...currentItemGroup])
      }
      currentItemGroup = []
    }
  }

  const finishCurrentSubGroup = () => {
    finishCurrentItemGroup()
    if (currentSubGroup && currentTopLevelGroup) {
      currentTopLevelGroup.items.push([currentSubGroup])
      currentSubGroup = null
    }
    currentSubGroupCustomSlug = null
  }

  const finishCurrentTopLevelGroup = () => {
    finishCurrentSubGroup()
    if (currentTopLevelGroup) {
      navigation.push([currentTopLevelGroup])
      currentTopLevelGroup = null
    }
    currentTopLevelCustomSlug = null
    pathStack = []
  }

  for (const line of lines) {
    const trimmed = line.trim()

    // Skip empty lines
    if (!trimmed) continue

    // Handle the "Top Level Links" section
    if (trimmed === '# Top Level Links') {
      inTopLevelLinksSection = true
      continue
    }

    // Exit Top Level Links section when we hit a new section
    if (inTopLevelLinksSection && (trimmed.startsWith('## ') || trimmed.startsWith('# '))) {
      inTopLevelLinksSection = false
    }

    // Process Top Level Links items
    if (inTopLevelLinksSection && trimmed.startsWith('- ')) {
      const rawTopLinkText = trimmed.substring(2)
      const { baseText: titleWithIconAndSlug, extraProps } = extractTrailingJson(rawTopLinkText)
      const { title, customSlug } = parseTextWithSlug(titleWithIconAndSlug)

      // Determine icon: prefer JSON's icon
      let finalIcon: string | undefined
      const jsonIcon = (extraProps && typeof extraProps.icon === 'string' ? (extraProps.icon as string) : undefined) as
        | string
        | undefined
      if (jsonIcon) {
        finalIcon = jsonIcon
      }

      // Store top-level link info for later merging with sections
      topLevelLinksMap.set(title, {
        icon: finalIcon || undefined,
        customSlug: customSlug || undefined,
      })
      continue
    }

    // Top level sections (## Header) - these become top-level groups
    if (trimmed.startsWith('## ')) {
      finishCurrentTopLevelGroup()
      const rawHeaderText = trimmed.substring(3)
      const { baseText: titleWithIconAndSlug, extraProps } = extractTrailingJson(rawHeaderText)
      const { title, customSlug } = parseTextWithSlug(titleWithIconAndSlug)

      currentTopLevelGroup = {
        title,
        items: [],
      }

      // If icon provided via JSON, set it
      if (extraProps && typeof extraProps.icon === 'string') {
        const jsonIcon = extraProps.icon as string
        ;(currentTopLevelGroup as any).icon = jsonIcon
      }

      currentTopLevelCustomSlug = customSlug
      currentSubGroup = null
      currentItemGroup = []
      pathStack = []
      continue
    }

    // Subsections (### Header) - these become sub-groups within top-level groups
    if (trimmed.startsWith('### ')) {
      finishCurrentSubGroup()
      const rawHeaderText = trimmed.substring(4)
      const { baseText: titleWithIconAndSlug, extraProps } = extractTrailingJson(rawHeaderText)
      const { title, customSlug } = parseTextWithSlug(titleWithIconAndSlug)

      currentSubGroup = {
        title,
        items: [],
      }

      // If icon provided via JSON, set it
      if (extraProps && typeof extraProps.icon === 'string') {
        const jsonIcon = extraProps.icon as string
        ;(currentSubGroup as any).icon = jsonIcon
      }

      currentSubGroupCustomSlug = customSlug
      currentItemGroup = []
      pathStack = []
      continue
    }

    // List items (- Item) - handle indentation levels
    if (trimmed.startsWith('- ')) {
      // Calculate indentation level (number of leading spaces before the -)
      const leadingSpaces = line.length - line.trimStart().length
      const indentLevel = Math.floor(leadingSpaces / 2) // Assuming 2 spaces per indent level

      const rawItemText = trimmed.substring(2)
      // Support optional trailing JSON blob that should be merged into the item
      const { baseText: titleWithIconAndSlug, extraProps } = extractTrailingJson(rawItemText)
      // Parse slug syntax for list items
      const { title, customSlug } = parseTextWithSlug(titleWithIconAndSlug)

      // Update pathStack based on indentation level
      // Keep only the path components for levels above the current one
      pathStack = pathStack.slice(0, indentLevel)

      // Add current item to pathStack
      const itemSlug = customSlug || slugify(title)
      pathStack.push(itemSlug)

      // Helper function to find or create a parent container at a specific nesting level
      const findOrCreateParentContainer = (targetLevel: number): any[] => {
        if (targetLevel === 0) {
          // Level 0: return the current item group
          if (!currentItemGroup) {
            currentItemGroup = []
          }
          return currentItemGroup
        }

        // For nested levels, navigate through the structure
        let currentContainer = currentItemGroup
        if (!currentContainer || currentContainer.length === 0) {
          return []
        }

        // Navigate through each level of nesting
        for (let level = 1; level <= targetLevel; level++) {
          const parentItem = currentContainer[currentContainer.length - 1]

          if (!parentItem) {
            return []
          }

          // Convert the parent item to a group if it's not already one
          if (!parentItem.items) {
            parentItem.items = [[]]
            // Only set default collapse if not explicitly set via JSON
            if (typeof parentItem.collapse === 'undefined') {
              parentItem.collapse = true
            }
            delete parentItem.href // Groups don't have hrefs
          }

          // Get the last sub-group within this parent
          const lastSubGroup = parentItem.items[parentItem.items.length - 1]
          currentContainer = lastSubGroup
        }

        return currentContainer
      }

      // Create the new item
      const newItem: any = {
        title,
        href: generateHref(
          title,
          currentTopLevelGroup?.title,
          currentSubGroup?.title,
          itemSlug,
          currentTopLevelCustomSlug || undefined,
          currentSubGroupCustomSlug || undefined,
          pathStack.slice(0, -1), // Pass all parent path segments except the current item
        ),
      }

      // Icon can only come from trailing JSON

      // Merge any extra properties parsed from the trailing JSON
      if (extraProps) {
        // If icon provided via JSON, set it
        if (typeof extraProps.icon === 'string') {
          const jsonIcon = extraProps.icon as string
          newItem.icon = jsonIcon
        }

        Object.assign(newItem, extraProps)
      }

      // Find the appropriate container for this indentation level
      const targetContainer = findOrCreateParentContainer(indentLevel)

      // Add the item to the target container
      if (targetContainer) {
        targetContainer.push(newItem)
      }
    }
  }

  // Finish any remaining content
  finishCurrentTopLevelGroup()

  // Merge top-level link info (icons, custom slugs) with section groups
  const finalNavigation = navigation.map((navGroup) => {
    const group = navGroup[0]
    if (group && group.title) {
      const topLevelInfo = topLevelLinksMap.get(group.title)
      if (topLevelInfo && topLevelInfo.icon) {
        group.icon = topLevelInfo.icon
      }
    }
    return navGroup
  })

  return {
    navigation: finalNavigation,
  }
}

/**
 * Generate href from title and context
 * @param {string} title - The item title
 * @param {string} topLevel - The top-level group title
 * @param {string} subLevel - The sub-level group title
 * @param {string} customSlug - The custom slug for the item
 * @param {string} topLevelCustomSlug - The custom slug for the top-level group
 * @param {string} subLevelCustomSlug - The custom slug for the sub-level group
 * @param {string[]} parentPathSegments - Array of parent path segments for nested items
 * @returns {string} - The generated href
 */
function generateHref(
  title: string,
  _topLevel?: string,
  subLevel?: string,
  customSlug?: string,
  topLevelCustomSlug?: string,
  subLevelCustomSlug?: string,
  parentPathSegments?: string[],
) {
  let href = '/docs'
  let topLevel = _topLevel

  // Special case for Home section - use root path
  if (topLevel === 'Home') {
    topLevel = ''
  }

  // Add the top-level group path
  if (topLevel) {
    const topLevelSlug = topLevelCustomSlug || slugify(topLevel)
    href += `/${topLevelSlug}`
  }

  // Add the sub-level group path
  if (subLevel) {
    const subLevelSlug = subLevelCustomSlug || slugify(subLevel)
    href += `/${subLevelSlug}`
  }

  // Add any nested parent path segments (for deeply nested items)
  if (parentPathSegments && parentPathSegments.length > 0) {
    for (const segment of parentPathSegments) {
      href += `/${segment}`
    }
  }

  // Use custom slug for the item if provided, otherwise slugify the title
  const itemSlug = customSlug || slugify(title)
  href += `/${itemSlug}`

  return href
}

export type ManifestItem = {
  title: string
  href: string
  icon?: string
}

export type ManifestGroup = {
  title: string
  items: Manifest
  collapse?: boolean
  icon?: string
}

export type Manifest = (ManifestItem | ManifestGroup)[][]

const manifestItem: z.ZodType<ManifestItem> = z
  .object({
    title: z.string(),
    href: z.string(),
    icon: z.string().optional(),
  })
  .passthrough()

const manifestGroup: z.ZodType<ManifestGroup> = z
  .object({
    title: z.string(),
    items: z.lazy(() => manifestSchema),
    collapse: z.boolean().optional(),
    icon: z.string().optional(),
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
