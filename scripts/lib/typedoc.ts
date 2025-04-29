// responsible for reading in and parsing the typedoc markdown
// for validation see validators/checkTypedoc.ts
// this also removes the .mdx suffix from the urls in the markdown
// some of the typedoc files with not parse when using `remarkMdx`
//   so we catch those errors and parse them the same but without `remarkMdx`

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
import { getTypedocsCache, type Store } from './store'
import { removeMdxSuffixPlugin } from './plugins/removeMdxSuffixPlugin'

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
      .use(removeMdxSuffixPlugin(config))
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
      .use(removeMdxSuffixPlugin(config))
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
  const typedocsCache = getTypedocsCache(store)

  return Promise.all(paths.map(async (filePath) => typedocsCache(filePath, () => read(filePath))))
}
