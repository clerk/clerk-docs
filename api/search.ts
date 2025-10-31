import fs from 'node:fs/promises'
import path from 'node:path'
import OpenAI from 'openai'
import { cosineSimilarity, estimateTokens } from '../scripts/lib/embeddings'
import { VALID_SDKS, type SDK } from '../scripts/lib/schemas'

const PRICE_PER_1K_TOKENS = 0.00002 // $0.00002 per 1K tokens for text-embedding-3-small

export const config = {
  runtime: 'nodejs',
}

interface SearchRequest {
  query: string
  limit?: number
  sdk?: SDK
}

interface EmbeddingChunk {
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

interface SearchResult {
  url: string
  title: string
  content: string
  score: number
  chunk_index: number
}

interface SearchResponse {
  results: SearchResult[]
  cost?: {
    tokens: number
    cost: number
  }
}

// Cache embeddings in memory (global scope for serverless function)
let cachedEmbeddings: EmbeddingChunk[] | null = null
let cachedEmbeddingsPath: string | null = null

async function loadEmbeddings(): Promise<EmbeddingChunk[]> {
  // For Vercel, dist folder will be in the project root
  const embeddingsPath = path.join(process.cwd(), 'dist', 'embeddings.json')

  // Return cached if path hasn't changed
  if (cachedEmbeddings && cachedEmbeddingsPath === embeddingsPath) {
    return cachedEmbeddings
  }

  try {
    const content = await fs.readFile(embeddingsPath, 'utf-8')
    const embeddingsFile: EmbeddingsFile = JSON.parse(content)
    cachedEmbeddings = embeddingsFile.chunks
    cachedEmbeddingsPath = embeddingsPath
    return cachedEmbeddings
  } catch (error) {
    throw new Error(`Failed to load embeddings: ${error}`)
  }
}

async function generateQueryEmbedding(query: string): Promise<number[]> {
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

export default async function handler(request: Request): Promise<Response> {
  try {
    // Only allow POST requests
    if (request.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed. Use POST.' }),
        {
          status: 405,
          headers: { 'Content-Type': 'application/json' },
        },
      )
    }

    // Parse request body
    let body: SearchRequest
    try {
      body = (await request.json()) as SearchRequest
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid JSON in request body' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        },
      )
    }

    // Validate request
    if (!body.query || typeof body.query !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Missing or invalid "query" field' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        },
      )
    }

    const limit = body.limit && body.limit > 0 ? Math.min(body.limit, 50) : 10
    const userSDK = body.sdk && VALID_SDKS.includes(body.sdk) ? body.sdk : undefined

    // Load embeddings
    const embeddings = await loadEmbeddings()

    // Generate query embedding
    const queryTokens = estimateTokens(body.query)
    const queryEmbedding = await generateQueryEmbedding(body.query)
    const queryCost = (queryTokens / 1000) * PRICE_PER_1K_TOKENS

    // Calculate similarity scores
    const scoredChunks = embeddings.map((chunk) => ({
      ...chunk,
      score: cosineSimilarity(queryEmbedding, chunk.embedding),
    }))

    // Filter by SDK if specified
    let filteredChunks = scoredChunks
    if (userSDK) {
      // Group by base_url (or url if no base_url)
      const groupedByBaseUrl = new Map<string, typeof scoredChunks>()
      for (const chunk of scoredChunks) {
        const key = chunk.base_url || chunk.url
        if (!groupedByBaseUrl.has(key)) {
          groupedByBaseUrl.set(key, [])
        }
        groupedByBaseUrl.get(key)!.push(chunk)
      }

      // For each group, pick the best match for user's SDK
      filteredChunks = []
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
    }

    // Sort by score (descending) and take top N
    const topResults = filteredChunks
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((chunk) => ({
        url: chunk.url,
        title: chunk.title,
        content: chunk.content.substring(0, 500) + (chunk.content.length > 500 ? '...' : ''), // Snippet
        score: Math.round(chunk.score * 1000) / 1000, // Round to 3 decimal places
        chunk_index: chunk.chunk_index,
      }))

    const response: SearchResponse = {
      results: topResults,
      cost: {
        tokens: queryTokens,
        cost: Math.round(queryCost * 100000000) / 100000000, // Round to 8 decimal places
      },
    }

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Search API error:', error)
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  }
}

