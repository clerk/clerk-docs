// This function takes the value pulled out from
// `extractComponentPropValueFromNode()` and parses it in to
// an array of sdk keys with negation support

import { VFile } from 'vfile'
import { BuildConfig } from '../config'
import type { Node } from 'unist'
import { safeMessage, type WarningsSection } from '../error-messages'
import { isValidSdk, isValidSdks } from '../schemas'

export interface SDKFilter {
  sdks: string[]
  isNegated: boolean
}

export const extractSDKsFromIfProp =
  (config: BuildConfig) =>
  (node: Node, vfile: VFile | undefined, sdkProp: string, section: WarningsSection, filePath: string): SDKFilter | undefined => {
    const isValidItem = isValidSdk(config)
    const isValidItems = isValidSdks(config)

    // Check if the prop contains array syntax
    if (sdkProp.includes('", "') || sdkProp.includes("', '") || sdkProp.includes('["') || sdkProp.includes('"]')) {
      const sdks = JSON.parse(sdkProp.replaceAll("'", '"')) as string[]
      
      // Check if any SDK is negated (starts with !)
      const hasNegation = sdks.some((sdk) => typeof sdk === 'string' && sdk.startsWith('!'))
      
      // Strip ! prefix and validate
      const processedSdks = sdks.map((sdk) => {
        if (typeof sdk === 'string' && sdk.startsWith('!')) {
          return sdk.substring(1)
        }
        return sdk
      })
      
      if (isValidItems(processedSdks)) {
        return { sdks: processedSdks, isNegated: hasNegation }
      } else {
        const invalidSDKs = processedSdks.filter((sdk) => !isValidItem(sdk))
        if (vfile) {
          safeMessage(config, vfile, filePath, section, 'invalid-sdks-in-if', [invalidSDKs], node.position)
        }
      }
    } else {
      // Single SDK value
      const isNegated = sdkProp.startsWith('!')
      const processedSdk = isNegated ? sdkProp.substring(1) : sdkProp
      
      if (isValidItem(processedSdk)) {
        return { sdks: [processedSdk], isNegated }
      } else {
        if (vfile) {
          safeMessage(config, vfile, filePath, section, 'invalid-sdk-in-if', [processedSdk], node.position)
        }
      }
    }
  }
