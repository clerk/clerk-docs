import type { BuildConfig } from './config'
import { removeMdxSuffix } from './utils/removeMdxSuffix'
import type { SDK } from './schemas'
import yaml from 'yaml'

type Docs = Map<string, string>

export const writeLLMsFull = async (outputtedDocsFiles: OutputtedDocsFiles) => {
  return outputtedDocsFiles.map((file) => file.content).join('\n')
}

// Returns the SDK whose folder a dist-relative path lives under, or null for
// non-SDK-scoped (core) paths. The match requires a `${sdk}/` segment so that
// SDKs sharing a prefix (e.g. `react` vs `react-router`) are disambiguated.
export const sdkPrefixOfPath = (filePath: string, validSdks: readonly SDK[]): SDK | null => {
  for (const sdk of validSdks) {
    if (filePath === sdk || filePath.startsWith(`${sdk}/`)) return sdk
  }
  return null
}

// Pick the docs that belong in the per-SDK llms-full bundle for `targetSdk`.
// Rules:
//   - Files under `{otherSdk}/...` are dropped.
//   - Files under `{targetSdk}/...` are kept (the real SDK-specific content).
//   - Core (non-prefixed) files are kept unless either:
//       a) they're shadowed by any `{anySdk}/<same path>` (the core file is
//          just a landing-redirect for an SDK-split doc), OR
//       b) they're SDK-scoped (single-SDK docs without their own variant dir)
//          and `targetSdk` isn't listed in `availableSdks`.
export const filterOutputDocsForSdk = <T extends Pick<OutputtedDocsFile, 'path' | 'sdkScoped' | 'availableSdks'>>(
  docs: T[],
  targetSdk: SDK,
  validSdks: readonly SDK[],
): T[] => {
  const allPaths = new Set(docs.map((doc) => doc.path))
  const isShadowed = (corePath: string) => validSdks.some((sdk) => allPaths.has(`${sdk}/${corePath}`))

  return docs.filter((doc) => {
    const sdk = sdkPrefixOfPath(doc.path, validSdks)
    if (sdk !== null) return sdk === targetSdk
    if (isShadowed(doc.path)) return false
    if (doc.sdkScoped) return doc.availableSdks?.includes(targetSdk) ?? false
    return true
  })
}

export const writeLLMs = async (outputtedDocsFiles: OutputtedDocsFiles) => {
  const list = outputtedDocsFiles.map((page) => `- [${page.title}](${page.url})`).join('\n')
  return `# Clerk\n\n## Docs\n\n${list}`
}

// Parse the comma-separated `availableSdks` frontmatter field into a list of
// SDK keys. Returns null when the field is absent or empty.
const parseAvailableSdks = (raw: unknown): SDK[] | null => {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (trimmed.length === 0) return null
  return trimmed
    .split(',')
    .map((sdk) => sdk.trim())
    .filter((sdk) => sdk.length > 0) as SDK[]
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
      const { title, sdkScoped, availableSdks } = frontmatter ?? {}

      if (!title) {
        // console.error(`Title not found in ${file.path} - will be ignored from llm txt files`)
        return null
      }

      return {
        ...file,
        title,
        sdkScoped: sdkScoped === true || sdkScoped === 'true',
        availableSdks: parseAvailableSdks(availableSdks),
      }
    })
    .filter((page) => page !== null)
}

export type OutputtedDocsFile = NonNullable<ReturnType<typeof listOutputDocsFiles>[number]>
type OutputtedDocsFiles = ReturnType<typeof listOutputDocsFiles>
