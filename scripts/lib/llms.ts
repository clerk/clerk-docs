import { removeMdxSuffix } from './utils/removeMdxSuffix'

type Docs = Map<string, string>

export const writeLLMsFull = async (docs: Docs, files: { path: string }[]) => {
  const allFiles = listAllFiles(docs, files)
  return JSON.stringify(allFiles, null, 2)
  //   return JSON.stringify({ docs: Array.from(docs.entries()), files }, null, 2)
}

export const writeLLMs = async (docs: Docs, files: { path: string }[]) => {
  const allFiles = listAllFiles(docs, files)
  return ''
}

const listAllFiles = (docs: Docs, files: { path: string }[]) => {
  return files.map(({ path }) => {
    const doc = docs.get(path)
    if (!doc) {
      throw new Error(`Doc not found: ${path}`)
    }

    return {
      path,
      url: `{{SITE_URL}}/docs/${removeMdxSuffix(path)
        .replace(/^index$/, '') // remove root index
        .replace(/\/index$/, '')}`, // remove /index from the end,
    }
  })
}
