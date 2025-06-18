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
import { type DocsMap } from '../store'
import { findComponent } from '../utils/findComponent'
import { removeMdxSuffix } from '../utils/removeMdxSuffix'
import { scopeHrefToSDK } from '../utils/scopeHrefToSDK'

export const validateAndEmbedLinks =
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
    const scopeHref = scopeHrefToSDK(config)
    const checkCardsComponentScope = watchComponentScope('Cards')

    return mdastMap(tree, (node) => {
      const inCardsComponent = checkCardsComponentScope(node)

      if (node.type !== 'link') return node
      if (!('url' in node)) return node
      if (typeof node.url !== 'string') return node
      if (!node.url.startsWith(config.baseDocsLink) && (!node.url.startsWith('#') || href === undefined)) return node
      if (!('children' in node)) return node

      // we are overwriting the url with the mdx suffix removed
      node.url = removeMdxSuffix(node.url)

      let [url, hash] = (node.url as string).split('#')

      if (url === '' && href !== undefined) {
        // If the link is just a hash, then we need to link to the same doc
        url = href
      }

      const ignore = config.ignoredPaths(url) || config.ignoredLinks(url)
      if (ignore === true) return node

      const linkedDoc = docsMap.get(url)

      if (linkedDoc === undefined) {
        safeMessage(config, vfile, filePath, section, 'link-doc-not-found', [url], node.position)
        return node
      }

      foundLink?.(linkedDoc.file.filePath)

      if (hash !== undefined) {
        const hasHash = linkedDoc.headingsHashes.has(hash)

        if (hasHash === false) {
          safeMessage(config, vfile, filePath, section, 'link-hash-not-found', [hash, url], node.position)
        }
      }

      if (linkedDoc.sdk === undefined) {
        return node
      }

      // we are specifically skipping over replacing links inside Cards until we can figure out a way to have the cards display what sdks they support
      if (inCardsComponent === true) {
        node.url = scopeHref(url, '~')
        return node
      }

      // we are going to swap it for the sdk link component to give the users a great experience
      const firstChild = node.children?.[0]
      const childIsCodeBlock = firstChild?.type === 'inlineCode'

      if (childIsCodeBlock) {
        firstChild.type = 'text'

        return SDKLink({
          href: `${scopeHref(url, ':sdk:')}${hash !== undefined ? `#${hash}` : ''}`,
          sdks: linkedDoc.sdk,
          code: true,
        })
      }

      return SDKLink({
        href: `${scopeHref(url, ':sdk:')}${hash !== undefined ? `#${hash}` : ''}`,
        sdks: linkedDoc.sdk,
        code: false,
        children: node.children,
      })
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
