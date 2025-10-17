import { Node } from 'unist'
import { visit as mdastVisit } from 'unist-util-visit'
import { map as mdastMap } from 'unist-util-map'
import type { VFile } from 'vfile'
import { SDKLink } from '../components/SDKLink'
import type { BuildConfig } from '../config'
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
  (
    config: BuildConfig,
    docsMap: DocsMap,
    docSDKs: SDK[],
    foundLink?: (link: string) => void,
    href?: string,
    currentPageSDK?: SDK,
  ) =>
  () =>
  (tree: Node, vfile: VFile) => {
    const scopeHref = scopeHrefToSDK(config)
    const checkCardsComponentScope = watchComponentScope('Cards')
    const definitions: Record<string, { url: string; title?: string }> = {}

    // Collect reference-style link definitions like: [ref]: /docs/path#hash "Title"
    mdastVisit(tree, 'definition', (def: any) => {
      if (typeof def.identifier === 'string' && typeof def.url === 'string') {
        definitions[def.identifier] = { url: def.url, title: def.title }
      }
    })

    return mdastMap(tree, (node) => {
      const inCardsComponent = checkCardsComponentScope(node)

      // Resolve reference-style links to concrete link nodes first
      if (node.type === 'linkReference') {
        const identifier = (node as any).identifier as string | undefined
        if (identifier && definitions[identifier]) {
          const def = definitions[identifier]
          const resolved: any = {
            type: 'link',
            url: def.url,
            title: def.title,
            children: (node as any).children ?? [],
            position: (node as any).position,
          }
          node = resolved as unknown as Node
        } else {
          return node
        }
      }

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

      // Is the page we are currently rendering, compatible with the linked page?
      // If no current page sdk is provided, we assume it is compatible
      const targetSdkSupported = currentPageSDK ? linkedDocSDKs.includes(currentPageSDK) : true

      // Does the linked page support more than one sdk?
      const linkedDocIsMultiSDK = linkedDocSDKs.length > 1

      // Do the linked page and the current page use exactly the same sdk?
      const usesTheSameSDKs = linkedDocSDKs.every((sdk) => docSDKs.includes(sdk))

      const shouldConvertToSDKLink = !targetSdkSupported || linkedDocIsMultiSDK || !usesTheSameSDKs

      // In these cases, we don't need to convert to a SDKLink
      if (!shouldConvertToSDKLink) return node

      const injectSDK =
        linkedDocSDKs !== undefined &&
        // Don't inject SDK scoping for single SDK scenarios (only one valid SDK + document supports that SDK)
        linkedDocSDKs.length > 1 &&
        !linkedDocSDKs.some((sdk) => url.endsWith(`/${sdk}`) || url.includes(`/${sdk}/`))

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
          sdks: linkedDocSDKs,
          code: true,
        })
      }

      return SDKLink({
        href: scopedHref,
        sdks: linkedDocSDKs,
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
