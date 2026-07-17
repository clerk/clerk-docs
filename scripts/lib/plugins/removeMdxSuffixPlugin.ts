import type { Node } from 'unist'
import { map as mdastMap } from 'unist-util-map'
import type { VFile } from 'vfile'
import type { BuildConfig } from '../config'
import { removeMdxSuffix } from '../utils/removeMdxSuffix'

// Process links in partials and remove the .mdx suffix
export const removeMdxSuffixPlugin = (config: BuildConfig) => () => (tree: Node, vfile: VFile) => {
  return mdastMap(tree, (node) => {
    if (node.type !== 'link') return node
    if (!('url' in node)) return node
    if (typeof node.url !== 'string') return node
    if (!node.url.startsWith(config.baseDocsLink)) return node
    if (!('children' in node)) return node

    // We are overwriting the url with the mdx suffix removed
    node.url = removeMdxSuffix(node.url)

    return node
  })
}
