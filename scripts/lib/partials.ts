import path from 'node:path'
import readdirp from 'readdirp'
import { remark } from 'remark'
import remarkFrontmatter from 'remark-frontmatter'
import remarkMdx from 'remark-mdx'
import type { Node } from 'unist'
import { map as mdastMap } from 'unist-util-map'
import { visit as mdastVisit } from 'unist-util-visit'
import reporter from 'vfile-reporter'
import type { BuildConfig } from './config'
import { errorMessages, safeFail } from './error-messages'
import { readMarkdownFile } from './io'
import { removeMdxSuffix } from './utils/removeMdxSuffix'
import type { Store } from './store'

export const readPartialsFolder = (config: BuildConfig) => async () => {
  return readdirp.promise(config.partialsPath, {
    type: 'files',
    fileFilter: '*.mdx',
  })
}

export const readPartial = (config: BuildConfig) => async (filePath: string) => {
  const readFile = readMarkdownFile(config)

  const fullPath = path.join(config.docsRelativePath, config.partialsRelativePath, filePath)

  const [error, content] = await readFile(fullPath)

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
      // Process links in partials and remove the .mdx suffix
      .use(() => (tree, vfile) => {
        return mdastMap(tree, (node) => {
          if (node.type !== 'link') return node
          if (!('url' in node)) return node
          if (typeof node.url !== 'string') return node
          if (!node.url.startsWith(config.baseDocsLink)) return node
          if (!('children' in node)) return node

          // We are overwriting the url with the mdx suffix removed
          node.url = removeMdxSuffix(node.url)

          return node
        })
      })
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

  return Promise.all(
    paths.map(async (markdownPath) => {
      const cachedValue = store.partialsFiles.get(markdownPath)

      if (cachedValue !== undefined) {
        return cachedValue
      }

      const partial = await read(markdownPath)

      store.partialsFiles.set(markdownPath, partial)

      return partial
    }),
  )
}
