import fs from 'node:fs'
import { glob } from 'node:fs/promises'

const DOCS_DIR = 'docs'
const PUBLIC_ASSETS_DIR = 'public/images'
const ASSET_EXTENSIONS = ['png', 'jpg', 'jpeg', 'svg', 'gif', 'webp', 'mp4']

const args = process.argv.slice(2)
const fix = args.includes('--fix')

type Color = 'red' | 'green' | 'yellow' | 'blue' | 'gray'

const colorCodes: Record<Color, string> = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  gray: '\x1b[90m',
}

function log(color: Color, message: string, indent = 0): void {
  const padding = '  '.repeat(indent)
  console.log(`${colorCodes[color]}${padding}${message}\x1b[0m`)
}

function showHelp(): void {
  console.log(`
Usage: tsx scripts/check-images.ts [options]

Options:
  --fix        Delete unreferenced assets
  -h, --help   Show this help message

Examples:
  npm run lint:check-images
  npm run lint:check-images -- --fix
`)
}

async function getPublicAssets(): Promise<string[]> {
  const pattern = `${PUBLIC_ASSETS_DIR}/**/*.{${ASSET_EXTENSIONS.join(',')}}`
  const files: string[] = []

  for await (const entry of glob(pattern)) {
    const relativePath = entry.toString().replace('public/', '/docs/')
    files.push(relativePath)
  }

  return files.sort()
}

interface AssetReferences {
  references: string[]
  referenceMap: Map<string, string[]>
}

async function getAssetReferences(): Promise<AssetReferences> {
  const references = new Set<string>()
  const referenceMap = new Map<string, string[]>()

  for await (const entry of glob(`${DOCS_DIR}/**/*.{md,mdx}`)) {
    const file = entry.toString()
    const content = fs.readFileSync(file, 'utf8')

    const assetPathRegex = /\/docs\/images\/[^\s)"'}\]]+/g
    const matches = content.matchAll(assetPathRegex)

    for (const match of matches) {
      let assetPath = match[0].replace(/[,;:]+$/, '')

      if (assetPath.startsWith('/docs/images/')) {
        references.add(assetPath)

        if (!referenceMap.has(assetPath)) {
          referenceMap.set(assetPath, [])
        }
        if (!referenceMap.get(assetPath)!.includes(file)) {
          referenceMap.get(assetPath)!.push(file)
        }
      }
    }
  }

  return {
    references: Array.from(references).sort(),
    referenceMap,
  }
}

interface AssetDifferences {
  unreferenced: string[]
  missing: string[]
}

function findDifferences(publicAssets: string[], docReferences: string[]): AssetDifferences {
  const publicSet = new Set(publicAssets)
  const refSet = new Set(docReferences)

  return {
    unreferenced: publicAssets.filter((asset) => !refSet.has(asset)),
    missing: docReferences.filter((ref) => !publicSet.has(ref)),
  }
}

async function main(): Promise<void> {
  log('blue', 'Checking asset sync...\n')

  try {
    const publicAssets = await getPublicAssets()
    const { references: docReferences, referenceMap } = await getAssetReferences()
    const { unreferenced, missing } = findDifferences(publicAssets, docReferences)

    if (fix && unreferenced.length > 0) {
      log('yellow', `Deleting ${unreferenced.length} unreferenced asset(s)...`)

      for (const asset of unreferenced) {
        const filePath = asset.replace('/docs/', 'public/')
        try {
          fs.unlinkSync(filePath)
          log('gray', `deleted ${filePath}`, 2)
        } catch (err) {
          log('red', `failed to delete ${filePath}: ${(err as Error).message}`, 2)
        }
      }
      console.log()
    }

    const assetCount = fix ? publicAssets.length - unreferenced.length : publicAssets.length
    log('gray', `Found ${assetCount} assets in ${PUBLIC_ASSETS_DIR}`)
    log('gray', `Found ${docReferences.length} unique asset references in ${DOCS_DIR}\n`)

    const hasUnreferenced = !fix && unreferenced.length > 0
    const hasMissing = missing.length > 0

    if (hasUnreferenced) {
      log('yellow', `⚠ Unreferenced assets (in ${PUBLIC_ASSETS_DIR} but not used in docs):`)
      for (const asset of unreferenced) {
        log('yellow', asset.replace('/docs/', 'public/'), 2)
      }
      console.log()
    }

    if (hasMissing) {
      log('red', `✗ Missing assets (referenced in docs but not in ${PUBLIC_ASSETS_DIR}):`)
      for (const ref of missing) {
        log('red', ref, 2)
        if (referenceMap.has(ref)) {
          for (const file of referenceMap.get(ref)!) {
            log('gray', `referenced in ${file}`, 3)
          }
        }
      }
      console.log()
    }

    if (hasUnreferenced || hasMissing) {
      const totalIssues = (hasUnreferenced ? unreferenced.length : 0) + missing.length
      log('red', `✗ Found ${totalIssues} asset sync issue(s)`)

      if (hasUnreferenced) {
        log('gray', `${unreferenced.length} unreferenced asset(s) can be deleted`, 2)
      }
      if (hasMissing) {
        log('gray', `${missing.length} missing asset(s) need to be added or references fixed`, 2)
      }

      process.exit(1)
    } else {
      log('green', '✓ Perfect asset sync!')
      log('gray', `All ${assetCount} assets are properly referenced`, 2)
      log('gray', `All ${docReferences.length} references have corresponding assets`, 2)
      process.exit(0)
    }
  } catch (error) {
    log('red', `Error checking assets: ${(error as Error).message}`)
    process.exit(1)
  }
}

if (args.includes('--help') || args.includes('-h')) {
  showHelp()
  process.exit(0)
}

main()
