import type { BuildConfig } from './config'
import { headingHashesForSdk } from './plugins/validateLinks'
import type { Redirect } from './redirects'
import type { SDK } from './schemas'
import type { DocsMap } from './store'
import { removeMdxSuffix } from './utils/removeMdxSuffix'

export interface DocsLinkManifest {
  generatedAt: string
  sourceRevision: string
  /** Routable docs URL → sorted, unique heading anchors on that page (`[]` when it has none). */
  routes: Record<string, string[]>
  redirects: {
    static: Record<string, string>
    dynamic: Redirect[]
  }
}

const trailingIndexRegex = /\/index$/

export function createDocsLinkManifest({
  routes,
  staticRedirects,
  dynamicRedirects,
  generatedAt,
  sourceRevision,
}: {
  routes: Iterable<{ url: string; anchors: Iterable<string> }>
  staticRedirects: Record<string, string>
  dynamicRedirects: Redirect[]
  generatedAt: Date
  sourceRevision: string
}): DocsLinkManifest {
  const anchorsByRoute = new Map<string, Set<string>>()

  for (const { url, anchors } of routes) {
    const route = url.replace(trailingIndexRegex, '')
    const routeAnchors = anchorsByRoute.get(route) ?? new Set<string>()

    for (const anchor of anchors) {
      routeAnchors.add(anchor)
    }

    anchorsByRoute.set(route, routeAnchors)
  }

  return {
    generatedAt: generatedAt.toISOString(),
    sourceRevision,
    routes: Object.fromEntries(
      Array.from(anchorsByRoute.keys())
        .sort()
        .map((route) => [route, Array.from(anchorsByRoute.get(route) ?? []).sort()]),
    ),
    redirects: {
      static: staticRedirects,
      dynamic: dynamicRedirects,
    },
  }
}

/**
 * The heading anchors a reader lands on at a page that build-docs wrote to `distPath`.
 *
 * Mirrors the dist layout the doc write passes produce: a page at the dist root is the
 * doc with that href (a core doc, a single-SDK doc, a doc whose href already carries its
 * SDK, or the unscoped SDK-chooser page of a multi-SDK doc), and a page under `<sdk>/`
 * is that SDK's rendering of the doc at the rest of the path (its `<page>.<sdk>.mdx`
 * variant when one exists). A page rendered for one SDK reports the anchors that SDK's
 * readers see, matching the per-SDK link validation; the unscoped page of a multi-SDK
 * doc reports the union of what each of its SDKs renders. That union is built per SDK
 * rather than from the doc's unfiltered `headingsHashes`, whose single slug counter
 * turns a heading repeated across mutually exclusive `<If />` branches into a
 * `heading-2` anchor that no rendered page has. A core doc (no `sdk` frontmatter) is
 * the one place that unfiltered set is right: its emitted file keeps every `<If />`
 * branch and the site assigns ids with one counter over the whole page, so there the
 * `heading-2` id is real.
 */
export function headingAnchorsForDistPage(config: BuildConfig, docsMap: DocsMap, distPath: string): Set<string> {
  const slug = removeMdxSuffix(distPath)
  const href = `${config.baseDocsLink}${slug}`
  const doc = docsMap.get(href)

  if (doc !== undefined) {
    // Discriminate on the frontmatter, not `doc.sdk`: manifest scoping stamps `sdk` onto the
    // docsMap copy of an unscoped doc, but the write passes iterate the unstamped originals, so
    // such a doc is still emitted as one root page with every <If /> branch intact.
    const sdks = [...(doc.frontmatter.sdk ?? []), ...(doc.distinctSDKVariants ?? [])]

    if (sdks.length === 0) {
      return doc.headingsHashes
    }

    const anchors = new Set<string>()

    for (const sdk of sdks) {
      for (const anchor of headingHashesForSdk(docRenderedForSdk(docsMap, href, doc, sdk), sdk)) {
        anchors.add(anchor)
      }
    }

    return anchors
  }

  const [sdk, ...rest] = slug.split('/')

  if (config.validSdks.includes(sdk as SDK)) {
    const baseHref = `${config.baseDocsLink}${rest.join('/')}`
    const baseDoc = docsMap.get(baseHref)

    if (baseDoc !== undefined) {
      return headingHashesForSdk(docRenderedForSdk(docsMap, baseHref, baseDoc, sdk as SDK), sdk as SDK)
    }
  }

  throw new Error(`No doc found for the dist page ${distPath}, so its heading anchors can't be published`)
}

/**
 * The doc whose content renders for `sdk`: the `<page>.<sdk>.mdx` variant when the doc
 * has one for that SDK, otherwise the doc itself.
 */
function docRenderedForSdk(docsMap: DocsMap, href: string, doc: NonNullable<ReturnType<DocsMap['get']>>, sdk: SDK) {
  if (doc.distinctSDKVariants?.includes(sdk)) {
    return docsMap.get(`${href}.${sdk}`) ?? doc
  }

  return doc
}
