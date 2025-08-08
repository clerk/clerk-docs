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
import type { SDK } from './schemas'
import type { readTooltip } from './tooltips'

type MarkdownFile = Awaited<ReturnType<ReturnType<typeof parseInMarkdownFile>>>
type CoreDocsFile = VFile
type ScopedDocsFile = VFile
type PartialsFile = Awaited<ReturnType<ReturnType<typeof readPartial>>>
type TypedocsFile = Awaited<ReturnType<ReturnType<typeof readTypedoc>>>
type TooltipsFile = Awaited<ReturnType<ReturnType<typeof readTooltip>>>

export type DocsMap = Map<string, MarkdownFile>
export type CoreDocsMap = Map<string, CoreDocsFile>
export type ScopedDocsMap = Map<string, Map<SDK, ScopedDocsFile>>
export type PartialsMap = Map<string, PartialsFile>
export type TypedocsMap = Map<string, TypedocsFile>
export type TooltipsMap = Map<string, TooltipsFile>

export const createBlankStore = () => ({
  markdown: new Map() as DocsMap,
  coreDocs: new Map() as CoreDocsMap,
  scopedDocs: new Map() as ScopedDocsMap,
  partials: new Map() as PartialsMap,
  typedocs: new Map() as TypedocsMap,
  tooltips: new Map() as TooltipsMap,
  dirtyDocMap: new Map() as Map<string, Set<string>>,
  writtenFiles: new Map() as Map<string, string>,
})

export type Store = ReturnType<typeof createBlankStore>

export const invalidateFile =
  (store: ReturnType<typeof createBlankStore>, config: BuildConfig) =>
  (filePath: string, invalidateAdjacentDocs: boolean = true) => {
    console.log(`invalidating ${filePath}`)

    const docsPath = path.join(config.baseDocsLink, path.relative(config.docsPath, filePath))

    store.coreDocs.delete(docsPath)
    store.scopedDocs.delete(docsPath)

    if (store.markdown.has(docsPath)) {
      store.markdown.delete(docsPath)

      const adjacentDocs = store.dirtyDocMap.get(docsPath)

      if (adjacentDocs && invalidateAdjacentDocs) {
        const invalidate = invalidateFile(store, config)
        adjacentDocs.forEach((docPath) => {
          invalidate(docPath, false)
        })
      }
    }

    const relativePartialPath = path.relative(config.partialsPath, filePath)

    if (store.partials.has(relativePartialPath)) {
      store.partials.delete(relativePartialPath)

      const adjacent = store.dirtyDocMap.get(`_partials/${relativePartialPath}`)

      if (adjacent && invalidateAdjacentDocs) {
        const invalidate = invalidateFile(store, config)
        adjacent.forEach((docPath) => {
          invalidate(docPath, false)
        })
      }
    }

    const relativeTypedocPath = path.relative(config.typedocPath, filePath)

    if (store.typedocs.has(relativeTypedocPath)) {
      store.typedocs.delete(relativeTypedocPath)

      const adjacent = store.dirtyDocMap.get(relativeTypedocPath)

      if (adjacent && invalidateAdjacentDocs) {
        const invalidate = invalidateFile(store, config)
        adjacent.forEach((docPath) => {
          invalidate(docPath, false)
        })
      }
    }

    if (config.tooltips) {
      const relativeTooltipPath = path.relative(config.tooltips.inputPath, filePath)

      if (store.tooltips.has(relativeTooltipPath)) {
        store.tooltips.delete(relativeTooltipPath)

        const adjacent = store.dirtyDocMap.get(`_tooltips/${relativeTooltipPath}`)

        if (adjacent && invalidateAdjacentDocs) {
          const invalidate = invalidateFile(store, config)
          adjacent.forEach((docPath) => {
            invalidate(docPath, false)
          })
        }
      }
    }
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

export const getScopedDocCache = (store: Store) => {
  return async (cache: SDK, key: string, cacheMiss: (key: string) => Promise<ScopedDocsFile>) => {
    // Get the file specific cache or create a new one
    if (!store.scopedDocs.has(key)) {
      store.scopedDocs.set(key, new Map())
    }
    const sdkCache = store.scopedDocs.get(key)
    if (!sdkCache) {
      throw new Error(`No SDK cache found for ${key}`)
    }

    // If it exists, return the cached file
    const cached = sdkCache.get(cache)
    if (cached) {
      return structuredClone(cached)
    }

    // If it doesn't exist, call the cache miss function for this sdk
    const result = await cacheMiss(key)

    const sdkCache2 = store.scopedDocs.get(key)
    if (!sdkCache2) {
      throw new Error(`No SDK cache found for ${key}`)
    }
    sdkCache2.set(cache, structuredClone(result))
    store.scopedDocs.set(key, sdkCache2)

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

export const getTooltipsCache = (store: Store) => {
  return async (key: string, cacheMiss: (key: string) => Promise<TooltipsFile>) => {
    const cached = store.tooltips.get(key)
    if (cached) return structuredClone(cached)

    const result = await cacheMiss(key)
    store.tooltips.set(key, structuredClone(result))
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
