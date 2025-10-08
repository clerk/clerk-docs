import type { BuildConfig } from './config'
import fs from 'node:fs/promises'
import path from 'node:path'
import { u as mdastBuilder } from 'unist-builder'

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

import type { Node } from 'unist'
import { map as mdastMap } from 'unist-util-map'
import type { VFile } from 'vfile'
import { safeMessage } from './error-messages'
import type { DocsFile } from './io'
import { extractComponentPropValueFromNode } from './utils/extractComponentPropValueFromNode'
import { z } from 'zod'

export const checkPrompts =
  (config: BuildConfig, prompts: Prompt[], file: DocsFile, options: { reportWarnings: boolean; update: boolean }) =>
  () =>
  (tree: Node, vfile: VFile) => {
    if (config.prompts === null) return

    return mdastMap(tree, (node) => {
      // console.dir(node, { depth: null })
      const promptSrc = extractComponentPropValueFromNode(
        config,
        node,
        vfile,
        'LLMPrompt',
        'src',
        false,
        'docs',
        file.filePath,
        z.string(),
      )

      if (promptSrc === undefined) return node

      if (promptSrc.startsWith('prompts/') === false) {
        if (options.reportWarnings === true) {
          safeMessage(config, vfile, file.filePath, 'docs', 'src-not-in-prompts', [promptSrc], node.position)
        }
        return node
      }

      const prompt = prompts.find((prompt) => prompt.filePath === promptSrc)

      if (prompt === undefined) {
        if (options.reportWarnings === true) {
          safeMessage(config, vfile, file.filePath, 'docs', 'prompt-not-found', [promptSrc], node.position)
        }
        return node
      }

      const embedPrompt = extractComponentPropValueFromNode(
        config,
        node,
        vfile,
        'LLMPrompt',
        'embed',
        false,
        'docs',
        file.filePath,
        z.boolean(),
      )

      if (embedPrompt === true) {
        return Object.assign(node, mdastBuilder('code', { lang: 'md', value: prompt.content }))
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
