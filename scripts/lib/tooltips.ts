// responsible for reading in and parsing the tooltips markdown
// for validation see validators/checkTooltips.ts
// for tooltips we currently do not allow them to embed other tooltips
// this also removes the .mdx suffix from the urls in the markdown

import path from 'node:path'
import readdirp from 'readdirp'
import { remark } from 'remark'
import remarkFrontmatter from 'remark-frontmatter'
import remarkMdx from 'remark-mdx'
import type { Node } from 'unist'
import reporter from 'vfile-reporter'
import type { BuildConfig } from './config'
import { errorMessages } from './error-messages'
import { readMarkdownFile, writeDistFile } from './io'
import { removeMdxSuffixPlugin } from './plugins/removeMdxSuffixPlugin'
import { getTooltipsCache, type Store } from './store'

export const readTooltipsFolder = (config: BuildConfig) => async () => {
  if (!config.tooltips) {
    console.error('Tooltips are not enabled')
    return []
  }

  return readdirp.promise(config.tooltips.inputPath, {
    type: 'files',
    fileFilter: '*.mdx',
  })
}

export const readTooltip = (config: BuildConfig) => async (filePath: string) => {
  if (!config.tooltips) {
    throw new Error('Tooltips are not enabled')
  }

  const fullPath = path.join(config.tooltips.inputPath, filePath)

  const [error, content] = await readMarkdownFile(fullPath)

  if (error) {
    throw new Error(errorMessages['tooltip-read-error'](fullPath), { cause: error })
  }

  let tooltipNode: Node | null = null

  try {
    const tooltipContentVFile = await remark()
      .use(remarkFrontmatter)
      .use(remarkMdx)
      .use(() => (tree) => {
        tooltipNode = tree
      })
      .use(removeMdxSuffixPlugin(config))
      .process({
        path: `docs/_tooltips/${filePath}`,
        value: content,
      })

    const tooltipContentReport = reporter([tooltipContentVFile], { quiet: true })

    if (tooltipContentReport !== '') {
      console.error(tooltipContentReport)
      process.exit(1)
    }

    if (tooltipNode === null) {
      throw new Error(errorMessages['tooltip-parse-error'](filePath))
    }

    return {
      path: `_tooltips/${filePath}`,
      content,
      vfile: tooltipContentVFile,
      node: tooltipNode as Node,
    }
  } catch (error) {
    console.error(`✗ Error parsing tooltip: ${filePath}`)
    throw error
  }
}

export const readTooltipsMarkdown = (config: BuildConfig, store: Store) => async (paths: string[]) => {
  const read = readTooltip(config)
  const tooltipsCache = getTooltipsCache(store)

  return Promise.all(paths.map(async (markdownPath) => tooltipsCache(markdownPath, () => read(markdownPath))))
}
