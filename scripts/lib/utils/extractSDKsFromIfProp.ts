// This function takes the value pulled out from
// `extractComponentPropValueFromNode()` and parses it in to
// an array of sdk keys

import { VFile } from 'vfile'
import { BuildConfig } from '../config'
import type { Node } from 'unist'
import { safeMessage, type WarningsSection } from '../error-messages'
import { isValidSdk, isValidSdks } from '../schemas'

export const extractSDKsFromIfProp =
  (config: BuildConfig) =>
  (node: Node, vfile: VFile | undefined, sdkProp: string, section: WarningsSection, filePath: string) => {
    const isValidItem = isValidSdk(config)
    const isValidItems = isValidSdks(config)

    if (sdkProp.includes('", "') || sdkProp.includes("', '") || sdkProp.includes('["') || sdkProp.includes('"]')) {
      const sdks = JSON.parse(sdkProp.replaceAll("'", '"')) as string[]
      if (isValidItems(sdks)) {
        return sdks
      } else {
        const invalidSDKs = sdks.filter((sdk) => !isValidItem(sdk))
        if (vfile) {
          safeMessage(config, vfile, filePath, section, 'invalid-sdks-in-if', [invalidSDKs], node.position)
        }
      }
    } else {
      if (isValidItem(sdkProp)) {
        return [sdkProp]
      } else {
        if (vfile) {
          safeMessage(config, vfile, filePath, section, 'invalid-sdk-in-if', [sdkProp], node.position)
        }
      }
    }
  }
