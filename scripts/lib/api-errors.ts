import fs from 'node:fs/promises'
import path from 'path'
import type { BuildConfig } from './config'

interface ApiError {
  name: string
  description?: string
  status: number
  shortMessage: string
  longMessage?: string
  code: string
  meta?: string
  usage: {
    fapi: boolean
    bapi: boolean
  }
  file?: string
}

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
  const parseMeta = (meta: string) => {
    try {
      return JSON.parse(meta.toLowerCase())
    } catch (error) {
      return meta
    }
  }

  const parseDescription = (name: string, description: string | undefined) => {
    if (!description) return ''

    const parsedDescription = description
      .replaceAll(name, `\`${name}\``) // Format the error name in the description
      .replaceAll('_', '\\_') // Escape underscores
      .replaceAll(/(https?:\/\/[^\s]+)/g, (url) => `[${url}](${url})`) // Replace URLs with MDX links

    return `\n${parsedDescription}\n`
  }

  const parseTitle = (file: string) => {
    if (!file) return 'Other'
    const words = file.replace('.go', '').split('_')
    const title = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
    return title
  }

  // Handles line break opportunities in the error name
  const parseName = (name: string) => {
    return name.replace(/([A-Z])/g, '<wbr />$1')
  }

  const parseCode = (code: {}, status: number) => {
    return `\`\`\`json {{ filename: 'Status Code: ${status}' }}
${JSON.stringify(code, null, 2)}
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
          const errorJson = {
            shortMessage: error.shortMessage,
            ...(error.longMessage && { longMessage: error.longMessage }),
            code: error.code,
            ...(error.meta && { meta: parseMeta(error.meta) }),
          }

          return `### <code>${parseName(error.name)}</code>
${parseDescription(error.name, error.description)}
${parseCode(errorJson, error.status)}
`
        })
        .join('\n')

      return `## ${parseTitle(file)}

${fileErrors}
`
    })
    .join('')

  return frontmatter + errorDocs.replace(/\n$/, '')
}

export async function generateApiErrorDocs(config: BuildConfig) {
  try {
    // Read the API errors JSON file
    const apiErrorsPath = path.join(config.dataPath, 'api-errors.json')
    const apiErrorsContent = await fs.readFile(apiErrorsPath, 'utf-8')
    const errors: ApiError[] = JSON.parse(apiErrorsContent)

    // Generate the documentation
    const docsBAPI = parseApiErrors(
      errors.filter((error) => error.usage.bapi),
      {
        title: 'Backend API errors',
        description: 'An index of Clerk Backend API errors.',
      },
    )
    const docsFAPI = parseApiErrors(
      errors.filter((error) => error.usage.fapi),
      {
        title: 'Frontend API errors',
        description: 'An index of Clerk Frontend API errors.',
      },
    )

    // Write the output file
    const outputPathBAPI = path.join(config.docsPath, 'errors', 'backend-api.mdx')
    const outputPathFAPI = path.join(config.docsPath, 'errors', 'frontend-api.mdx')

    await fs.writeFile(outputPathBAPI, docsBAPI, 'utf-8')
    await fs.writeFile(outputPathFAPI, docsFAPI, 'utf-8')
  } catch (error) {
    console.error('Error generating documentation:', error)
    throw error
    process.exit(1)
  }
}
