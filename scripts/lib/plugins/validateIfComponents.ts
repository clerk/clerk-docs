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

      if (sdk === undefined) return

      const sdksFilter = extractSDKsFromIfProp(config)(node, vfile, sdk, 'docs', filePath)

      if (sdksFilter === undefined) return

      const manifestItems = flatSDKScopedManifest.filter((item) => item.href === doc.file.href)

      const availableSDKs = manifestItems.flatMap((item) => item.sdk).filter(Boolean)

      // The doc doesn't exist in the manifest so we are skipping it
      if (manifestItems.length === 0) return

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
    })
  }
