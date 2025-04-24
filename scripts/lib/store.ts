// only really needed when in dev mode
// if `build()` is run twice, this can store the important markdown files
//   so that we don't have to read them from the file system again which is slow
// use the `invalidateFile()` function to remove a file from the store

import path from 'node:path'
import type { BuildConfig } from './config'
import { removeMdxSuffix } from './utils/removeMdxSuffix'
import type { readPartial } from './partials'
import type { readTypedoc } from './typedoc'
import type { parseInMarkdownFile } from './markdown'

export type DocsMap = Map<string, Awaited<ReturnType<ReturnType<typeof parseInMarkdownFile>>>>
export type PartialsMap = Map<string, Awaited<ReturnType<ReturnType<typeof readPartial>>>>
export type TypedocsMap = Map<string, Awaited<ReturnType<ReturnType<typeof readTypedoc>>>>

export const createBlankStore = () => ({
  markdownFiles: new Map() as DocsMap,
  partialsFiles: new Map() as PartialsMap,
  typedocsFiles: new Map() as TypedocsMap,
})

export type Store = ReturnType<typeof createBlankStore>

export const invalidateFile =
  (store: ReturnType<typeof createBlankStore>, config: BuildConfig) => (filePath: string) => {
    store.markdownFiles.delete(removeMdxSuffix(`${config.baseDocsLink}${path.relative(config.docsPath, filePath)}`))
    store.partialsFiles.delete(path.relative(config.partialsPath, filePath))
    store.typedocsFiles.delete(path.relative(config.typedocPath, filePath))
  }
