import { Node } from 'unist'
import { visit as mdastVisit } from 'unist-util-visit'
import type { VFile } from 'vfile'
import { type BuildConfig } from '../config'
import { safeFail, safeMessage } from '../error-messages'
import { ManifestItem } from '../manifest'
import { type SDK } from '../schemas'
import { extractComponentPropValueFromNode } from '../utils/extractComponentPropValueFromNode'
import { extractSDKsFromIfProp } from '../utils/extractSDKsFromIfProp'
import { z } from 'zod'

/**
 * Extracts list of allowed SDKs from the `sdk` and `notSdk` props of the <If /> component
 */
function extractSDKsFromIfComponent(
  config: BuildConfig,
  node: Node,
  vfile: VFile,
  filePath: string,
  sdk: string | undefined,
  notSdk: string | undefined,
) {
  if (sdk && notSdk) {
    safeFail(
      config,
      vfile,
      filePath,
      'docs',
      'if-component-sdk-and-not-sdk-props-cannot-be-used-together',
      [],
      node.position,
    )
  }

  if (notSdk) {
    const notAllowedSdks = extractSDKsFromIfProp(config)(node, vfile, notSdk, 'docs', filePath)
    return notAllowedSdks
  }

  if (sdk) {
    const allowedSdks = extractSDKsFromIfProp(config)(node, vfile, sdk, 'docs', filePath)
    return allowedSdks
  }

  // Don't throw an error if neither `sdk` nor `notSdk` is present
  // because <If> accepts a `condition` prop
  return undefined
}

export const validateIfComponents =
  (
    config: BuildConfig,
    filePath: string,
    doc: { file: { href: string }; sdk?: SDK[] },
    flatSDKScopedManifest: ManifestItem[],
  ) =>
  () =>
  (tree: Node, vfile: VFile) => {
    mdastVisit(tree, (node) => {
      const allowedSdks = extractSDKsFromIfComponent(
        config,
        node,
        vfile,
        filePath,
        extractComponentPropValueFromNode(config, node, vfile, 'If', 'sdk', false, 'docs', filePath, z.string()),
        extractComponentPropValueFromNode(config, node, vfile, 'If', 'notSdk', false, 'docs', filePath, z.string()),
      )

      if (allowedSdks === undefined) return

      const manifestItems = flatSDKScopedManifest.filter((item) => item.href === doc.file.href)

      const availableSDKs = manifestItems.flatMap((item) => item.sdk).filter(Boolean)

      // The doc doesn't exist in the manifest so we are skipping it
      if (manifestItems.length === 0) return

      allowedSdks.forEach((sdk) => {
        ;(() => {
          if (doc.sdk === undefined) return

          const available = doc.sdk.includes(sdk)

          if (available === false) {
            safeFail(
              config,
              vfile,
              filePath,
              'docs',
              'if-component-sdk-not-in-frontmatter',
              [sdk, doc.sdk],
              node.position,
            )
          }
        })()
        ;(() => {
          // The doc is generic so we are skipping it
          if (availableSDKs.length === 0) return

          const available = availableSDKs.includes(sdk)

          if (available === false) {
            safeFail(
              config,
              vfile,
              filePath,
              'docs',
              'if-component-sdk-not-in-manifest',
              [sdk, doc.file.href],
              node.position,
            )
          }
        })()
      })
    })
  }
