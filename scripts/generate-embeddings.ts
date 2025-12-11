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
} as const satisfies Record<
  string,
  { model: OpenAIEmbeddingModelId; cost: number; batch_cost: number; max_tokens: number }
>

import 'dotenv/config'
import { embedMany } from 'ai'
import { createOpenAI, type openai } from '@ai-sdk/openai'
import readdirp from 'readdirp'
import fs from 'fs/promises'
import yaml from 'yaml'
import z from 'zod'
import { encoding_for_model } from 'tiktoken'
import { slugifyWithCounter } from '@sindresorhus/slugify'
import { remark } from 'remark'
import remarkMdx from 'remark-mdx'
import { filter as mdastFilter } from 'unist-util-filter'
import { map as mdastMap } from 'unist-util-map'

const EMBEDDING_MODEL_SIZE = cliFlag('large') ? 'large' : 'small'
const ESTIMATE_COST = cliFlag('estimate-cost')
const EMBEDDING_MODEL = EMBEDDING_MODELS[EMBEDDING_MODEL_SIZE]
const EMBEDDING_DIMENSIONS = cliFlag('dimensions', z.coerce.number().positive().optional()) ?? 1_536 / 3 // higher dimensions are more accurate but more expensive, and slower
const OPENAI_EMBEDDINGS_API_KEY = env('OPENAI_EMBEDDINGS_API_KEY')
// We want to use the dist folder as the markdown in there has the partials, tooltips, typedocs, etc. embedded in it.
const DOCUMENTATION_FOLDER = cliFlag('docs', z.string().optional()) ?? './dist'
const EMBEDDINGS_OUTPUT_PATH = cliFlag('output', z.string().optional()) ?? './dist/embeddings.json'

type Chunk = {
  type: 'page' | 'paragraph'
  availableSdks?: string[]
  activeSdk?: string
  title: string
  canonical: string
  heading?: string
  content: string
  tokens: number
  cost: number
  searchRank?: number
}
type OpenAIEmbeddingModelId = Parameters<typeof openai.textEmbeddingModel>[0]

async function main() {
  console.info({
    EMBEDDING_MODEL_SIZE,
    EMBEDDING_MODEL,
    EMBEDDING_DIMENSIONS,
    ESTIMATE_COST,
    DOCUMENTATION_FOLDER,
    EMBEDDINGS_OUTPUT_PATH,
  })

  // List all the markdown files in the dist folder
  const markdownFiles = (
    await Promise.all(
      (
        await readdirp.promise(DOCUMENTATION_FOLDER, {
          type: 'files',
          fileFilter: '*.mdx',
        })
      ).map(async ({ fullPath }) => {
        try {
          const fileContents = await fs.readFile(fullPath, 'utf8')
          const { frontmatter, content } = extractFrontmatter(fileContents)

          const frontmatterTitle = frontmatter.title

          if (frontmatterTitle === undefined) return null

          const vfile = await remark()
            .use(remarkMdx)
            .use(() => (tree) => {
              // Here we can filter out any nodes that we don't want to include in the search
              return mdastFilter(tree, (node) => {
                if (node.type === 'code') return false // remove code blocks from search
                if (node.type === 'mdxJsxFlowElement') return false // remove mdx elements from search
                if (node.type === 'mdxJsxTextElement') return false // remove mdx elements from search
                if (node.type === 'mdxTextExpression') return false // remove `{ target: '_blank' }` tags
                if (node.type === 'mdxFlowExpression') return false // remove `{/* ... */}` comments
                if (node.type === 'image') return false // remove images from search

                return true
              })
            })
            .use(() => (tree) => {
              return mdastMap(tree, (node) => {
                // Remove the url by replacing the node with its children (the link text)
                if (node.type === 'link' && 'children' in node && Array.isArray(node.children)) {
                  return node.children[0]
                }

                // Remove bold, italic, underline, etc tags
                if (
                  node.type === 'emphasis' ||
                  node.type === 'strong' ||
                  node.type === 'underline' ||
                  node.type === 'strikethrough'
                ) {
                  if ('children' in node && Array.isArray(node.children)) {
                    return node.children[0]
                  }
                }

                // Remove blockquote style
                if (node.type === 'blockquote') {
                  if ('children' in node && Array.isArray(node.children)) {
                    return node.children[0]
                  }
                }

                return node
              })
            })
            .process({
              value: content,
            })

          return {
            fullPath,
            title: frontmatterTitle,
            canonical: frontmatter.canonical,
            availableSdks: frontmatter.availableSdks,
            activeSdk: frontmatter.activeSdk,
            searchRank: frontmatter.search?.rank,
            content: String(vfile),
          }
        } catch (error) {
          throw new Error(`Failed to parse ${fullPath}`, { cause: error })
        }
      }),
    )
  ).filter((file) => file !== null)
  console.info(`✓ Loaded ${markdownFiles.length} markdown files from ${DOCUMENTATION_FOLDER}`)

  // Chunk the markdown
  const markdownChunks = markdownFiles.flatMap((file) => {
    try {
      // Include the title in the first chunk
      let currentChunkContent: string[] | null = [`# ${file.title}`]
      let currentHeading: string | undefined = undefined
      let type: 'page' | 'paragraph' = 'page'
      const slugify = slugifyWithCounter()

      return file.content.split('\n').reduce((chunks, line, lineCount, lines) => {
        const trimmedLine = line.trim()

        // Detect if the current line is a h2 or h3 heading
        const heading = isH2(trimmedLine) ?? isH3(trimmedLine)

        if (currentChunkContent !== null && heading) {
          // We have reached a new heading, so we need to add the current chunk to the chunks array
          const content = currentChunkContent.join('\n')
          const tokens = calcTokens(content)

          if (tokens > EMBEDDING_MODEL.max_tokens) {
            throw new Error(`Chunk content is too large, max tokens: ${EMBEDDING_MODEL.max_tokens}, tokens: ${tokens}`)
          }

          chunks.push({
            title: file.title,
            canonical: file.canonical,
            availableSdks: file.availableSdks,
            activeSdk: file.activeSdk,
            heading: currentHeading ? slugify(currentHeading) : undefined,
            content,
            tokens,
            cost: calcTokenCost({ tokens }),
            type,
            searchRank: file.searchRank,
          })
          // Reset the current chunk content
          currentChunkContent = null

          // Now switch to paragraphs for the rest of the file
          type = 'paragraph'
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
              title: file.title,
              canonical: file.canonical,
              availableSdks: file.availableSdks,
              activeSdk: file.activeSdk,
              heading: currentHeading ? slugify(currentHeading) : undefined,
              content,
              tokens,
              cost: calcTokenCost({ tokens }),
              type,
              searchRank: file.searchRank,
            })
          }
        }

        if (currentChunkContent === null) {
          // We are starting a new chunk, so just add in the first line
          currentChunkContent = [trimmedLine]
        }

        return chunks
      }, [] as Chunk[])
    } catch (error) {
      throw new Error(`Failed to chunk ${file.fullPath}`, { cause: error })
    }
  })
  console.info(`✓ Converted ${markdownFiles.length} markdown files into ${markdownChunks.length} chunks`)

  const totalCost = markdownChunks.reduce((acc, chunk) => acc + chunk.cost, 0)
  const totalChunks = markdownChunks.reduce((acc, chunk) => acc + chunk.tokens, 0)
  const largestChunk = markdownChunks.reduce((acc, chunk) => Math.max(acc, chunk.tokens), 0)
  const smallestChunk = markdownChunks.reduce((acc, chunk) => Math.min(acc, chunk.tokens), 10_000)

  console.info(`Total chunk Tokens: ${totalChunks}`)
  console.info(`Largest chunk Tokens: ${largestChunk}`)
  console.info(`Smallest chunk Tokens: ${smallestChunk}`)
  console.info(`Estimated cost: $${totalCost.toFixed(6)}`)

  if (ESTIMATE_COST) {
    process.exit(0)
  }

  const openai = createOpenAI({ apiKey: OPENAI_EMBEDDINGS_API_KEY })

  const { embeddings } = await embedMany({
    model: openai.textEmbeddingModel(EMBEDDING_MODEL.model),
    values: markdownChunks.map((chunk) => chunk.content),
    providerOptions: {
      openai: {
        dimensions: EMBEDDING_DIMENSIONS,
      },
    },
  })

  const chunksWithEmbeddings = markdownChunks.map(({ cost, tokens, ...chunk }, index) => {
    const embedding = embeddings[index]

    if (!embedding) {
      throw new Error(`No embedding found for chunk ${index}`)
    }

    return {
      ...chunk,
      id: index,
      embedding: embedding,
    }
  })

  console.info(`✓ Generated embeddings for ${chunksWithEmbeddings.length} chunks`)

  await fs.writeFile(EMBEDDINGS_OUTPUT_PATH, JSON.stringify(chunksWithEmbeddings))
  console.info(`✓ Wrote embeddings to ${EMBEDDINGS_OUTPUT_PATH}`)
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
function cliFlag<T extends z.ZodTypeAny>(name: string, schema: T): z.infer<T> | undefined
function cliFlag<T extends z.ZodTypeAny>(name: string, schema?: T): boolean | z.infer<T> | undefined {
  if (schema) {
    const arg = process.argv.find((f) => f.startsWith(`--${name}=`))
    if (!arg) return undefined
    const value = arg.split('=')[1]
    try {
      return schema.parse(value)
    } catch (err) {
      throw new Error(`Invalid value for flag --${name}: ${value}. Error: ${err}`)
    }
  } else {
    return process.argv.includes(`--${name}`)
  }
}

const frontmatterRegex = /---[\s\S]*?---/
const frontmatterSchema = z.object({
  canonical: z.string(),
  title: z.string().optional(),
  availableSdks: z
    .string()
    .optional()
    .transform((value) => value?.split(',')),
  activeSdk: z.string().optional(),
  search: z
    .object({
      rank: z.number().optional(),
    })
    .optional(),
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
