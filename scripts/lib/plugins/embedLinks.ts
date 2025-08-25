import { Node } from 'unist'
import { map as mdastMap } from 'unist-util-map'
import type { VFile } from 'vfile'
import { SDKLink } from '../components/SDKLink'
import type { BuildConfig } from '../config'
import type { WarningsSection } from '../error-messages'
import type { DocsMap } from '../store'
import { findComponent } from '../utils/findComponent'
import { removeMdxSuffix } from '../utils/removeMdxSuffix'
import { scopeHrefToSDK } from '../utils/scopeHrefToSDK'
import { SDK } from '../schemas'

/**
 * Remark plugin to transform Markdown links to SDK-aware links.
 * - Rewrites internal doc links to use <SDKLink> when appropriate.
 * - Injects SDK scoping into links for multi-SDK docs.
 * - Optionally tracks found links via callback.
 * - Skips links to ignored paths or links.
 */
export const embedLinks =
  (config: BuildConfig, docsMap: DocsMap, docSDKs: SDK[], foundLink?: (link: string) => void, href?: string) =>
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
        return node
      }

      foundLink?.(linkedDoc.file.filePath)

      if (linkedDoc.sdk === undefined) {
        return node
      }

      const linkedDocSDKs = [...(linkedDoc.sdk ?? []), ...(linkedDoc.distinctSDKVariants ?? [])]

      // Check if all SDKs for the current document are also present in the linked document.
      // If true, the link does not need to be SDK-scoped, as the SDK context is already compatible.
      const usesTheSameSDKs = linkedDocSDKs.every((sdk) => docSDKs.includes(sdk))

      if (usesTheSameSDKs) {
        return node
      }

      const injectSDK =
        linkedDoc.frontmatter.sdk !== undefined &&
        // Don't inject SDK scoping for single SDK scenarios (only one valid SDK + document supports that SDK)
        linkedDoc.frontmatter.sdk.length > 1 &&
        !url.endsWith(`/${linkedDoc.frontmatter.sdk[0]}`) &&
        !url.includes(`/${linkedDoc.frontmatter.sdk[0]}/`)

      // we are specifically skipping over replacing links inside Cards until we can figure out a way to have the cards display what sdks they support
      if (inCardsComponent === true) {
        return node
      }

      // we are going to swap it for the sdk link component to give the users a great experience
      const firstChild = node.children?.[0]
      const childIsCodeBlock = firstChild?.type === 'inlineCode'

      const scopedHref = `${injectSDK ? scopeHref(url, ':sdk:') : url}${hash !== undefined ? `#${hash}` : ''}`

      if (childIsCodeBlock) {
        firstChild.type = 'text'

        return SDKLink({
          href: scopedHref,
          sdks: [...(linkedDoc.sdk ?? []), ...(linkedDoc.distinctSDKVariants ?? [])],
          code: true,
        })
      }

      return SDKLink({
        href: scopedHref,
        sdks: [...(linkedDoc.sdk ?? []), ...(linkedDoc.distinctSDKVariants ?? [])],
        code: false,
        children: node.children,
      })
    })
  }

/**
 * Tracks whether the current node is within the scope of a specified component in the AST.
 * Returns a function that, when called with a node, returns true if the node is inside the component,
 * and false otherwise. Useful for context-aware processing (e.g., skipping link replacements inside certain components).
 */
export function watchComponentScope(componentName: string) {
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
