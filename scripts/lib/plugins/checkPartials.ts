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
import { resolvePartialPath } from '../utils/resolvePartialPath'
import { z } from 'zod'

const stringSchema = z.string()

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
        stringSchema,
      )

      if (partialSrc === undefined) return node

      // Check if partialSrc is a valid format (global or relative)
      const resolvedPartialPath = resolvePartialPath(file.filePathInDocsFolder, partialSrc)

      if (resolvedPartialPath === undefined) {
        if (options.reportWarnings === true) {
          safeMessage(config, vfile, file.filePath, 'docs', 'include-src-not-partials', [], node.position)
        }
        return node
      }

      // Find the partial in the partials array
      // Partials are stored with their path relative to the docs folder
      // Global partials: "_partials/billing/enable-billing.mdx"
      // Relative partials: "billing/_partials/local.mdx"
      const partial = partials.find((partial) => partial.path === resolvedPartialPath)

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

      foundPartial?.(resolvedPartialPath)

      if (options.embed === true) {
        const result = Object.assign(node, partial.node)
        // Mark all nodes in the partial subtree so validators can distinguish
        // embedded content from content authored directly in the host page.
        const markFromPartial = (n: Node) => {
          ;(n as any).data = { ...(n as any).data, fromPartial: true }
          if ('children' in n && Array.isArray((n as any).children)) {
            ;(n as any).children.forEach(markFromPartial)
          }
        }
        markFromPartial(result)
        return result
      }

      return node
    })
  }
