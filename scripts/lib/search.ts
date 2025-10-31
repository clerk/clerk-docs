import fs from 'node:fs/promises'
import path from 'node:path'
import OpenAI from 'openai'
import { cosineSimilarity, estimateTokens } from './embeddings'
import { VALID_SDKS, type SDK } from './schemas'

// Constants
export const PRICE_PER_1K_TOKENS_EMBEDDING = 0.00002 // $0.00002 per 1K tokens for text-embedding-3-small
export const PRICE_PER_1K_TOKENS_GPT_4O_MINI = 0.00015 // $0.00015 per 1K input tokens
export const PRICE_PER_1K_TOKENS_GPT_4O_MINI_OUTPUT = 0.0006 // $0.0006 per 1K output tokens

// Types
export interface EmbeddingChunk {
  id: string
  content: string
  embedding: number[]
  url: string
  title: string
  chunk_index: number
  file_path: string
  sdk?: SDK
  base_url?: string
}

interface EmbeddingsFile {
  chunks: EmbeddingChunk[]
}

export interface ScoredChunk extends EmbeddingChunk {
  score: number
}

export interface SearchResult {
  chunks: ScoredChunk[]
  tokens: number
  cost: number
}

// Cache for API endpoints (serverless functions)
let cachedEmbeddings: EmbeddingChunk[] | null = null
let cachedEmbeddingsPath: string | null = null

/**
 * Load embeddings from file. Supports both API (Vercel) and CLI contexts.
 */
export async function loadEmbeddings(distPath?: string): Promise<EmbeddingChunk[]> {
  let embeddingsPath: string

  if (distPath) {
    // CLI context - use provided path
    embeddingsPath = path.join(distPath, 'embeddings.json')
  } else {
    // API context - use process.cwd() (Vercel)
    embeddingsPath = path.join(process.cwd(), 'dist', 'embeddings.json')
    // Return cached if path hasn't changed (for serverless functions)
    if (cachedEmbeddings && cachedEmbeddingsPath === embeddingsPath) {
      return cachedEmbeddings
    }
  }

  try {
    const content = await fs.readFile(embeddingsPath, 'utf-8')
    const embeddingsFile: EmbeddingsFile = JSON.parse(content)
    const chunks = embeddingsFile.chunks

    // Cache for API context
    if (!distPath) {
      cachedEmbeddings = chunks
      cachedEmbeddingsPath = embeddingsPath
    }

    return chunks
  } catch (error) {
    throw new Error(`Failed to load embeddings: ${error}`)
  }
}

/**
 * Generate embedding vector for a query string using OpenAI.
 */
export async function generateQueryEmbedding(query: string): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is not set')
  }

  const openai = new OpenAI({ apiKey })

  try {
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: query,
    })

    return response.data[0].embedding
  } catch (error) {
    throw new Error(`Failed to generate query embedding: ${error}`)
  }
}

/**
 * Filter chunks by SDK, prioritizing SDK-specific variants.
 */
export function filterChunksBySDK(
  scoredChunks: ScoredChunk[],
  userSDK?: SDK,
): ScoredChunk[] {
  if (!userSDK) {
    return scoredChunks
  }

  // Group by base_url (or url if no base_url)
  const groupedByBaseUrl = new Map<string, ScoredChunk[]>()
  for (const chunk of scoredChunks) {
    const key = chunk.base_url || chunk.url
    if (!groupedByBaseUrl.has(key)) {
      groupedByBaseUrl.set(key, [])
    }
    groupedByBaseUrl.get(key)!.push(chunk)
  }

  // For each group, pick the best match for user's SDK
  const filteredChunks: ScoredChunk[] = []
  for (const group of groupedByBaseUrl.values()) {
    // Find chunk matching user's SDK
    const sdkMatch = group.find((chunk) => chunk.sdk === userSDK)
    if (sdkMatch) {
      // User's SDK has a variant - use it
      filteredChunks.push(sdkMatch)
    } else {
      // User's SDK doesn't have a variant - use highest scoring variant
      const bestMatch = group.sort((a, b) => b.score - a.score)[0]
      filteredChunks.push(bestMatch)
    }
  }

  return filteredChunks
}

/**
 * Perform semantic search on embeddings.
 */
export async function performSearch(
  query: string,
  embeddings: EmbeddingChunk[],
  userSDK?: SDK,
  limit: number = 8,
): Promise<SearchResult> {
  const queryTokens = estimateTokens(query)
  const queryEmbedding = await generateQueryEmbedding(query)
  const searchCost = (queryTokens / 1000) * PRICE_PER_1K_TOKENS_EMBEDDING

  // Calculate similarity scores
  const scoredChunks: ScoredChunk[] = embeddings.map((chunk) => ({
    ...chunk,
    score: cosineSimilarity(queryEmbedding, chunk.embedding),
  }))

  // Filter by SDK if specified
  let filteredChunks = filterChunksBySDK(scoredChunks, userSDK)

  // Get top N chunks
  const topChunks = filteredChunks.sort((a, b) => b.score - a.score).slice(0, limit)

  return {
    chunks: topChunks,
    tokens: queryTokens,
    cost: searchCost,
  }
}

/**
 * Format chunks as context string for GPT prompts.
 */
export function formatContextChunks(chunks: ScoredChunk[]): string {
  let context = ''
  for (const chunk of chunks) {
    context += `---\n`
    context += `Title: ${chunk.title}\n`
    context += `URL: ${chunk.url}\n`
    context += `Content:\n${chunk.content}\n\n`
  }
  return context
}

/**
 * Get pricing for a GPT model.
 */
export function getModelPricing(model: string): { input: number; output: number } {
  // Default to GPT-4o-mini pricing
  if (model.includes('gpt-4o-mini') || model.includes('gpt-4o')) {
    return {
      input: PRICE_PER_1K_TOKENS_GPT_4O_MINI,
      output: PRICE_PER_1K_TOKENS_GPT_4O_MINI_OUTPUT,
    }
  }
  // GPT-3.5-turbo pricing
  if (model.includes('gpt-3.5')) {
    return {
      input: 0.0005 / 1000, // $0.0005 per 1K tokens
      output: 0.0015 / 1000, // $0.0015 per 1K tokens
    }
  }
  // Default to GPT-4o-mini
  return {
    input: PRICE_PER_1K_TOKENS_GPT_4O_MINI,
    output: PRICE_PER_1K_TOKENS_GPT_4O_MINI_OUTPUT,
  }
}

