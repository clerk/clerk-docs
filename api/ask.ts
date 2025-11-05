import OpenAI from 'openai'
import { VALID_SDKS, type SDK } from '../scripts/lib/schemas'
import {
  formatContextChunks,
  getModelPricing,
  loadEmbeddings,
  performSearch,
  type EmbeddingChunk,
  type ScoredChunk,
} from '../scripts/lib/search'

export const config = {
  runtime: 'nodejs',
}

interface AskRequest {
  query: string
  sdk?: SDK
  limit?: number
  model?: string
  rerank?: boolean
}

interface AskResponse {
  answer: string
  sources: Array<{
    url: string
    title: string
    chunk_index: number
  }>
  iterations: number
  cost: {
    search_tokens: number
    search_cost: number
    completion_tokens: number
    completion_cost: number
    total_cost: number
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
    let body: AskRequest
    try {
      body = (await request.json()) as AskRequest
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

    const limit = body.limit && body.limit > 0 ? Math.min(body.limit, 20) : 8
    const userSDK = body.sdk && VALID_SDKS.includes(body.sdk) ? body.sdk : undefined
    const model = body.model || 'gpt-4o-mini'
    const rerank = body.rerank === true // Must explicitly set to true
    const MAX_ITERATIONS = 5

    // Load embeddings
    const embeddings = await loadEmbeddings()

    // Define search_docs tool
    const searchDocsTool = {
      type: 'function' as const,
      function: {
        name: 'search_docs',
        description:
          'Search the Clerk documentation for relevant information. Use this when you need more specific information to answer the question accurately.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The search query to find relevant documentation',
            },
            limit: {
              type: 'number',
              description: 'Number of results to return (default: 5, max: 10)',
              default: 5,
            },
          },
          required: ['query'],
        },
      },
    }

    // Perform initial search
    const initialSearch = await performSearch(body.query, embeddings, userSDK, limit, rerank)
    let allChunks = new Map<string, ScoredChunk>()
    for (const chunk of initialSearch.chunks) {
      allChunks.set(chunk.id, chunk)
    }

    let totalSearchTokens = initialSearch.tokens + (initialSearch.rerankTokens || 0)
    let totalSearchCost = initialSearch.cost + (initialSearch.rerankCost || 0)
    let iterations = 1

    // Build system prompt
    const systemPrompt = `You are a helpful assistant that answers questions about Clerk authentication and user management using the provided documentation.

When answering questions:
- Use the provided documentation context to give accurate answers
- Include code examples when relevant
- If the user specifies an SDK (${userSDK ? userSDK : 'any SDK'}), prioritize information relevant to that SDK
- Cite sources by mentioning the documentation title or URL when referencing specific information
- You can use the search_docs tool to find additional information if the initial context doesn't fully answer the question
- If you need more specific information, use search_docs with a focused query
- Be concise but thorough
- After gathering sufficient information, provide your final answer`

    // Format initial context
    const initialContext = formatContextChunks(initialSearch.chunks)
    const userPrompt = `Question: ${body.query}

${userSDK ? `Note: The user is working with the ${userSDK} SDK.` : ''}

Documentation Context:
${initialContext}`

    // Initialize conversation
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]

    // Conversation loop with function calling
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is not set')
    }

    const openai = new OpenAI({ apiKey })
    let answer = ''
    let promptTokens = 0
    let outputTokens = 0

    while (iterations <= MAX_ITERATIONS) {
      const completion = await openai.chat.completions.create({
        model,
        messages,
        tools: [searchDocsTool],
        tool_choice: iterations === MAX_ITERATIONS ? 'none' : 'auto', // Force answer on last iteration
        max_tokens: 1000,
        temperature: 0.7,
      })

      const message = completion.choices[0]?.message
      if (!message) {
        break
      }

      promptTokens += completion.usage?.prompt_tokens || 0
      outputTokens += completion.usage?.completion_tokens || 0

      // Add assistant message to conversation
      messages.push(message)

      // Check if GPT wants to call a tool
      if (message.tool_calls && message.tool_calls.length > 0) {
        for (const toolCall of message.tool_calls) {
          if (toolCall.function.name === 'search_docs') {
            const args = JSON.parse(toolCall.function.arguments || '{}')
            const searchQuery = args.query || body.query
            const searchLimit = Math.min(args.limit || 5, 10)

            // Perform search
            const searchResult = await performSearch(searchQuery, embeddings, userSDK, searchLimit, rerank)
            totalSearchTokens += searchResult.tokens + (searchResult.rerankTokens || 0)
            totalSearchCost += searchResult.cost + (searchResult.rerankCost || 0)

            // Add new chunks (avoid duplicates)
            for (const chunk of searchResult.chunks) {
              if (!allChunks.has(chunk.id)) {
                allChunks.set(chunk.id, chunk)
              }
            }

            // Format results for tool response
            const searchResults = searchResult.chunks.map((chunk) => ({
              title: chunk.title,
              url: chunk.url,
              content: chunk.content,
              score: chunk.score,
            }))

            // Add tool result to conversation
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify(searchResults, null, 2),
            })

            iterations++
          }
        }
      } else {
        // GPT provided final answer
        const content = message.content
        if (typeof content === 'string') {
          answer = content || 'I apologize, but I could not generate an answer.'
        } else if (content && typeof content === 'object' && Array.isArray(content)) {
          const textParts: string[] = []
          for (const c of content as Array<{ text?: string }>) {
            if (c && 'text' in c && c.text) {
              textParts.push(c.text)
            }
          }
          answer = textParts.join('') || 'I apologize, but I could not generate an answer.'
        }
        break
      }
    }

    // If we hit max iterations, get the last message content
    if (!answer && messages.length > 0) {
      const lastMessage = messages[messages.length - 1]
      if (lastMessage.role === 'assistant' && 'content' in lastMessage) {
        const content = lastMessage.content
        if (typeof content === 'string') {
          answer = content || 'I apologize, but I could not generate a complete answer.'
        } else if (content && typeof content === 'object' && Array.isArray(content)) {
          const textParts: string[] = []
          for (const c of content as Array<{ text?: string }>) {
            if (c && 'text' in c && c.text) {
              textParts.push(c.text)
            }
          }
          answer = textParts.join('') || 'I apologize, but I could not generate a complete answer.'
        }
      }
    }

    // Calculate costs
    const pricing = getModelPricing(model)
    const completionCost = (promptTokens / 1000) * pricing.input + (outputTokens / 1000) * pricing.output
    const totalCost = totalSearchCost + completionCost

    // Format sources (unique by URL)
    const sourcesMap = new Map<string, { url: string; title: string; chunk_index: number }>()
    for (const chunk of allChunks.values()) {
      const fullUrl = chunk.heading_slug ? `${chunk.url}#${chunk.heading_slug}` : chunk.url
      const key = fullUrl
      if (!sourcesMap.has(key) || sourcesMap.get(key)!.chunk_index > chunk.chunk_index) {
        sourcesMap.set(key, {
          url: fullUrl,
          title: chunk.title,
          chunk_index: chunk.chunk_index,
        })
      }
    }

    const sources = Array.from(sourcesMap.values())

    const response: AskResponse = {
      answer,
      sources,
      iterations,
      cost: {
        search_tokens: totalSearchTokens,
        search_cost: Math.round(totalSearchCost * 100000000) / 100000000,
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
