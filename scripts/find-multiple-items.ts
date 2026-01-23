/**
 * Script to find objects in manifest.json where the `items` array
 * has more than one child array.
 *
 * Usage: npx ts-node scripts/find-multiple-items.ts
 */

import * as fs from 'fs'
import * as path from 'path'

interface ManifestItem {
  title?: string
  href?: string
  items?: ManifestItem[][]
  [key: string]: unknown
}

interface Match {
  path: string
  title?: string
  childArrayCount: number
  childArraySummaries: string[]
}

function findMultipleItemArrays(
  obj: unknown,
  currentPath: string = 'root',
  matches: Match[] = []
): Match[] {
  if (Array.isArray(obj)) {
    obj.forEach((item, index) => {
      findMultipleItemArrays(item, `${currentPath}[${index}]`, matches)
    })
  } else if (obj && typeof obj === 'object') {
    const record = obj as Record<string, unknown>

    // Check if this object has an 'items' property that is an array
    if (Array.isArray(record.items)) {
      const itemsArray = record.items

      // Count how many child arrays there are
      const childArrays = itemsArray.filter((item) => Array.isArray(item)) as ManifestItem[][]
      const childArrayCount = childArrays.length

      if (childArrayCount > 1) {
        // Get a summary of each child array (first item's title or href)
        const childArraySummaries = childArrays.map((arr, idx) => {
          const firstItem = arr[0]
          if (firstItem) {
            const label = firstItem.title || firstItem.href || '(no title/href)'
            return `  [${idx}]: ${arr.length} item(s), first: "${label}"`
          }
          return `  [${idx}]: empty array`
        })

        matches.push({
          path: currentPath,
          title: typeof record.title === 'string' ? record.title : undefined,
          childArrayCount,
          childArraySummaries,
        })
      }
    }

    // Recurse into all properties
    for (const [key, value] of Object.entries(record)) {
      findMultipleItemArrays(value, `${currentPath}.${key}`, matches)
    }
  }

  return matches
}

function main() {
  const manifestPath = path.join(__dirname, '../docs/manifest.json')

  if (!fs.existsSync(manifestPath)) {
    console.error(`manifest.json not found at: ${manifestPath}`)
    process.exit(1)
  }

  const content = fs.readFileSync(manifestPath, 'utf-8')
  const manifest = JSON.parse(content)

  const matches = findMultipleItemArrays(manifest)

  if (matches.length === 0) {
    console.log('No objects found with items array having more than one child array.')
  } else {
    console.log(`Found ${matches.length} object(s) with multiple child arrays in items:\n`)

    matches.forEach((match, index) => {
      console.log(`${index + 1}. Path: ${match.path}`)
      if (match.title) {
        console.log(`   Title: "${match.title}"`)
      }
      console.log(`   Child arrays: ${match.childArrayCount}`)
      match.childArraySummaries.forEach((summary) => console.log(`   ${summary}`))
      console.log()
    })
  }
}

main()
