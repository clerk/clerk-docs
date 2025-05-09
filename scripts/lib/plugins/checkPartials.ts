// This validator manages the partials in the docs
// based on the options passed through it can
//   - only report warnings if something ain't right
//   - only embed the partials contents in to the markdown
//   - both report warnings and embed the partials contents

import type { BuildConfig } from '../config'
import type { Node } from 'unist'
import type { VFile } from 'vfile'
import { map as mdastMap } from 'unist-util-map'
import { extractComponentPropValueFromNode } from '../utils/extractComponentPropValueFromNode'
import { safeMessage } from '../error-messages'
import { removeMdxSuffix } from '../utils/removeMdxSuffix'

export const checkPartials =
  (
    config: BuildConfig,
    partials: {
      node: Node
      path: string
    }[],
    filePath: string,
    options: {
      reportWarnings: boolean
      embed: boolean
    },
  ) =>
  () =>
  (tree: Node, vfile: VFile) => {
    return mdastMap(tree, (node) => {
      const partialSrc = extractComponentPropValueFromNode(
        config,
        node,
        vfile,
        'Include',
        'src',
        true,
        'docs',
        filePath,
      )

      if (partialSrc === undefined) return node

      if (partialSrc.startsWith('_partials/') === false) {
        if (options.reportWarnings === true) {
          safeMessage(config, vfile, filePath, 'docs', 'include-src-not-partials', [], node.position)
        }
        return node
      }

      const partial = partials.find((partial) => `_partials/${partial.path}` === `${removeMdxSuffix(partialSrc)}.mdx`)

      if (partial === undefined) {
        if (options.reportWarnings === true) {
          safeMessage(
            config,
            vfile,
            filePath,
            'docs',
            'partial-not-found',
            [removeMdxSuffix(partialSrc)],
            node.position,
          )
        }
        return node
      }

      if (options.embed === true) {
        return Object.assign(node, partial.node)
      }

      return node
    })
  }
