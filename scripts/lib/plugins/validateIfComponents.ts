import { Node } from 'unist'
import { visit as mdastVisit } from 'unist-util-visit'
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

/**
 * Validates the SDKs in the <If /> component against the SDKs declared in the frontmatter and the manifest.
 * Set `ignoreSdkWarning` on an `<If>` to skip these checks (e.g. shared partials embedded in a single-SDK guide).
 */
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
          const sdk = extractComponentPropValueFromNode(
            config,
            node,
            vfile,
            'If',
            'sdk',
            false,
            'docs',
            filePath,
            z.string(),
          )
          const notSdk = extractComponentPropValueFromNode(
            config,
            node,
            vfile,
            'If',
            'notSdk',
            false,
            'docs',
            filePath,
            z.string(),
          )
          const ignoreSdkWarning = extractComponentPropValueFromNode(
            config,
            node,
            vfile,
            'If',
            'ignoreSdkWarning',
            false,
            'docs',
            filePath,
            z.boolean(),
          )

          const allowedSdks = extractSDKsFromIfComponent(config, node, vfile, filePath, sdk, notSdk)

          if (allowedSdks === undefined) return

          // Partials are shared across pages with different SDK scopes, so
          // scope validation (frontmatter/manifest checks) at the embedding site
          // would produce false positives. Prop parsing above still validates
          // SDK names and catches sdk+notSdk misuse.
          if ((node as any).data?.fromPartial) return

          // If the `ignoreSdkWarning` prop is true, skip the validation checks
          if (ignoreSdkWarning === true) return

          const manifestItems = flatSDKScopedManifest.filter((item) => item.href === doc.file.href)

          const availableSDKs = manifestItems.flatMap((item) => item.sdk).filter(Boolean)

          // The doc doesn't exist in the manifest so we are skipping it
          if (manifestItems.length === 0) return

          allowedSdks.forEach((sdk) => {
            ; (() => {
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
              ; (() => {
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
