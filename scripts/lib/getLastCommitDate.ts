import simpleGit from 'simple-git'
import type { BuildConfig } from './config'

export const getLastCommitDate = (config: BuildConfig) => {
  if (config.flags.skipGit) {
    return async () => null
  }

  const git = simpleGit(config.docsPath)

  return async (filePath: string) => {
    const log = await git.log({ file: filePath, n: 1 })
    return log.latest?.date ? new Date(log.latest.date) : null
  }
}
