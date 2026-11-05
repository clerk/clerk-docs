import path from 'node:path'
import { removeMdxSuffix } from './removeMdxSuffix'

export function resolvePartialPath(sourcePath: string, src: string): string | undefined {
  const partialPath = `${removeMdxSuffix(src)}.mdx`

  if (src.startsWith('_partials/')) return partialPath
  if (src.startsWith('./') || src.startsWith('../')) {
    return path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), partialPath))
  }

  return undefined
}
