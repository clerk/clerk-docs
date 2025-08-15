import type { Node } from 'unist'
import { visit as mdastVisit } from 'unist-util-visit'
import type { VFile } from 'vfile'
import yaml from 'yaml'
import { type BuildConfig } from '../config'
import { safeFail, safeMessage, WarningsSection } from '../error-messages'
import { isValidSdk, isValidSdks, type SDK } from '../schemas'

export type Frontmatter = {
  title: string
  description?: string
  sdk?: SDK[]
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

        const frontmatterYaml: Record<'title' | 'description' | 'sdk', string | undefined> = yaml.parse(node.value)

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

        const frontmatterSDKs = frontmatterYaml.sdk?.split(', ')

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

        frontmatter = {
          title: frontmatterYaml.title,
          description: frontmatterYaml.description,
          sdk: frontmatterSDKs,
        }
      },
    )

    if (frontmatter === undefined) {
      safeFail(config, vfile, filePath, section, 'frontmatter-parse-failed', [href])
      return
    }

    callback(frontmatter)
  }
