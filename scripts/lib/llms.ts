import type { BuildConfig } from './config'
import { removeMdxSuffix } from './utils/removeMdxSuffix'
import yaml from 'yaml'

type Docs = Map<string, string>

export const writeLLMsFull = async (outputtedDocsFiles: OutputtedDocsFiles) => {
  return outputtedDocsFiles.map((file) => file.content).join('\n')
}

export const formatLLMsDocLine = (page: { title: string; url: string; description?: string }) => {
  return page.description ? `- [${page.title}](${page.url}): ${page.description}` : `- [${page.title}](${page.url})`
}

export const writeLLMs = async (outputtedDocsFiles: OutputtedDocsFiles) => {
  const list = outputtedDocsFiles.map(formatLLMsDocLine).join('\n')
  return `# Clerk\n\n## Docs\n\n${list}`
}

export const normalizeFrontmatterDescription = (raw: unknown): string | undefined => {
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim().replace(/\s+/g, ' ')
  return trimmed.length > 0 ? trimmed : undefined
}

export const listOutputDocsFiles = (config: BuildConfig, docs: Docs, files: { path: string }[]) => {
  return files
    .filter(({ path }) => !path.startsWith('~/')) // Exclude these quick redirect pages
    .map(({ path }) => {
      const content = docs.get(path)

      if (!content) {
        throw new Error(`Doc not found: ${path}`)
      }

      return {
        path,
        url: `{{SITE_URL}}${config.baseDocsLink}${removeMdxSuffix(path)
          .replace(/^index$/, '') // remove root index
          .replace(/\/index$/, '')}`, // remove /index from the end,
        content,
      }
    })
    .map((file) => {
      const frontmatter = yaml.parse(file.content.split('---')[1])
      const { title } = frontmatter

      if (!title) {
        // console.error(`Title not found in ${file.path} - will be ignored from llm txt files`)
        return null
      }

      return {
        ...file,
        title,
        description: normalizeFrontmatterDescription(frontmatter.description),
      }
    })
    .filter((page) => page !== null)
}

type OutputtedDocsFiles = ReturnType<typeof listOutputDocsFiles>
