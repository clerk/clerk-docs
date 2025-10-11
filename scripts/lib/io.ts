import { removeMdxSuffix } from './utils/removeMdxSuffix'
import { errorMessages } from './error-messages'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { BuildConfig } from './config'
import readdirp from 'readdirp'
import type { SDK } from './schemas'
import { Store } from './store'

// Read in a markdown file from the docs folder
export const readMarkdownFile = async (filePath: string) => {
  try {
    const fileContent = await fs.readFile(filePath, { encoding: 'utf-8' })
    return [null, fileContent] as const
  } catch (error) {
    return [new Error(errorMessages['file-read-error'](filePath), { cause: error }), null] as const
  }
}

// list all the docs in the docs folder
export const readDocsFolder = (config: BuildConfig) => async () => {
  const files = await readdirp.promise(config.docsPath, {
    type: 'files',
    fileFilter: (entry) =>
      // Partials are inside the docs folder, so we need to exclude them
      // Exclude global _partials folder and any relative _partials folders
      !entry.path.startsWith(`${config.partialsFolderName}/`) &&
      !entry.path.includes(`/${config.partialsFolderName}/`) &&
      // Tooltips are inside the docs folder too, also ignore them as they are not full pages
      (config.tooltips?.inputPathRelative
        ? `${config.docsRelativePath}/${entry.path}`.startsWith(config.tooltips.inputPathRelative) === false
        : true) &&
      // Ignore anything that isn't an .mdx file
      entry.path.endsWith('.mdx'),
  })

  return files.map((file) => {
    const filePath = path.join(config.baseDocsLink, file.path)
    const href = removeMdxSuffix(filePath)

    return {
      filePath: filePath as `/docs/${string}.mdx`,
      relativeFilePath: filePath.substring(1) as `docs/${string}.mdx`,
      fullFilePath: path.join(config.basePath, '..', filePath) as `${string}.mdx`,
      filePathInDocsFolder: file.path as `${string}.mdx`,

      href: href as `/docs/${string}`,
      relativeHref: href.substring(1) as `docs/${string}`,
    }
  })
}

export type DocsFile = Awaited<ReturnType<ReturnType<typeof readDocsFolder>>>[number]

// checks if a folder exists, if not it will be created
export const ensureDirectory = async (dirPath: string): Promise<void> => {
  try {
    await fs.access(dirPath)
  } catch {
    await fs.mkdir(dirPath, { recursive: true })
  }
}

// write a file to the dist (output) folder
export const writeDistFile = (config: BuildConfig, store: Store) => async (filePath: string, contents: string) => {
  const fullPath = path.join(config.distTempPath, filePath)
  await ensureDirectory(path.dirname(fullPath))
  await fs.writeFile(fullPath, contents, { encoding: 'utf-8' })
  store.writtenFiles.set(filePath, contents)
}

// write a file to the dist (output) folder, inside the specified sdk folder
export const writeSDKFile = (config: BuildConfig, store: Store) => {
  const writeFile = writeDistFile(config, store)
  return async (sdk: SDK, filePath: string, contents: string) => {
    await writeFile(path.join(sdk, filePath), contents)
  }
}

// not exactly io, but used to parse the json using a result pattern
export const parseJSON = (json: string) => {
  try {
    const output = JSON.parse(json)

    return [null, output as unknown] as const
  } catch (error) {
    return [new Error(`Failed to parse JSON`, { cause: error }), null] as const
  }
}
