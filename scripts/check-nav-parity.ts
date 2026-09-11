#!/usr/bin/env bun
/**
 * Nav parity checker: proves two built `dist/manifest.json`s render the same navigation.
 *
 * The standing use: build a dist before a manifest-affecting change and one after, and prove
 * the change is nav-output-neutral (e.g. a manifest edit that moves groups or changes what a
 * page's frontmatter scopes, or any edit to `build-docs.ts`'s manifest handling).
 *
 * A dist is `{ flags, navigation: { default: { type: 'sectioned', sections }, <sdk>: { type:
 * 'flat', items } } }`. The checker normalizes each dist in to one `NormNode` tree per rendered
 * SDK view and diffs them, after the same folder-first visibility filter the site applies —
 * `sdk` arrays are consumed by that filter and then dropped, surviving only as a `scoped`
 * marker on a `/:sdk:/` href, because that is the one place a residual array can still change
 * what renders. The default tree renders before hydration for readers whose SDK is not in the
 * URL, and its literal `sdk` arrays drive that first paint, so it is compared separately with
 * those arrays kept; a structural or `sdk`-array change to it fails the run unless
 * `--allow-default-change` vouches for it after a browser check (it then prints as a `note:`).
 *
 * Why comparing DATA is enough — and stronger than simulating a render:
 * the sidenav is a pure function of (kind, title, href, order, children) plus the presentation
 * flags (tag/icon/wrap/target/hideTitle), all of which are compared here. `sdk` is not itself
 * part of an SDK view's comparison: it has already done its only remaining job (deciding which
 * nodes are in this view, via the same visibility filter the site runs) by the time a view is
 * normalized, so equal per-view node sets already imply equal
 * `visible(itemSDKs, core, showIfDeprecated)` outcomes for every core, not just one — see the
 * `baseNode` comment for what a residual array can still change.
 *
 * Views, not dist keys: the checker enumerates VALID_SDKS. Enumerating the dist's navigation
 * keys would silently skip nextjs/react/… , which have no keyed entry and render from the
 * default view.
 *
 * Usage: bun scripts/check-nav-parity.ts [--allow-default-change] <dist-manifest.json> <dist-manifest.json>
 */

import fs from 'node:fs'
import { VALID_SDKS } from './lib/schemas'

// Mirrors config.manifestOptions in build-docs.ts: build-docs strips these values before
// writing the dist, so a manifest that spells them out and one that omits them are the
// same nav. Stripping them here too keeps that equivalence on both sides of the diff.
const WRAP_DEFAULT = true
const HIDE_TITLE_DEFAULT = false

export type NormNode = {
  kind: 'section' | 'page' | 'folder' | 'heading'
  title: string
  href?: string
  sdk?: string[]
  tag?: string
  maintainer?: string
  icon?: string
  wrap?: boolean
  target?: string
  hideTitle?: boolean
  scoped?: true
  children?: NormNode[]
}

type RawNode = Record<string, any>
type Dist = { flags?: unknown; navigation: any }

const isFolder = (raw: RawNode) => Array.isArray(raw.items)
const isHeading = (raw: RawNode) => raw.type === 'heading'

const matchesSDK = (raw: RawNode, sdk: string) => !Array.isArray(raw.sdk) || raw.sdk.includes(sdk)

/**
 * `sdk` in a view.
 *
 * An SDK view compares what renders. The arrays are consumed by the view projection — the
 * folder-first visibility filter that decides which nodes each SDK view contains — and then
 * dropped, because inside a view the only remaining consumer that can change output is
 * `sdkScopeHref`, which substitutes `/:sdk:/` iff the node is scoped at all. So a placeholder
 * href keeps a `scoped` marker and every other node loses the array.
 *
 * The default tree (no `sdk`) keeps the literal array, sorted so authoring order is not a
 * diff: there the arrays are the data the site filters with before hydration, so they are
 * compared strictly. A change to that tree fails the run unless `allowDefaultChange` vouches
 * for it, in which case it is a note.
 */
const baseNode = (raw: RawNode, kind: NormNode['kind'], sdk: string | undefined): NormNode => {
  const node: NormNode = { kind, title: raw.title }

  if (raw.href !== undefined) node.href = raw.href

  if (sdk === undefined) {
    if (Array.isArray(raw.sdk)) node.sdk = [...raw.sdk].sort()
  } else if (Array.isArray(raw.sdk) && typeof raw.href === 'string' && raw.href.includes(':sdk:')) {
    node.scoped = true
  }

  if (raw.tag !== undefined) node.tag = raw.tag
  if (raw.maintainer !== undefined) node.maintainer = raw.maintainer
  if (raw.icon !== undefined) node.icon = raw.icon
  if (raw.wrap !== undefined && raw.wrap !== WRAP_DEFAULT) node.wrap = raw.wrap
  if (raw.target !== undefined) node.target = raw.target
  if (raw.hideTitle !== undefined && raw.hideTitle !== HIDE_TITLE_DEFAULT) node.hideTitle = raw.hideTitle

  return node
}

/** A folder emptied by the sdk filter is not rendered, so it is not part of the view. */
const normalizeItem = (raw: RawNode, sdk: string | undefined): NormNode | null => {
  const kind = isHeading(raw) ? 'heading' : isFolder(raw) ? 'folder' : 'page'
  const node = baseNode(raw, kind, sdk)

  if (kind === 'folder') {
    const children = normalizeItems(raw.items, sdk)
    if (sdk !== undefined && children.length === 0) return null
    node.children = children
  }

  return node
}

const normalizeItems = (items: RawNode[], sdk: string | undefined): NormNode[] =>
  items
    .filter((item) => sdk === undefined || matchesSDK(item, sdk))
    .map((item) => normalizeItem(item, sdk))
    .filter((node): node is NormNode => node !== null)

/**
 * Sections carry the same presentation fields as any other node here. `buildSections` copies
 * only title/icon/sdk on to a section, so a `tag`/`wrap`/`hideTitle` on a section WOULD
 * surface as a diff — deliberately. Those fields change how a section renders, so losing them
 * is a behaviour change to report, not noise to normalize away. (No authored section carries
 * any of them today, so this costs nothing on the real manifests.)
 *
 * `children` is nested sections first, then items, in the order the dist lists them.
 */
const sectionNode = (raw: RawNode, sdk: string | undefined): NormNode | null => {
  if (sdk !== undefined && !matchesSDK(raw, sdk)) return null

  const node = baseNode(raw, 'section', sdk)
  const children = [...sectionNodes(raw.sections ?? [], sdk), ...normalizeItems(raw.items ?? [], sdk)]

  if (sdk !== undefined && children.length === 0) return null

  node.children = children
  return node
}

const sectionNodes = (raws: RawNode[], sdk: string | undefined): NormNode[] =>
  raws.map((raw) => sectionNode(raw, sdk)).filter((node): node is NormNode => node !== null)

/**
 * One view of a dist: an SDK's rendered tree (`sdk` given) or the default tree (`sdk`
 * omitted). A keyed entry is already scoped to its SDK, but its items can still carry narrower
 * scopes, so the same filter runs over both shapes.
 */
export const normalizeDist = (dist: Dist, sdk?: string): NormNode[] => {
  const navigation = dist.navigation ?? {}
  const view = (sdk !== undefined ? navigation[sdk] : undefined) ?? navigation.default

  if (view === undefined) throw new Error(`No navigation entry for view "${sdk ?? 'default'}" and no default entry`)

  if (view.type === 'flat') return normalizeItems(view.items ?? [], sdk)

  return sectionNodes(view.sections ?? [], sdk)
}

// ---------------------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------------------

/** Key-order-insensitive, so a reordered flags object is not reported as a change. */
const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

const MAX_DIFF_LINES = 40

/**
 * A prefix/suffix-trimmed window rather than a full LCS diff: the manifests run to thousands
 * of lines, and the first divergence is what a reader needs.
 */
const formatDiff = (oldText: string, newText: string): string => {
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')

  let start = 0
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) start++

  let end = 0
  while (
    end < oldLines.length - start &&
    end < newLines.length - start &&
    oldLines[oldLines.length - 1 - end] === newLines[newLines.length - 1 - end]
  ) {
    end++
  }

  const oldWindow = oldLines.slice(start, oldLines.length - end)
  const newWindow = newLines.slice(start, newLines.length - end)

  const render = (marker: string, lines: string[]) => {
    const shown = lines.slice(0, MAX_DIFF_LINES).map((line) => `${marker}${line}`)
    if (lines.length > MAX_DIFF_LINES) shown.push(`${marker}… ${lines.length - MAX_DIFF_LINES} more line(s)`)
    return shown
  }

  return [
    `first difference at line ${start + 1} (old: ${oldLines.length} lines, new: ${newLines.length} lines)`,
    ...render('- ', oldWindow),
    ...render('+ ', newWindow),
  ].join('\n')
}

/** The rendered SDK views. The default tree is compared separately, with its `sdk` arrays. */
export const VIEWS: string[] = [...VALID_SDKS]

export type ViewCount = { view: string; old: number; new: number }

const countNodes = (nodes: NormNode[]): number =>
  nodes.reduce((total, node) => total + 1 + countNodes(node.children ?? []), 0)

/** Per-view node counts, printed on success so "OK" can never mean "compared nothing". */
export const formatCounts = (counts: ViewCount[]): string =>
  counts
    .map(({ view, old, new: next }) => {
      const suffix = old === next ? '' : ` (new: ${next})`
      return `  ${view.padEnd(22)}${String(old).padStart(6)} nodes${suffix}`
    })
    .join('\n')

export type CompareOptions = {
  /**
   * Accept a changed default tree (structure or `sdk` arrays) as a note instead of a failure.
   * Pass it only after checking the pre-hydration nav in the browser — that tree is what
   * readers see before hydration swaps in their SDK's view.
   */
  allowDefaultChange?: boolean
}

export const compareDistManifests = (
  oldDist: Dist,
  newDist: Dist,
  options: CompareOptions = {},
): {
  ok: boolean
  diffs: { view: string; diff: string }[]
  counts: ViewCount[]
  notes: string[]
} => {
  const diffs: { view: string; diff: string }[] = []
  const counts: ViewCount[] = []

  const oldFlags = stableStringify(oldDist.flags ?? {})
  const newFlags = stableStringify(newDist.flags ?? {})
  if (oldFlags !== newFlags) diffs.push({ view: 'flags', diff: formatDiff(oldFlags, newFlags) })

  const notes: string[] = []

  for (const view of VIEWS) {
    const oldNodes = normalizeDist(oldDist, view)
    const newNodes = normalizeDist(newDist, view)

    counts.push({ view, old: countNodes(oldNodes), new: countNodes(newNodes) })

    const oldView = JSON.stringify(oldNodes, null, 1)
    const newView = JSON.stringify(newNodes, null, 1)

    if (oldView !== newView) diffs.push({ view, diff: formatDiff(oldView, newView) })
  }

  // The default tree renders before hydration for every reader whose SDK is not in the URL, and
  // its `sdk` arrays drive that first paint's CSS visibility, so a change to it is a failure
  // unless the caller vouches for it after checking that surface in the browser.
  const oldDefault = JSON.stringify(normalizeDist(oldDist), null, 1)
  const newDefault = JSON.stringify(normalizeDist(newDist), null, 1)
  if (oldDefault !== newDefault) {
    if (options.allowDefaultChange) {
      notes.push('default tree structure or sdk arrays changed; accepted via --allow-default-change')
    } else {
      diffs.push({
        view: 'default (pre-hydration)',
        diff:
          'default tree structure or sdk arrays changed. This tree is what renders before hydration; ' +
          'check it in the browser, then re-run with --allow-default-change to accept.\n' +
          formatDiff(oldDefault, newDefault),
      })
    }
  }

  // Non-vacuity: two empty trees compare equal, so a truncated, stale or wrong-shaped dist
  // would otherwise report parity while comparing nothing at all. The nextjs view always has
  // content in a real build, so an empty one is a broken input, not a passing comparison.
  const guardCount = counts.find(({ view }) => view === 'nextjs')
  if (guardCount === undefined || guardCount.old === 0 || guardCount.new === 0) {
    diffs.unshift({
      view: 'non-vacuity',
      diff:
        `the nextjs view normalized to 0 nodes ` +
        `(old: ${guardCount?.old ?? 0}, new: ${guardCount?.new ?? 0}). ` +
        `An empty tree compares equal to an empty tree, so this is not parity — check that ` +
        `both dist manifests are complete builds.`,
    })
  }

  return { ok: diffs.length === 0, diffs, counts, notes }
}

// ---------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------

const main = () => {
  const args = process.argv.slice(2)
  const allowDefaultChange = args.includes('--allow-default-change')
  const [oldPath, newPath] = args.filter((arg) => !arg.startsWith('--'))

  if (oldPath === undefined || newPath === undefined) {
    console.error(
      'usage: bun scripts/check-nav-parity.ts [--allow-default-change] <dist-manifest.json> <dist-manifest.json>',
    )
    process.exit(2)
  }

  const read = (filePath: string): Dist => JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  const { ok, diffs, counts, notes } = compareDistManifests(read(oldPath), read(newPath), { allowDefaultChange })

  for (const note of notes) console.log(`note: ${note}`)

  if (ok) {
    console.log(`parity: OK (${counts.length} views compared)`)
    console.log(formatCounts(counts))
    return
  }

  console.error(`node counts per view (old / new):`)
  console.error(formatCounts(counts))

  for (const { view, diff } of diffs) {
    console.error(`\n=== ${view} ===`)
    console.error(diff)
  }
  console.error(`\nparity: FAILED (${diffs.length} problem(s) reported across ${counts.length} views)`)
  process.exit(1)
}

// Only run as a CLI, never on import from the test file.
if (process.argv[1] !== undefined && /check-nav-parity\.ts$/.test(process.argv[1])) main()
