import { VALID_SDKS, type SDK } from '../scripts/lib/schemas'
import { loadEmbeddings, performSearch } from '../scripts/lib/search'

export const config = {
  runtime: 'nodejs',
}

interface SearchRequest {
  query: string
  limit?: number
  sdk?: SDK
  rerank?: boolean
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
    rerankTokens?: number
    rerankCost?: number
    totalTokens: number
    totalCost: number
  }
}

export default async function handler(request: Request): Promise<Response> {
  try {
    // Only allow POST requests
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed. Use POST.' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Parse request body
    let body: SearchRequest
    try {
      body = (await request.json()) as SearchRequest
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON in request body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Validate request
    if (!body.query || typeof body.query !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing or invalid "query" field' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const limit = body.limit && body.limit > 0 ? Math.min(body.limit, 50) : 10
    const userSDK = body.sdk && VALID_SDKS.includes(body.sdk) ? body.sdk : undefined
    const rerank = body.rerank === true // Must explicitly set to true

    // Load embeddings and perform search
    const embeddings = await loadEmbeddings()
    const searchResult = await performSearch(body.query, embeddings, userSDK, limit, rerank)

    // Format results
    const topResults = searchResult.chunks.map((chunk) => ({
      url: chunk.heading_slug ? `${chunk.url}#${chunk.heading_slug}` : chunk.url,
      title: chunk.title,
      content: chunk.content.substring(0, 500) + (chunk.content.length > 500 ? '...' : ''), // Snippet
      score: Math.round(chunk.score * 1000) / 1000, // Round to 3 decimal places
      chunk_index: chunk.chunk_index,
    }))

    const response: SearchResponse = {
      results: topResults,
      cost: {
        tokens: searchResult.tokens,
        cost: Math.round(searchResult.cost * 100000000) / 100000000, // Round to 8 decimal places
        rerankTokens: searchResult.rerankTokens,
        rerankCost: searchResult.rerankCost ? Math.round(searchResult.rerankCost * 100000000) / 100000000 : undefined,
        totalTokens: searchResult.totalTokens,
        totalCost: Math.round(searchResult.totalCost * 100000000) / 100000000,
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
