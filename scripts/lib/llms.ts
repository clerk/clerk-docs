import type { BuildConfig } from './config'
import { removeMdxSuffix } from './utils/removeMdxSuffix'
import yaml from 'yaml'
import type { SDK } from './schemas'

type Docs = Map<string, string>

// Display names for SDKs when rendered as sub-headers in llms.txt.
// Keep these in sync with VALID_SDKS in ./schemas.ts.
const SDK_DISPLAY_NAMES: Record<SDK, string> = {
  nextjs: 'Next.js',
  react: 'React',
  'js-frontend': 'JavaScript',
  'chrome-extension': 'Chrome Extension',
  expo: 'Expo',
  android: 'Android',
  ios: 'iOS',
  expressjs: 'Express',
  fastify: 'Fastify',
  'react-router': 'React Router',
  'tanstack-react-start': 'TanStack React Start',
  go: 'Go',
  astro: 'Astro',
  nuxt: 'Nuxt',
  vue: 'Vue',
  ruby: 'Ruby',
}

// Some SDKs are referenced in URL/file paths under a slug that doesn't match
// their SDK key (e.g. /docs/reference/javascript/... is the js-frontend SDK).
// This map allows those path segments to be recognized as SDK-scoped.
const PATH_SEGMENT_SDK_ALIASES: Record<string, SDK> = {
  javascript: 'js-frontend',
  express: 'expressjs',
}

const getSdkFromPath = (path: string, validSdks: readonly SDK[]): SDK | null => {
  // Skip the trailing file segment (e.g. "expo.mdx") - we only want directory
  // segments, so a generic doc whose filename contains an SDK name is not
  // misclassified as SDK-scoped.
  const segments = path.split('/').slice(0, -1)
  for (const segment of segments) {
    if (validSdks.includes(segment as SDK)) {
      return segment as SDK
    }
    const aliased = PATH_SEGMENT_SDK_ALIASES[segment]
    if (aliased && validSdks.includes(aliased)) {
      return aliased
    }
  }
  return null
}

const getSdkDisplayName = (sdk: SDK): string => SDK_DISPLAY_NAMES[sdk] ?? sdk

export const writeLLMsFull = async (outputtedDocsFiles: OutputtedDocsFiles) => {
  return outputtedDocsFiles.map((file) => file.content).join('\n')
}

export const writeLLMs = async (outputtedDocsFiles: OutputtedDocsFiles, validSdks: readonly SDK[]) => {
  const generic: OutputtedDocsFiles = []
  const bySdk = new Map<SDK, OutputtedDocsFiles>()

  for (const page of outputtedDocsFiles) {
    const sdk = getSdkFromPath(page.path, validSdks)
    if (sdk === null) {
      generic.push(page)
    } else {
      const list = bySdk.get(sdk) ?? []
      list.push(page)
      bySdk.set(sdk, list)
    }
  }

  const formatPage = (page: OutputtedDocsFiles[number]) => `- [${page.title}](${page.url})`

  const sections: string[] = [`## Docs`, generic.map(formatPage).join('\n')]

  // Emit SDK sections in the order they appear in validSdks for stable, predictable output.
  for (const sdk of validSdks) {
    const pages = bySdk.get(sdk)
    if (!pages || pages.length === 0) continue
    sections.push(`### ${getSdkDisplayName(sdk)}`)
    sections.push(pages.map(formatPage).join('\n'))
  }

  return `# Clerk\n\n${sections.filter((section) => section.length > 0).join('\n\n')}`
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
