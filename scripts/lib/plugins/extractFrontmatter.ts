import type { Node } from 'unist'
import { visit as mdastVisit } from 'unist-util-visit'
import type { VFile } from 'vfile'
import yaml from 'yaml'
import { type BuildConfig } from '../config'
import { safeFail, safeMessage, WarningsSection } from '../error-messages'
import { isValidSdk, isValidSdks, type SDK } from '../schemas'

export const LLMS_TEXT_SECTIONS = ['Quick Start', 'Guide', 'Component', 'Reference'] as const
export type LlmsTextSection = (typeof LLMS_TEXT_SECTIONS)[number]

export type LlmsText = {
  include?: boolean
  section?: LlmsTextSection | true
}

export type Frontmatter = {
  title: string
  description?: string
  sdk?: SDK[]
  llmsText?: LlmsText
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

        const frontmatterYaml: Record<string, unknown> = yaml.parse(node.value)

        if (frontmatterYaml === null) {
          safeFail(config, vfile, filePath, section, 'frontmatter-missing-title', [], node.position)
          return
        }

        const title = frontmatterYaml.title
        const description = frontmatterYaml.description
        const sdkRaw = frontmatterYaml.sdk

        if (typeof title !== 'string') {
          safeFail(config, vfile, filePath, section, 'frontmatter-missing-title', [], node.position)
          return
        }

        if (typeof description !== 'string') {
          safeMessage(config, vfile, filePath, section, 'frontmatter-missing-description', [], node.position)
        }

        const frontmatterSDKs = typeof sdkRaw === 'string' ? sdkRaw.split(', ') : undefined

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

        let llmsText: LlmsText | undefined = undefined
        const llmsTextRaw = frontmatterYaml.llmsText

        if (llmsTextRaw !== undefined) {
          if (typeof llmsTextRaw !== 'object' || llmsTextRaw === null || Array.isArray(llmsTextRaw)) {
            safeFail(config, vfile, filePath, section, 'llms-text-shape-invalid', [], node.position)
            return
          }

          const includeRaw = (llmsTextRaw as Record<string, unknown>).include
          const sectionRaw = (llmsTextRaw as Record<string, unknown>).section

          if (includeRaw !== undefined && typeof includeRaw !== 'boolean') {
            safeFail(config, vfile, filePath, section, 'llms-text-shape-invalid', [], node.position)
            return
          }

          let parsedSection: LlmsTextSection | true | undefined = undefined
          if (sectionRaw === true) {
            parsedSection = true
          } else if (typeof sectionRaw === 'string') {
            if (!LLMS_TEXT_SECTIONS.includes(sectionRaw as LlmsTextSection)) {
              safeFail(
                config,
                vfile,
                filePath,
                section,
                'invalid-llms-text-section',
                [sectionRaw, LLMS_TEXT_SECTIONS as unknown as string[]],
                node.position,
              )
              return
            }
            parsedSection = sectionRaw as LlmsTextSection
          } else if (sectionRaw !== undefined) {
            safeFail(config, vfile, filePath, section, 'llms-text-shape-invalid', [], node.position)
            return
          }

          llmsText = {
            include: includeRaw,
            section: parsedSection,
          }

          if (includeRaw === true && typeof description !== 'string') {
            safeFail(config, vfile, filePath, section, 'llms-text-missing-description', [], node.position)
            return
          }
        }

        frontmatter = {
          title,
          description: typeof description === 'string' ? description : undefined,
          sdk: frontmatterSDKs,
          llmsText,
        }
      },
    )

    if (frontmatter === undefined) {
      safeFail(config, vfile, filePath, section, 'frontmatter-parse-failed', [href])
      return
    }

    callback(frontmatter)
  }
