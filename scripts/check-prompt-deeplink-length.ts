/**
 * Validates that every prompt a `<Prompt variant="banner" />` uses opens in
 * Cursor from the banner's "Open in Cursor" button.
 *
 * Only banners have that button — cards render the install prompt with no
 * Cursor link — so prompts used only by cards are skipped. A usage with no
 * variant counts as a banner, the way Prompt.tsx renders it.
 *
 * Cursor's rule (length, characters, and blocked content such as `.env`) lives
 * in src/lib/cursor-deeplink.ts, which the banner uses to decide whether to show
 * the button. A banner whose prompt Cursor would refuse fails here unless the
 * usage opts out of the button with `deeplink={false}`.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import readdirp from 'readdirp'
import { remark } from 'remark'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
import remarkMdx from 'remark-mdx'
import { visit } from 'unist-util-visit'
import {
  CURSOR_DEEPLINK_MAX_LENGTH,
  getCursorDeeplinkLength,
  getCursorPromptRejection,
  type CursorPromptRejection,
} from '../../src/lib/cursor-deeplink'

const processor = remark().use(remarkFrontmatter).use(remarkMdx).use(remarkGfm)

export type PromptUsage = {
  line: number | undefined
  src: string | undefined
  variant: 'card' | 'banner'
  // `false` for `deeplink={false}`, `'invalid'` for any other value
  deeplink: false | 'invalid' | undefined
}

type JsxAttribute = {
  type: string
  name?: string
  value?: string | { type: string; value: string } | null
}

/** Finds every `<Prompt />` in an MDX source, skipping code and comments. */
export function findPromptUsages(content: string): PromptUsage[] {
  const tree = processor.parse(content)
  const usages: PromptUsage[] = []

  visit(tree, ['mdxJsxFlowElement', 'mdxJsxTextElement'], (node: any) => {
    if (node.name !== 'Prompt') return

    const attributes = (node.attributes as JsxAttribute[]).filter((attribute) => attribute.type === 'mdxJsxAttribute')
    const attribute = (name: string) => attributes.find((candidate) => candidate.name === name)

    const src = attribute('src')?.value
    const variant = attribute('variant')?.value
    const deeplink = attribute('deeplink')

    usages.push({
      line: node.position?.start.line,
      src: typeof src === 'string' ? src : undefined,
      // Prompt.tsx renders anything that isn't a card as a banner.
      variant: variant === 'card' ? 'card' : 'banner',
      deeplink:
        deeplink === undefined
          ? undefined
          : typeof deeplink.value === 'object' && deeplink.value?.value.trim() === 'false'
            ? false
            : 'invalid',
    })
  })

  return usages
}

const rejectionMessages: Record<CursorPromptRejection, string> = {
  empty: 'is empty',
  'unsupported-characters': 'contains characters Cursor refuses (Unicode format characters or DEL)',
  'too-long': `is over Cursor's ${CURSOR_DEEPLINK_MAX_LENGTH} character limit`,
  'blocked-content': 'contains content Cursor refuses (such as a `.env` reference)',
}

type Color = 'red' | 'green' | 'yellow' | 'gray'

const colorCodes: Record<Color, string> = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  gray: '\x1b[90m',
}

function log(color: Color, message: string, indent = 0): void {
  const padding = '  '.repeat(indent)
  console.log(`${colorCodes[color]}${padding}${message}\x1b[0m`)
}

async function main() {
  const root = path.resolve(__dirname, '..')
  const usages: Array<PromptUsage & { file: string }> = []

  for await (const entry of readdirp(path.join(root, 'docs'), {
    fileFilter: (entry) => entry.basename.endsWith('.mdx'),
  })) {
    const content = await fs.readFile(entry.fullPath, 'utf8')
    if (!content.includes('<Prompt')) continue
    const file = path.relative(root, entry.fullPath)
    for (const usage of findPromptUsages(content)) usages.push({ ...usage, file })
  }

  const failures: string[] = []
  const fail = (message: string) => {
    log('red', `✗ ${message}`)
    failures.push(message)
  }

  for (const usage of usages) {
    const where = `${usage.file}:${usage.line ?? '?'}`

    if (usage.deeplink === 'invalid') {
      fail(`${where} — deeplink only accepts {false}`)
      continue
    }
    if (usage.deeplink === false && usage.variant === 'card') {
      fail(`${where} — deeplink={false} has no effect on a card, which has no Cursor button`)
      continue
    }
    // The docs build fails a Prompt without a string src.
    if (usage.src === undefined) continue

    if (usage.variant === 'card') {
      log('gray', `⊘ ${usage.src} — card in ${where}, no Cursor button`)
      continue
    }
    let prompt: string
    try {
      prompt = (await fs.readFile(path.join(root, usage.src), 'utf8')).trim()
    } catch {
      fail(`${usage.src} — banner in ${where} uses a prompt file that doesn't exist`)
      continue
    }

    if (usage.deeplink === false) {
      log('yellow', `⊘ ${usage.src} — banner in ${where} opts out with deeplink={false}`)
      continue
    }

    const length = getCursorDeeplinkLength(prompt)
    const rejection = getCursorPromptRejection(prompt)
    if (rejection === null) {
      log('green', `✓ ${usage.src} — banner in ${where}, ${length} chars by Cursor's measure`)
    } else {
      fail(`${usage.src} — banner in ${where} ${rejectionMessages[rejection]} (${length} chars by Cursor's measure)`)
    }
  }

  console.log()

  if (failures.length > 0) {
    log('red', `✗ ${failures.length} <Prompt> deeplink problem(s)`)
    log('gray', 'Cursor drops these prompts, so the banner would hide "Open in Cursor"', 1)
    log('gray', 'Fix the prompt, or add deeplink={false} to that <Prompt> to drop the button on purpose', 1)
    process.exitCode = 1
  } else {
    log('green', `✓ All banner prompts open in Cursor or opt out (${usages.length} <Prompt> usages)`)
  }
}

if (require.main === module) {
  main()
}
