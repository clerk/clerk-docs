import type { BuildConfig } from './config'
import { removeMdxSuffix } from './utils/removeMdxSuffix'
import yaml from 'yaml'

type Docs = Map<string, string>

export const writeLLMsFull = async (outputtedDocsFiles: OutputtedDocsFiles) => {
  return outputtedDocsFiles.map((file) => file.content).join('\n')
}

export const writeLLMs = async (outputtedDocsFiles: OutputtedDocsFiles) => {
  const list = outputtedDocsFiles.map((page) => `- [${page.title}](${page.url})`).join('\n')
  return `# Clerk\n\n## Docs\n\n${list}`
}

// Build the public markdown URL for a docs file path. Points at the `.md`
// export route so LLMs consuming llms.txt fetch the markdown variant directly.
export const buildLLMsDocsUrl = (filePath: string, baseDocsLink: string): string => {
  // For nested index pages (e.g. `guides/index.mdx`) the canonical URL drops
  // the trailing `/index`, matching the docs site's routing. The root
  // `index.mdx` keeps its slug so it maps to `/docs/index.md`.
  const slug = removeMdxSuffix(filePath).replace(/\/index$/, '')
  return `{{SITE_URL}}${baseDocsLink}${slug}.md`
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
        url: buildLLMsDocsUrl(path, config.baseDocsLink),
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
      }
    })
    .filter((page) => page !== null)
}

type OutputtedDocsFiles = ReturnType<typeof listOutputDocsFiles>
