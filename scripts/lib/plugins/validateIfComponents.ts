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
      const manifestItems = flatSDKScopedManifest.filter((item) => item.href === doc.file.href)

      const availableSDKs = manifestItems.flatMap((item) => item.sdk).filter(Boolean)

      // The doc doesn't exist in the manifest so we are skipping it
      if (manifestItems.length === 0) return

      // Validate `sdk` prop
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

      // Validate `not` prop
      const notSdk = extractComponentPropValueFromNode(
        config,
        node,
        vfile,
        'If',
        'not',
        false,
        'docs',
        filePath,
        z.string(),
      )

      if (sdk && notSdk) {
        safeMessage(
          config,
          vfile,
          filePath,
          'docs',
          'if-component-sdk-and-not-sdk-props-cannot-be-used-together',
          [],
          node.position,
        )
      }

      if (sdk !== undefined) {
        const sdksFilter = extractSDKsFromIfProp(config)(node, vfile, sdk, 'docs', filePath)

        if (sdksFilter !== undefined) {
          sdksFilter.forEach((sdk) => {
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
        }
      }

      if (notSdk !== undefined) {
        const notSdksFilter = extractSDKsFromIfProp(config)(node, vfile, notSdk, 'docs', filePath)

        if (notSdksFilter !== undefined) {
          notSdksFilter.forEach((sdk) => {
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
        }
      }
    })
  }
