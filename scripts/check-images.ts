import fs from 'node:fs'
import { glob } from 'node:fs/promises'
import {
  extractExplicitAssetReferences,
  resolvePreviewAssetReferencesWithIssue,
  type PreviewIssueReason,
} from './lib/image-reference-resolver'

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

Reference rules:
  - Explicit asset paths like /docs/images/...
  - docs/**/*.mdx frontmatter preview.src values mapped to /docs/images/ui-components/<slug>.<ext>
  - preview.src values that do not resolve to an image are shown as warnings
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
  previewWarnings: PreviewWarning[]
}

interface PreviewWarning {
  file: string
  previewSrc: string
  reason: PreviewIssueReason
}

function addReference(
  referenceMap: Map<string, string[]>,
  references: Set<string>,
  assetPath: string,
  file: string,
): void {
  references.add(assetPath)

  if (!referenceMap.has(assetPath)) {
    referenceMap.set(assetPath, [])
  }

  if (!referenceMap.get(assetPath)!.includes(file)) {
    referenceMap.get(assetPath)!.push(file)
  }
}

async function getAssetReferences(publicAssets: string[]): Promise<AssetReferences> {
  const references = new Set<string>()
  const referenceMap = new Map<string, string[]>()
  const previewWarnings: PreviewWarning[] = []
  const publicAssetsSet = new Set(publicAssets)

  for await (const entry of glob(`${DOCS_DIR}/**/*.{md,mdx}`)) {
    const file = entry.toString()
    const content = fs.readFileSync(file, 'utf8')
    const explicitReferences = extractExplicitAssetReferences(content)
    for (const assetPath of explicitReferences) {
      addReference(referenceMap, references, assetPath, file)
    }

    if (file.endsWith('.mdx')) {
      const previewResolution = resolvePreviewAssetReferencesWithIssue(content, publicAssetsSet)

      for (const assetPath of previewResolution.references) {
        addReference(referenceMap, references, assetPath, file)
      }

      if (previewResolution.issue) {
        previewWarnings.push({
          file,
          previewSrc: previewResolution.issue.previewSrc,
          reason: previewResolution.issue.reason,
        })
      }
    }
  }

  return {
    references: Array.from(references).sort(),
    referenceMap,
    previewWarnings,
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
    const { references: docReferences, referenceMap, previewWarnings } = await getAssetReferences(publicAssets)
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

    if (previewWarnings.length > 0) {
      log('yellow', '⚠ Unresolved preview.src image mappings:')
      for (const warning of previewWarnings) {
        if (warning.reason === 'invalid-src') {
          log('yellow', `${warning.previewSrc} (invalid preview.src format)`, 2)
        } else {
          log('yellow', `${warning.previewSrc} (no matching image in public/images/ui-components/)`, 2)
        }
        log('gray', `referenced in ${warning.file}`, 3)
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
