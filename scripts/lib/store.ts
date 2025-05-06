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

type MarkdownFile = Awaited<ReturnType<ReturnType<typeof parseInMarkdownFile>>>
type PartialsFile = Awaited<ReturnType<ReturnType<typeof readPartial>>>
type TypedocsFile = Awaited<ReturnType<ReturnType<typeof readTypedoc>>>

export type DocsMap = Map<string, MarkdownFile>
export type PartialsMap = Map<string, PartialsFile>
export type TypedocsMap = Map<string, TypedocsFile>

export const createBlankStore = () => ({
  markdown: new Map() as DocsMap,
  partials: new Map() as PartialsMap,
  typedocs: new Map() as TypedocsMap,
})

export type Store = ReturnType<typeof createBlankStore>

export const invalidateFile =
  (store: ReturnType<typeof createBlankStore>, config: BuildConfig) => (filePath: string) => {
    store.markdown.delete(removeMdxSuffix(`${config.baseDocsLink}${path.relative(config.docsPath, filePath)}`))
    store.partials.delete(path.relative(config.partialsPath, filePath))
    store.typedocs.delete(path.relative(config.typedocPath, filePath))
  }

export const getMarkdownCache = (store: Store) => {
  return async (key: string, cacheMiss: (key: string) => Promise<MarkdownFile>) => {
    const cached = store.markdown.get(key)
    if (cached) return structuredClone(cached)

    const result = await cacheMiss(key)
    store.markdown.set(key, structuredClone(result))
    return result
  }
}

export const getPartialsCache = (store: Store) => {
  return async (key: string, cacheMiss: (key: string) => Promise<PartialsFile>) => {
    const cached = store.partials.get(key)
    if (cached) return structuredClone(cached)

    const result = await cacheMiss(key)
    store.partials.set(key, structuredClone(result))
    return result
  }
}

export const getTypedocsCache = (store: Store) => {
  return async (key: string, cacheMiss: (key: string) => Promise<TypedocsFile>) => {
    const cached = store.typedocs.get(key)
    if (cached) return structuredClone(cached)

    const result = await cacheMiss(key)
    store.typedocs.set(key, structuredClone(result))
    return result
  }
}
