import type { BuildConfig } from './config'
import { removeMdxSuffix } from './utils/removeMdxSuffix'
import yaml from 'yaml'

type Docs = Map<string, string>

export const LLMS_FULL_HEADER = `# Clerk Documentation (full content)

> Complete Clerk documentation: every doc page concatenated into one file
> for LLM/agent consumption.

## Companion files

- [All sections index](https://clerk.com/llms-full.txt): Top-level index linking to every llms-full.txt file on clerk.com
- [Articles](https://clerk.com/articles/llms-full.txt): Full content of all Clerk articles
- [Blog](https://clerk.com/blog/llms-full.txt): Full content of all Clerk blog posts
- [Changelog](https://clerk.com/changelog/llms-full.txt): Full content of all Clerk changelog entries

---

`

export const writeLLMsFull = async (outputtedDocsFiles: OutputtedDocsFiles) => {
  return LLMS_FULL_HEADER + outputtedDocsFiles.map((file) => file.content).join('\n')
}

export const writeLLMs = async (outputtedDocsFiles: OutputtedDocsFiles) => {
  const list = outputtedDocsFiles.map((page) => `- [${page.title}](${page.url})`).join('\n')
  return `# Clerk\n\n## Docs\n\n${list}`
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
      }
    })
    .filter((page) => page !== null)
}

type OutputtedDocsFiles = ReturnType<typeof listOutputDocsFiles>
