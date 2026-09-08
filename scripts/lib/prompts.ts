import type { BuildConfig } from './config'
import fs from 'node:fs/promises'
import path from 'node:path'

export interface Prompt {
  filePath: string
  name: string
  content: string
}

export async function readPrompts(config: BuildConfig) {
  const { inputPath, outputPath } = config.prompts ?? {}
  if (!inputPath || !outputPath) {
    throw new Error('Prompts paths not configured')
  }

  const files = await fs.readdir(inputPath)

  return await Promise.all(
    files.map(async (file) => {
      return {
        filePath: path.join('prompts', file),
        name: file,
        content: await fs.readFile(path.join(inputPath, file), 'utf-8'),
      }
    }),
  )
}

export async function writePrompts(config: BuildConfig, prompts: Prompt[]) {
  const { outputPath } = config.prompts ?? {}
  if (!outputPath) {
    throw new Error('Prompts output path not configured')
  }

  await fs.mkdir(outputPath, { recursive: true })

  await Promise.all(prompts.map((prompt) => fs.writeFile(path.join(outputPath, prompt.name), prompt.content)))
}

import type { Node, Position } from 'unist'
import { map as mdastMap } from 'unist-util-map'
import { visit } from 'unist-util-visit'
import type { VFile } from 'vfile'
import { safeFail, safeMessage, type WarningsSection } from './error-messages'
import type { DocsFile } from './io'
import { extractComponentPropValueFromNode } from './utils/extractComponentPropValueFromNode'
import { z } from 'zod'

// Valueless props (`<Prompt title />`) reach the extractor as boolean `true`;
// tolerate them at parse time so they land in the friendly missing-prop
// failure instead of a raw ZodError.
const stringOrBooleanSchema = z.union([z.string(), z.boolean()])
const asString = (value: string | boolean | undefined): string | undefined =>
  typeof value === 'string' ? value : undefined

// The single prompt component. `variant` picks the HTML rendering, `output`
// picks what agent-facing markdown does with the prompt; both are required so
// every declaration is an explicit decision.
export const PROMPT_VARIANTS = ['card', 'banner'] as const
export const PROMPT_OUTPUTS = ['link', 'inline', 'replace'] as const

export const checkPrompts =
  (
    config: BuildConfig,
    prompts: Prompt[],
    file: Pick<DocsFile, 'filePath'>,
    options: { reportWarnings: boolean; update: boolean; section?: WarningsSection; pageScope?: boolean },
  ) =>
  () =>
  (tree: Node, vfile: VFile) => {
    if (config.prompts === null) return

    const section = options.section ?? 'docs'

    // Page-scope rules — one output="replace" prompt per page, and treatment
    // primitives only alongside one — can't be judged from a page's raw source
    // or a partial in isolation: the replace prompt and the primitive may live
    // on opposite sides of an <Include>. They run on the composed tree (the
    // page pass with partials embedded), controlled by `pageScope` so the raw
    // parse and partial passes validate props without false page verdicts.
    // <PromptOnly> without a replace prompt is content that can never render
    // (hidden on the page, removed from markdown), <ManualSteps> without one
    // is just <Steps> wearing the wrong name, and a second replace prompt is
    // wrong anywhere (extractReplacePrompt and the .md route honor only one).
    if ((options.pageScope ?? options.reportWarnings) === true) {
      const replacePrompts: (Position | undefined)[] = []
      const manualSteps: (Position | undefined)[] = []
      const orphans = new Map<string, Position | undefined>()
      visit(tree as any, ['mdxJsxFlowElement', 'mdxJsxTextElement'], (node: any) => {
        if (node.name === 'Prompt') {
          const output = node.attributes?.find(
            (attribute: any) => attribute.type === 'mdxJsxAttribute' && attribute.name === 'output',
          )?.value
          if (output === 'replace') replacePrompts.push(node.position)
        }
        if (node.name === 'ManualSteps') manualSteps.push(node.position)
        if ((node.name === 'PromptOnly' || node.name === 'ManualSteps') && !orphans.has(node.name)) {
          orphans.set(node.name, node.position)
        }
      })
      if (section === 'docs' && replacePrompts.length === 0) {
        for (const [name, position] of orphans) {
          safeFail(
            config,
            vfile,
            file.filePath,
            section,
            'treatment-primitive-without-replace-prompt',
            [name],
            position,
          )
        }
      }
      for (const position of replacePrompts.slice(1)) {
        safeFail(config, vfile, file.filePath, section, 'multiple-replace-prompts', [], position)
      }
      // The disclosure and the ToC's collapsed entry share a fixed id, so a
      // second <ManualSteps> would render duplicate ids and ambiguous links.
      for (const position of manualSteps.slice(1)) {
        safeFail(config, vfile, file.filePath, section, 'multiple-manual-steps', [], position)
      }
    }

    return mdastMap(tree, (node) => {
      // The old component name fails loudly instead of silently rendering nothing.
      if (
        (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') &&
        'name' in node &&
        node.name === 'PromptBanner'
      ) {
        if (options.reportWarnings === true) {
          safeFail(config, vfile, file.filePath, section, 'prompt-banner-removed', [], node.position)
        }
        return node
      }

      const isPromptNode =
        (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') &&
        'name' in node &&
        node.name === 'Prompt'

      if (!isPromptNode) return node

      const promptSrc = asString(
        extractComponentPropValueFromNode(
          config,
          node,
          vfile,
          'Prompt',
          'src',
          false,
          section,
          file.filePath,
          stringOrBooleanSchema,
        ),
      )

      if (promptSrc === undefined) {
        // A Prompt with no src has nothing to validate or rewrite, but it's
        // still a broken declaration — fail instead of skipping it.
        if (options.reportWarnings === true) {
          safeFail(config, vfile, file.filePath, section, 'prompt-missing-prop', ['src', null], node.position)
        }
        return node
      }

      if (options.reportWarnings === true) {
        for (const [prop, valid] of [
          ['variant', PROMPT_VARIANTS],
          ['output', PROMPT_OUTPUTS],
        ] as const) {
          const value = asString(
            extractComponentPropValueFromNode(
              config,
              node,
              vfile,
              'Prompt',
              prop,
              false,
              section,
              file.filePath,
              stringOrBooleanSchema,
            ),
          )
          if (value === undefined) {
            safeFail(config, vfile, file.filePath, section, 'prompt-missing-prop', [prop, [...valid]], node.position)
          } else if (!(valid as readonly string[]).includes(value)) {
            safeFail(
              config,
              vfile,
              file.filePath,
              section,
              'prompt-invalid-prop',
              [prop, value, [...valid]],
              node.position,
            )
          }
        }

        const title = asString(
          extractComponentPropValueFromNode(
            config,
            node,
            vfile,
            'Prompt',
            'title',
            false,
            section,
            file.filePath,
            stringOrBooleanSchema,
          ),
        )
        if (title === undefined || title.trim() === '') {
          safeFail(config, vfile, file.filePath, section, 'prompt-missing-prop', ['title', null], node.position)
        }
      }

      if (promptSrc.startsWith('prompts/') === false) {
        if (options.reportWarnings === true) {
          safeMessage(config, vfile, file.filePath, section, 'src-not-in-prompts', ['Prompt', promptSrc], node.position)
        }
        return node
      }

      const prompt = prompts.find((prompt) => prompt.filePath === promptSrc)

      if (prompt === undefined) {
        if (options.reportWarnings === true) {
          safeMessage(config, vfile, file.filePath, section, 'prompt-not-found', [promptSrc], node.position)
        }
        return node
      }

      if (options.update === true && config.prompts !== null) {
        ;(node as any).attributes.find(({ name }) => name === 'src').value = promptSrc.replace(
          'prompts/',
          `${config.prompts.outputPathRelative}/`,
        )
      }

      return node
    })
  }
