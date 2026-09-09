import type { Node } from 'unist'
import { visit as mdastVisit } from 'unist-util-visit'
import type { VFile } from 'vfile'
import yaml from 'yaml'
import { type BuildConfig } from '../config'
import { safeFail, safeMessage, WarningsSection } from '../error-messages'
import { isValidSdk, isValidSdks, maintainer as maintainerSchema, tag as tagSchema, type SDK } from '../schemas'

export type Frontmatter = {
  title: string
  description?: string
  sdk?: SDK[]
  tag?: 'experimental' | 'beta' | 'new' | 'legacy' | 'deprecated' | 'removed'
  maintainer?: 'community'
  /**
   * Sidenav label for the SDKs this file renders. Build-only: consumed by the manifest
   * serializer and never written to generated MDX. Only valid on docs with SDK variants.
   */
  navTitle?: string
}

export const extractFrontmatter =
  (
    config: BuildConfig,
    href: string,
    filePath: string,
    section: WarningsSection,
    callback: (frontmatter: Frontmatter) => void,
  ) =>
  () =>
  (tree: Node, vfile: VFile) => {
    const validateSDKs = isValidSdks(config)

    let frontmatter: Frontmatter | undefined = undefined

    mdastVisit(
      tree,
      (node) => node.type === 'yaml' && 'value' in node,
      (node) => {
        if (!('value' in node)) return
        if (typeof node.value !== 'string') return

        const frontmatterYaml: Record<'title' | 'description' | 'sdk' | 'tag' | 'maintainer' | 'navTitle', unknown> =
          yaml.parse(node.value)

        if (frontmatterYaml === null) {
          safeFail(config, vfile, filePath, section, 'frontmatter-missing-title', [], node.position)
          return
        }

        if (frontmatterYaml.title === undefined) {
          safeFail(config, vfile, filePath, section, 'frontmatter-missing-title', [], node.position)
          return
        }

        if (frontmatterYaml.description === undefined) {
          safeMessage(config, vfile, filePath, section, 'frontmatter-missing-description', [], node.position)
        }

        const frontmatterSDKs = (frontmatterYaml.sdk as string | undefined)?.split(', ')

        if (frontmatterSDKs !== undefined && validateSDKs(frontmatterSDKs) === false) {
          const invalidSDKs = frontmatterSDKs.filter((sdk) => isValidSdk(config)(sdk) === false)
          safeFail(
            config,
            vfile,
            filePath,
            section,
            'invalid-sdk-in-frontmatter',
            [invalidSDKs, config.validSdks as SDK[]],
            node.position,
          )
          return
        }

        let tagValue: Frontmatter['tag']
        if (frontmatterYaml.tag !== undefined) {
          const parsed = tagSchema.safeParse(frontmatterYaml.tag)
          if (!parsed.success) {
            safeFail(
              config,
              vfile,
              filePath,
              section,
              'invalid-tag-in-frontmatter',
              [frontmatterYaml.tag as string],
              node.position,
            )
            return
          }
          tagValue = parsed.data
        }

        let maintainerValue: Frontmatter['maintainer']
        if (frontmatterYaml.maintainer !== undefined) {
          const parsed = maintainerSchema.safeParse(frontmatterYaml.maintainer)
          if (!parsed.success) {
            safeFail(
              config,
              vfile,
              filePath,
              section,
              'invalid-maintainer-in-frontmatter',
              [frontmatterYaml.maintainer as string],
              node.position,
            )
            return
          }
          maintainerValue = parsed.data
        }

        let navTitleValue: string | undefined
        if (frontmatterYaml.navTitle !== undefined) {
          const raw = frontmatterYaml.navTitle
          if (typeof raw !== 'string' || raw.trim() === '') {
            safeFail(config, vfile, filePath, section, 'invalid-navtitle-in-frontmatter', [raw], node.position)
            return
          }
          navTitleValue = raw.trim()
        }

        frontmatter = {
          title: frontmatterYaml.title as string,
          description: frontmatterYaml.description as string | undefined,
          sdk: frontmatterSDKs,
          tag: tagValue,
          maintainer: maintainerValue,
          navTitle: navTitleValue,
        }
      },
    )

    if (frontmatter === undefined) {
      safeFail(config, vfile, filePath, section, 'frontmatter-parse-failed', [href])
      return
    }

    callback(frontmatter)
  }
