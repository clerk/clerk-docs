const EMBEDDING_MODELS = {
  small: {
    model: 'text-embedding-3-small',
    cost: 0.02 / 1_000_000,
    batch_cost: 0.01 / 1_000_000,
    max_tokens: 8_192,
  },
  large: {
    model: 'text-embedding-3-large',
    cost: 0.13 / 1_000_000,
    batch_cost: 0.065 / 1_000_000,
    max_tokens: 8_192,
  },
} as const

import 'dotenv/config'
import { OpenAI } from 'openai'
import readdirp from 'readdirp'
import fs from 'fs/promises'
import yaml from 'yaml'
import z from 'zod'
import { encoding_for_model } from 'tiktoken'
import { slugifyWithCounter } from '@sindresorhus/slugify'

const EMBEDDING_MODEL_SIZE = cliFlag('large') ? 'large' : 'small'
const ESTIMATE_COST = cliFlag('estimate-cost')
const EMBEDDING_MODEL = EMBEDDING_MODELS[EMBEDDING_MODEL_SIZE]
const OPENAI_EMBEDDINGS_API_KEY = env('OPENAI_EMBEDDINGS_API_KEY')
// We want to use the dist folder as the markdown in there has the partials, tooltips, typedocs, etc. embedded in it.
const DOCUMENTATION_FOLDER = cliFlag('docs', true) ?? './dist'
const EMBEDDINGS_OUTPUT_PATH = cliFlag('output', true) ?? './dist/embeddings.json'

async function main() {
  console.log({
    EMBEDDING_MODEL_SIZE,
    EMBEDDING_MODEL,
    ESTIMATE_COST,
    DOCUMENTATION_FOLDER,
    EMBEDDINGS_OUTPUT_PATH,
  })

  const openai = new OpenAI({ apiKey: OPENAI_EMBEDDINGS_API_KEY })

  // List all the markdown files in the dist folder
  const markdownFiles = await Promise.all(
    (
      await readdirp.promise(DOCUMENTATION_FOLDER, {
        type: 'files',
        fileFilter: '*.mdx',
      })
    ).map(async ({ fullPath }) => {
      try {
        const fileContents = await fs.readFile(fullPath, 'utf8')
        const { frontmatter, content } = extractFrontmatter(fileContents)
        return {
          fullPath,
          frontmatter,
          content,
        }
      } catch (error) {
        throw new Error(`Failed to parse ${fullPath}`, { cause: error })
      }
    }),
  )
  console.info(`✓ Loaded ${markdownFiles.length} markdown files from ${DOCUMENTATION_FOLDER}`)

  // Chunk the markdown
  const markdownChunks = markdownFiles.flatMap(({ fullPath, content, frontmatter }) => {
    try {
      let currentChunkContent: string[] | null = null
      let currentHeading: string | undefined = undefined
      const slugify = slugifyWithCounter()

      return content.split('\n').reduce(
        (chunks, line, lineCount, lines) => {
          const trimmedLine = line.trim()

          // Detect if the current line is a h2 or h3 heading
          const heading = isH2(trimmedLine) ?? isH3(trimmedLine)

          if (currentChunkContent !== null && heading) {
            // We have reached a new heading, so we need to add the current chunk to the chunks array
            const content = currentChunkContent.join('\n')
            const tokens = calcTokens(content)

            if (tokens > EMBEDDING_MODEL.max_tokens) {
              throw new Error(
                `Chunk content is too large, max tokens: ${EMBEDDING_MODEL.max_tokens}, tokens: ${tokens}`,
              )
            }

            chunks.push({
              canonical: frontmatter.canonical,
              sdk: frontmatter.sdk,
              heading: currentHeading ? slugify(currentHeading) : undefined,
              content,
              cost: calcTokenCost({ tokens }),
            })
            // Reset the current chunk content
            currentChunkContent = null
          }

          if (heading) {
            currentHeading = heading
          }

          if (currentChunkContent !== null && !heading) {
            // Add the current line to the current chunk content
            currentChunkContent.push(trimmedLine)

            if (lineCount === lines.length - 1) {
              // We have reached the end of the file, so we need to add the current chunk to the chunks array
              const content = currentChunkContent.join('\n')
              const tokens = calcTokens(content)

              if (tokens > EMBEDDING_MODEL.max_tokens) {
                throw new Error(
                  `Chunk content is too large, max tokens: ${EMBEDDING_MODEL.max_tokens}, tokens: ${tokens}`,
                )
              }

              chunks.push({
                canonical: frontmatter.canonical,
                sdk: frontmatter.sdk,
                heading: currentHeading ? slugify(currentHeading) : undefined,
                content,
                cost: calcTokenCost({ tokens }),
              })
            }
          }

          if (currentChunkContent === null) {
            // We are starting a new chunk, so just add in the first line
            currentChunkContent = [trimmedLine]
          }

          return chunks
        },
        [] as {
          canonical: string
          sdk?: string[]
          heading?: string
          content: string
          cost: number
        }[],
      )
    } catch (error) {
      throw new Error(`Failed to chunk ${fullPath}`, { cause: error })
    }
  })
  console.info(`✓ Converted ${markdownChunks.length} markdown files into ${markdownChunks.length} chunks`)

  const totalCost = markdownChunks.reduce((acc, chunk) => acc + chunk.cost, 0)
  console.log(`Estimated cost: $${totalCost.toFixed(6)}`)

  if (ESTIMATE_COST) {
    process.exit(0)
  }

  //   console.log(markdownChunks)
}

// Only invokes the main function if we run the script directly eg npm run build, bun run ./scripts/build-docs.ts
if (require.main === module) {
  main()
}

function env(name: string): string
function env(name: string, required: true): string
function env(name: string, required: false): string | undefined
function env(name: string, required: boolean = true): string | undefined {
  const value = process.env[name]
  if (required && !value) {
    throw new Error(`Environment variable ${name} is required`)
  }
  return value
}

function cliFlag(name: string): boolean
function cliFlag(name: string, requiresValue: true): string | undefined
function cliFlag(name: string, requiresValue: false): boolean
function cliFlag(name: string, requiresValue: boolean = false): boolean | string | undefined {
  if (requiresValue) {
    const value = process.argv.find((f) => f.startsWith(`--${name}=`))
    if (!value) return undefined
    return value.split('=')[1]
  } else {
    return process.argv.includes(`--${name}`)
  }
}

const frontmatterRegex = /---[\s\S]*?---/
const frontmatterSchema = z.object({
  canonical: z.string(),
  title: z.string().optional(),
  sdk: z
    .string()
    .optional()
    .transform((value) => value?.split(', ')),
})

function extractFrontmatter(content: string) {
  const frontmatterMatch = content.match(frontmatterRegex)
  const frontmatter = frontmatterMatch?.[0]
    ?.replace(/^---\s*\n?/, '')
    .replace(/\n?---\s*$/, '')
    .trim()

  if (!frontmatter) {
    throw new Error('No frontmatter found')
  }

  const parsedFrontmatter = yaml.parse(frontmatter)
  const parsed = frontmatterSchema.parse(parsedFrontmatter)

  // Remove the frontmatter from the content to return the rest
  const contentWithoutFrontmatter = frontmatterMatch ? content.replace(frontmatterMatch[0], '').trimStart() : content

  return {
    frontmatter: parsed,
    content: contentWithoutFrontmatter,
  }
}

// Helper function to calculate the number of tokens in a string
const encoder = encoding_for_model(EMBEDDING_MODEL.model)
function calcTokens(text: string) {
  return encoder.encode(text).length
}
function calcTokenCost(source: { tokens: number } | { text: string }) {
  if ('text' in source) {
    return calcTokens(source.text) * EMBEDDING_MODEL.cost
  } else {
    return source.tokens * EMBEDDING_MODEL.cost
  }
}

const H2Regex = /^##\s+(.+)$/
const isH2 = (line: string) => line.match(H2Regex)?.[1]

const H3Regex = /^###\s+(.+)$/
const isH3 = (line: string) => line.match(H3Regex)?.[1]
