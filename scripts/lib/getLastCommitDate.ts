import { Repository } from '@napi-rs/simple-git'
import type { BuildConfig } from './config'

export const getLastCommitDate = (config: BuildConfig) => {
  if (config.gitPath === undefined) {
    return async (filePath: string) => null
  }

  const repo = new Repository(config.gitPath)

  return async (filePath: string) => {
    return new Date(await repo.getFileLatestModifiedDateAsync(filePath))
  }
}
