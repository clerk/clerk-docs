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
import { VALID_SDKS } from './schemas'

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
  // Track in-flight promises to deduplicate concurrent requests
  // Using any to avoid circular type reference with PartialsFile
  inFlightPartials: new Map() as Map<string, Promise<any>>,
})

export type Store = ReturnType<typeof createBlankStore>

export const invalidateFile =
  (store: ReturnType<typeof createBlankStore>, config: BuildConfig) =>
  (filePath: string, invalidateAdjacentDocs: boolean = true) => {
    const docsPath = path.join(config.baseDocsLink, path.relative(config.docsPath, filePath))

    store.coreDocs.delete(docsPath)
    store.scopedDocs.delete(docsPath)

    // Check if this is an SDK variant file (e.g., api-doc.react.mdx)
    // If so, we also need to invalidate the main document (e.g., api-doc.mdx)
    // because the scoped doc cache for the main document depends on the SDK variant content
    const fileName = path.basename(docsPath)
    const sdkMatch = VALID_SDKS.find((sdk) => fileName.endsWith(`.${sdk}.mdx`))
    if (sdkMatch) {
      // This is an SDK variant file - also invalidate the main document
      const mainDocPath = docsPath.replace(`.${sdkMatch}.mdx`, '.mdx')
      store.coreDocs.delete(mainDocPath)
      store.scopedDocs.delete(mainDocPath)
      if (store.markdown.has(mainDocPath)) {
        store.markdown.delete(mainDocPath)
      }
    }

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

    // Handle both global and relative partials
    // All partials are now relative to config.docsPath
    // Global partials start with _partials/ (e.g., "_partials/test.mdx")
    // Relative partials have /_partials/ in their path (e.g., "guides/_partials/test.mdx")
    const relativePartialPath = path.relative(config.docsPath, filePath)

    if (store.partials.has(relativePartialPath)) {
      store.partials.delete(relativePartialPath)
      // Also clear any in-flight promises for this partial
      store.inFlightPartials.delete(relativePartialPath)

      const adjacent = store.dirtyDocMap.get(relativePartialPath)

      if (adjacent && invalidateAdjacentDocs) {
        const invalidate = invalidateFile(store, config)
        adjacent.forEach((docPath) => {
          // Pass true to continue the invalidation chain (e.g., nested partial -> parent partial -> doc)
          // Infinite loops are prevented by the cache checks - once a file is removed from cache,
          // subsequent invalidate calls will be no-ops
          invalidate(docPath, true)
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
    // Check if already cached
    const cached = store.partials.get(key)
    if (cached) return structuredClone(cached)

    // Check if there's already an in-flight request for this partial
    const inFlight = store.inFlightPartials.get(key)
    if (inFlight) {
      // Wait for the in-flight request to complete and return its result
      // This deduplicates concurrent requests to the same partial
      const result = await inFlight
      return structuredClone(result)
    }

    // Create a new promise for this request
    const promise = cacheMiss(key)
      .then((result) => {
        // Store in cache and remove from in-flight
        store.partials.set(key, structuredClone(result))
        store.inFlightPartials.delete(key)
        return result
      })
      .catch((error) => {
        // On error, remove from in-flight to allow retries
        store.inFlightPartials.delete(key)
        throw error
      })

    // Track this in-flight request
    store.inFlightPartials.set(key, promise)

    return promise
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
