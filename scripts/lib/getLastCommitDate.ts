import fs from 'node:fs/promises'
import path from 'node:path'
import simpleGit from 'simple-git'
import type { BuildConfig } from './config'

// `git rev-parse --show-toplevel` always reports the canonical path, with symlinks resolved,
// while a configured basePath is used as given. On macOS that's enough to break the lookup:
// os.tmpdir() hands back /var/folders/..., which is really /private/var/folders/.... Comparing
// the two forms silently misses every file, so pages lose `lastUpdated` with no error. Canonicalize
// both sides before they meet.
//
// Only a path that isn't there falls back to the resolved form -- deleted files still appear in
// history, and there's nothing to resolve. Anything else (EACCES, ELOOP) is a real fault, and
// swallowing it would silently drop `lastUpdated` again, which is the bug this exists to fix.
// ENOTDIR covers a path component that exists but isn't a directory; macOS reports that as ENOENT,
// Linux as ENOTDIR.
const MISSING_PATH_CODES = new Set(['ENOENT', 'ENOTDIR'])

const canonicalize = async (filePath: string) => {
  try {
    return await fs.realpath(filePath)
  } catch (error) {
    if (error instanceof Error && MISSING_PATH_CODES.has((error as NodeJS.ErrnoException).code ?? '')) {
      return path.resolve(filePath)
    }

    throw error
  }
}

export const getLastCommitDate = (config: BuildConfig) => {
  if (config.flags.skipGit) {
    return async () => null
  }

  const git = simpleGit(config.docsPath)
  let mapPromise: Promise<Map<string, Date>> | undefined

  const getDateMap = () => {
    mapPromise ??= (async () => {
      const repoRoot = await canonicalize((await git.raw(['rev-parse', '--show-toplevel'])).trim())

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
    return dateMap.get(await canonicalize(filePath)) ?? null
  }
}
