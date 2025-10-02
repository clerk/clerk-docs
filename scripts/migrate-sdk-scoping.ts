import fs from 'node:fs/promises'
import path from 'node:path'

// Types
type SDK =
  | 'nextjs'
  | 'react'
  | 'js-frontend'
  | 'chrome-extension'
  | 'expo'
  | 'ios'
  | 'expressjs'
  | 'fastify'
  | 'react-router'
  | 'remix'
  | 'tanstack-react-start'
  | 'go'
  | 'astro'
  | 'nuxt'
  | 'vue'
  | 'ruby'
  | 'js-backend'

interface ManifestItem {
  title: string
  href?: string
  sdk?: SDK[]
  target?: string
}

interface ManifestGroup {
  title: string
  items?: Manifest
  sdk?: SDK[]
}

type Manifest = Array<ManifestItem | ManifestGroup>

interface ManifestRoot {
  navigation: Manifest
}

// Configuration
const BASE_DOCS_LINK = '/docs/'
const MANIFEST_PATH = path.join(__dirname, '../docs/manifest.json')
const DOCS_PATH = path.join(__dirname, '../docs')

// Helper function to traverse the manifest tree and collect SDK scoping
async function traverseManifest(items: Manifest, parentSdk?: SDK[]): Promise<Map<string, SDK[]>> {
  const sdkMap = new Map<string, SDK[]>()

  for (const item of items) {
    // Handle the nested array structure in the manifest
    if (Array.isArray(item)) {
      const childSdks = await traverseManifest(item, parentSdk)
      // Merge child SDKs into our map
      for (const [href, sdk] of childSdks) {
        sdkMap.set(href, sdk)
      }
    } else if ('href' in item && item.href?.startsWith(BASE_DOCS_LINK)) {
      // This is a page item
      const sdk = item.sdk ?? parentSdk
      if (sdk && sdk.length > 0) {
        sdkMap.set(item.href, sdk)
      }
    } else if ('items' in item && item.items) {
      // This is a group item
      const groupSdk = item.sdk ?? parentSdk
      const childSdks = await traverseManifest(item.items, groupSdk)

      // Merge child SDKs into our map
      for (const [href, sdk] of childSdks) {
        sdkMap.set(href, sdk)
      }
    }
  }

  return sdkMap
}

// Helper function to convert href to file path
function hrefToFilePath(href: string): string {
  // Remove /docs/ prefix and add .mdx extension
  const relativePath = href.replace(BASE_DOCS_LINK, '') + '.mdx'
  return path.join(DOCS_PATH, relativePath)
}

// Helper function to update frontmatter with SDK scoping
async function updateFileWithSdk(filePath: string, sdks: SDK[]): Promise<boolean> {
  try {
    const content = await fs.readFile(filePath, 'utf-8')

    // Check if file has frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/m)

    if (!frontmatterMatch) {
      console.warn(`  ⚠️  No frontmatter found in ${path.relative(DOCS_PATH, filePath)}`)
      return false
    }

    const [, frontmatterContent, bodyContent] = frontmatterMatch

    // Check if SDK already exists in frontmatter
    const hasSdkLine = /^sdk:\s*.+$/m.test(frontmatterContent)

    let newFrontmatterContent: string

    if (hasSdkLine) {
      // Replace existing SDK line
      const sdkValue = sdks.length === 1 ? sdks[0] : sdks.join(', ')
      newFrontmatterContent = frontmatterContent.replace(/^sdk:\s*.+$/m, `sdk: ${sdkValue}`)
    } else {
      // Add SDK line after description if it exists, otherwise after title
      const lines = frontmatterContent.split('\n')
      let insertIndex = -1

      // Find where to insert the SDK line
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('description:') || lines[i].match(/^description:\s*>/)) {
          // If there's a multi-line description, find the end
          if (lines[i].includes('>') || lines[i].includes('|')) {
            // Multi-line description, find the end
            let j = i + 1
            while (j < lines.length && (lines[j].startsWith('  ') || lines[j].trim() === '')) {
              j++
            }
            insertIndex = j
          } else {
            insertIndex = i + 1
          }
          break
        } else if (lines[i].startsWith('title:')) {
          insertIndex = i + 1
        }
      }

      if (insertIndex === -1) {
        insertIndex = lines.length
      }

      const sdkValue = sdks.length === 1 ? sdks[0] : sdks.join(', ')
      lines.splice(insertIndex, 0, `sdk: ${sdkValue}`)
      newFrontmatterContent = lines.join('\n')
    }

    const newContent = `---\n${newFrontmatterContent}\n---\n${bodyContent}`
    await fs.writeFile(filePath, newContent, 'utf-8')

    const sdkValue = sdks.length === 1 ? sdks[0] : sdks.join(', ')
    console.log(`  ✓ Updated ${path.relative(DOCS_PATH, filePath)} with SDK: ${sdkValue}`)
    return true
  } catch (error) {
    console.error(`  ❌ Error updating ${path.relative(DOCS_PATH, filePath)}:`, error)
    return false
  }
}

// Main function
async function main() {
  try {
    console.log('🚀 Starting SDK scoping migration...')

    // Read manifest
    console.log('📖 Reading manifest.json...')
    const manifestContent = await fs.readFile(MANIFEST_PATH, 'utf-8')
    const manifest: ManifestRoot = JSON.parse(manifestContent)

    // Extract SDK scoping from manifest
    console.log('🔍 Extracting SDK scoping from manifest...')
    const sdkMap = await traverseManifest(manifest.navigation)

    console.log(`📊 Found ${sdkMap.size} documents with SDK scoping`)

    // Update files
    console.log('✏️  Updating document frontmatter...')
    let updated = 0
    let errors = 0

    for (const [href, sdks] of sdkMap) {
      const filePath = hrefToFilePath(href)

      // Check if file exists
      try {
        await fs.access(filePath)
        const success = await updateFileWithSdk(filePath, sdks)
        if (success) {
          updated++
        } else {
          errors++
        }
      } catch (error) {
        console.warn(`  ⚠️  File not found: ${path.relative(DOCS_PATH, filePath)}`)
        errors++
      }
    }

    console.log('\n📈 Migration Summary:')
    console.log(`  ✅ Successfully updated: ${updated} files`)
    console.log(`  ❌ Errors/warnings: ${errors} files`)
    console.log(`  📝 Total documents processed: ${sdkMap.size}`)

    if (updated > 0) {
      console.log('\n🎉 SDK scoping migration completed successfully!')
      console.log('💡 You can now commit these changes to persist the SDK scoping in frontmatter.')
    }
  } catch (error) {
    console.error('💥 Migration failed:', error)
    process.exit(1)
  }
}

// Run if called directly
if (require.main === module) {
  main()
}

export { main as migrateSdkScoping }
