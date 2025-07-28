import fs from 'fs/promises'
import path from 'path'
import { z } from 'zod'

const PROPOSAL_PATH = path.join(process.cwd(), './proposal.md')
const OUTPUT_PATH = path.join(process.cwd(), './public/manifest.proposal.json')

// Valid icon names from the schema
const VALID_ICONS = [
  'apple',
  'application-2',
  'arrow-up-circle',
  'astro',
  'angular',
  'block',
  'bolt',
  'book',
  'box',
  'c-sharp',
  'chart',
  'checkmark-circle',
  'chrome',
  'clerk',
  'code-bracket',
  'cog-6-teeth',
  'door',
  'elysia',
  'expressjs',
  'globe',
  'go',
  'home',
  'hono',
  'javascript',
  'koa',
  'link',
  'linkedin',
  'lock',
  'nextjs',
  'nodejs',
  'plug',
  'plus-circle',
  'python',
  'react',
  'redwood',
  'remix',
  'react-router',
  'rocket',
  'route',
  'ruby',
  'rust',
  'speedometer',
  'stacked-rectangle',
  'solid',
  'svelte',
  'tanstack',
  'user-circle',
  'user-dotted-circle',
  'vue',
  'x',
  'expo',
  'nuxt',
  'fastify',
] as const

type ValidIcon = (typeof VALID_ICONS)[number]

/**
 * Parse title, icon, and custom slug from text
 * Supports formats like:
 * - "Title (icon) [slug]"
 * - "Title (icon)"
 * - "Title [slug]"
 * - "Title"
 */
function parseTextWithIconAndSlug(text: string): {
  title: string
  icon: ValidIcon | null
  customSlug: string | null
} {
  // Match pattern: Title (icon) [slug] or any combination
  const match = text.match(/^(.+?)(?:\s*\(([^)]+)\))?(?:\s*\[([^\]]+)\])?$/)

  if (!match) {
    return { title: text.trim(), icon: null, customSlug: null }
  }

  const [, titlePart, iconPart, slugPart] = match
  const title = titlePart.trim()
  const icon = iconPart?.trim()
  const customSlug = slugPart?.trim()

  // Validate icon if provided
  const validIcon = icon && VALID_ICONS.includes(icon as ValidIcon) ? (icon as ValidIcon) : null
  if (icon && !validIcon) {
    console.warn(`Warning: Invalid icon "${icon}" for "${title}". Valid icons: ${VALID_ICONS.join(', ')}`)
  }

  return {
    title,
    icon: validIcon,
    customSlug: customSlug || null,
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
      const titleWithIconAndSlug = trimmed.substring(2)
      const { title, icon, customSlug } = parseTextWithIconAndSlug(titleWithIconAndSlug)

      // Store top-level link info for later merging with sections
      topLevelLinksMap.set(title, {
        icon: icon || undefined,
        customSlug: customSlug || undefined,
      })
      continue
    }

    // Top level sections (## Header) - these become top-level groups
    if (trimmed.startsWith('## ')) {
      finishCurrentTopLevelGroup()
      const titleWithIconAndSlug = trimmed.substring(3)
      const { title, icon, customSlug } = parseTextWithIconAndSlug(titleWithIconAndSlug)

      currentTopLevelGroup = {
        title,
        items: [],
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
      const titleWithIconAndSlug = trimmed.substring(4)
      const { title, icon, customSlug } = parseTextWithIconAndSlug(titleWithIconAndSlug)

      currentSubGroup = {
        title,
        items: [],
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

      const titleWithIconAndSlug = trimmed.substring(2)
      // Parse icon and slug syntax for list items
      const { title, icon, customSlug } = parseTextWithIconAndSlug(titleWithIconAndSlug)

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
            parentItem.collapse = true
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
          undefined,
          itemSlug,
          currentTopLevelCustomSlug || undefined,
          currentSubGroupCustomSlug || undefined,
          pathStack.slice(0, -1), // Pass all parent path segments except the current item
        ),
      }

      // Add icon if provided
      if (icon) {
        newItem.icon = icon
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
      if (topLevelInfo) {
        // Add icon from top-level links if available
        if (topLevelInfo.icon) {
          group.icon = topLevelInfo.icon
        }
        // Note: custom slug from top-level links could override section slug if needed
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
 * @param {string} manifestKey - The manifest key for separate manifests
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
  manifestKey?: string,
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

  // If this is a separate manifest, use the manifest key as the base path
  if (manifestKey) {
    href += `/${manifestKey}`
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
  icon?: ValidIcon
}

export type ManifestGroup = {
  title: string
  items: Manifest
  collapse?: boolean
  icon?: ValidIcon
}

export type Manifest = (ManifestItem | ManifestGroup)[][]

const manifestItem: z.ZodType<ManifestItem> = z
  .object({
    title: z.string(),
    href: z.string(),
    icon: z.enum(VALID_ICONS).optional(),
  })
  .strict()

const manifestGroup: z.ZodType<ManifestGroup> = z
  .object({
    title: z.string(),
    items: z.lazy(() => manifestSchema),
    collapse: z.boolean().optional(),
    icon: z.enum(VALID_ICONS).optional(),
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
