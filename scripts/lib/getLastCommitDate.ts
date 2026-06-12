import path from 'node:path'
import simpleGit from 'simple-git'
import type { BuildConfig } from './config'

export const getLastCommitDate = (config: BuildConfig) => {
  if (config.flags.skipGit) {
    return async () => null
  }

  const git = simpleGit(config.docsPath)
  let mapPromise: Promise<Map<string, Date>> | undefined

  const getDateMap = () => {
    mapPromise ??= (async () => {
      const repoRoot = (await git.raw(['rev-parse', '--show-toplevel'])).trim()
      const logOutput = await git.raw(['log', '--name-only', '--pretty=format:%x00%aI'])
      const dateMap = new Map<string, Date>()

      for (const entry of logOutput.split('\0')) {
        if (entry.length === 0) continue

        const newlineIndex = entry.indexOf('\n')
        if (newlineIndex === -1) {
          // Author date line
          continue
        }

        const dateStr = entry.slice(0, newlineIndex)
        const paths = entry
          .slice(newlineIndex + 1)
          .split('\n')
          .filter(Boolean)

        for (const filePath of paths) {
          const absolutePath = path.resolve(repoRoot, filePath)
          if (!dateMap.has(absolutePath)) {
            dateMap.set(absolutePath, new Date(dateStr))
          }
        }
      }

      return dateMap
    })()

    return mapPromise
  }

  return async (filePath: string) => {
    const dateMap = await getDateMap()
    return dateMap.get(path.resolve(filePath)) ?? null
  }
}
