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
import { extractComponentPropValueFromNode } from '../utils/extractComponentPropValueFromNode'
import { removeMdxSuffix } from '../utils/removeMdxSuffix'
import { z } from 'zod'
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
      const tooltipSrc = extractComponentPropValueFromNode(
        config,
        node,
        vfile,
        'Tooltip',
        'src',
        true,
        'docs',
        file.filePath,
        z.string(),
      )

      if (tooltipSrc === undefined) return node

      if (tooltipSrc.startsWith('_tooltips/') === false) {
        if (options.reportWarnings === true) {
          safeMessage(config, vfile, file.filePath, 'docs', 'tooltip-src-not-tooltip', [], node.position)
        }
        return node
      }

      const tooltip = tooltips.find((tooltip) => tooltip.path === `${removeMdxSuffix(tooltipSrc)}.mdx`)

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
                name: 'TooltipTitle',
                children: (node as any).children,
              }),
              mdastBuilder('mdxJsxTextElement', {
                name: 'TooltipDescription',
                children: [tooltip.node],
              }),
            ],
          }),
        )
      }

      return node
    })
  }
