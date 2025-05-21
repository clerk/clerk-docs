import fs from 'fs'
import path from 'path'

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

**Status Code:** \`${error.status}\`
${parseDescription(error.name, error.description)}
\`\`\`json
${JSON.stringify(errorJson, null, 2)}
\`\`\`
`
        })
        .join('\n')

      return `## ${parseTitle(file)}

${fileErrors}
`
    })
    .join('')

  return frontmatter + errorDocs
}

export async function generateApiErrorDocs() {
  try {
    // Read the API errors JSON file
    const apiErrorsPath = path.join(process.cwd(), 'data', 'api-errors.json')
    const apiErrorsContent = await fs.promises.readFile(apiErrorsPath, 'utf-8')
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
    const outputPathBAPI = path.join(process.cwd(), 'docs', 'errors', 'backend-api.mdx')
    const outputPathFAPI = path.join(process.cwd(), 'docs', 'errors', 'frontend-api.mdx')

    await fs.promises.writeFile(outputPathBAPI, docsBAPI, 'utf-8')
    await fs.promises.writeFile(outputPathFAPI, docsFAPI, 'utf-8')
  } catch (error) {
    console.error('Error generating documentation:', error)
    process.exit(1)
  }
}
