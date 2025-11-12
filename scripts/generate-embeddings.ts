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
} as const satisfies Record<string, { model: EmbeddingModel; cost: number; batch_cost: number; max_tokens: number }>

import 'dotenv/config'
import { OpenAI } from 'openai'
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
import type { EmbeddingModel } from 'openai/resources/embeddings.mjs'

const EMBEDDING_MODEL_SIZE = cliFlag('large') ? 'large' : 'small'
const ESTIMATE_COST = cliFlag('estimate-cost')
const EMBEDDING_MODEL = EMBEDDING_MODELS[EMBEDDING_MODEL_SIZE]
const EMBEDDING_DIMENSIONS = cliFlag('dimensions', z.coerce.number().positive().optional()) ?? 1_536 // higher dimensions are more accurate but more expensive, and slower
const OPENAI_EMBEDDINGS_API_KEY = env('OPENAI_EMBEDDINGS_API_KEY')
// We want to use the dist folder as the markdown in there has the partials, tooltips, typedocs, etc. embedded in it.
const DOCUMENTATION_FOLDER = cliFlag('docs', z.string().optional()) ?? './dist'
const EMBEDDINGS_OUTPUT_PATH = cliFlag('output', z.string().optional()) ?? './embeddings.json'
const OPENAI_MAX_TOKENS_PER_REQUEST = cliFlag('max-tokens', z.coerce.number().positive().optional()) ?? 150_000 - 10_000 // 10k tokens for safety

type Chunk = {
  canonical: string
  sdk?: string[]
  heading?: string
  content: string
  tokens: number
  cost: number
}

async function main() {
  console.info({
    EMBEDDING_MODEL_SIZE,
    EMBEDDING_MODEL,
    EMBEDDING_DIMENSIONS,
    ESTIMATE_COST,
    DOCUMENTATION_FOLDER,
    EMBEDDINGS_OUTPUT_PATH,
    OPENAI_MAX_TOKENS_PER_REQUEST,
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

          if (frontmatter.title === undefined) return null

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
            frontmatter,
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
  const markdownChunks = markdownFiles.flatMap(({ fullPath, content, frontmatter }) => {
    try {
      let currentChunkContent: string[] | null = null
      let currentHeading: string | undefined = undefined
      const slugify = slugifyWithCounter()

      return content.split('\n').reduce((chunks, line, lineCount, lines) => {
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
            canonical: frontmatter.canonical,
            sdk: frontmatter.sdk,
            heading: currentHeading ? slugify(currentHeading) : undefined,
            content,
            tokens,
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
              tokens,
              cost: calcTokenCost({ tokens }),
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
      throw new Error(`Failed to chunk ${fullPath}`, { cause: error })
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

  const batches = markdownChunks.reduce(
    (batches, chunk) => {
      // Find the next batch that has less than OPENAI_MAX_TOKENS_PER_REQUEST tokens
      const nextBatch = batches.find(
        (batch) => batch.reduce((acc, chunk) => acc + chunk.tokens, 0) < OPENAI_MAX_TOKENS_PER_REQUEST,
      )
      if (nextBatch) {
        nextBatch.push(chunk)
      } else {
        batches.push([chunk])
      }

      return batches
    },
    [[]] as Chunk[][],
  )
  console.info(`✓ Split chunks into ${batches.length} batches`)

  const openai = new OpenAI({ apiKey: OPENAI_EMBEDDINGS_API_KEY })

  const chunksWithEmbeddings = await processQueue(batches, async (batch, index) => {
    const tokens = batch.reduce((acc, chunk) => acc + chunk.tokens, 0)
    console.info(
      `Generating embeddings for batch ${index} of ${batches.length} (${batch.length} chunks, ${tokens} tokens)`,
    )
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL.model,
      input: batch.map((chunk) => chunk.content),
      dimensions: EMBEDDING_DIMENSIONS,
      encoding_format: 'float',
    })
    return batch.map((chunk, index) => {
      const result = response.data.find((data) => data.index === index)

      if (!result) {
        throw new Error(`No embedding found for chunk ${index}`)
      }

      return {
        ...chunk,
        embedding: result.embedding,
      }
    })
  }).then((results) => results.flat())
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

async function processQueue<T, R>(
  items: T[],
  worker: (item: T, index: number) => Promise<R>,
  concurrency = 1,
): Promise<R[]> {
  const results: R[] = []
  let nextIndex = 0
  let active = 0

  return new Promise<R[]>((resolve, reject) => {
    const processNext = () => {
      if (nextIndex >= items.length && active === 0) {
        resolve(results)
        return
      }
      while (active < concurrency && nextIndex < items.length) {
        const i = nextIndex++
        active++
        worker(items[i], i)
          .then((result) => {
            results[i] = result
          })
          .catch(reject)
          .finally(() => {
            active--
            processNext()
          })
      }
    }
    processNext()
  })
}
