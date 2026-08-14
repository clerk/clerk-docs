import { Node } from 'unist'
import { filter as mdastFilter } from 'unist-util-filter'
import { map as mdastMap } from 'unist-util-map'
import { visit as mdastVisit } from 'unist-util-visit'
import type { VFile } from 'vfile'
import type { BuildConfig } from '../config'
import { type WarningsSection, safeMessage } from '../error-messages'
import type { SDK } from '../schemas'
import type { DocsMap } from '../store'
import { documentHasIfComponents } from '../utils/documentHasIfComponents'
import { removeMdxSuffix } from '../utils/removeMdxSuffix'
import { nodeIsVisibleForSdk } from './filterOtherSDKsContentOut'

// Match clerk.com/docs URLs but require a path after /docs (not just /docs or /docs/)
const CLERK_DOCS_URL_PATTERN = /https?:\/\/clerk\.com(\/docs\/[^\s\)\]"'`}]+)/g
// Trailing punctuation accidentally captured at the end of a URL (e.g. sentence punctuation).
const trailingPunctuationRegex = /[,;:\.]+$/
// Trailing closing parens accidentally captured at the end of a URL.
const trailingParensRegex = /\)+$/

/**
 * Remark plugin to validate Markdown links in documentation.
 * - Checks that internal doc links point to existing documents.
 * - Checks that clerk.com/docs URLs in code block comments point to existing documents.
 * - Optionally tracks found links via callback.
 * - Warns if a link points to a missing document or heading.
 * - Skips ignored paths and links.
 *
 * When `targetSdks` is provided the plugin instead runs a variant-aware hash check
 * for each of those SDKs: it only validates links that render for the SDK
 * (respecting <If sdk/notSdk> filtering) and warns when a linked anchor exists in
 * the union of the linked doc's SDK variants but not in the variant the link
 * resolves to for that SDK. All other warnings (missing docs, fully missing
 * hashes, etc.) are left to the SDK-agnostic passes so they are only reported
 * once. The SDK output pass validates each scoped doc for its one target SDK;
 * unscoped docs render for every SDK, so they are validated for all of them.
 */
export const validateLinks =
  (
    config: BuildConfig,
    docsMap: DocsMap,
    filePath: string,
    section: WarningsSection,
    foundLink?: (link: string) => void,
    href?: string,
    targetSdks?: SDK[],
  ) =>
  () =>
  (tree: Node, vfile: VFile) => {
    if (targetSdks !== undefined) {
      // <If /> filtering only changes the tree when the doc has <If /> components;
      // without any, every SDK sees the same links, so skip the per-SDK filtering.
      const needsFiltering = documentHasIfComponents(tree)

      for (const targetSdk of targetSdks) {
        validateLinkHashesForSdk(config, docsMap, filePath, section, vfile, tree, href, targetSdk, needsFiltering)
      }

      return tree
    }

    return mdastMap(tree, (node) => {
      // Check clerk.com/docs URLs in code blocks
      if (node.type === 'code' && 'value' in node && typeof node.value === 'string') {
        validateCodeBlockUrls(config, docsMap, filePath, section, vfile, node.value, node.position)
        return node
      }

      if (node.type !== 'link') return node
      if (!('url' in node)) return node
      if (typeof node.url !== 'string') return node

      // we are overwriting the url with the mdx suffix removed
      node.url = removeMdxSuffix(node.url)

      if (node.url.startsWith('docs/')) {
        safeMessage(
          config,
          vfile,
          filePath,
          section,
          'doc-link-must-start-with-a-slash',
          [node.url as string],
          node.position,
        )
      }
      if (!node.url.startsWith(config.baseDocsLink) && (!node.url.startsWith('#') || href === undefined)) return node
      if (!('children' in node)) return node

      let [url, hash] = (node.url as string).split('#')

      if (url === '' && href !== undefined) {
        // If the link is just a hash, then we need to link to the same doc
        url = href
      }

      const ignore = config.ignoredPaths(url) || config.ignoredLinks(url)
      if (ignore === true) return node

      const linkedDoc = docsMap.get(url)

      if (linkedDoc === undefined) {
        safeMessage(
          config,
          vfile,
          filePath,
          section,
          'link-doc-not-found',
          [node.url as string, `${url}.mdx`],
          node.position,
        )
        return node
      }

      foundLink?.(linkedDoc.file.filePath)

      if (hash !== undefined) {
        const hasHash = combinedHeadingHashes(docsMap, url, linkedDoc).has(hash)

        if (hasHash === false) {
          safeMessage(config, vfile, filePath, section, 'link-hash-not-found', [hash, url], node.position)
        }
      }

      return node
    })
  }

/**
 * The union of a doc's heading hashes across every one of its distinct SDK variants.
 * An anchor in this set exists in at least one variant of the doc (but not
 * necessarily in all of them).
 */
function combinedHeadingHashes(docsMap: DocsMap, url: string, linkedDoc: NonNullable<ReturnType<DocsMap['get']>>) {
  const hashes = new Set(linkedDoc.headingsHashes)

  if (linkedDoc.distinctSDKVariants) {
    linkedDoc.distinctSDKVariants.forEach((sdk) => {
      const distinctSDKVariant = docsMap.get(`${url}.${sdk}`)

      if (distinctSDKVariant === undefined) return

      distinctSDKVariant.headingsHashes.forEach((headingHash) => {
        hashes.add(headingHash)
      })
    })
  }

  return hashes
}

/**
 * Variant-aware hash validation for the per-SDK output pass. Only looks at links
 * and code-block URLs that actually render for `targetSdk` (content behind
 * <If /> components for other SDKs is skipped) and warns when an anchor exists
 * in some variant of the linked doc but not in the variant this SDK's readers
 * land on.
 */
function validateLinkHashesForSdk(
  config: BuildConfig,
  docsMap: DocsMap,
  filePath: string,
  section: WarningsSection,
  vfile: VFile,
  tree: Node,
  href: string | undefined,
  targetSdk: SDK,
  needsFiltering: boolean,
): void {
  // Drop content that does not render for this SDK so links inside other SDKs'
  // <If /> branches don't produce false positives.
  const visibleTree = needsFiltering ? mdastFilter(tree, nodeIsVisibleForSdk(config, filePath, targetSdk)) : tree

  if (visibleTree === null || visibleTree === undefined) return

  mdastVisit(
    visibleTree,
    (node) => node.type === 'link',
    (node) => {
      if (!('url' in node) || typeof node.url !== 'string') return

      const linkUrl = removeMdxSuffix(node.url)

      if (!linkUrl.startsWith(config.baseDocsLink) && (!linkUrl.startsWith('#') || href === undefined)) return

      let [url, hash] = linkUrl.split('#')

      if (hash === undefined) return

      if (url === '' && href !== undefined) {
        // If the link is just a hash, then we need to link to the same doc
        url = href
      }

      checkHashExistsForSdk(config, docsMap, filePath, section, vfile, url, hash, targetSdk, node.position)
    },
  )

  // Absolute clerk.com/docs URLs in code-block comments resolve to the reader's
  // active SDK variant just like rendered links do, so hold them to the same check.
  mdastVisit(
    visibleTree,
    (node) => node.type === 'code',
    (node) => {
      if (!('value' in node) || typeof node.value !== 'string') return

      for (const { url, hash } of extractCodeBlockDocsUrls(node.value)) {
        if (hash === undefined) continue

        checkHashExistsForSdk(config, docsMap, filePath, section, vfile, url, hash, targetSdk, node.position)
      }
    },
  )
}

/**
 * Warns when `hash` exists in some variant of the doc at `url` but not in the
 * variant `targetSdk` readers land on. Missing docs and fully missing anchors
 * are left to the SDK-agnostic passes so they are only reported once.
 */
function checkHashExistsForSdk(
  config: BuildConfig,
  docsMap: DocsMap,
  filePath: string,
  section: WarningsSection,
  vfile: VFile,
  url: string,
  hash: string,
  targetSdk: SDK,
  position: Node['position'],
): void {
  const ignore = config.ignoredPaths(url) || config.ignoredLinks(url)
  if (ignore === true) return

  const linkedDoc = docsMap.get(url)

  // A missing doc is already reported by the SDK-agnostic passes
  if (linkedDoc === undefined) return

  const linkedDocSDKs = [...(linkedDoc.sdk ?? []), ...(linkedDoc.distinctSDKVariants ?? [])]

  // Cross-SDK link: the linked doc doesn't support this SDK, so the link renders
  // as an <SDKLink /> that sends readers to one of the doc's own SDK variants.
  // The union check in the SDK-agnostic passes covers those.
  if (linkedDoc.sdk !== undefined && !linkedDocSDKs.includes(targetSdk)) return

  const variantHashes = (() => {
    // A distinct variant file (eg doc.react.mdx) replaces the generic content
    // entirely for its SDK, so validate against the variant's own headings.
    if (linkedDoc.distinctSDKVariants?.includes(targetSdk)) {
      const distinctSDKVariant = docsMap.get(`${url}.${targetSdk}`)

      if (distinctSDKVariant !== undefined) {
        return distinctSDKVariant.headingsHashesBySdk?.get(targetSdk) ?? distinctSDKVariant.headingsHashes
      }
    }

    return linkedDoc.headingsHashesBySdk?.get(targetSdk) ?? linkedDoc.headingsHashes
  })()

  if (variantHashes.has(hash)) return

  // Only report the variant gap when the anchor does exist in another variant —
  // a fully missing anchor is already reported as link-hash-not-found.
  if (!combinedHeadingHashes(docsMap, url, linkedDoc).has(hash)) return

  safeMessage(config, vfile, filePath, section, 'link-hash-not-found-for-sdk', [hash, targetSdk, url], position)
}

/**
 * Extract clerk.com/docs URLs from a code block's comment lines, split into
 * url and (optional) hash. Shared by the union and variant-aware checks.
 */
function extractCodeBlockDocsUrls(codeValue: string): { raw: string; url: string; hash: string | undefined }[] {
  const results: { raw: string; url: string; hash: string | undefined }[] = []
  const lines = codeValue.split('\n')

  for (const line of lines) {
    // Only check lines that look like comments (exclude # inside URLs by stripping clerk.com URLs first)
    const lineWithoutUrls = line.replace(CLERK_DOCS_URL_PATTERN, '')
    const isComment =
      lineWithoutUrls.includes('//') ||
      lineWithoutUrls.includes('#') ||
      lineWithoutUrls.includes('/*') ||
      lineWithoutUrls.includes('*/')
    if (!isComment) continue

    // Find all clerk.com/docs URLs
    const matches = line.matchAll(CLERK_DOCS_URL_PATTERN)
    for (const match of matches) {
      // match[1] is the captured group: /docs/...
      const fullPath = match[1].replace(trailingPunctuationRegex, '').replace(trailingParensRegex, '')
      const [url, hash] = fullPath.split('#')

      results.push({ raw: match[0], url, hash })
    }
  }

  return results
}

/**
 * Validate clerk.com/docs URLs found in code block comments.
 * Extracts URLs from comment lines and checks they point to existing docs.
 */
function validateCodeBlockUrls(
  config: BuildConfig,
  docsMap: DocsMap,
  filePath: string,
  section: WarningsSection,
  vfile: VFile,
  codeValue: string,
  position: Node['position'],
): void {
  for (const { raw, url, hash } of extractCodeBlockDocsUrls(codeValue)) {
    const ignore = config.ignoredPaths(url) || config.ignoredLinks(url)
    if (ignore === true) continue

    const linkedDoc = docsMap.get(url)

    if (linkedDoc === undefined) {
      safeMessage(config, vfile, filePath, section, 'link-doc-not-found', [raw, `${url}.mdx`], position)
      continue
    }

    // Validate hash if present
    if (hash !== undefined) {
      if (!combinedHeadingHashes(docsMap, url, linkedDoc).has(hash)) {
        safeMessage(config, vfile, filePath, section, 'link-hash-not-found', [hash, url], position)
      }
    }
  }
}
