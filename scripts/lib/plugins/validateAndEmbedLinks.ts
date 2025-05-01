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
import { findComponent } from '../utils/findComponent'
import { type ExternalLinks, isExternalLink } from '../external-links'

export const validateAndEmbedLinks =
  (
    config: BuildConfig,
    docsMap: DocsMap,
    externalLinks: ExternalLinks,
    filePath: string,
    section: WarningsSection,
    doc?: { href: string },
  ) =>
  () =>
  (tree: Node, vfile: VFile) => {
    const checkCardsComponentScope = watchComponentScope('Cards')

    return mdastMap(tree, (node) => {
      const inCardsComponent = checkCardsComponentScope(node)

      if (node.type !== 'link') return node
      if (!('url' in node)) return node
      if (typeof node.url !== 'string') return node
      // if (!node.url.startsWith(config.baseDocsLink) && (!node.url.startsWith('#') || doc === undefined)) return node
      if (!node.url.startsWith(config.baseDocsLink)) {
        if (isExternalLink(node.url)) {
          externalLinks.add(node.url)
          return node
        }

        if (doc === undefined) {
          return node
        }

        if (!node.url.startsWith('#')) {
          return node
        }
      }
      if (!('children' in node)) return node

      // we are overwriting the url with the mdx suffix removed
      node.url = removeMdxSuffix(node.url)

      let [url, hash] = (node.url as string).split('#')

      if (url === '' && doc !== undefined) {
        // If the link is just a hash, then we need to link to the same doc
        url = doc.href
      }

      const ignore = config.ignoredLink(url)
      if (ignore === true) return node

      const linkedDoc = docsMap.get(url)

      if (linkedDoc === undefined) {
        safeMessage(config, vfile, filePath, section, 'link-doc-not-found', [url], node.position)
        return node
      }

      if (hash !== undefined) {
        const hasHash = linkedDoc.headingsHashes.has(hash)

        if (hasHash === false) {
          safeMessage(config, vfile, filePath, section, 'link-hash-not-found', [hash, url], node.position)
        }
      }

      // we are specifically skipping over replacing links inside Cards until we can figure out a way to have the cards display what sdks they support
      if (inCardsComponent === false) {
        if (linkedDoc.sdk !== undefined) {
          // we are going to swap it for the sdk link component to give the users a great experience

          const firstChild = node.children?.[0]
          const childIsCodeBlock = firstChild?.type === 'inlineCode'

          if (childIsCodeBlock) {
            firstChild.type = 'text'

            return SDKLink({
              href: `${scopeHrefToSDK(config)(url, ':sdk:')}${hash !== undefined ? `#${hash}` : ''}`,
              sdks: linkedDoc.sdk,
              code: true,
            })
          }

          return SDKLink({
            href: `${scopeHrefToSDK(config)(url, ':sdk:')}${hash !== undefined ? `#${hash}` : ''}`,
            sdks: linkedDoc.sdk,
            code: false,
            children: node.children,
          })
        }
      } else {
        node.url = node.url + '?instant-redirect=true'
      }

      return node
    })
  }

function watchComponentScope(componentName: string) {
  let inComponent = false
  let offset: number | null = null

  return (node: Node) => {
    if (findComponent(node, componentName)) {
      inComponent = true
      offset = node.position?.end?.offset ?? 0
    }

    if (inComponent && offset !== null && node.position?.start?.offset && node.position.start.offset > offset) {
      inComponent = false
      offset = null
    }

    return inComponent
  }
}
