// This validator manages the partials in the docs
// based on the options passed through it can
//   - only report warnings if something ain't right
//   - only embed the partials contents in to the markdown
//   - both report warnings and embed the partials contents

import type { Node } from 'unist'
import { map as mdastMap } from 'unist-util-map'
import type { VFile } from 'vfile'
import type { BuildConfig } from '../config'
import { safeMessage } from '../error-messages'
import type { DocsFile } from '../io'
import { extractComponentPropValueFromNode } from '../utils/extractComponentPropValueFromNode'
import { removeMdxSuffix } from '../utils/removeMdxSuffix'
import { z } from 'zod'

export const checkPartials =
  (
    config: BuildConfig,
    partials: {
      node: Node
      path: string
    }[],
    file: DocsFile,
    options: {
      reportWarnings: boolean
      embed: boolean
    },
    foundPartial?: (partial: string) => void,
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
        file.filePath,
        z.string(),
      )

      if (partialSrc === undefined) return node

      if (partialSrc.startsWith('_partials/') === false) {
        if (options.reportWarnings === true) {
          safeMessage(config, vfile, file.filePath, 'docs', 'include-src-not-partials', [], node.position)
        }
        return node
      }

      const partial = partials.find((partial) => `_partials/${partial.path}` === `${removeMdxSuffix(partialSrc)}.mdx`)

      if (partial === undefined) {
        if (options.reportWarnings === true) {
          safeMessage(
            config,
            vfile,
            file.filePath,
            'docs',
            'partial-not-found',
            [removeMdxSuffix(partialSrc)],
            node.position,
          )
        }
        return node
      }

      foundPartial?.(`${removeMdxSuffix(partialSrc)}.mdx`)

      if (options.embed === true) {
        return Object.assign(node, partial.node)
      }

      return node
    })
  }
