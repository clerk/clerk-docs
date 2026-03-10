import { Node } from 'unist'
import { map as mdastMap } from 'unist-util-map'
import type { VFile } from 'vfile'
import type { BuildConfig } from '../config'
import { type WarningsSection, safeMessage } from '../error-messages'
import type { DocsMap } from '../store'
import { removeMdxSuffix } from '../utils/removeMdxSuffix'

// Match clerk.com/docs URLs but require a path after /docs (not just /docs or /docs/)
const CLERK_DOCS_URL_PATTERN = /https?:\/\/clerk\.com(\/docs\/[^\s\)\]"'`}]+)/g

/**
 * Remark plugin to validate Markdown links in documentation.
 * - Checks that internal doc links point to existing documents.
 * - Checks that clerk.com/docs URLs in code block comments point to existing documents.
 * - Optionally tracks found links via callback.
 * - Warns if a link points to a missing document or heading.
 * - Skips ignored paths and links.
 */
export const validateLinks =
  (
    config: BuildConfig,
    docsMap: DocsMap,
    filePath: string,
    section: WarningsSection,
    foundLink?: (link: string) => void,
    href?: string,
  ) =>
  () =>
  (tree: Node, vfile: VFile) => {
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
        const combinedHeadingHashes = new Set(linkedDoc.headingsHashes)

        if (linkedDoc.distinctSDKVariants) {
          linkedDoc.distinctSDKVariants.forEach((sdk) => {
            const distinctSDKVariant = docsMap.get(`${url}.${sdk}`)

            if (distinctSDKVariant === undefined) return

            distinctSDKVariant.headingsHashes.forEach((headingHash) => {
              combinedHeadingHashes.add(headingHash)
            })
          })
        }

        const hasHash = combinedHeadingHashes.has(hash)

        if (hasHash === false) {
          safeMessage(config, vfile, filePath, section, 'link-hash-not-found', [hash, url], node.position)
        }
      }

      return node
    })
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
  const lines = codeValue.split('\n')

  for (const line of lines) {
    // Only check lines that look like comments
    const isComment = line.includes('//') || line.includes('#') || line.includes('/*') || line.includes('*/')
    if (!isComment) continue

    // Find all clerk.com/docs URLs
    const matches = line.matchAll(CLERK_DOCS_URL_PATTERN)
    for (const match of matches) {
      // match[1] is the captured group: /docs/...
      const fullPath = match[1].replace(/[,;:\.]+$/, '').replace(/\)+$/, '')
      const [url, hash] = fullPath.split('#')

      const ignore = config.ignoredPaths(url) || config.ignoredLinks(url)
      if (ignore === true) continue

      const linkedDoc = docsMap.get(url)

      if (linkedDoc === undefined) {
        safeMessage(config, vfile, filePath, section, 'link-doc-not-found', [match[0], `${url}.mdx`], position)
        continue
      }

      // Validate hash if present
      if (hash !== undefined) {
        const combinedHeadingHashes = new Set(linkedDoc.headingsHashes)

        if (linkedDoc.distinctSDKVariants) {
          linkedDoc.distinctSDKVariants.forEach((sdk) => {
            const distinctSDKVariant = docsMap.get(`${url}.${sdk}`)
            if (distinctSDKVariant === undefined) return
            distinctSDKVariant.headingsHashes.forEach((headingHash) => {
              combinedHeadingHashes.add(headingHash)
            })
          })
        }

        if (!combinedHeadingHashes.has(hash)) {
          safeMessage(config, vfile, filePath, section, 'link-hash-not-found', [hash, url], position)
        }
      }
    }
  }
}
