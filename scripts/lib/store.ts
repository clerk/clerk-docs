// only really needed when in dev mode
// if `build()` is run twice, this can store the important markdown files
//   so that we don't have to read them from the file system again which is slow
// use the `invalidateFile()` function to remove a file from the store

import path from 'node:path'
import type { VFile } from 'vfile'
import type { BuildConfig } from './config'
import type { parseInMarkdownFile } from './markdown'
import type { readPartial } from './partials'
import type { readTypedoc } from './typedoc'

type MarkdownFile = Awaited<ReturnType<ReturnType<typeof parseInMarkdownFile>>>
type CoreDocsFile = VFile
type PartialsFile = Awaited<ReturnType<ReturnType<typeof readPartial>>>
type TypedocsFile = Awaited<ReturnType<ReturnType<typeof readTypedoc>>>

export type DocsMap = Map<string, MarkdownFile>
export type CoreDocsMap = Map<string, CoreDocsFile>
export type PartialsMap = Map<string, PartialsFile>
export type TypedocsMap = Map<string, TypedocsFile>

export const createBlankStore = () => ({
  markdown: new Map() as DocsMap,
  coreDocs: new Map() as CoreDocsMap,
  partials: new Map() as PartialsMap,
  typedocs: new Map() as TypedocsMap,
  dirtyDocMap: new Map() as Map<string, Set<string>>,
})

export type Store = ReturnType<typeof createBlankStore>

export const invalidateFile =
  (store: ReturnType<typeof createBlankStore>, config: BuildConfig) =>
  (filePath: string, invalidateAdjacentDocs: boolean = true) => {
    console.log(`invalidating ${filePath}`)

    const docsPath = path.join(config.baseDocsLink, path.relative(config.docsPath, filePath))

    if (store.markdown.has(docsPath) && store.coreDocs.has(docsPath)) {
      store.markdown.delete(docsPath)
      store.coreDocs.delete(docsPath)

      const adjacentDocs = store.dirtyDocMap.get(docsPath)

      if (adjacentDocs && invalidateAdjacentDocs) {
        const invalidate = invalidateFile(store, config)
        adjacentDocs.forEach((docPath) => {
          invalidate(docPath, false)
        })
      }
    }
    store.partials.delete(path.relative(config.partialsPath, filePath))
    store.typedocs.delete(path.relative(config.typedocPath, filePath))
  }

export const markDocumentDirty =
  (store: ReturnType<typeof createBlankStore>) => (filePath: string, adjustedByFilePath: string) => {
    const dirtyDocs = store.dirtyDocMap.get(adjustedByFilePath) ?? new Set()
    dirtyDocs.add(filePath)
    store.dirtyDocMap.set(adjustedByFilePath, dirtyDocs)
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

export const getCoreDocCache = (store: Store) => {
  return async (key: string, cacheMiss: (key: string) => Promise<CoreDocsFile>) => {
    const cached = store.coreDocs.get(key)
    if (cached) return structuredClone(cached)

    const result = await cacheMiss(key)
    store.coreDocs.set(key, structuredClone(result))
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
