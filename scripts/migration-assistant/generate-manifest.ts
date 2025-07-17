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

/**
 * Parse markdown content and convert to a single navigation structure
 * @param {string} content - The markdown content
 * @returns {Object} - Object containing navigation structure
 */
function parseMarkdownToManifest(content: string) {
  const lines = content.split('\n')
  const navigation: any[] = []
  let currentTopLevelGroup: { title: string; items: any[] } | null = null
  let currentTopLevelCustomSlug: string | null = null
  let currentSubGroup: { title: string; items: any[] } | null = null
  let currentSubGroupCustomSlug: string | null = null
  let currentItemGroup: any[] = []
  let pathStack: string[] = [] // Stack to track nested path components

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

    // Skip the "Top Level Links" section and its content
    if (trimmed === '# Top Level Links') {
      continue
    }

    // Top level sections (## Header) - these become top-level groups
    if (trimmed.startsWith('## ')) {
      finishCurrentTopLevelGroup()
      const titleWithBrackets = trimmed.substring(3)
      const bracketMatch = titleWithBrackets.match(/^(.+?)\s*\[([^\]]+)\]$/)

      let title: string, customSlug: string | null
      if (bracketMatch) {
        title = bracketMatch[1].trim()
        customSlug = bracketMatch[2].trim()
      } else {
        title = titleWithBrackets.trim()
        customSlug = null
      }

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
      const titleWithBrackets = trimmed.substring(4)
      const bracketMatch = titleWithBrackets.match(/^(.+?)\s*\[([^\]]+)\]$/)

      let title: string, customSlug: string | null
      if (bracketMatch) {
        title = bracketMatch[1].trim()
        customSlug = bracketMatch[2].trim()
      } else {
        title = titleWithBrackets.trim()
        customSlug = null
      }

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

      const titleWithBrackets = trimmed.substring(2)
      // Parse bracket syntax for list items
      const bracketMatch = titleWithBrackets.match(/^(.+?)\s*\[([^\]]+)\]$/)

      let title: string, customSlug: string | null
      if (bracketMatch) {
        title = bracketMatch[1].trim()
        customSlug = bracketMatch[2].trim()
      } else {
        title = titleWithBrackets.trim()
        customSlug = null
      }

      // Update pathStack based on indentation level
      // Keep only the path components for levels above the current one
      pathStack = pathStack.slice(0, indentLevel)

      // Add current item to pathStack
      const itemSlug = customSlug || slugify(title)
      pathStack.push(itemSlug)

      // If this is a level 0 item (no indentation), it could be either a simple item or a group header
      if (indentLevel === 0) {
        // Initialize item group if needed
        if (!currentItemGroup) {
          currentItemGroup = []
        }

        // Create the content item
        const linkItem = {
          title,
          href: generateHref(
            title,
            currentSubGroup?.title,
            undefined,
            undefined,
            itemSlug,
            currentSubGroupCustomSlug || undefined,
          ),
        }

        // Add item to current group
        currentItemGroup.push(linkItem)
      } else {
        // This is an indented item - we need to find or create a group for it

        // Get the parent item from the current item group
        if (currentItemGroup && currentItemGroup.length > 0) {
          const parentItem = currentItemGroup[currentItemGroup.length - 1]

          // Convert the parent item to a group if it's not already one
          if (!parentItem.items) {
            // Transform the parent from a simple item to a group
            parentItem.items = [[]]
            parentItem.collapse = true
            delete parentItem.href // Groups don't have hrefs
          }

          // Create the sub-item
          const subItem = {
            title,
            href: generateHref(
              title,
              currentSubGroup?.title,
              undefined,
              undefined,
              itemSlug,
              currentSubGroupCustomSlug || undefined,
            ),
          }

          // Add the sub-item to the parent group's items
          const lastSubGroup = parentItem.items[parentItem.items.length - 1]
          lastSubGroup.push(subItem)
        }
      }
    }
  }

  // Finish any remaining content
  finishCurrentTopLevelGroup()

  return {
    navigation,
  }
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
  console.log('✅ Read ia-proposal.md')

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
