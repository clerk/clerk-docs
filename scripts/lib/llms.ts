import yaml from 'yaml'
import type { SDK } from './schemas'

type Docs = Map<string, string>

// Collapses any run of whitespace into a single space.
const whitespaceRunRegex = /\s+/g

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

// Which path segment an SDK's reference pages live under. `src/app/docs/SDK.tsx` derives this from
// each SDK's `referenceRoute` — that is the authority. This file can't import across the clerk-docs
// boundary, so PATH_SEGMENT_SDK_ALIASES mirrors it by hand.
//
// `backend` -> `js-backend` is deliberately absent: js-backend is deprecated for the current core, so
// its URLs must stay reference-first to match convertMdxToMarkdown.ts. Do not "complete" this map.
const getReferencePathSegment = (sdk: SDK): string =>
  Object.entries(PATH_SEGMENT_SDK_ALIASES).find(([, aliasedSdk]) => aliasedSdk === sdk)?.[0] ?? sdk

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Clerk-owned registrable domains: production `clerk.com` and Vercel preview
// deployments on `clerkstage.dev` (e.g. `clerk-docs-git-<branch>.clerkstage.dev`).
// The `(?:[a-z0-9-]+\.)*` allows any subdomain, and anchoring the host between
// `https://` and the path means look-alikes like `clerk.com.evil.dev` or
// `notclerkstage.dev` can't match.
const CLERK_HOST = '(?:[a-z0-9-]+\\.)*(?:clerk\\.com|clerkstage\\.dev)'

// A root-relative `/docs/...` link only counts when the character before `/docs`
// isn't part of a larger token — a host, a deeper path segment, or a query value.
// Excluding `/?&=%-` keeps third-party URLs like
// `https://example.test/?next=/docs/reference/...` or `.../x//docs/reference/...`
// from being treated as Clerk links. The normalizer and the guard share this
// boundary so they agree on what a root-relative link is; their host matching
// stays separate (see generatedClerkDocsPath).
const ROOT_RELATIVE_BOUNDARY = '(?<![\\w./?&=%-])'

// Matches a Clerk-owned docs path beginning with `pathPrefix` — an absolute Clerk
// URL (see CLERK_HOST) or a root-relative `/docs/...` link — while ignoring
// third-party URLs that merely contain the same path (e.g. a Supabase reference
// link that includes `/docs/reference/javascript/`). The leading alternation is
// captured so callers can preserve the host prefix when rewriting.
const clerkOwnedDocsPath = (pathPrefix: string, flags = ''): RegExp =>
  new RegExp(`(https://${CLERK_HOST}|${ROOT_RELATIVE_BOUNDARY})${escapeRegExp(pathPrefix)}`, flags)

// Intentionally separate from clerkOwnedDocsPath: the output guard must not share
// the normalizer's matcher or a matcher regression could make both silently agree.
const generatedClerkDocsPath = (pathPrefix: string): RegExp =>
  new RegExp(`(?:https://${CLERK_HOST}|${ROOT_RELATIVE_BOUNDARY})${escapeRegExp(pathPrefix)}`)

export const emitSdkFirstReferenceUrls = (content: string, validSdks: readonly SDK[]): string => {
  const rewrites = validSdks.map((sdk) => ({
    from: clerkOwnedDocsPath(`/docs/reference/${getReferencePathSegment(sdk)}/`, 'g'),
    to: `$1/docs/${sdk}/reference/`,
  }))

  // `canonical:` frontmatter keeps the page's real, reference-first canonical URL — rewriting it
  // makes llms-full.txt disagree with the live page's <link rel="canonical">.
  return content
    .split('\n')
    .map((line) => {
      if (line.startsWith('canonical:')) return line
      return rewrites.reduce((acc, { from, to }) => acc.replace(from, to), line)
    })
    .join('\n')
}

/**
 * Guard the generated index against teaching agents both reference URL shapes
 * for the same SDK. Canonical metadata in individual pages remains
 * reference-first; links emitted from an SDK section are always SDK-first.
 *
 * Only Clerk-owned links count: a third-party URL that merely contains
 * `/docs/reference/<segment>/` (e.g. a Supabase link) is not a mixed shape.
 */
export const assertConsistentReferenceUrlShapes = (content: string, validSdks: readonly SDK[]) => {
  // canonical: frontmatter is intentionally reference-first (see emitSdkFirstReferenceUrls) and
  // isn't part of the emitted link shape, so it's excluded from this check.
  const body = content
    .split('\n')
    .filter((line) => !line.startsWith('canonical:'))
    .join('\n')

  for (const sdk of validSdks) {
    const hasReferenceFirst = generatedClerkDocsPath(`/docs/reference/${getReferencePathSegment(sdk)}/`).test(body)

    if (hasReferenceFirst) {
      throw new Error(`Generated LLM file contains a non-canonical reference-first URL for ${sdk}`)
    }
  }
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

export const writeLLMsFull = async (outputtedDocsFiles: OutputtedDocsFiles, validSdks: readonly SDK[]) => {
  const content = emitSdkFirstReferenceUrls(
    LLMS_FULL_HEADER + outputtedDocsFiles.map((file) => file.content).join('\n'),
    validSdks,
  )
  assertConsistentReferenceUrlShapes(content, validSdks)
  return content
}

export const formatLLMsDocLine = (page: OutputtedDocsFiles[number]) =>
  page.description ? `- [${page.title}](${page.url}): ${page.description}` : `- [${page.title}](${page.url})`

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

  const sections: string[] = [`## Docs`, generic.map(formatLLMsDocLine).join('\n')]

  // Emit SDK sections in the order they appear in validSdks for stable, predictable output.
  for (const sdk of validSdks) {
    const pages = bySdk.get(sdk)
    if (!pages || pages.length === 0) continue
    sections.push(`### ${getSdkDisplayName(sdk)}`)
    sections.push(pages.map(formatLLMsDocLine).join('\n'))
  }

  const content = emitSdkFirstReferenceUrls(
    `# Clerk\n\n${sections.filter((section) => section.length > 0).join('\n\n')}`,
    validSdks,
  )
  assertConsistentReferenceUrlShapes(content, validSdks)
  return content
}

export const normalizeFrontmatterDescription = (raw: unknown): string | undefined => {
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim().replace(whitespaceRunRegex, ' ')
  return trimmed.length > 0 ? trimmed : undefined
}

export const listOutputDocsFiles = (docs: Docs, files: { path: string; url: string }[]) => {
  return files
    .filter(({ path }) => !path.startsWith('~/')) // Exclude these quick redirect pages
    .map(({ path, url }) => {
      const content = docs.get(path)

      if (!content) {
        throw new Error(`Doc not found: ${path}`)
      }

      return {
        path,
        url: `{{SITE_URL}}${url}.md`,
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
