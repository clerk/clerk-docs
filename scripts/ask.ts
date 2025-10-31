import 'dotenv/config'
import path from 'node:path'
import OpenAI from 'openai'
import { VALID_SDKS, type SDK } from './lib/schemas'
import {
  formatContextChunks,
  getModelPricing,
  loadEmbeddings,
  performSearch,
  type ScoredChunk,
} from './lib/search'

async function main() {
  const args = process.argv.slice(2)

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log('Usage: npm run ask -- <query> [--limit N] [--sdk SDK] [--model MODEL]')
    console.log('')
    console.log('Options:')
    console.log('  --limit N    Number of context chunks (default: 8)')
    console.log('  --sdk SDK    Filter results by SDK (e.g., react, nextjs)')
    console.log('  --model MODEL GPT model to use (default: gpt-4o-mini)')
    console.log('  --help, -h   Show this help message')
    console.log('')
    console.log('Examples:')
    console.log('  npm run ask -- "How do I authenticate a user?"')
    console.log('  npm run ask -- "How to setup Clerk" --sdk react')
    console.log('  npm run ask -- "What is useUser?" --model gpt-4o')
    process.exit(0)
  }

  const query = args.filter((arg) => !arg.startsWith('--'))[0]
  if (!query) {
    console.error('Error: Query is required')
    console.error('Usage: npm run ask -- <query> [--limit N] [--sdk SDK] [--model MODEL]')
    process.exit(1)
  }

  const limitArg = args.find((arg) => arg.startsWith('--limit'))
  const limit = limitArg ? parseInt(limitArg.split('=')[1] || args[args.indexOf(limitArg) + 1], 10) : 8

  if (isNaN(limit) || limit <= 0) {
    console.error('Error: Invalid limit value')
    process.exit(1)
  }

  const sdkArg = args.find((arg) => arg.startsWith('--sdk'))
  const userSDK = sdkArg ? ((sdkArg.split('=')[1] || args[args.indexOf(sdkArg) + 1]) as SDK) : undefined

  if (userSDK && !VALID_SDKS.includes(userSDK)) {
    console.error(`Error: Invalid SDK "${userSDK}"`)
    console.error(`Valid SDKs: ${VALID_SDKS.join(', ')}`)
    process.exit(1)
  }

  const modelArg = args.find((arg) => arg.startsWith('--model'))
  const model = modelArg ? modelArg.split('=')[1] || args[args.indexOf(modelArg) + 1] : 'gpt-4o-mini'

  const maxLimit = Math.min(limit, 20)
  const MAX_ITERATIONS = 5

  try {
    console.log(`❓ Question: "${query}"`)
    if (userSDK) {
      console.log(`📱 Filtering by SDK: ${userSDK}`)
    }
    console.log(`🤖 Using model: ${model}`)
    console.log(`📊 Loading embeddings...`)

    const distPath = path.resolve(__dirname, '../dist')
    const embeddings = await loadEmbeddings(distPath)
    console.log(`✓ Loaded ${embeddings.length.toLocaleString()} chunks`)

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
    console.log(`🔍 Searching for relevant documentation...`)
    const initialSearch = await performSearch(query, embeddings, userSDK, maxLimit)
    let allChunks = new Map<string, ScoredChunk>()
    for (const chunk of initialSearch.chunks) {
      allChunks.set(chunk.id, chunk)
    }

    console.log(`✓ Found ${initialSearch.chunks.length} relevant chunks`)

    let totalSearchTokens = initialSearch.tokens
    let totalSearchCost = initialSearch.cost
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
    const userPrompt = `Question: ${query}

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

    console.log(`🤖 Generating answer with ${model}...`)

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
            const searchQuery = args.query || query
            const searchLimit = Math.min(args.limit || 5, 10)

            console.log(`  🔍 GPT requested additional search: "${searchQuery}"`)

            // Perform search
            const searchResult = await performSearch(searchQuery, embeddings, userSDK, searchLimit)
            totalSearchTokens += searchResult.tokens
            totalSearchCost += searchResult.cost

            // Add new chunks (avoid duplicates)
            for (const chunk of searchResult.chunks) {
              if (!allChunks.has(chunk.id)) {
                allChunks.set(chunk.id, chunk)
              }
            }

            console.log(`  ✓ Found ${searchResult.chunks.length} additional chunks`)

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
    const sourcesMap = new Map<string, { url: string; title: string }>()
    for (const chunk of allChunks.values()) {
      const key = chunk.url
      if (!sourcesMap.has(key)) {
        sourcesMap.set(key, {
          url: chunk.url,
          title: chunk.title,
        })
      }
    }

    const sources = Array.from(sourcesMap.values())

    // Display answer
    console.log('\n' + '='.repeat(80))
    console.log('📝 Answer:')
    console.log('='.repeat(80))
    console.log(answer)
    console.log('\n' + '='.repeat(80))
    console.log('📚 Sources:')
    console.log('='.repeat(80))
    sources.forEach((source, index) => {
      console.log(`${index + 1}. ${source.title}`)
      console.log(`   ${source.url}`)
    })
    console.log('='.repeat(80))
    console.log(`\n💰 Costs:`)
    console.log(
      `   Search:        $${totalSearchCost.toFixed(8)} (${totalSearchTokens} tokens, ${iterations} iteration${iterations !== 1 ? 's' : ''})`,
    )
    console.log(
      `   Completion:   $${completionCost.toFixed(8)} (${promptTokens} input + ${outputTokens} output tokens)`,
    )
    console.log(`   Total:        $${totalCost.toFixed(8)}`)
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

if (require.main === module) {
  main()
}
