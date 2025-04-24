// Validates
// - remove the mdx suffix from the url
// - check if the link is a valid link
// - check if the link is a link to a sdk scoped page
// - replace the link with the sdk link component if it is a link to a sdk scoped page

import { Node } from 'unist'
import { map as mdastMap } from 'unist-util-map'
import type { VFile } from 'vfile'
import { SDKLink } from '../components/SDKLink'
import { type BuildConfig } from '../config'
import { safeMessage, type WarningsSection } from '../error-messages'
import { DocsMap } from '../store'
import { removeMdxSuffix } from '../utils/removeMdxSuffix'
import { scopeHrefToSDK } from '../utils/scopeHrefToSDK'

export const validateAndEmbedLinks =
  (config: BuildConfig, docsMap: DocsMap, filePath: string, section: WarningsSection) =>
  () =>
  (tree: Node, vfile: VFile) => {
    return mdastMap(tree, (node) => {
      if (node.type !== 'link') return node
      if (!('url' in node)) return node
      if (typeof node.url !== 'string') return node
      if (!node.url.startsWith(config.baseDocsLink)) return node
      if (!('children' in node)) return node

      // we are overwriting the url with the mdx suffix removed
      node.url = removeMdxSuffix(node.url)

      const [url, hash] = (node.url as string).split('#')

      const ignore = config.ignoredLink(url)
      if (ignore === true) return node

      const doc = docsMap.get(url)

      if (doc === undefined) {
        safeMessage(config, vfile, filePath, section, 'link-doc-not-found', [url], node.position)
        return node
      }

      if (hash !== undefined) {
        const hasHash = doc.headingsHashes.has(hash)

        if (hasHash === false) {
          safeMessage(config, vfile, filePath, section, 'link-hash-not-found', [hash, url], node.position)
        }
      }

      if (doc.sdk !== undefined) {
        // we are going to swap it for the sdk link component to give the users a great experience

        const firstChild = node.children?.[0]
        const childIsCodeBlock = firstChild?.type === 'inlineCode'

        if (childIsCodeBlock) {
          firstChild.type = 'text'

          return SDKLink({
            href: scopeHrefToSDK(config)(url, ':sdk:'),
            sdks: doc.sdk,
            code: true,
          })
        }

        return SDKLink({
          href: scopeHrefToSDK(config)(url, ':sdk:'),
          sdks: doc.sdk,
          code: false,
          children: node.children,
        })
      }

      return node
    })
  }
