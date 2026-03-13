// responsible for reading in and parsing the typedoc markdown
// for validation see validators/checkTypedoc.ts
// this also removes the .mdx suffix from the urls in the markdown
// some of the typedoc files with not parse when using `remarkMdx`
//   so we catch those errors and parse them the same but without `remarkMdx`

import { existsSync } from 'node:fs'
import path from 'node:path'
import readdirp from 'readdirp'
import { remark } from 'remark'
import remarkMdx from 'remark-mdx'
import type { Node } from 'unist'
import type { BuildConfig } from './config'
import { errorMessages } from './error-messages'
import { readMarkdownFile } from './io'
import { removeMdxSuffixPlugin } from './plugins/removeMdxSuffixPlugin'
import { getTypedocsCache, type Store } from './store'
import { removeMdxSuffix } from './utils/removeMdxSuffix'

export const readTypedocsFolder = (config: BuildConfig) => async () => {
  if (config.flags?.silenceTypedocErrors && !existsSync(config.typedocPath)) {
    return []
  }
  return readdirp.promise(config.typedocPath, {
    type: 'files',
    fileFilter: '*.mdx',
  })
}

export const readTypedoc = (config: BuildConfig) => async (filePath: string) => {
  const typedocPath = path.join(config.typedocPath, filePath)
  const silenceErrors = config.flags?.silenceTypedocErrors === true

  const doRead = async () => {
    const [error, content] = await readMarkdownFile(typedocPath)

    if (error) {
      if (silenceErrors) return null
      throw new Error(errorMessages['typedoc-read-error'](typedocPath), { cause: error })
    }

    const contentWithMarkers = typedocTableSpecialCharacters.encode(content)

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
          value: contentWithMarkers,
        })

      if (node === null) {
        if (silenceErrors) return null
        throw new Error(errorMessages['typedoc-parse-error'](typedocPath))
      }

      return {
        path: `${removeMdxSuffix(filePath)}.mdx`,
        content: contentWithMarkers,
        vfile,
        node: node as Node,
      }
    } catch (err) {
      // Plain-markdown fallback (no remarkMdx); some typedoc files only parse this way
      let node: Node | null = null

      const vfile = await remark()
        .use(() => (tree) => {
          node = tree
        })
        .use(removeMdxSuffixPlugin(config))
        .process({
          path: typedocPath,
          value: contentWithMarkers,
        })

      if (node === null) {
        if (silenceErrors) return null
        throw new Error(errorMessages['typedoc-parse-error'](typedocPath))
      }

      return {
        path: `${removeMdxSuffix(filePath)}.mdx`,
        content: contentWithMarkers,
        vfile,
        node: node as Node,
      }
    }
  }

  if (silenceErrors) {
    try {
      return await doRead()
    } catch {
      return null
    }
  }
  return doRead()
}

// We need to replace these characters otherwise the markdown parser will act weird
export const typedocTableSpecialCharacters = {
  encode: (content: string) =>
    content
      .replaceAll('\\|', '/ESCAPEPIPE/')
      .replaceAll('\\{', '/ESCAPEOPENBRACKET/')
      .replaceAll('\\}', '/ESCAPECLOSEBRACKET/')
      .replaceAll('\\>', '/ESCAPEGREATERTHAN/')
      .replaceAll('\\<', '/ESCAPELESSTHAN/'),
  decode: (content: string) =>
    content
      .replaceAll('/ESCAPEPIPE/', '\\|')
      .replaceAll('/ESCAPEOPENBRACKET/', '\\{')
      .replaceAll('/ESCAPECLOSEBRACKET/', '\\}')
      .replaceAll('/ESCAPEGREATERTHAN/', '\\>')
      .replaceAll('/ESCAPELESSTHAN/', '\\<'),
}

export const readTypedocsMarkdown = (config: BuildConfig, store: Store) => async (paths: string[]) => {
  const read = readTypedoc(config)
  const silenceErrors = config.flags?.silenceTypedocErrors === true

  if (silenceErrors) {
    const results = await Promise.all(paths.map((filePath) => read(filePath)))
    return results.filter((r): r is NonNullable<(typeof results)[number]> => r !== null)
  }

  const typedocsCache = getTypedocsCache(store)
  return Promise.all(paths.map(async (filePath) => typedocsCache(filePath, () => read(filePath))))
}
