import type { BuildConfig } from './config'
import fs from 'node:fs/promises'
import path from 'node:path'
import { toString } from 'mdast-util-to-string'
import { remark } from 'remark'
import remarkGfm from 'remark-gfm'
import type { Node, Position } from 'unist'
import { map as mdastMap } from 'unist-util-map'
import { visit } from 'unist-util-visit'
import { VFile } from 'vfile'
import { safeFail, safeMessage, type WarningsSection } from './error-messages'
import type { DocsFile } from './io'
import { extractComponentPropValueFromNode } from './utils/extractComponentPropValueFromNode'
import { z } from 'zod'

export interface Prompt {
  filePath: string
  name: string
  content: string
}

const setupPromptNames = new Set(['cli-setup.md', 'nextjs-quickstart.md'])

const packageRunnerPattern = String.raw`(?:npx(?:\s+-y)?|pnpm\s+dlx|bunx|yarn\s+dlx)`
const clerkCommandPattern = String.raw`clerk(?:@[^\s]+)?`
const clerkCommand = new RegExp(`^(?:${packageRunnerPattern}\\s+)?${clerkCommandPattern}(?:\\s|$)`)
const packageRunnerCommand = new RegExp(`^${packageRunnerPattern}\\s+clerk@latest(?:\\s|$)`)
const initCommand = new RegExp(`${packageRunnerPattern}\\s+clerk@latest\\s+init(?![\\w-])`)
const loginCommand = new RegExp(`${packageRunnerPattern}\\s+clerk@latest\\s+auth\\s+login(?![\\w-])`)
// Preserve command order within a line so every chained Clerk invocation is validated independently.
const shellCommandSeparator = /\s*(?:&&|\|\||[;&|])\s*/
const globalCliInstall =
  /\b(?:(?:npm\s+(?:install|i)|pnpm\s+add|bun\s+add)\s+(?:(?:--global|-g)\s+[^\n`]*\bclerk\b|[^\n`]*\bclerk\b[^\n`]*\s(?:--global|-g)\b)|yarn\s+global\s+add\s+[^\n`]*\bclerk\b)/i
const frameworkQuickstartUrl = /https:\/\/clerk\.com\/docs\/[^\s`|)>]+\/getting-started\/quickstart[^\s`|)>]*/g

interface MarkdownValueNode extends Node {
  type: 'code' | 'inlineCode' | 'text'
  value: string
}

interface MarkdownLinkNode extends Node {
  type: 'link'
  url: string
}

interface CommandSnippet {
  command: string
  headings: string[]
  line: number
  type: 'code' | 'inlineCode'
}

interface QuickstartUrl {
  line: number
  value: string
}

function valueStartLine(content: string, node: MarkdownValueNode) {
  const line = node.position?.start.line ?? 1
  const offset = node.position?.start.offset
  if (node.type !== 'code' || offset === undefined) return line

  return /^(?:`{3,}|~{3,})/.test(content.slice(offset)) ? line + 1 : line
}

function markdownDetails(content: string) {
  const tree = remark().use(remarkGfm).parse(content)
  const commands: CommandSnippet[] = []
  const globalInstalls: number[] = []
  const quickstartUrls: QuickstartUrl[] = []
  // The section headings enclosing the current node, outermost first. Only
  // root-level headings count: a heading inside a blockquote or list doesn't
  // open a section, and a new heading closes every section at or below its depth.
  const headings: { depth: number; text: string }[] = []

  visit(tree, ['heading', 'text', 'code', 'inlineCode'], (node: any, _index, parent: any) => {
    if (node.type === 'heading') {
      if (parent?.type !== 'root') return
      while (headings.length && headings[headings.length - 1].depth >= node.depth) headings.pop()
      headings.push({ depth: node.depth, text: toString(node) })
      return
    }

    const valueNode = node as MarkdownValueNode
    const startLine = valueStartLine(content, valueNode)
    for (const [lineOffset, line] of valueNode.value.split('\n').entries()) {
      const lineNumber = startLine + lineOffset
      if (globalCliInstall.test(line)) globalInstalls.push(lineNumber)
      if (valueNode.type === 'text') continue

      for (const shellCommand of line.split(shellCommandSeparator)) {
        const command = shellCommand.trim().replace(/^\$\s+/, '')
        if (clerkCommand.test(command)) {
          commands.push({ command, headings: headings.map(({ text }) => text), line: lineNumber, type: valueNode.type })
        }
      }
    }
  })

  visit(tree, ['link', 'text', 'code', 'inlineCode'], (node: any, _index, parent: any) => {
    if ((node.type === 'text' || node.type === 'inlineCode') && parent?.type === 'link') return

    const value = node.type === 'link' ? (node as MarkdownLinkNode).url : (node as MarkdownValueNode).value
    const startLine = node.type === 'link' ? node.position?.start.line ?? 1 : valueStartLine(content, node)
    for (const match of value.matchAll(frameworkQuickstartUrl)) {
      quickstartUrls.push({
        line: startLine + value.slice(0, match.index ?? 0).split('\n').length - 1,
        value: match[0],
      })
    }
  })

  return { commands, globalInstalls, quickstartUrls }
}

export function checkPromptInvariants(prompts: Prompt[], routableDocsHrefs: Iterable<string>) {
  const vfiles = new Map<string, VFile>()
  const docsHrefs = new Set(routableDocsHrefs)

  const report = (prompt: Prompt, message: string, line?: number) => {
    const vfile = vfiles.get(prompt.filePath) ?? new VFile({ path: prompt.filePath, value: prompt.content })
    const vfileMessage = vfile.message(message, line === undefined ? undefined : { line, column: 1 })
    vfileMessage.fatal = true
    vfiles.set(prompt.filePath, vfile)
  }

  for (const prompt of prompts) {
    const { commands, globalInstalls, quickstartUrls } = markdownDetails(prompt.content)

    for (const line of globalInstalls) {
      report(prompt, 'do not install the Clerk CLI globally', line)
    }

    for (const { command, line } of commands) {
      if (packageRunnerCommand.test(command) === false) {
        report(prompt, `use a package runner with clerk@latest instead of \`${command}\``, line)
      }
    }

    if (setupPromptNames.has(prompt.name)) {
      const fencedCommands = commands.filter((command) => command.type === 'code')
      const firstInitIndex = fencedCommands.findIndex(({ command }) => initCommand.test(command))
      if (firstInitIndex === -1) {
        report(prompt, 'include Clerk initialization in setup guidance')
      } else {
        const requiredLogin = fencedCommands
          .slice(0, firstInitIndex)
          .find(
            ({ command, headings }) =>
              loginCommand.test(command) && headings.some((heading) => /\(optional\)/i.test(heading)) === false,
          )
        if (requiredLogin) {
          report(prompt, 'do not require Clerk authentication before initialization', requiredLogin.line)
        }
      }
    }

    for (const quickstartUrl of quickstartUrls) {
      const url = new URL(quickstartUrl.value.replace(/[.,;:!]+$/, ''))
      if (url.pathname.endsWith('.md') === false) {
        report(prompt, 'framework quickstart links must end in .md', quickstartUrl.line)
        continue
      }

      const docsHref = url.pathname.replace(/\.md$/, '')
      if (docsHrefs.has(docsHref) === false) {
        report(prompt, `quickstart link does not resolve: ${url}`, quickstartUrl.line)
      }
    }
  }

  return [...vfiles.values()]
}

export function validatePromptInvariants(prompts: Prompt[], routableDocsHrefs: Iterable<string>) {
  const errors = checkPromptInvariants(prompts, routableDocsHrefs).flatMap((vfile) =>
    vfile.messages.map((message) => `${vfile.path}${message.line ? `:${message.line}` : ''}: ${message.message}`),
  )

  if (errors.length) {
    throw new Error(`Prompt invariant validation failed:\n${errors.map((error) => `- ${error}`).join('\n')}`)
  }
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
