import { Node } from 'unist'
import { SKIP, visit as mdastVisit } from 'unist-util-visit'
import type { VFile } from 'vfile'
import { type BuildConfig } from '../config'
import { safeFail } from '../error-messages'
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
    // Still validate that the SDK names are valid, but don't return them
    // for scope checking — notSdk exclusions don't require the excluded
    // SDKs to be in the page's scope.
    extractSDKsFromIfProp(config)(node, vfile, notSdk, 'docs', filePath)
    return undefined
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
      // Skip nodes embedded from partials — their <If> components are validated
      // in the context of each including page, but partials are shared across
      // pages with different SDK scopes, so per-page checks produce false positives.
      if ((node as any).data?.fromPartial) return SKIP

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
            // TODO: Re-enable after clerk/clerk-docs#3265 (mobile custom flows manifest) merges.
            console.warn(`⚠️  TEMPORARILY DISABLED: <If /> sdk "${sdk}" not in frontmatter for ${filePath}`)
          }
        })()
        ;(() => {
          // The doc is generic so we are skipping it
          if (availableSDKs.length === 0) return

          const available = availableSDKs.includes(sdk)

          if (available === false) {
            // TODO: Re-enable after clerk/clerk-docs#3265 (mobile custom flows manifest) merges.
            console.warn(`⚠️  TEMPORARILY DISABLED: <If /> sdk "${sdk}" not in manifest for ${doc.file.href}`)
          }
        })()
      })
    })
  }
