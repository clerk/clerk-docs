// This validator manages the tooltips in the docs
// based on the options passed through it can
//   - only report warnings if something ain't right
//   - only embed the tooltips contents in to the markdown
//   - both report warnings and embed the tooltips contents

import type { Node } from 'unist'
import { map as mdastMap } from 'unist-util-map'
import type { VFile } from 'vfile'
import type { BuildConfig } from '../config'
import { safeMessage } from '../error-messages'
import type { DocsFile } from '../io'
import { removeMdxSuffix } from '../utils/removeMdxSuffix'
import { u as mdastBuilder } from 'unist-builder'

export const checkTooltips =
  (
    config: BuildConfig,
    tooltips: {
      node: Node
      path: string
    }[],
    file: DocsFile,
    options: {
      reportWarnings: boolean
      embed: boolean
    },
    foundTooltip?: (tooltip: string) => void,
  ) =>
  () =>
  (tree: Node, vfile: VFile) => {
    return mdastMap(tree, (node) => {
      // Tooltips are written as links with the format [trigger](!content)
      // We need to check if the node is a link
      if (node.type !== 'link') return node
      if (!('url' in node)) return node
      if (!('children' in node)) return node
      if (typeof node.url !== 'string') return node

      // Then, check if the link is a tooltip (starts with !)
      // [trigger text](!content)
      if (!node.url.startsWith('!')) return node

      // Access the link properties
      // url of the link = <TooltipContent> e.g. '!content'
      // children (the text content of the link) = <TooltipTrigger> e.g. 'trigger text'
      const url = node.url
      const children = node.children

      // The tooltip content exists in a MDX file e.g. '_tooltips/content.mdx'
      // We need to remove the ! to get the file path e.g. 'content'
      const tooltipSrc = url.substring(1)

      const tooltip = tooltips.find((tooltip) => tooltip.path === `_tooltips/${removeMdxSuffix(tooltipSrc)}.mdx`)

      if (tooltip === undefined) {
        if (options.reportWarnings === true) {
          safeMessage(
            config,
            vfile,
            file.filePath,
            'docs',
            'tooltip-not-found',
            [removeMdxSuffix(tooltipSrc)],
            node.position,
          )
        }
        return node
      }

      foundTooltip?.(`${removeMdxSuffix(tooltipSrc)}.mdx`)

      if (options.embed === true) {
        return Object.assign(
          node,
          mdastBuilder('mdxJsxTextElement', {
            name: 'Tooltip',
            attributes: [],
            children: [
              mdastBuilder('mdxJsxTextElement', {
                name: 'TooltipTrigger',
                children: children,
              }),
              mdastBuilder('mdxJsxTextElement', {
                name: 'TooltipContent',
                children: [tooltip.node],
              }),
            ],
          }),
        )
      }

      return node
    })
  }
