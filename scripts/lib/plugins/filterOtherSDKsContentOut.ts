import { filter as mdastFilter } from 'unist-util-filter'
import { type BuildConfig } from '../config'
import { type SDK } from '../schemas'
import { extractComponentPropValueFromNode } from '../utils/extractComponentPropValueFromNode'
import { extractSDKsFromIfProp } from '../utils/extractSDKsFromIfProp'
import type { Node } from 'unist'
import type { VFile } from 'vfile'
import { z } from 'zod'

// filter out content that is only available to other sdk's

export const filterOtherSDKsContentOut =
  (config: BuildConfig, filePath: string, targetSdk: SDK) => () => (tree: Node, vfile: VFile) => {
    return mdastFilter(tree, (node) => {
      // We aren't passing the vfile here as the as the warning
      // should have already been reported above when we initially
      // parsed the file

      // Check for `not` prop first - if targetSdk is in `not`, filter it out
      const notSdk = extractComponentPropValueFromNode(
        config,
        node,
        undefined,
        'If',
        'not',
        false,
        'docs',
        filePath,
        z.string(),
      )

      if (notSdk !== undefined) {
        const notSdksFilter = extractSDKsFromIfProp(config)(node, undefined, notSdk, 'docs', filePath)

        if (notSdksFilter !== undefined && notSdksFilter.includes(targetSdk)) {
          return false
        }

        return true
      }

      // Then check for `sdk` prop
      const sdk = extractComponentPropValueFromNode(
        config,
        node,
        undefined,
        'If',
        'sdk',
        false,
        'docs',
        filePath,
        z.string(),
      )

      // If no `sdk` prop and no `not` prop (or `not` didn't match), keep the node
      if (sdk === undefined) return true

      const sdksFilter = extractSDKsFromIfProp(config)(node, undefined, sdk, 'docs', filePath)

      if (sdksFilter === undefined) return true

      if (sdksFilter.includes(targetSdk)) {
        return true
      }

      return false
    })
  }
