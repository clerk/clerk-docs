/**
 * One-shot, deterministic converter: old nested-array manifest (`Array<Array<Item>>`) → the new
 * flat-array format (`{ navigationType, navigation: Item[] }`), plus a per-SDK manifest file for
 * every SDK named in the (at most one) top-level `flatNav` group.
 *
 * Run directly with `bun scripts/migrate-manifest.ts`: reads `docs/manifest.json`, writes
 * `docs/manifest.json` (sectioned, minus the flatNav group) and `docs/manifest.<sdk>.json` (flat,
 * one per SDK named on the flatNav group), each Prettier-formatted.
 *
 * No judgment calls live here — this is a pure, deterministic reshape. SDK group de-duplication
 * across `manifest.<sdk>.json` files is deferred (DOCS-11971). Deleted after the format flip
 * merges.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import prettier from 'prettier'

type OldItem = Record<string, unknown> & { title: string; items?: OldNav; sdk?: string[]; flatNav?: boolean }
type OldNav = OldItem[][]
type OldManifest = { flags?: Record<string, boolean>; navigation: OldNav }

type NewItem = Record<string, unknown> & { title: string; items?: NewItem[]; sdk?: string[] }
export type NewManifest = { navigationType: 'sectioned' | 'flat'; navigation: NewItem[] }

const stripFlatNav = ({ flatNav, ...rest }: OldItem) => rest

/** Recursively concatenates the inner groups of an old-format nav into a single flat array, at every nesting level. */
export function unwrapNav(nav: OldNav): NewItem[] {
  return nav.flat().map((item) => {
    const cleaned = stripFlatNav(item)
    if (item.items) return { ...cleaned, items: unwrapNav(item.items) }
    return cleaned as NewItem
  })
}

const omitSdk = ({ sdk, ...rest }: NewItem) => rest

/**
 * Includes an item in the target SDK's manifest when it has no authored `sdk` field, or its `sdk`
 * list contains the target. Folders recurse; a folder left empty after filtering is dropped
 * entirely (render-time visibility would have hidden it anyway). An `sdk` field that is exactly
 * `[target]` is dropped as redundant — the manifest it now lives in already scopes it.
 */
function filterForSDK(items: NewItem[], target: string): NewItem[] {
  const out: NewItem[] = []
  for (const item of items) {
    if (item.sdk && !item.sdk.includes(target)) continue
    const kept: NewItem = item.sdk && item.sdk.length === 1 && item.sdk[0] === target ? omitSdk(item) : { ...item }
    if (item.items) {
      kept.items = filterForSDK(item.items, target)
      if (kept.items.length === 0) continue
    }
    out.push(kept)
  }
  return out
}

/**
 * Converts an old-format manifest into a sectioned main manifest plus one flat manifest per SDK
 * named on the (at most one) top-level `flatNav` group.
 */
export function migrateManifest(old: OldManifest): { main: NewManifest; sdkManifests: Record<string, NewManifest> } {
  if ('navigationType' in old) throw new Error('manifest is already migrated (navigationType present)')

  // Detect flatNav groups on the ORIGINAL top-level items — unwrapNav strips the flatNav flag, so
  // match by index between the flattened original top level and the unwrapped output.
  const originalTopLevel = old.navigation.flat()
  const unwrapped = unwrapNav(old.navigation)
  const flatIndexes = originalTopLevel.flatMap((item, i) => (item.flatNav === true ? [i] : []))
  if (flatIndexes.length > 1) throw new Error('expected at most one top-level flatNav group')

  const sdkManifests: Record<string, NewManifest> = {}
  let main = unwrapped
  if (flatIndexes.length === 1) {
    const flat = originalTopLevel[flatIndexes[0]]
    if (!flat.sdk || flat.sdk.length === 0) {
      throw new Error(`flatNav group '${flat.title}' has no sdk list; refusing to drop it`)
    }
    main = unwrapped.filter((_, i) => i !== flatIndexes[0])
    const children = unwrapNav(flat.items ?? [])
    for (const sdk of flat.sdk) {
      sdkManifests[sdk] = { navigationType: 'flat', navigation: filterForSDK(children, sdk) }
    }
  }

  return { main: { navigationType: 'sectioned', navigation: main }, sdkManifests }
}

const MANIFEST_PATH = path.join('docs', 'manifest.json')

async function writeFormatted(filePath: string, data: unknown) {
  const config = await prettier.resolveConfig(filePath)
  const formatted = await prettier.format(JSON.stringify(data), { ...config, parser: 'json', filepath: filePath })
  await fs.writeFile(filePath, formatted)
}

async function main() {
  const raw = await fs.readFile(MANIFEST_PATH, 'utf-8')
  const old = JSON.parse(raw) as OldManifest

  let migrated: { main: NewManifest; sdkManifests: Record<string, NewManifest> }
  try {
    migrated = migrateManifest(old)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/already migrated/.test(message)) {
      throw new Error(
        `${message}\nTo re-run: restore the old-format docs/manifest.json from git, delete the generated docs/manifest.<sdk>.json files, then run again.`,
      )
    }
    throw error
  }

  // `flags` stays in the authored main manifest exactly as today.
  await writeFormatted(MANIFEST_PATH, { flags: old.flags, ...migrated.main })

  for (const [sdk, manifest] of Object.entries(migrated.sdkManifests)) {
    await writeFormatted(path.join('docs', `manifest.${sdk}.json`), manifest)
  }
}

// Only run when executed directly (e.g. `bun scripts/migrate-manifest.ts`), not when this module
// is imported by `migrate-manifest.test.ts`. `import.meta.main` is a bun runtime flag not present
// in the Node type defs, hence the cast; a `tsx` invocation doesn't set it, so fall back to
// comparing the resolved script path against argv[1].
const runningUnderBun = (import.meta as { main?: boolean }).main === true
const runningUnderTsx =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])

if (runningUnderBun || runningUnderTsx) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
