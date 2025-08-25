// This validator manages the typedoc in the docs
// based on the options passed through it can
//   - only report warnings if something ain't right
//   - only embed the typedoc contents in to the markdown
//   - both report warnings and embed the typedoc contents
// This validator will also ensure that the typedoc folder exists

import type { BuildConfig } from '../config'
import type { Node } from 'unist'
import type { VFile } from 'vfile'
import { map as mdastMap } from 'unist-util-map'
import { extractComponentPropValueFromNode } from '../utils/extractComponentPropValueFromNode'
import { errorMessages, safeMessage } from '../error-messages'
import { removeMdxSuffix } from '../utils/removeMdxSuffix'
import { existsSync } from 'node:fs'
import { z } from 'zod'

export const checkTypedoc =
  (
    config: BuildConfig,
    typedocs: { path: string; node: Node }[],
    filePath: string,
    options: { reportWarnings: boolean; embed: boolean },
    foundTypedoc?: (typedoc: string) => void,
  ) =>
  () =>
  (tree: Node, vfile: VFile) => {
    return mdastMap(tree, (node) => {
      const typedocSrc = extractComponentPropValueFromNode(
        config,
        node,
        vfile,
        'Typedoc',
        'src',
        true,
        'docs',
        filePath,
        z.string(),
      )

      if (typedocSrc === undefined) return node

      const typedocFolderExists = existsSync(config.typedocPath)

      if (typedocFolderExists === false && options.reportWarnings === true) {
        throw new Error(errorMessages['typedoc-folder-not-found'](config.typedocPath))
      }

      const typedoc = typedocs.find(({ path }) => path === `${removeMdxSuffix(typedocSrc)}.mdx`)

      if (typedoc === undefined) {
        if (options.reportWarnings === true) {
          safeMessage(
            config,
            vfile,
            filePath,
            'docs',
            'typedoc-not-found',
            [`${removeMdxSuffix(typedocSrc)}.mdx`],
            node.position,
          )
        }
        return node
      }

      foundTypedoc?.(`${removeMdxSuffix(typedocSrc)}.mdx`)

      if (options.embed === true) {
        return Object.assign(node, typedoc.node)
      }

      return node
    })
  }
