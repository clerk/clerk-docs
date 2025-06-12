// For the test suite to work effectively we need to be able to
// configure the builds, this file defines the config object

import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'
import type { SDK } from './schemas'

type BuildConfigOptions = {
  basePath: string
  validSdks: readonly SDK[]
  dataPath: string
  docsPath: string
  baseDocsLink: string
  manifestPath: string
  partialsPath: string
  distPath: string
  typedocPath: string
  publicPath?: string
  ignorePaths: string[]
  ignoreLinks: string[]
  ignoreWarnings?: {
    docs: Record<string, string[]>
    partials: Record<string, string[]>
    typedoc: Record<string, string[]>
  }
  manifestOptions: {
    wrapDefault: boolean
    collapseDefault: boolean
    hideTitleDefault: boolean
  }
  redirects?: {
    static: {
      inputPath: string
      outputPath: string
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
  flags?: {
    watch?: boolean
    controlled?: boolean
    skipGit?: boolean
    skipApiErrors?: boolean
  }
}

export type BuildConfig = Awaited<ReturnType<typeof createConfig>>

// Takes the basePath and resolves the relative paths to be absolute paths
export async function createConfig(config: BuildConfigOptions) {
  const resolve = (relativePath: string) => {
    return path.isAbsolute(relativePath) ? relativePath : path.join(config.basePath, relativePath)
  }

  const tempDist = await fs.mkdtemp(path.join(os.tmpdir(), 'clerk-docs-dist-'))

  return {
    basePath: config.basePath,
    baseDocsLink: config.baseDocsLink,
    validSdks: config.validSdks,

    manifestRelativePath: config.manifestPath,
    manifestFilePath: resolve(config.manifestPath),

    partialsRelativePath: config.partialsPath,
    partialsPath: resolve(config.partialsPath),

    dataRelativePath: config.dataPath,
    dataPath: resolve(config.dataPath),

    docsRelativePath: config.docsPath,
    docsPath: resolve(config.docsPath),

    distTempRelativePath: tempDist,
    distTempPath: resolve(tempDist),

    distFinalRelativePath: config.distPath,
    distFinalPath: resolve(config.distPath),

    typedocRelativePath: config.typedocPath,
    typedocPath: resolve(config.typedocPath),

    publicRelativePath: config.publicPath,
    publicPath: config.publicPath ? resolve(config.publicPath) : undefined,

    ignoredPaths: (url: string) => config.ignorePaths.some((ignoreItem) => url.startsWith(ignoreItem)),
    ignoredLinks: (url: string) => config.ignoreLinks.some((ignoreItem) => url === ignoreItem),
    ignoreWarnings: config.ignoreWarnings ?? {
      docs: {},
      partials: {},
      typedoc: {},
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

    flags: {
      watch: config.flags?.watch ?? false,
      controlled: config.flags?.controlled ?? false,
      skipGit: config.flags?.skipGit ?? false,
      skipApiErrors: config.flags?.skipApiErrors ?? false,
    },
  }
}
