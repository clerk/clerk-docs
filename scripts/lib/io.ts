import fs from 'node:fs/promises'
import path from 'node:path'
import readdirp from 'readdirp'
import type { BuildConfig } from './config'
import { errorMessages } from './error-messages'

// Read in a markdown file from the docs folder
export const readMarkdownFile = (config: BuildConfig) => async (docPath: string) => {
  const filePath = path.join(config.docsPath, docPath)

  try {
    const fileContent = await fs.readFile(filePath, { encoding: 'utf-8' })
    return [null, fileContent] as const
  } catch (error) {
    return [new Error(errorMessages['file-read-error'](filePath), { cause: error }), null] as const
  }
}

// list all the docs in the docs folder
export const readDocsFolder = (config: BuildConfig) => async () => {
  return readdirp.promise(config.docsPath, {
    type: 'files',
    fileFilter: (entry) =>
      // Partials are inside the docs folder, so we need to exclude them
      `${config.docsRelativePath}/${entry.path}`.startsWith(config.partialsRelativePath) === false &&
      entry.path.endsWith('.mdx'),
  })
}

// not exactly io, but used to parse the json using a result patten
export const parseJSON = (json: string) => {
  try {
    const output = JSON.parse(json)

    return [null, output as unknown] as const
  } catch (error) {
    return [new Error(`Failed to parse JSON`, { cause: error }), null] as const
  }
}
