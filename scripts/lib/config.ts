// For the test suite to work effectively we need to be able to
// configure the builds, this file defines the config object

import path from 'node:path'
import type { SDK } from './schemas'

type BuildConfigOptions = {
  basePath: string
  validSdks: readonly SDK[]
  docsPath: string
  baseDocsLink: string
  manifestPath: string
  partialsPath: string
  distPath: string
  typedocPath: string
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
  cleanDist: boolean
  flags?: {
    watch?: boolean
    controlled?: boolean
  }
}

export type BuildConfig = ReturnType<typeof createConfig>

// Takes the basePath and resolves the relative paths to be absolute paths
export function createConfig(config: BuildConfigOptions) {
  const resolve = (relativePath: string) => {
    return path.isAbsolute(relativePath) ? relativePath : path.join(config.basePath, relativePath)
  }

  return {
    basePath: config.basePath,
    baseDocsLink: config.baseDocsLink,
    validSdks: config.validSdks,

    manifestRelativePath: config.manifestPath,
    manifestFilePath: resolve(config.manifestPath),

    partialsRelativePath: config.partialsPath,
    partialsPath: resolve(config.partialsPath),

    docsRelativePath: config.docsPath,
    docsPath: resolve(config.docsPath),

    distRelativePath: config.distPath,
    distPath: resolve(config.distPath),

    typedocRelativePath: config.typedocPath,
    typedocPath: resolve(config.typedocPath),

    ignoredLink: (url: string) => config.ignoreLinks.some((ignoreItem) => url.startsWith(ignoreItem)),
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
            inputPath: resolve(path.join(config.distPath, config.redirects.static.inputPath)),
            outputPath: resolve(path.join(config.distPath, config.redirects.static.outputPath)),
          },
          dynamic: {
            inputPath: resolve(path.join(config.distPath, config.redirects.dynamic.inputPath)),
            outputPath: resolve(path.join(config.distPath, config.redirects.dynamic.outputPath)),
          },
        }
      : null,

    cleanDist: config.cleanDist,

    flags: {
      watch: config.flags?.watch ?? false,
      controlled: config.flags?.controlled ?? false,
    },
  }
}
