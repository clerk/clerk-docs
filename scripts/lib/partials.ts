// responsible for reading in and parsing the partials markdown
// for validation see validators/checkPartials.ts
// for partials we currently do not allow them to embed other partials
// this also removes the .mdx suffix from the urls in the markdown

import path from 'node:path'
import readdirp from 'readdirp'
import { remark } from 'remark'
import remarkFrontmatter from 'remark-frontmatter'
import remarkMdx from 'remark-mdx'
import type { Node } from 'unist'
import { visit as mdastVisit } from 'unist-util-visit'
import reporter from 'vfile-reporter'
import type { BuildConfig } from './config'
import { errorMessages, safeFail } from './error-messages'
import { readMarkdownFile } from './io'
import { removeMdxSuffixPlugin } from './plugins/removeMdxSuffixPlugin'
import { getPartialsCache, type Store } from './store'

export const readPartialsFolder = (config: BuildConfig) => async () => {
  return readdirp.promise(config.partialsPath, {
    type: 'files',
    fileFilter: '*.mdx',
  })
}

export const readPartial = (config: BuildConfig) => async (filePath: string) => {
  const fullPath = path.join(config.partialsPath, filePath)

  const [error, content] = await readMarkdownFile(fullPath)

  if (error) {
    throw new Error(errorMessages['partial-read-error'](fullPath), { cause: error })
  }

  let partialNode: Node | null = null

  try {
    const partialContentVFile = await remark()
      .use(remarkFrontmatter)
      .use(remarkMdx)
      .use(() => (tree) => {
        partialNode = tree
      })
      .use(() => (tree, vfile) => {
        mdastVisit(
          tree,
          (node) =>
            (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') &&
            'name' in node &&
            node.name === 'Include',
          (node) => {
            safeFail(config, vfile, fullPath, 'partials', 'partials-inside-partials', [], node.position)
          },
        )
      })
      .use(removeMdxSuffixPlugin(config))
      .process({
        path: `docs/_partials/${filePath}`,
        value: content,
      })

    const partialContentReport = reporter([partialContentVFile], { quiet: true })

    if (partialContentReport !== '') {
      console.error(partialContentReport)
      process.exit(1)
    }

    if (partialNode === null) {
      throw new Error(errorMessages['partial-parse-error'](filePath))
    }

    return {
      path: filePath,
      content,
      vfile: partialContentVFile,
      node: partialNode as Node,
    }
  } catch (error) {
    console.error(`✗ Error parsing partial: ${filePath}`)
    throw error
  }
}

export const readPartialsMarkdown = (config: BuildConfig, store: Store) => async (paths: string[]) => {
  const read = readPartial(config)
  const partialsCache = getPartialsCache(store)

  return Promise.all(paths.map(async (markdownPath) => partialsCache(markdownPath, () => read(markdownPath))))
}
