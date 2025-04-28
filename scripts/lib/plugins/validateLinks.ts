// Validates
// - remove the mdx suffix from the url
// - check if the link is a valid link
// - check if the link is a link to a sdk scoped page
// - replace the link with the sdk link component if it is a link to a sdk scoped page

import { Node } from 'unist'
import { visit as mdastVisit } from 'unist-util-visit'
import type { VFile } from 'vfile'
import { type BuildConfig } from '../config'
import { safeMessage, type WarningsSection } from '../error-messages'
import { DocsMap } from '../store'
import { removeMdxSuffix } from '../utils/removeMdxSuffix'

export const validateLinks =
  (config: BuildConfig, docsMap: DocsMap, filePath: string, section: WarningsSection, doc?: { href: string }) =>
  () =>
  (tree: Node, vfile: VFile) => {
    return mdastVisit(tree, (node) => {
      if (node.type !== 'link') return
      if (!('url' in node)) return
      if (typeof node.url !== 'string') return
      if (!node.url.startsWith(config.baseDocsLink) && (!node.url.startsWith('#') || doc === undefined)) return
      if (!('children' in node)) return

      // we are overwriting the url with the mdx suffix removed
      node.url = removeMdxSuffix(node.url)

      let [url, hash] = (node.url as string).split('#')

      if (url === '' && doc !== undefined) {
        // If the link is just a hash, then we need to link to the same doc
        url = doc.href
      }

      const ignore = config.ignoredLink(url)
      if (ignore === true) return

      const linkedDoc = docsMap.get(url)

      if (linkedDoc === undefined) {
        safeMessage(config, vfile, filePath, section, 'link-doc-not-found', [url], node.position)
        return
      }

      if (hash !== undefined) {
        const hasHash = linkedDoc.headingsHashes.has(hash)

        if (hasHash === false) {
          safeMessage(config, vfile, filePath, section, 'link-hash-not-found', [hash, url], node.position)
        }
      }

      return
    })
  }
