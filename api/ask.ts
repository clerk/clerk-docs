import fs from 'node:fs/promises'
import path from 'node:path'
import OpenAI from 'openai'
import { cosineSimilarity, estimateTokens } from '../scripts/lib/embeddings'
import { VALID_SDKS, type SDK } from '../scripts/lib/schemas'

const PRICE_PER_1K_TOKENS_EMBEDDING = 0.00002 // $0.00002 per 1K tokens for text-embedding-3-small
const PRICE_PER_1K_TOKENS_GPT_4O_MINI = 0.00015 // $0.00015 per 1K input tokens
const PRICE_PER_1K_TOKENS_GPT_4O_MINI_OUTPUT = 0.0006 // $0.0006 per 1K output tokens

export const config = {
  runtime: 'nodejs',
}

interface AskRequest {
  query: string
  sdk?: SDK
  limit?: number
  model?: string
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

interface AskResponse {
  answer: string
  sources: Array<{
    url: string
    title: string
    chunk_index: number
  }>
  cost: {
    search_tokens: number
    search_cost: number
    completion_tokens: number
    completion_cost: number
    total_cost: number
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

function formatContextChunks(chunks: Array<EmbeddingChunk & { score: number }>): string {
  let context = ''
  for (const chunk of chunks) {
    context += `---\n`
    context += `Title: ${chunk.title}\n`
    context += `URL: ${chunk.url}\n`
    context += `Content:\n${chunk.content}\n\n`
  }
  return context
}

function getModelPricing(model: string): { input: number; output: number } {
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
    let body: AskRequest
    try {
      body = (await request.json()) as AskRequest
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

    const limit = body.limit && body.limit > 0 ? Math.min(body.limit, 20) : 8
    const userSDK = body.sdk && VALID_SDKS.includes(body.sdk) ? body.sdk : undefined
    const model = body.model || 'gpt-4o-mini'

    // Load embeddings
    const embeddings = await loadEmbeddings()

    // Generate query embedding
    const queryTokens = estimateTokens(body.query)
    const queryEmbedding = await generateQueryEmbedding(body.query)
    const searchCost = (queryTokens / 1000) * PRICE_PER_1K_TOKENS_EMBEDDING

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

    // Get top N chunks
    const topChunks = filteredChunks
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)

    // Format context for GPT
    const context = formatContextChunks(topChunks)
    const contextTokens = estimateTokens(context)
    const totalInputTokens = queryTokens + contextTokens

    // Build system prompt
    const systemPrompt = `You are a helpful assistant that answers questions about Clerk authentication and user management using the provided documentation.

When answering questions:
- Use the provided documentation context to give accurate answers
- Include code examples when relevant
- If the user specifies an SDK (${userSDK ? userSDK : 'any SDK'}), prioritize information relevant to that SDK
- Cite sources by mentioning the documentation title or URL when referencing specific information
- If the context doesn't contain enough information to answer the question, say so clearly
- Be concise but thorough`

    // Build user prompt
    const userPrompt = `Question: ${body.query}

${userSDK ? `Note: The user is working with the ${userSDK} SDK.` : ''}

Documentation Context:
${context}`

    // Call GPT
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is not set')
    }

    const openai = new OpenAI({ apiKey })
    const completion = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 1000,
      temperature: 0.7,
    })

    const answer = completion.choices[0]?.message?.content || 'I apologize, but I could not generate an answer.'
    const promptTokens = completion.usage?.prompt_tokens || totalInputTokens
    const outputTokens = completion.usage?.completion_tokens || 0

    // Calculate costs
    const pricing = getModelPricing(model)
    const completionCost = (promptTokens / 1000) * pricing.input + (outputTokens / 1000) * pricing.output
    const totalCost = searchCost + completionCost

    // Format sources
    const sources = topChunks.map((chunk) => ({
      url: chunk.url,
      title: chunk.title,
      chunk_index: chunk.chunk_index,
    }))

    const response: AskResponse = {
      answer,
      sources,
      cost: {
        search_tokens: queryTokens,
        search_cost: Math.round(searchCost * 100000000) / 100000000,
        completion_tokens: promptTokens + outputTokens,
        completion_cost: Math.round(completionCost * 100000000) / 100000000,
        total_cost: Math.round(totalCost * 100000000) / 100000000,
      },
    }

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Ask API error:', error)
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

