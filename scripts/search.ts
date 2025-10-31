import 'dotenv/config'
import path from 'node:path'
import { VALID_SDKS, type SDK } from './lib/schemas'
import { loadEmbeddings, performSearch, type EmbeddingChunk } from './lib/search'

interface SearchResult {
  url: string
  title: string
  content: string
  score: number
  chunk_index: number
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
    console.log('Usage: npm run search -- <query> [--limit N] [--sdk SDK]')
    console.log('')
    console.log('Options:')
    console.log('  --limit N    Maximum number of results (default: 10)')
    console.log('  --sdk SDK    Filter results by SDK (e.g., react, nextjs)')
    console.log('  --help, -h  Show this help message')
    console.log('')
    console.log('Examples:')
    console.log('  npm run search -- "authentication"')
    console.log('  npm run search -- "how to setup clerk" --limit 5')
    console.log('  npm run search -- "use user hook" --sdk react')
    process.exit(0)
  }

  const query = args.filter((arg) => !arg.startsWith('--'))[0]
  if (!query) {
    console.error('Error: Query is required')
    console.error('Usage: npm run search -- <query> [--limit N] [--sdk SDK]')
    process.exit(1)
  }

  const limitArg = args.find((arg) => arg.startsWith('--limit'))
  const limit = limitArg ? parseInt(limitArg.split('=')[1] || args[args.indexOf(limitArg) + 1], 10) : 10

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

  const maxLimit = Math.min(limit, 50)

  try {
    console.log(`🔍 Searching for: "${query}"`)
    if (userSDK) {
      console.log(`📱 Filtering by SDK: ${userSDK}`)
    }
    console.log(`📊 Loading embeddings...`)

    const distPath = path.resolve(__dirname, '../dist')
    const embeddings = await loadEmbeddings(distPath)
    console.log(`✓ Loaded ${embeddings.length.toLocaleString()} chunks`)

    console.log(`🤖 Generating query embedding...`)
    const searchResult = await performSearch(query, embeddings, userSDK, maxLimit)
    const queryCost = searchResult.cost
    const queryTokens = searchResult.tokens

    console.log(`🔎 Calculating similarity scores...`)
    const topResults = searchResult.chunks.map((chunk) => ({
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
    console.log(`💰 Query cost: $${queryCost.toFixed(8)} (${queryTokens} tokens)`)
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

if (require.main === module) {
  main()
}
