import fs from 'node:fs/promises'
import path from 'node:path'
import OpenAI from 'openai'
import { estimateTokens } from './embeddings'
import { cosineSimilarity } from 'ai'
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
  heading_slug?: string
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
  rerankTokens?: number // NEW: tokens used for reranking
  rerankCost?: number // NEW: cost of reranking
  totalTokens: number // NEW: embedding + rerank tokens
  totalCost: number // NEW: embedding + rerank cost
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
export function filterChunksBySDK(scoredChunks: ScoredChunk[], userSDK?: SDK): ScoredChunk[] {
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
 * Rerank chunks using OpenAI to improve relevance, with detailed debug logs.
 */
async function rerankWithOpenAI(
  query: string,
  chunks: ScoredChunk[],
  topK: number,
): Promise<{ rerankedChunks: ScoredChunk[]; tokens: number; cost: number }> {
  console.debug(`[rerankWithOpenAI] Entering rerankWithOpenAI: query="${query}", chunks=${chunks.length}, topK=${topK}`)

  // Skip reranking if we have 0 or 1 chunks (no point)
  if (chunks.length <= 1) {
    console.debug(`[rerankWithOpenAI] Skipping reranking: chunks.length <= 1 (length=${chunks.length})`)
    return {
      rerankedChunks: chunks.slice(0, topK),
      tokens: 0,
      cost: 0,
    }
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    console.error(`[rerankWithOpenAI] OPENAI_API_KEY environment variable is not set`)
    throw new Error('OPENAI_API_KEY environment variable is not set')
  }

  const openai = new OpenAI({ apiKey })

  // Build prompt with query and all chunks
  const chunksText = chunks
    .map((chunk, index) => {
      return `[${index}] ${chunk.title}\n${chunk.content.substring(0, 1000)}`
    })
    .join('\n\n---\n\n')

  const prompt = `Given a search query and multiple documents, rate each document's relevance to the query.
Return a JSON object with a "scores" array containing exactly ${chunks.length} relevance scores (0.0 = not relevant, 1.0 = highly relevant), one score per document in order.

Query: ${query}

Documents:
${chunksText}

Respond with JSON: {"scores": [0.9, 0.7, 0.3, ...]}`

  try {
    console.debug(
      `[rerankWithOpenAI] Sending rerank prompt to OpenAI (model: gpt-4o-mini, prompt size: ${prompt.length} chars, chunks: ${chunks.length})`,
    )
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0,
      response_format: { type: 'json_object' },
    })

    const content = response.choices[0]?.message?.content
    console.debug(`[rerankWithOpenAI] Received response from OpenAI. Content present: ${!!content}`)

    if (!content) {
      console.error(`[rerankWithOpenAI] No response content from OpenAI`)
      throw new Error('No response from OpenAI')
    }

    // Parse response - OpenAI might return {"scores": [0.9, 0.7, ...]} or just [0.9, 0.7, ...]
    let scores: number[]
    try {
      const parsed = JSON.parse(content)
      if (Array.isArray(parsed)) {
        scores = parsed
        console.debug(`[rerankWithOpenAI] Parsed scores as array: [${scores.join(', ')}]`)
      } else if (parsed.scores && Array.isArray(parsed.scores)) {
        scores = parsed.scores
        console.debug(`[rerankWithOpenAI] Parsed scores from "scores" property: [${scores.join(', ')}]`)
      } else {
        console.error(`[rerankWithOpenAI] Invalid JSON format from OpenAI: ${content}`)
        throw new Error('Invalid response format')
      }
    } catch (err) {
      // Try parsing as direct array
      console.warn(
        `[rerankWithOpenAI] Failed JSON.parse. Attempting array extraction. Error: ${err instanceof Error ? err.message : err}`,
      )
      const arrayMatch = content.match(/\[[\d.,\s]+\]/)
      if (arrayMatch) {
        scores = JSON.parse(arrayMatch[0])
        console.debug(`[rerankWithOpenAI] Extracted scores from array in string: [${scores.join(', ')}]`)
      } else {
        console.error(`[rerankWithOpenAI] Could not parse scores from response: ${content}`)
        throw new Error('Could not parse scores from response')
      }
    }

    if (scores.length !== chunks.length) {
      console.error(`[rerankWithOpenAI] Scores length mismatch: expected ${chunks.length}, got ${scores.length}`)
      throw new Error(`Expected ${chunks.length} scores, got ${scores.length}`)
    }

    // Create reranked chunks with new scores
    const rerankedChunks: ScoredChunk[] = chunks.map((chunk, index) => ({
      ...chunk,
      score: scores[index] || 0,
    }))
    console.debug(
      `[rerankWithOpenAI] Reranked chunks, top scores: ${rerankedChunks
        .slice(0, 3)
        .map((c) => c.score)
        .join(', ')} ...`,
    )

    // Sort by new scores and take top K
    const topReranked = rerankedChunks.sort((a, b) => b.score - a.score).slice(0, topK)
    console.debug(`[rerankWithOpenAI] Sorted and sliced to topK (${topK}) rerankedChunks`)

    // Calculate costs
    const inputTokens = response.usage?.prompt_tokens || 0
    const outputTokens = response.usage?.completion_tokens || 0
    const pricing = getModelPricing('gpt-4o-mini')
    const rerankCost = (inputTokens / 1000) * pricing.input + (outputTokens / 1000) * pricing.output

    console.debug(
      `[rerankWithOpenAI] OpenAI token usage: input=${inputTokens}, output=${outputTokens}, total=${inputTokens + outputTokens}, cost=$${rerankCost}`,
    )

    return {
      rerankedChunks: topReranked,
      tokens: inputTokens + outputTokens,
      cost: rerankCost,
    }
  } catch (error) {
    console.error(
      `[rerankWithOpenAI] Failed to rerank chunks: ${error instanceof Error ? error.message : String(error)}`,
    )
    throw new Error(`Failed to rerank chunks: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Perform semantic search on embeddings with optional reranking.
 * Adds debug logs at each important step.
 */
export async function performSearch(
  query: string,
  embeddings: EmbeddingChunk[],
  userSDK?: SDK,
  limit: number = 8,
  rerank: boolean = false,
): Promise<SearchResult> {
  console.debug(`[performSearch] query="${query}", limit=${limit}, userSDK=${userSDK}, rerank=${rerank}`)
  const queryTokens = estimateTokens(query)
  console.debug(`[performSearch] Estimated query tokens: ${queryTokens}`)
  const queryEmbedding = await generateQueryEmbedding(query)
  console.debug(`[performSearch] Query embedding generated (length=${queryEmbedding.length})`)
  const searchCost = (queryTokens / 1000) * PRICE_PER_1K_TOKENS_EMBEDDING
  console.debug(`[performSearch] Search cost (embedding): $${searchCost}`)

  // Calculate similarity scores
  console.debug(`[performSearch] Calculating cosine similarity for ${embeddings.length} chunks`)
  const scoredChunks: ScoredChunk[] = embeddings.map((chunk, idx) => {
    const score = cosineSimilarity(queryEmbedding, chunk.embedding)
    // Uncomment to trace individual scores, but can be very verbose:
    // console.debug(`[performSearch] Chunk ${idx}: score=${score} (${chunk.url})`)
    return {
      ...chunk,
      score,
    }
  })

  // Filter by SDK if specified
  let filteredChunks = filterChunksBySDK(scoredChunks, userSDK)
  console.debug(`[performSearch] ${filteredChunks.length} chunks after SDK filter (${userSDK || 'none'})`)

  let finalChunks: ScoredChunk[]
  let rerankTokens = 0
  let rerankCost = 0

  if (rerank) {
    // Stage 1: Get candidate chunks (more than requested for reranking)
    const candidateLimit = Math.min(limit + 50, 200)
    console.debug(`[performSearch] Selecting up to ${candidateLimit} candidate chunks for reranking`)
    const candidateChunks = filteredChunks.sort((a, b) => b.score - a.score).slice(0, candidateLimit)

    // Stage 2: Rerank candidates using OpenAI
    console.debug(`[performSearch] Sending ${candidateChunks.length} candidate chunks to rerankWithOpenAI`)
    const rerankResult = await rerankWithOpenAI(query, candidateChunks, limit)
    finalChunks = rerankResult.rerankedChunks
    rerankTokens = rerankResult.tokens
    rerankCost = rerankResult.cost

    console.debug(
      `[performSearch] Rerank complete: rerankTokens=${rerankTokens}, rerankCost=$${rerankCost}, returning ${finalChunks.length} chunks`,
    )
  } else {
    // No reranking - just sort by similarity score and take top results
    console.debug(`[performSearch] Reranking disabled, using cosine similarity scores`)
    finalChunks = filteredChunks.sort((a, b) => b.score - a.score).slice(0, limit)
  }

  // Calculate totals
  const totalTokens = queryTokens + rerankTokens
  const totalCost = searchCost + rerankCost
  console.debug(`[performSearch] Total tokens=${totalTokens}, Total cost=$${totalCost}`)

  return {
    chunks: finalChunks,
    tokens: queryTokens,
    cost: searchCost,
    rerankTokens: rerank ? rerankTokens : undefined,
    rerankCost: rerank ? rerankCost : undefined,
    totalTokens,
    totalCost,
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
