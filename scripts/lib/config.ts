// For the test suite to work effectively we need to be able to
// configure the builds, this file defines the config object

import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'
import type { SDK } from './schemas'
import { existsSync } from 'node:fs'

type BuildConfigOptions = {
  basePath: string
  validSdks: readonly SDK[]
  dataPath: string
  docsPath: string
  baseDocsLink: string
  manifestPath: string
  partialsFolderName: string
  distPath: string
  typedocPath: string
  localTypedocOverridePath?: string
  publicPath?: string
  ignorePaths: string[]
  ignoreLinks: string[]
  ignoreWarnings?: {
    docs: Record<string, string[]>
    partials: Record<string, string[]>
    typedoc: Record<string, string[]>
    tooltips: Record<string, string[]>
  }
  manifestOptions: {
    wrapDefault: boolean
    hideTitleDefault: boolean
  }
  redirects?: {
    static: {
      inputPath: string
      outputPath: string
      outputCompactPath?: string
      outputBloomFilterPath?: string
    }
    dynamic: {
      inputPath: string
      outputPath: string
    }
  }
  prompts?: {
    inputPath: string
    outputPath: string
  }
  tooltips?: {
    inputPath: string
    outputPath: string
  }
  llms?: {
    overviewPath?: string
    fullPath?: string
  }
  siteFlags?: {
    inputPath: string
    outputPath: string
  }
  flags?: {
    watch?: boolean
    controlled?: boolean
    skipGit?: boolean
    skipApiErrors?: boolean
    silenceTypedocErrors?: boolean
  }
}

export type BuildConfig = Awaited<ReturnType<typeof createConfig>>

// How recently a `.dev-dist` entry must have been modified for the startup sweep to treat it
// as another watcher's in-flight build and leave it alone. Watch builds finish in a couple of
// minutes, so 30 minutes is comfortably past any live build without keeping junk around long.
const DEV_DIST_SWEEP_GRACE_MS = 30 * 60 * 1000

// Takes the basePath and resolves the relative paths to be absolute paths
export async function createConfig(config: BuildConfigOptions) {
  const resolve = (relativePath: string) => {
    return path.isAbsolute(relativePath) ? relativePath : path.join(config.basePath, relativePath)
  }

  const find = (...paths: [...(string | undefined | null)[], string]) => {
    for (const path of paths) {
      if (path && existsSync(resolve(path))) {
        return path
      }
    }

    const lastItem = paths[paths.length - 1]
    if (lastItem) {
      return lastItem
    }
    throw new Error('No path found')
  }

  // Watch mode swaps dist to a freshly built temp folder on every rebuild by re-pointing a
  // symlink at it, so the temp folder must outlive the build — and it must live inside the
  // repo, next to dist: `next build` (Turbopack) rejects a dist symlink that resolves outside
  // the project root, and macOS purges os.tmpdir() out from under long-running dev sessions,
  // either of which breaks the next `next build` after running dev. Non-watch builds copy the
  // temp folder to dist and delete it, so the OS temp directory is fine there.
  const devDistParent = path.join(path.dirname(resolve(config.distPath)), '.dev-dist')

  let devDistParentReady: Promise<string> | null = null
  const getTempDistParent = () => {
    if (!config.flags?.watch) return Promise.resolve(os.tmpdir())

    devDistParentReady ??= (async () => {
      // Sweep temp dists left behind by previous sessions (each session leaves its last live
      // one behind) — except the one dist still points to: the sweep runs before this session's
      // first build has published a replacement, and Next.js dev may be serving docs from it
      // through the dist symlink right up until then. A later session sweeps it once dist points
      // elsewhere. Runs once per process; rebuilds within a session must not sweep either, as
      // the previous rebuild's temp dist is live behind the dist symlink.
      // Only the expected codes mean "no live target": ENOENT (no dist yet) and EINVAL (dist
      // is a real folder, not a symlink). Anything else (EACCES, I/O errors) must abort the
      // sweep rather than read as "nothing to protect" and delete the live target.
      const distFinalPath = resolve(config.distPath)
      const liveTarget = await fs.readlink(distFinalPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT' || error.code === 'EINVAL') return null
        throw error
      })
      const liveTargetPath = liveTarget === null ? null : path.resolve(path.dirname(distFinalPath), liveTarget)

      const entries = await fs.readdir(devDistParent).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return [] as string[]
        throw error
      })
      const now = Date.now()
      await Promise.all(
        entries.map(async (entry) => {
          const entryPath = path.join(devDistParent, entry)
          if (entryPath === liveTargetPath) return

          // A recently modified entry may be another watcher's in-flight build — a second dev
          // session running in the same checkout. There's no cross-process "in use" signal to
          // check, so age is the guard: in-flight builds are minutes old (their mtime updates
          // as top-level files land), while abandoned ones age past the window and get swept
          // by a later session. ENOENT means a concurrent cleanup got there first — fine.
          const stats = await fs.stat(entryPath).catch((error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return null
            throw error
          })
          if (stats === null || now - stats.mtimeMs < DEV_DIST_SWEEP_GRACE_MS) return

          await fs.rm(entryPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
        }),
      )

      await fs.mkdir(devDistParent, { recursive: true })
      return devDistParent
    })()

    return devDistParentReady
  }

  const changeTempDist = async () => {
    const tempDist = await fs.mkdtemp(path.join(await getTempDistParent(), 'clerk-docs-dist-'))

    return {
      basePath: config.basePath,
      baseDocsLink: config.baseDocsLink,
      validSdks: config.validSdks,

      manifestRelativePath: config.manifestPath,
      manifestFilePath: resolve(config.manifestPath),

      partialsFolderName: config.partialsFolderName,

      dataRelativePath: config.dataPath,
      dataPath: resolve(config.dataPath),

      docsRelativePath: config.docsPath,
      docsPath: resolve(config.docsPath),

      distTempRelativePath: tempDist,
      distTempPath: resolve(tempDist),
      changeTempDist,

      distFinalRelativePath: config.distPath,
      distFinalPath: resolve(config.distPath),

      typedocRelativePath: find(config.localTypedocOverridePath, config.typedocPath),
      typedocPath: resolve(find(config.localTypedocOverridePath, config.typedocPath)),

      publicRelativePath: config.publicPath,
      publicPath: config.publicPath ? resolve(config.publicPath) : undefined,

      ignoredPaths: (url: string) => config.ignorePaths.some((ignoreItem) => url.startsWith(ignoreItem)),
      ignoredLinks: (url: string) => config.ignoreLinks.some((ignoreItem) => url === ignoreItem),
      ignoreWarnings: config.ignoreWarnings ?? {
        docs: {},
        partials: {},
        typedoc: {},
        tooltips: {},
      },

      manifestOptions: config.manifestOptions ?? {
        wrapDefault: true,
        collapseDefault: false,
        hideTitleDefault: false,
      },

      redirects: config.redirects
        ? {
            static: {
              inputPath: resolve(path.join(config.basePath, config.redirects.static.inputPath)),
              outputPath: resolve(path.join(tempDist, config.redirects.static.outputPath)),
              outputCompactPath: config.redirects.static.outputCompactPath
                ? resolve(path.join(tempDist, config.redirects.static.outputCompactPath))
                : undefined,
              outputBloomFilterPath: config.redirects.static.outputBloomFilterPath
                ? resolve(path.join(tempDist, config.redirects.static.outputBloomFilterPath))
                : undefined,
            },
            dynamic: {
              inputPath: resolve(path.join(config.basePath, config.redirects.dynamic.inputPath)),
              outputPath: resolve(path.join(tempDist, config.redirects.dynamic.outputPath)),
            },
          }
        : null,

      prompts: config.prompts
        ? {
            inputPath: resolve(path.join(config.basePath, config.prompts.inputPath)),
            inputPathRelative: config.prompts.inputPath,
            outputPath: resolve(path.join(tempDist, config.prompts.outputPath)),
            outputPathRelative: config.prompts.outputPath,
          }
        : null,

      tooltips: config.tooltips
        ? {
            inputPath: resolve(path.join(config.basePath, config.tooltips.inputPath)),
            inputPathRelative: config.tooltips.inputPath,
            outputPath: resolve(path.join(tempDist, config.tooltips.outputPath)),
            outputPathRelative: config.tooltips.outputPath,
          }
        : null,

      llms: config.llms
        ? {
            overviewPath: config.llms.overviewPath,
            fullPath: config.llms.fullPath,
          }
        : null,

      siteFlags: config.siteFlags
        ? {
            inputPath: resolve(path.join(config.basePath, config.siteFlags.inputPath)),
            inputPathRelative: config.siteFlags.inputPath,
            outputPath: resolve(path.join(tempDist, config.siteFlags.outputPath)),
            outputPathRelative: config.siteFlags.outputPath,
          }
        : null,

      flags: {
        watch: config.flags?.watch ?? false,
        controlled: config.flags?.controlled ?? false,
        skipGit: config.flags?.skipGit ?? false,
        skipApiErrors: config.flags?.skipApiErrors ?? false,
        silenceTypedocErrors: config.flags?.silenceTypedocErrors ?? false,
      },
    }
  }

  return changeTempDist()
}
