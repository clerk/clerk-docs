import { Node } from 'unist'
import { map as mdastMap } from 'unist-util-map'
import type { VFile } from 'vfile'
import type { BuildConfig } from '../config'
import { type WarningsSection, safeMessage } from '../error-messages'
import type { DocsMap } from '../store'
import { removeMdxSuffix } from '../utils/removeMdxSuffix'

/**
 * Remark plugin to validate Markdown links in documentation.
 * - Checks that internal doc links point to existing documents.
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
