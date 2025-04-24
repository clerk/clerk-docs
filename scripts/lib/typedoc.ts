import path from 'node:path'
import readdirp from 'readdirp'
import { remark } from 'remark'
import remarkMdx from 'remark-mdx'
import type { Node } from 'unist'
import { map as mdastMap } from 'unist-util-map'
import type { BuildConfig } from './config'
import { errorMessages } from './error-messages'
import { readMarkdownFile } from './io'
import { removeMdxSuffix } from './utils/removeMdxSuffix'
import type { Store } from './store'

export const readTypedocsFolder = (config: BuildConfig) => async () => {
  return readdirp.promise(config.typedocPath, {
    type: 'files',
    fileFilter: '*.mdx',
  })
}

export const readTypedoc = (config: BuildConfig) => async (filePath: string) => {
  const readFile = readMarkdownFile(config)

  const typedocPath = path.join(config.typedocRelativePath, filePath)

  const [error, content] = await readFile(typedocPath)

  if (error) {
    throw new Error(errorMessages['typedoc-read-error'](typedocPath), { cause: error })
  }

  try {
    let node: Node | null = null

    const vfile = await remark()
      .use(remarkMdx)
      .use(() => (tree) => {
        node = tree
      })
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
        path: typedocPath,
        value: content,
      })

    if (node === null) {
      throw new Error(errorMessages['typedoc-parse-error'](typedocPath))
    }

    return {
      path: `${removeMdxSuffix(filePath)}.mdx`,
      content,
      vfile,
      node: node as Node,
    }
  } catch (error) {
    let node: Node | null = null

    const vfile = await remark()
      .use(() => (tree) => {
        node = tree
      })
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
        path: typedocPath,
        value: content,
      })

    if (node === null) {
      throw new Error(errorMessages['typedoc-parse-error'](typedocPath))
    }

    return {
      path: `${removeMdxSuffix(filePath)}.mdx`,
      content,
      vfile,
      node: node as Node,
    }
  }
}

export const readTypedocsMarkdown = (config: BuildConfig, store: Store) => async (paths: string[]) => {
  const read = readTypedoc(config)

  return Promise.all(
    paths.map(async (filePath) => {
      const cachedValue = store.typedocsFiles.get(filePath)

      if (cachedValue !== undefined) {
        return cachedValue
      }

      const typedoc = await read(filePath)

      store.typedocsFiles.set(filePath, typedoc)

      return typedoc
    }),
  )
}
