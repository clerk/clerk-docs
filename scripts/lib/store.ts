import type { VFile } from 'vfile'
import type { Node } from 'unist'
import type { parseInMarkdownFile } from './markdown'
import type { readPartial } from './partials'

type MarkdownFile = Awaited<ReturnType<ReturnType<typeof parseInMarkdownFile>>>
type PartialsFile = Awaited<ReturnType<ReturnType<typeof readPartial>>>

export type DocsMap = Map<string, MarkdownFile>

export const createBlankStore = () => ({
  writtenFiles: new Map() as Map<string, string>,
  inFlightPartials: new Map() as Map<
    string,
    Promise<{
      path: string
      content: string
      vfile: VFile
      node: Node
    }>
  >,
})

export type Store = ReturnType<typeof createBlankStore>

export const getPartialsCache = (store: Store) => {
  return async (key: string, cacheMiss: (key: string) => Promise<PartialsFile>) => {
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

    // Track this in-flight request
    store.inFlightPartials.set(key, promise)

    return promise
  }
}
