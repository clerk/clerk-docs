import 'dotenv/config'
import fs from 'node:fs/promises'
import path from 'node:path'
import OpenAI from 'openai'
import { cosineSimilarity, estimateTokens } from './lib/embeddings'
import { VALID_SDKS, type SDK } from './lib/schemas'

const PRICE_PER_1K_TOKENS_EMBEDDING = 0.00002 // $0.00002 per 1K tokens for text-embedding-3-small
const PRICE_PER_1K_TOKENS_GPT_4O_MINI = 0.00015 // $0.00015 per 1K input tokens
const PRICE_PER_1K_TOKENS_GPT_4O_MINI_OUTPUT = 0.0006 // $0.0006 per 1K output tokens

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

async function loadEmbeddings(): Promise<EmbeddingChunk[]> {
  const distPath = path.resolve(__dirname, '../dist')
  const embeddingsPath = path.join(distPath, 'embeddings.json')

  try {
    const content = await fs.readFile(embeddingsPath, 'utf-8')
    const embeddingsFile: EmbeddingsFile = JSON.parse(content)
    return embeddingsFile.chunks
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
  const model = modelArg ? (modelArg.split('=')[1] || args[args.indexOf(modelArg) + 1]) : 'gpt-4o-mini'

  const maxLimit = Math.min(limit, 20)

  try {
    console.log(`❓ Question: "${query}"`)
    if (userSDK) {
      console.log(`📱 Filtering by SDK: ${userSDK}`)
    }
    console.log(`🤖 Using model: ${model}`)
    console.log(`📊 Loading embeddings...`)

    const embeddings = await loadEmbeddings()
    console.log(`✓ Loaded ${embeddings.length.toLocaleString()} chunks`)

    console.log(`🔍 Searching for relevant documentation...`)
    const queryTokens = estimateTokens(query)
    const queryEmbedding = await generateQueryEmbedding(query)
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
      .slice(0, maxLimit)

    console.log(`✓ Found ${topChunks.length} relevant chunks`)

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
    const userPrompt = `Question: ${query}

${userSDK ? `Note: The user is working with the ${userSDK} SDK.` : ''}

Documentation Context:
${context}`

    console.log(`🤖 Generating answer with ${model}...`)

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

    // Display answer
    console.log('\n' + '='.repeat(80))
    console.log('📝 Answer:')
    console.log('='.repeat(80))
    console.log(answer)
    console.log('\n' + '='.repeat(80))
    console.log('📚 Sources:')
    console.log('='.repeat(80))
    topChunks.forEach((chunk, index) => {
      console.log(`${index + 1}. ${chunk.title}`)
      console.log(`   ${chunk.url}`)
    })
    console.log('='.repeat(80))
    console.log(`\n💰 Costs:`)
    console.log(`   Search:        $${searchCost.toFixed(8)} (${queryTokens} tokens)`)
    console.log(`   Completion:   $${completionCost.toFixed(8)} (${promptTokens} input + ${outputTokens} output tokens)`)
    console.log(`   Total:        $${totalCost.toFixed(8)}`)
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

if (require.main === module) {
  main()
}

