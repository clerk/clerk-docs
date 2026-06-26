import path from 'node:path'
import simpleGit from 'simple-git'
import type { BuildConfig } from './config'

export const getLastCommitDate = (config: BuildConfig) => {
  if (config.flags.skipGit) {
    return async () => null
  }

  const git = simpleGit(config.docsPath)
  const repoRoot = path.dirname(config.docsPath)
  let mapPromise: Promise<Map<string, Date>> | undefined

  const getDateMap = () => {
    mapPromise ??= (async () => {
      // `--name-status` makes simple-git populate `commit.diff.files`, so we get the
      // changed paths per commit as typed objects instead of parsing raw git output.
      const log = (
        await git.log<{ date: string }>({
          format: { date: '%aI' },
          '--name-status': null,
        })
      ).all.map((commit) => ({ files: commit.diff?.files ?? [], date: new Date(commit.date) }))

      const dateMap = new Map<string, Date>()

      for (const commit of log) {
        for (const file of commit.files) {
          const absolutePath = path.resolve(repoRoot, file.file)
          if (!dateMap.has(absolutePath)) {
            dateMap.set(absolutePath, commit.date)
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
