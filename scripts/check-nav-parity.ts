#!/usr/bin/env bun
/**
 * Nav parity checker: proves two built `dist/manifest.json`s render the same navigation.
 *
 * Two modes, picked by the shape of the FIRST dist's `navigation` (an array is the legacy
 * format, an object is the current one) and printed as a `mode:` line so a run can never be
 * read as the mode it wasn't:
 *
 *  - `old-vs-new` — the format flip's migration gate, comparing a pre-flip dist against a
 *    post-flip one. Nothing on `main` emits the old format any more, so this is history.
 *  - `new-vs-new` — the standing use: build a dist before a manifest-affecting change and one
 *    after, and prove the change is nav-output-neutral (e.g. a manifest edit that moves groups
 *    or changes what a page's frontmatter scopes, or any edit to `build-docs.ts`'s manifest
 *    handling). It compares the 16 rendered SDK views only, after the same folder-first
 *    visibility filter the site applies — `sdk` arrays are consumed by that filter and then
 *    dropped, surviving only as a `scoped` marker on a `/:sdk:/` href, because that is the one
 *    place a residual array can still change what renders. The default tree renders before
 *    hydration for readers whose SDK is not in the URL, and its literal `sdk` arrays drive that
 *    first paint, so a structural or `sdk`-array change to it fails the run unless
 *    `--allow-default-change` vouches for it after a browser check (it then prints as a `note:`).
 *
 * Everything below the normalization step — the VIEWS enumeration, NormNode, per-view counts,
 * the non-vacuity guard, the diff — is shared by both modes; only which normalizer runs over
 * the left-hand dist changes.
 *
 * `main` builds `dist/manifest.json` as `{ flags, navigation: Array<Array<…>> }` — one tree
 * whose `topNav` groups are the sections and whose `flatNav` group is the mobile sidebar.
 * This branch builds `{ flags, navigation: { default: { type: 'sectioned', sections },
 * <sdk>: { type: 'flat', items } } }`. The two shapes are different; the nav the reader sees
 * must not be. This script normalizes both dists in to one `NormNode` tree per rendered view
 * (`default` plus every SDK in VALID_SDKS) and diffs them.
 *
 * Why comparing DATA is enough — and stronger than simulating a render:
 * the sidenav is a pure function of (kind, title, href, order, children) plus the presentation
 * flags (tag/icon/wrap/target/hideTitle) and, in old-vs-new, the literal `sdk` array — all of
 * which are compared here. In new-vs-new, `sdk` is not itself part of the comparison: it has
 * already done its only remaining job (deciding which nodes are in this view, via the same
 * visibility filter the site runs) by the time a view is normalized, so equal per-view node
 * sets already imply equal `visible(itemSDKs, core, showIfDeprecated)` outcomes for every
 * core, not just one — see the `baseNode` comment for what a residual array can still change.
 *
 * Views, not dist keys: the checker enumerates `default` + VALID_SDKS. Enumerating the new
 * dist's navigation keys would silently skip nextjs/react/… , which have no keyed entry and
 * render from the default view.
 *
 * Usage: bun scripts/check-nav-parity.ts [--new-both] [--allow-default-change] <dist-manifest.json> <dist-manifest.json>
 *        (--new-both forces new-vs-new; without it the mode is detected from the first dist)
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

/** Old dist items nest one array level (`[[a, b], [c]]`); new dist items do not. Accept both. */
const asItems = (items: unknown): RawNode[] => {
  if (!Array.isArray(items)) return []
  return items.flatMap((entry) => (Array.isArray(entry) ? entry : [entry]))
}

const isFolder = (raw: RawNode) => Array.isArray(raw.items)
const isHeading = (raw: RawNode) => raw.type === 'heading'
const isTopNav = (raw: RawNode) => isFolder(raw) && raw.topNav === true
const isFlatNavGroup = (raw: RawNode) => isFolder(raw) && raw.flatNav === true

const matchesSDK = (raw: RawNode, sdk: string) => !Array.isArray(raw.sdk) || raw.sdk.includes(sdk)

/**
 * Mirrors the site's `hasVisibleChildren`: a folder is checked against its own `sdk` BEFORE
 * its children, so an sdk-excluded folder is dropped folder-and-children rather than having
 * its children promoted in to the view.
 */
const hasVisibleDescendant = (raw: RawNode, sdk: string): boolean => {
  if (isFolder(raw)) {
    if (!matchesSDK(raw, sdk)) return false
    return asItems(raw.items).some((child) => hasVisibleDescendant(child, sdk))
  }
  return matchesSDK(raw, sdk)
}

/**
 * `sdk` in a single-SDK view.
 *
 * The old dist's mobile items inherited the Mobile group's `['ios', 'android']`; the new
 * dist's flat entries carry the manifest's own root scope (`['ios']`) unless frontmatter
 * says otherwise. Collapsing a present array to `[sdk]` inside an SDK view makes those two
 * compare equal. Two of the three consumers of a residual array are plainly indifferent:
 * `visible()` is a membership test against the active SDK (already applied to build this
 * view), and `sdkScopeHref()` substitutes `/:sdk:/` iff the active SDK is a member.
 *
 * `cssVisibilitySDKs()` is NOT indifferent, and the honest reason the collapse is still safe
 * is structural, not algebraic. That chain feeds `useActiveSDKStyleDisplay`, which — when
 * `activeSDK` is undefined (SSR / pre-hydration, the case the chain exists for) — builds a
 * var-chain over EVERY member of the array, so `['ios','android']` and `['ios']` genuinely
 * differ there. Under the new format each flat tree is a keyed per-SDK entry that is only
 * ever rendered under its own SDK, so that pre-hydration chain is single-valued by
 * construction: the narrower array is the correct one for the only view it can appear in.
 * That is a property of the site rewrite (Tasks 8–11), which this checker does not inspect —
 * Task 12's browser verification owns the pre-hydration and SDK-switch surface.
 *
 * What the collapse preserves: that the item is scoped at all (an unscoped `:sdk:` href
 * renders the placeholder verbatim, so present-vs-absent is NOT normalized away), and that
 * the view's SDK is a member. Nothing hides behind it either — every SDK gets its own view,
 * so an item that gained or lost an SDK shows up as an added/removed node in that SDK's view.
 *
 * The default view keeps the literal (sorted) array — there the arrays are the data the site
 * filters with, so they are compared strictly.
 */
const normalizeSDK = (raw: RawNode, sdk: string | undefined): string[] | undefined => {
  if (!Array.isArray(raw.sdk)) return undefined
  return sdk === undefined ? [...raw.sdk].sort() : [sdk]
}

type NormMode = ParityMode

/**
 * `sdk` in a view.
 *
 * old-vs-new keeps its documented behaviour (the block above `normalizeSDK`).
 *
 * new-vs-new compares what renders. The arrays are consumed by the view projection — the
 * folder-first visibility filter that decides which nodes each SDK view contains — and then
 * dropped, because inside a view the only remaining consumer that can change output is
 * `sdkScopeHref`, which substitutes `/:sdk:/` iff the node is scoped at all. So a placeholder
 * href keeps a `scoped` marker and every other node loses the array. The default tree is compared
 * separately with its literal `sdk` arrays, because it renders before hydration; a change to it
 * fails the run unless `allowDefaultChange` vouches for it, in which case it is a note.
 */
const baseNode = (raw: RawNode, kind: NormNode['kind'], sdk: string | undefined, mode: NormMode): NormNode => {
  const node: NormNode = { kind, title: raw.title }

  if (raw.href !== undefined) node.href = raw.href

  if (mode === 'new-vs-new') {
    if (Array.isArray(raw.sdk) && typeof raw.href === 'string' && raw.href.includes(':sdk:')) node.scoped = true
  } else {
    const sdks = normalizeSDK(raw, sdk)
    if (sdks !== undefined) node.sdk = sdks
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
const normalizeItem = (raw: RawNode, sdk: string | undefined, mode: NormMode = 'old-vs-new'): NormNode | null => {
  const kind = isHeading(raw) ? 'heading' : isFolder(raw) ? 'folder' : 'page'
  const node = baseNode(raw, kind, sdk, mode)

  if (kind === 'folder') {
    const children = normalizeItems(asItems(raw.items), sdk, mode)
    if (sdk !== undefined && children.length === 0) return null
    node.children = children
  }

  return node
}

const normalizeItems = (items: RawNode[], sdk: string | undefined, mode: NormMode = 'old-vs-new'): NormNode[] =>
  items
    .filter((item) => sdk === undefined || matchesSDK(item, sdk))
    .map((item) => normalizeItem(item, sdk, mode))
    .filter((node): node is NormNode => node !== null)

type SectionShape = {
  /** The child sections of a section, in the shape of the dist being normalized. */
  nestedOf: (raw: RawNode) => RawNode[]
  /** The non-section children of a section. */
  itemsOf: (raw: RawNode) => RawNode[]
}

/** `topNav` groups are the old dist's sections; a nested `topNav` group is a nested section. */
const OLD_SECTIONS: SectionShape = {
  nestedOf: (raw) => asItems(raw.items).filter(isTopNav),
  itemsOf: (raw) => asItems(raw.items).filter((item) => !isTopNav(item)),
}

/** The new dist splits the two apart itself. */
const NEW_SECTIONS: SectionShape = {
  nestedOf: (raw) => raw.sections ?? [],
  itemsOf: (raw) => raw.items ?? [],
}

/**
 * Sections carry the same presentation fields as any other node here. `buildSections` copies
 * only title/icon/sdk on to a section, so a `tag`/`wrap`/`hideTitle` authored on a `topNav`
 * group WOULD surface as a diff — deliberately. Those fields change how a section renders, so
 * losing them is a behaviour change to report, not noise to normalize away. (No authored
 * section carries any of them today, so this costs nothing on the real manifests.)
 *
 * `children` is nested sections first, then items: the new format splits the two apart, which
 * cannot express interleaving the old single ordered list could. Order within each list is
 * preserved, and no authored section mixes the two.
 */
const sectionNode = (
  raw: RawNode,
  shape: SectionShape,
  sdk: string | undefined,
  mode: NormMode = 'old-vs-new',
): NormNode | null => {
  if (sdk !== undefined && !matchesSDK(raw, sdk)) return null

  const node = baseNode(raw, 'section', sdk, mode)
  const children = [
    ...sectionNodes(shape.nestedOf(raw), shape, sdk, mode),
    ...normalizeItems(shape.itemsOf(raw), sdk, mode),
  ]

  if (sdk !== undefined && children.length === 0) return null

  node.children = children
  return node
}

const sectionNodes = (
  raws: RawNode[],
  shape: SectionShape,
  sdk: string | undefined,
  mode: NormMode = 'old-vs-new',
): NormNode[] => raws.map((raw) => sectionNode(raw, shape, sdk, mode)).filter((node): node is NormNode => node !== null)

// ---------------------------------------------------------------------------------------
// Old dist (main): one tree, `topNav` groups are sections, the `flatNav` group is the
// mobile sidebar for the SDKs it covers.
// ---------------------------------------------------------------------------------------

/**
 * FlatNav semantics, from `FlatNav.tsx`.
 *
 * `Nav` picks flat-vs-sectioned by looking for a `flatNav` group visible for the active SDK,
 * then hands FlatNav the ENTIRE manifest — not that group. `processItems` walks every
 * top-level group, skips anything `hasVisibleChildren` rejects (a folder's own `sdk` is
 * checked before its children, hence ancestor-first), unwraps `topNav` and `hideTitle`
 * folders in to their children, and keeps everything else in place. So this walks the whole
 * manifest too. On today's data `Guides`/`Reference` list no mobile SDK and drop out on their
 * own, but leaning on that would bake in an unrecorded precondition: a `topNav` section that
 * ever covered a flat SDK belongs in that SDK's old-side view, and must surface as a diff if
 * the new format drops it.
 */
const oldFlatItems = (items: RawNode[], sdk: string): RawNode[] => {
  const out: RawNode[] = []

  const walk = (level: RawNode[]) => {
    for (const item of level) {
      if (!hasVisibleDescendant(item, sdk)) continue

      if (isFolder(item) && (item.topNav === true || item.hideTitle === true)) {
        walk(asItems(item.items))
        continue
      }

      out.push(item)
    }
  }

  walk(items)
  return out
}

export const normalizeOldDist = (dist: Dist, sdk?: string, mode: NormMode = 'old-vs-new'): NormNode[] => {
  const top = asItems(dist.navigation)

  if (sdk !== undefined) {
    const usesFlatNav = top.some((item) => isFlatNavGroup(item) && matchesSDK(item, sdk))
    if (usesFlatNav) return normalizeItems(oldFlatItems(top, sdk), sdk, mode)
  }

  return sectionNodes(
    top.filter((item) => isTopNav(item) && !isFlatNavGroup(item)),
    OLD_SECTIONS,
    sdk,
    mode,
  )
}

// ---------------------------------------------------------------------------------------
// New dist (this branch): navigation keyed by view.
// ---------------------------------------------------------------------------------------

export const normalizeNewDist = (dist: Dist, sdk?: string, mode: NormMode = 'old-vs-new'): NormNode[] => {
  const navigation = dist.navigation ?? {}
  const view = (sdk !== undefined ? navigation[sdk] : undefined) ?? navigation.default

  if (view === undefined) throw new Error(`No navigation entry for view "${sdk ?? 'default'}" and no default entry`)

  // A keyed entry is already scoped to its SDK, but its items can still carry narrower
  // scopes, so the same filter runs over both shapes.
  if (view.type === 'flat') return normalizeItems(view.items ?? [], sdk, mode)

  return sectionNodes(view.sections ?? [], NEW_SECTIONS, sdk, mode)
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

export const VIEWS: string[] = ['default', ...VALID_SDKS]

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

export type ParityMode = 'old-vs-new' | 'new-vs-new'

/**
 * Which normalizer the left-hand dist needs, from its own shape: the legacy format's
 * `navigation` is an array of arrays, the current format's is an object keyed by view.
 *
 * Detecting rather than assuming is what stops a new-format dist fed to the left-hand side
 * from being normalized as legacy — `normalizeOldDist` returns `[]` for anything that isn't an
 * array, which would surface as the non-vacuity guard complaining about a truncated dist
 * instead of the plain "you passed two new dists" that it is.
 */
export const detectMode = (dist: Dist): ParityMode =>
  dist.navigation !== null && typeof dist.navigation === 'object' && !Array.isArray(dist.navigation)
    ? 'new-vs-new'
    : 'old-vs-new'

export type CompareOptions = {
  /**
   * new-vs-new only: accept a changed default tree (structure or `sdk` arrays) as a note
   * instead of a failure. Pass it only after checking the pre-hydration nav in the browser —
   * that tree is what readers see before hydration swaps in their SDK's view.
   */
  allowDefaultChange?: boolean
}

export const compareDistManifests = (
  oldDist: Dist,
  newDist: Dist,
  modeOverride?: ParityMode,
  options: CompareOptions = {},
): {
  ok: boolean
  diffs: { view: string; diff: string }[]
  counts: ViewCount[]
  mode: ParityMode
  notes: string[]
} => {
  const mode = modeOverride ?? detectMode(oldDist)
  const normalizeLeft = mode === 'new-vs-new' ? normalizeNewDist : normalizeOldDist

  const diffs: { view: string; diff: string }[] = []
  const counts: ViewCount[] = []

  const oldFlags = stableStringify(oldDist.flags ?? {})
  const newFlags = stableStringify(newDist.flags ?? {})
  if (oldFlags !== newFlags) diffs.push({ view: 'flags', diff: formatDiff(oldFlags, newFlags) })

  const notes: string[] = []
  const views = mode === 'new-vs-new' ? VIEWS.filter((view) => view !== 'default') : VIEWS

  for (const view of views) {
    const sdk = view === 'default' ? undefined : view
    const oldNodes = normalizeLeft(oldDist, sdk, mode)
    const newNodes = normalizeNewDist(newDist, sdk, mode)

    counts.push({ view, old: countNodes(oldNodes), new: countNodes(newNodes) })

    const oldView = JSON.stringify(oldNodes, null, 1)
    const newView = JSON.stringify(newNodes, null, 1)

    if (oldView !== newView) diffs.push({ view, diff: formatDiff(oldView, newView) })
  }

  // The default tree renders before hydration for every reader whose SDK is not in the URL, and
  // its `sdk` arrays drive that first paint's CSS visibility, so a change to it is a failure
  // unless the caller vouches for it after checking that surface in the browser.
  if (mode === 'new-vs-new') {
    const oldDefault = JSON.stringify(normalizeNewDist(oldDist, undefined, 'old-vs-new'), null, 1)
    const newDefault = JSON.stringify(normalizeNewDist(newDist, undefined, 'old-vs-new'), null, 1)
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
  }

  // Non-vacuity: two empty trees compare equal, so a truncated, stale or wrong-shaped dist
  // would otherwise report parity while comparing nothing at all (`normalizeOldDist` yields
  // [] for any navigation that isn't an array). The default view always has content in a real
  // build, so an empty one is a broken input, not a passing comparison. new-vs-new has no
  // default view, so guard on nextjs.
  const guardView = mode === 'new-vs-new' ? 'nextjs' : 'default'
  const guardCount = counts.find(({ view }) => view === guardView)
  if (guardCount === undefined || guardCount.old === 0 || guardCount.new === 0) {
    diffs.unshift({
      view: 'non-vacuity',
      diff:
        `the ${guardView} view normalized to 0 nodes ` +
        `(old: ${guardCount?.old ?? 0}, new: ${guardCount?.new ?? 0}). ` +
        `An empty tree compares equal to an empty tree, so this is not parity — check that ` +
        `both dist manifests are complete and in the format their side is expected to emit.`,
    })
  }

  return { ok: diffs.length === 0, diffs, counts, mode, notes }
}

// ---------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------

const main = () => {
  const args = process.argv.slice(2)
  const forceNewBoth = args.includes('--new-both')
  const allowDefaultChange = args.includes('--allow-default-change')
  const [oldPath, newPath] = args.filter((arg) => !arg.startsWith('--'))

  if (oldPath === undefined || newPath === undefined) {
    console.error(
      'usage: bun scripts/check-nav-parity.ts [--new-both] [--allow-default-change] <dist-manifest.json> <dist-manifest.json>',
    )
    process.exit(2)
  }

  const read = (filePath: string): Dist => JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  const { ok, diffs, counts, mode, notes } = compareDistManifests(
    read(oldPath),
    read(newPath),
    forceNewBoth ? 'new-vs-new' : undefined,
    { allowDefaultChange },
  )

  // Printed either way: which normalizer ran over the left-hand dist decides what the result
  // means, and it is detected rather than declared.
  console.log(`mode: ${mode}`)
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
