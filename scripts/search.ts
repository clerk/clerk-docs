import 'dotenv/config'
import fs from 'node:fs/promises'
import path from 'node:path'
import OpenAI from 'openai'
import { cosineSimilarity } from './lib/embeddings'

interface EmbeddingChunk {
  id: string
  content: string
  embedding: number[]
  url: string
  title: string
  chunk_index: number
  file_path: string
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

function formatResult(result: SearchResult, index: number): string {
  const lines: string[] = []
  lines.push(`${index + 1}. ${result.title}`)
  lines.push(`   URL: ${result.url}`)
  lines.push(`   Score: ${result.score.toFixed(3)}`)
  lines.push(`   Chunk: ${result.chunk_index}`)
  lines.push(`   Content: ${result.content.substring(0, 200)}${result.content.length > 200 ? '...' : ''}`)
  lines.push('')
  return lines.join('\n')
}

async function main() {
  const args = process.argv.slice(2)

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log('Usage: npm run search -- <query> [--limit N]')
    console.log('')
    console.log('Options:')
    console.log('  --limit N    Maximum number of results (default: 10)')
    console.log('  --help, -h  Show this help message')
    console.log('')
    console.log('Examples:')
    console.log('  npm run search -- "authentication"')
    console.log('  npm run search -- "how to setup clerk" --limit 5')
    process.exit(0)
  }

  const query = args.filter((arg) => !arg.startsWith('--'))[0]
  if (!query) {
    console.error('Error: Query is required')
    console.error('Usage: npm run search -- <query> [--limit N]')
    process.exit(1)
  }

  const limitArg = args.find((arg) => arg.startsWith('--limit'))
  const limit = limitArg
    ? parseInt(limitArg.split('=')[1] || args[args.indexOf(limitArg) + 1], 10)
    : 10

  if (isNaN(limit) || limit <= 0) {
    console.error('Error: Invalid limit value')
    process.exit(1)
  }

  const maxLimit = Math.min(limit, 50)

  try {
    console.log(`🔍 Searching for: "${query}"`)
    console.log(`📊 Loading embeddings...`)

    const embeddings = await loadEmbeddings()
    console.log(`✓ Loaded ${embeddings.length.toLocaleString()} chunks`)

    console.log(`🤖 Generating query embedding...`)
    const queryEmbedding = await generateQueryEmbedding(query)

    console.log(`🔎 Calculating similarity scores...`)
    const scoredChunks = embeddings.map((chunk) => ({
      ...chunk,
      score: cosineSimilarity(queryEmbedding, chunk.embedding),
    }))

    const topResults = scoredChunks
      .sort((a, b) => b.score - a.score)
      .slice(0, maxLimit)
      .map((chunk) => ({
        url: chunk.url,
        title: chunk.title,
        content: chunk.content,
        score: Math.round(chunk.score * 1000) / 1000,
        chunk_index: chunk.chunk_index,
      }))

    console.log(`\n📋 Top ${topResults.length} results:\n`)
    console.log('='.repeat(80))

    topResults.forEach((result, index) => {
      console.log(formatResult(result, index))
    })

    console.log('='.repeat(80))
    console.log(`\nFound ${topResults.length} results (showing top ${maxLimit})`)
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

if (require.main === module) {
  main()
}

