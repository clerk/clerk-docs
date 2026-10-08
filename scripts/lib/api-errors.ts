import fs from 'node:fs/promises'
import path from 'path'
import type { BuildConfig } from './config'
import { DocsFile } from './io'

// Matches bare http(s) URLs so they can be wrapped as MDX links.
const urlRegex = /(https?:\/\/[^\s]+)/g
// Matches each uppercase letter, used to insert word-break opportunities.
const uppercaseLetterRegex = /([A-Z])/g
// Matches a single trailing newline at the end of the string.
const trailingNewlineRegex = /\n$/

// Section headings come from Go filenames (`jwt_templates.go` -> "JWT templates") and are sentence case, per the
// styleguide. Filenames come from clerk_go, so casing the default can't produce lives here.

// Words that keep a fixed casing wherever they appear in a filename.
const TITLE_WORDS: Record<string, string> = {
  cimd: 'CIMD',
  easie: 'EASIE',
  idp: 'IdP',
  jwt: 'JWT',
  oauth: 'OAuth',
  pkce: 'PKCE',
  saml: 'SAML',
  scim: 'SCIM',
  sms: 'SMS',
  sso: 'SSO',
  totp: 'TOTP',
  url: 'URL',
  urls: 'URLs',
}

// Whole filenames the word rules can't produce: run-together words, Clerk feature proper nouns, product names, and
// hyphenated nouns.
const TITLE_OVERRIDES: Record<string, string> = {
  agent_tasks: 'Agent Tasks',
  apikeys: 'API keys',
  awscognito: 'AWS Cognito',
  github_student_pack: 'GitHub Student Pack',
  google_one_tap: 'Google One Tap',
  oauth2_idp: 'OAuth 2.0 IdP',
  sign_in: 'Sign-in',
  sign_in_tokens: 'Sign-in tokens',
  sign_up: 'Sign-up',
}

interface ApiError {
  name: string
  description?: string
  status: number
  shortMessage: string
  longMessage?: string
  code: string
  meta?: Record<string, unknown>
  usage: {
    fapi: boolean
    bapi: boolean
    plapi: boolean
  }
  file?: string
}

// Where the generated error pages live, relative to the docs folder.
export const API_ERRORS_FOLDER = 'guides/development/errors'

// One generated page per API. `usage` is the flag in api_errors.json that routes an error to the page.
export const API_ERROR_PAGES = [
  { slug: 'backend-api', api: 'Backend API', usage: 'bapi' },
  { slug: 'frontend-api', api: 'Frontend API', usage: 'fapi' },
  { slug: 'platform-api', api: 'Platform API', usage: 'plapi' },
] as const satisfies { slug: string; api: string; usage: keyof ApiError['usage'] }[]

interface ParseApiErrorsOpts {
  title: string
  description: string
}

function parseApiErrors(errors: ApiError[], opts: ParseApiErrorsOpts): string {
  const frontmatter = `---
title: ${opts.title}
description: ${opts.description}
type: reference
---

${opts.description}

`
  const parseDescription = (name: string, description: string | undefined) => {
    if (!description) return ''

    const parsedDescription = description
      .replaceAll(name, `\`${name}\``) // Format the error name in the description
      .replaceAll('_', '\\_') // Escape underscores
      .replaceAll(urlRegex, (url) => `[${url}](${url})`) // Replace URLs with MDX links

    return `\n${parsedDescription}\n`
  }

  const parseTitle = (file: string) => {
    if (!file) return 'Other'
    const name = file.replace('.go', '')
    if (TITLE_OVERRIDES[name]) return TITLE_OVERRIDES[name]
    const title = name
      .split('_')
      .map((word) => TITLE_WORDS[word] ?? word)
      .join(' ')
    return title.charAt(0).toUpperCase() + title.slice(1)
  }

  // Handles line break opportunities in the error name
  const parseName = (name: string) => {
    return name.replace(uppercaseLetterRegex, '<wbr />$1')
  }

  // Renders the response body as the API sends it (clerk_go api/apierror/response.go). Without a long message, the API
  // falls back to the short one. `meta` holds the JSON keys the API sends, with `<placeholders>` for values only known
  // at runtime. `clerk_trace_id` is left out because it's per request, not per error.
  const parseCode = (error: ApiError) => {
    const body = {
      errors: [
        {
          message: error.shortMessage,
          long_message: error.longMessage || error.shortMessage,
          code: error.code,
          ...(error.meta && { meta: error.meta }),
        },
      ],
    }

    return `\`\`\`json {{ filename: 'Status Code: ${error.status}' }}
${JSON.stringify(body, null, 2)}
\`\`\``
  }

  // Group errors by file
  const errorsByFile = errors.reduce(
    (acc, error) => {
      const file = error.file || 'other'
      if (!acc[file]) {
        acc[file] = []
      }
      acc[file].push(error)
      return acc
    },
    {} as Record<string, ApiError[]>,
  )

  // Sort files alphabetically
  const sortedFiles = Object.keys(errorsByFile).sort()

  // Generate documentation for each file group
  const errorDocs = sortedFiles
    .map((file) => {
      const fileErrors = errorsByFile[file]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((error) => {
          return `### <code>${parseName(error.name)}</code>
${parseDescription(error.name, error.description)}
${parseCode(error)}
`
        })
        .join('\n')

      return `## ${parseTitle(file)}

${fileErrors}
`
    })
    .join('')

  return frontmatter + errorDocs.replace(trailingNewlineRegex, '')
}

export async function generateApiErrorDocs(config: BuildConfig) {
  if (config.flags.skipApiErrors) return null

  try {
    // Read the API errors JSON file
    const apiErrorsPath = path.join(config.dataPath, 'api_errors.json')
    const apiErrorsContent = await fs.readFile(apiErrorsPath, 'utf-8')
    const errors: ApiError[] = JSON.parse(apiErrorsContent)

    const outputPath = path.join(config.distTempPath, API_ERRORS_FOLDER)
    await fs.mkdir(outputPath, { recursive: true })

    return await Promise.all(
      API_ERROR_PAGES.map(async (page) => {
        const content = parseApiErrors(
          errors.filter((error) => error.usage[page.usage]),
          {
            title: `${page.api} errors`,
            description: `An index of Clerk ${page.api} errors.`,
          },
        )

        await fs.writeFile(path.join(outputPath, `${page.slug}.mdx`), content, 'utf-8')

        const filePath = `/docs/${API_ERRORS_FOLDER}/${page.slug}.mdx` as const
        const href = `/docs/${API_ERRORS_FOLDER}/${page.slug}` as const

        return {
          filePath,
          relativeFilePath: filePath.substring(1) as `docs/${string}.mdx`,
          fullFilePath: path.join(config.basePath, '..', filePath) as `${string}.mdx`,
          filePathInDocsFolder: `${API_ERRORS_FOLDER}/${page.slug}.mdx`,

          href,
          relativeHref: href.substring(1) as `docs/${string}`,

          content,
        } satisfies DocsFile & { content: string }
      }),
    )
  } catch (error) {
    console.error('Error generating documentation:', error)
    throw error
    process.exit(1)
  }
}
