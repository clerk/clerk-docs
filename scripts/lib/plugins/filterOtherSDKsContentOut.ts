import { filter as mdastFilter } from 'unist-util-filter'
import { type BuildConfig } from '../config'
import { type SDK } from '../schemas'
import { extractComponentPropValueFromNode } from '../utils/extractComponentPropValueFromNode'
import { extractSDKsFromIfProp } from '../utils/extractSDKsFromIfProp'
import type { Node } from 'unist'
import type { VFile } from 'vfile'
import { z } from 'zod'

// Filter out content that is only available to other sdk's
// Only runs for sdk-specific documents

export const filterOtherSDKsContentOut =
  (config: BuildConfig, filePath: string, targetSdk: SDK) => () => (tree: Node, vfile: VFile) => {
    return mdastFilter(tree, (node) => {
      // We aren't passing the vfile here as the as the warning
      // should have already been reported above when we initially
      // parsed the file

      // Check for `notSdk` prop first - if targetSdk is in `notSdk`, filter it out
      const notSdk = extractComponentPropValueFromNode(
        config,
        node,
        undefined,
        'If',
        'notSdk',
        false,
        'docs',
        filePath,
        z.string(),
      )

      if (notSdk !== undefined) {
        const notSdksFilter = extractSDKsFromIfProp(config)(node, undefined, notSdk, 'docs', filePath)

        // If targetSdk is in the notSdk list, filter out this node and its children
        if (notSdksFilter !== undefined && notSdksFilter.includes(targetSdk)) {
          return false
        }

        // If targetSdk is NOT in the notSdk list, keep this node and its children
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

      // If no `sdk` prop and no `notSdk` prop, keep the node
      if (sdk === undefined) return true

      const sdksFilter = extractSDKsFromIfProp(config)(node, undefined, sdk, 'docs', filePath)

      // If we can't parse the sdk prop, keep the node (safer to show than hide)
      if (sdksFilter === undefined) return true

      // If targetSdk is in the sdk list, keep this node and its children
      if (sdksFilter.includes(targetSdk)) {
        return true
      }

      // If targetSdk is NOT in the sdk list, filter out this node and its children
      return false
    })
  }
