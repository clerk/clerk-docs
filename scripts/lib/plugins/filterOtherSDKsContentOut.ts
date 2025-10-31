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
      const sdk = extractComponentPropValueFromNode(
        config,
        node,
        undefined,
        'If',
        'sdk',
        true,
        'docs',
        filePath,
        z.string(),
      )

      if (sdk === undefined) return true

      const sdkFilter = extractSDKsFromIfProp(config)(node, undefined, sdk, 'docs', filePath)

      if (sdkFilter === undefined) return true

      if (sdkFilter.isNegated) {
        // For negated SDKs, show content when targetSdk is NOT in the list
        // For arrays, use AND logic (show only if ALL negated SDKs are not the target)
        return !sdkFilter.sdks.includes(targetSdk)
      } else {
        // For regular SDKs, show content when targetSdk IS in the list
        return sdkFilter.sdks.includes(targetSdk)
      }
    })
  }
