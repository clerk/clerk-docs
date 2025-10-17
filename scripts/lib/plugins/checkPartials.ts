// This validator manages the partials in the docs
// based on the options passed through it can
//   - only report warnings if something ain't right
//   - only embed the partials contents in to the markdown
//   - both report warnings and embed the partials contents

import path from 'node:path'
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
    getPartial: (partial: string) =>
      | {
          node: Node
          path: string
        }
      | undefined,
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

      // Check if partialSrc is a valid format (global or relative)
      const isGlobalPartial = partialSrc.startsWith('_partials/')
      const isRelativePartial = partialSrc.startsWith('./') || partialSrc.startsWith('../')

      if (!isGlobalPartial && !isRelativePartial) {
        if (options.reportWarnings === true) {
          safeMessage(config, vfile, file.filePath, 'docs', 'include-src-not-partials', [], node.position)
        }
        return node
      }

      // Resolve the partial path
      let partial: { node: Node; path: string } | undefined

      if (isRelativePartial) {
        // Relative path - resolve relative to the document's directory
        // file.filePathInDocsFolder is like "billing/for-b2c.mdx"
        const docDir = path.dirname(file.filePathInDocsFolder)
        // Resolve relative to the document's directory and normalize the path
        partial = getPartial(path.normalize(path.join(docDir, `${removeMdxSuffix(partialSrc)}.mdx`)))
      } else {
        // Global partial path - keep the full path with _partials/ prefix
        // resolvedPartialPath = `${removeMdxSuffix(partialSrc)}.mdx`
        partial = getPartial(`${removeMdxSuffix(partialSrc)}.mdx`)
      }

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

      foundPartial?.(partial.path)

      if (options.embed === true) {
        return Object.assign(node, partial.node)
      }

      return node
    })
  }
