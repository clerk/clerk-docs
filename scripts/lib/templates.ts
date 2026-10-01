import fs from 'node:fs/promises'
import path from 'node:path'
import type { BuildConfig } from './config'
import type { DocsFile } from './io'
import { VALID_SDKS, type SDK } from './schemas'
import {
  fetchTemplateMetadata,
  TemplateGitHubAuthError,
  templateGitHubToken,
  type TemplateGitHubMetadata,
} from './template-graphql'

interface AdditionalExample {
  path: string
  description: string
}

export interface TemplateRepository {
  name: string
  repositoryUrl: string
  examplePath?: string
  additionalExamples?: AdditionalExample[]
  sdk?: SDK
  description: string
  docsUrl: string | null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && Array.isArray(value) === false

const readRequiredString = (entry: Record<string, unknown>, field: string, index: number) => {
  const value = entry[field]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`templates.json entry ${index + 1} must have a non-empty ${field}`)
  }
  return value
}

export function parseTemplateRepositories(input: unknown): TemplateRepository[] {
  if (Array.isArray(input) === false) throw new Error('templates.json must contain an array')

  const names = new Set<string>()
  const repositoryUrls = new Set<string>()

  return input.map((value, index) => {
    if (isRecord(value) === false) throw new Error(`templates.json entry ${index + 1} must be an object`)

    const name = readRequiredString(value, 'name', index)
    const repositoryUrl = readRequiredString(value, 'repositoryUrl', index)
    const examplePath = value.examplePath
    const additionalExamples = value.additionalExamples
    const sdk = value.sdk
    const description = value.description
    const docsUrl = value.docsUrl

    if (/^[a-z0-9][a-z0-9-]*$/.test(name) === false) {
      throw new Error(`templates.json entry ${index + 1} has an invalid repository name: ${name}`)
    }
    if (repositoryUrl !== `https://github.com/clerk/${name}`) {
      throw new Error(`templates.json entry ${index + 1} must use https://github.com/clerk/${name}`)
    }
    if (
      examplePath !== undefined &&
      (typeof examplePath !== 'string' ||
        examplePath.split('/').some((segment) => /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(segment) === false))
    ) {
      throw new Error(`templates.json entry ${index + 1} has an invalid examplePath`)
    }
    if (value.exampleDescription !== undefined) {
      throw new Error(`templates.json entry ${index + 1} must use description instead of exampleDescription`)
    }
    if (additionalExamples !== undefined && Array.isArray(additionalExamples) === false) {
      throw new Error(`templates.json entry ${index + 1} must use an array for additionalExamples`)
    }
    const parsedAdditionalExamples = (additionalExamples as unknown[] | undefined)?.map((example, exampleIndex) => {
      if (isRecord(example) === false) {
        throw new Error(`templates.json entry ${index + 1} additional example ${exampleIndex + 1} must be an object`)
      }
      const exampleDirectory = example.path
      if (
        typeof exampleDirectory !== 'string' ||
        exampleDirectory.split('/').some((segment) => /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(segment) === false)
      ) {
        throw new Error(`templates.json entry ${index + 1} has an invalid additional example path`)
      }
      if (
        typeof example.description !== 'string' ||
        example.description.trim() === '' ||
        example.description.includes('\n')
      ) {
        throw new Error(`templates.json entry ${index + 1} must use a one-line additional example description`)
      }
      return { path: exampleDirectory, description: example.description }
    })
    const examplePaths = [examplePath, ...(parsedAdditionalExamples ?? []).map((example) => example.path)]
    if (new Set(examplePaths).size !== examplePaths.length) {
      throw new Error(`templates.json entry ${index + 1} contains duplicate example paths`)
    }
    if (value.framework !== undefined || value.sdkIcon !== undefined) {
      throw new Error(`templates.json entry ${index + 1} must use sdk instead of framework or sdkIcon`)
    }
    if (sdk !== undefined && (typeof sdk !== 'string' || VALID_SDKS.includes(sdk as SDK) === false)) {
      throw new Error(`templates.json entry ${index + 1} has an invalid sdk: ${String(sdk)}`)
    }
    if (typeof description !== 'string' || description.trim() === '') {
      throw new Error(`templates.json entry ${index + 1} must have a non-empty description`)
    }
    if (description?.includes('\n')) {
      throw new Error(`templates.json entry ${index + 1} must use a one-line description`)
    }
    if (value.fallbackDescription !== undefined) {
      throw new Error(`templates.json entry ${index + 1} must use description instead of fallbackDescription`)
    }
    if (docsUrl !== null && (typeof docsUrl !== 'string' || docsUrl.startsWith('/docs/') === false)) {
      throw new Error(`templates.json entry ${index + 1} must have a /docs/ URL or null for docsUrl`)
    }
    if (names.has(name)) throw new Error(`templates.json contains duplicate repository name: ${name}`)
    if (repositoryUrls.has(repositoryUrl)) {
      throw new Error(`templates.json contains duplicate repository URL: ${repositoryUrl}`)
    }

    names.add(name)
    repositoryUrls.add(repositoryUrl)

    return {
      name,
      repositoryUrl,
      ...(examplePath === undefined ? {} : { examplePath: examplePath as string }),
      ...(parsedAdditionalExamples === undefined ? {} : { additionalExamples: parsedAdditionalExamples }),
      ...(sdk === undefined ? {} : { sdk: sdk as SDK }),
      description,
      docsUrl: docsUrl as string | null,
    }
  })
}

export async function readTemplateRepositories(dataPath: string) {
  const contents = await fs.readFile(path.join(dataPath, 'templates.json'), 'utf8')
  return parseTemplateRepositories(JSON.parse(contents) as unknown)
}

function escapeMdxText(value: string) {
  return value.replace(/[\\{}<>]/g, (character) => `\\${character}`)
}

export function renderTemplatesPage(
  repositories: TemplateRepository[],
  metadata: ReadonlyMap<string, TemplateGitHubMetadata | null> | null = null,
) {
  const items = repositories.flatMap((repository) => {
    const remote = metadata?.get(repository.name)
    // Existing directory entries use main when a local build has no token or GitHub is unavailable.
    const branch = encodeURIComponent(remote?.defaultBranch ?? 'main')
    return [
      {
        title: repository.examplePath ? `${repository.name}/${repository.examplePath}` : repository.name,
        href: repository.examplePath
          ? `${repository.repositoryUrl}/tree/${branch}/${repository.examplePath}`
          : repository.repositoryUrl,
        description: repository.description,
        lastUpdatedAt: repository.examplePath ? remote?.exampleDates[repository.examplePath] : remote?.lastUpdatedAt,
      },
      ...(repository.additionalExamples ?? []).map((example) => ({
        title: `${repository.name}/${example.path}`,
        href: `${repository.repositoryUrl}/tree/${branch}/${example.path}`,
        description: example.description,
        lastUpdatedAt: remote?.exampleDates[example.path],
      })),
    ]
  })
  items.sort((a, b) => a.title.localeCompare(b.title))

  const markdownEntries = items
    .map(
      (
        item,
      ) => `  - [${item.title}](${item.href})${item.lastUpdatedAt ? `{{ lastUpdatedAt: '${item.lastUpdatedAt}' }}` : ''}
  - ${escapeMdxText(item.description)}`,
    )
    .join('\n\n  ---\n\n')

  return `---
title: Clerk templates and examples
description: Browse Clerk-maintained quickstarts, starter templates, demos, and example applications.
---

Use these Clerk-maintained repositories to start a new application or find a working example for a Clerk feature. Every repository listed here is public and not archived in the [Clerk GitHub organization](https://github.com/clerk).

<If is="human">
<TemplateCatalog items={${JSON.stringify(items)}} />
</If>

<If is="llm">
<Cards>
${markdownEntries}
</Cards>
</If>
`
}

export async function generateTemplatesPage(config: BuildConfig) {
  const repositories = await readTemplateRepositories(config.dataPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null
    throw error
  })
  if (repositories === null) return null

  const token = templateGitHubToken()
  if (!token) {
    // A missing token on Vercel is a configuration error that won't fix itself, so fail instead of shipping no dates.
    if (process.env.VERCEL === '1') {
      throw new Error('GITHUB_ACCESS_TOKEN is required on Vercel builds to fetch template dates')
    }
    console.info('GITHUB_ACCESS_TOKEN or GITHUB_TOKEN is not set; building templates without update dates')
  }

  let metadata: Map<string, TemplateGitHubMetadata | null> | null = null
  try {
    metadata = await fetchTemplateMetadata(repositories, { token })
  } catch (error) {
    if (error instanceof TemplateGitHubAuthError && process.env.VERCEL === '1') throw error
    console.warn(`Could not fetch template dates from GitHub; building without dates: ${String(error)}`)
  }
  const unresolved = [...(metadata ?? [])].filter(([, remote]) => remote === null).map(([name]) => name)
  if (unresolved.length > 0) {
    console.warn(`GitHub returned no data for ${unresolved.join(', ')}; building those templates without dates`)
  }

  const content = renderTemplatesPage(repositories, metadata)
  const outputPath = path.join(config.distTempPath, 'templates.mdx')

  await fs.writeFile(outputPath, content, 'utf8')

  return {
    filePath: '/docs/templates.mdx',
    relativeFilePath: 'docs/templates.mdx',
    fullFilePath: path.join(config.dataPath, 'templates.json') as `${string}.mdx`,
    filePathInDocsFolder: 'templates.mdx',
    sourceFile: '/data/templates.json',
    href: '/docs/templates',
    relativeHref: 'docs/templates',
    content,
  } satisfies DocsFile & { content: string }
}
