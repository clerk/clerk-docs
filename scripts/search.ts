import 'dotenv/config'
import path from 'node:path'
import readline from 'node:readline'
import { VALID_SDKS, type SDK } from './lib/schemas'
import { loadEmbeddings, performSearch, type EmbeddingChunk } from './lib/search'

// ANSI escape codes for terminal control
const CLEAR_LINE = '\x1b[2K'
const MOVE_CURSOR_UP = (n: number) => `\x1b[${n}A`
const MOVE_CURSOR_DOWN = (n: number) => `\x1b[${n}B`
const CURSOR_TO_START = '\x1b[0G'
const CLEAR_SCREEN = '\x1b[2J'
const CURSOR_TO_TOP = '\x1b[H'

interface SearchResult {
  url: string
  title: string
  content: string
  score: number
  chunk_index: number
}

interface SearchOptions {
  limit: number
  sdk?: SDK
  rerank: boolean
}

function formatResult(result: SearchResult, index: number, compact: boolean = false): string {
  const lines: string[] = []
  if (compact) {
    lines.push(`${index + 1}. ${result.title} (${result.score.toFixed(3)})`)
    lines.push(`   ${result.url}`)
  } else {
    lines.push(`${index + 1}. ${result.title}`)
    lines.push(`   URL: ${result.url}`)
    lines.push(`   Score: ${result.score.toFixed(3)}`)
    lines.push(`   Chunk: ${result.chunk_index}`)
    lines.push(`   Content: ${result.content.substring(0, 200)}${result.content.length > 200 ? '...' : ''}`)
    lines.push('')
  }
  return lines.join('\n')
}

function formatResultsCompact(results: SearchResult[]): string {
  const lines: string[] = []
  results.forEach((result, index) => {
    lines.push(formatResult(result, index, true))
  })
  return lines.join('\n')
}

function printHelp(inRealtimeMode: boolean = false) {
  if (inRealtimeMode) {
    console.log('\n📖 Real-time Search Commands:')
    console.log('  Just type to search! Results update as you type.')
    console.log('')
    console.log('  Commands (type :command and press Enter):')
  } else {
    console.log('\n📖 Available commands:')
  }
  console.log('  :limit <number>      - Set result limit (default: 10, max: 50)')
  console.log('  :sdk <sdk>           - Filter by SDK (react, nextjs, etc.)')
  console.log('  :no-sdk              - Clear SDK filter')
  console.log('  :rerank              - Toggle reranking on/off')
  console.log('  :options             - Show current options')
  console.log('  :help                - Show this help message')
  console.log('  :exit, :quit, :q     - Exit the search CLI')
  console.log('')
}

function showOptions(options: SearchOptions) {
  console.log('\n⚙️  Current options:')
  console.log(`  Limit: ${options.limit}`)
  console.log(`  SDK: ${options.sdk || 'none'}`)
  console.log(`  Rerank: ${options.rerank ? 'enabled' : 'disabled'}`)
  console.log('')
}

async function performSearchWithOptions(
  query: string,
  embeddings: EmbeddingChunk[],
  options: SearchOptions,
  silent: boolean = false,
): Promise<SearchResult[] | null> {
  try {
    if (!silent) {
      console.log(`\n🔍 Searching for: "${query}"`)
      if (options.sdk) {
        console.log(`📱 Filtering by SDK: ${options.sdk}`)
      }
      if (options.rerank) {
        console.log(`🔄 Reranking enabled`)
      }
      console.log(`🤖 Generating query embedding...`)
    }

    const searchResult = await performSearch(query, embeddings, options.sdk, options.limit, options.rerank)

    if (!silent) {
      console.log(`🔎 Calculating similarity scores${options.rerank ? ' and reranking' : ''}...`)
    }

    const topResults = searchResult.chunks.map((chunk) => ({
      url: chunk.heading_slug ? `${chunk.url}#${chunk.heading_slug}` : chunk.url,
      title: chunk.title,
      content: chunk.content,
      score: Math.round(chunk.score * 1000) / 1000,
      chunk_index: chunk.chunk_index,
    }))

    if (!silent) {
      console.log(`\n📋 Top ${topResults.length} results:\n`)
      console.log('='.repeat(80))

      topResults.forEach((result, index) => {
        console.log(formatResult(result, index))
      })

      console.log('='.repeat(80))
      console.log(`\nFound ${topResults.length} results (showing top ${options.limit})`)
      console.log(`💰 Embedding cost: $${searchResult.cost.toFixed(8)} (${searchResult.tokens} tokens)`)
      if (searchResult.rerankCost && searchResult.rerankTokens) {
        console.log(`💰 Reranking cost: $${searchResult.rerankCost.toFixed(8)} (${searchResult.rerankTokens} tokens)`)
      }
      console.log(`💰 Total cost: $${searchResult.totalCost.toFixed(8)} (${searchResult.totalTokens} tokens)`)
    }

    return topResults
  } catch (error) {
    if (!silent) {
      console.error('❌ Error:', error instanceof Error ? error.message : error)
    }
    return null
  }
}

function parseCommand(input: string, options: SearchOptions): { command: string; args: string[] } | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  if (trimmed.startsWith(':')) {
    const parts = trimmed.slice(1).split(/\s+/)
    return { command: parts[0].toLowerCase(), args: parts.slice(1) }
  }

  return { command: 'search', args: [trimmed] }
}

async function handleCommand(
  command: string,
  args: string[],
  options: SearchOptions,
  embeddings: EmbeddingChunk[],
): Promise<{ shouldExit: boolean; newOptions: SearchOptions }> {
  switch (command) {
    case 'exit':
    case 'quit':
    case 'q':
      return { shouldExit: true, newOptions: options }

    case 'help':
      printHelp(false)
      return { shouldExit: false, newOptions: options }

    case 'options':
      showOptions(options)
      return { shouldExit: false, newOptions: options }

    case 'limit':
      if (args.length === 0) {
        console.log(`Current limit: ${options.limit}`)
        return { shouldExit: false, newOptions: options }
      }
      const limit = parseInt(args[0], 10)
      if (isNaN(limit) || limit <= 0 || limit > 50) {
        console.error('❌ Invalid limit. Must be between 1 and 50.')
        return { shouldExit: false, newOptions: options }
      }
      const newLimit = Math.min(limit, 50)
      console.log(`✓ Limit set to ${newLimit}`)
      return { shouldExit: false, newOptions: { ...options, limit: newLimit } }

    case 'sdk':
      if (args.length === 0) {
        console.log(`Current SDK filter: ${options.sdk || 'none'}`)
        return { shouldExit: false, newOptions: options }
      }
      const sdk = args[0] as SDK
      if (!VALID_SDKS.includes(sdk)) {
        console.error(`❌ Invalid SDK "${sdk}"`)
        console.error(`Valid SDKs: ${VALID_SDKS.join(', ')}`)
        return { shouldExit: false, newOptions: options }
      }
      console.log(`✓ SDK filter set to ${sdk}`)
      return { shouldExit: false, newOptions: { ...options, sdk } }

    case 'no-sdk':
      console.log('✓ SDK filter cleared')
      return { shouldExit: false, newOptions: { ...options, sdk: undefined } }

    case 'rerank':
      const newRerank = !options.rerank
      console.log(`✓ Reranking ${newRerank ? 'enabled' : 'disabled'}`)
      return { shouldExit: false, newOptions: { ...options, rerank: newRerank } }

    case 'search':
      if (args.length === 0) {
        console.error('❌ Please provide a search query')
        return { shouldExit: false, newOptions: options }
      }
      await performSearchWithOptions(args.join(' '), embeddings, options)
      return { shouldExit: false, newOptions: options }

    default:
      // Treat unknown commands as search queries
      await performSearchWithOptions([command, ...args].join(' '), embeddings, options)
      return { shouldExit: false, newOptions: options }
  }
}

function clearScreen() {
  process.stdout.write(CLEAR_SCREEN + CURSOR_TO_TOP)
}

function renderRealtimeSearch(
  query: string,
  results: SearchResult[] | null,
  options: SearchOptions,
  isSearching: boolean,
) {
  clearScreen()

  // Header
  console.log('═══════════════════════════════════════════════════════════════════════════════')
  console.log('🔍 Real-time Search')
  console.log('═══════════════════════════════════════════════════════════════════════════════')
  console.log(`Limit: ${options.limit} | SDK: ${options.sdk || 'all'} | Rerank: ${options.rerank ? 'on' : 'off'}`)
  console.log('───────────────────────────────────────────────────────────────────────────────')
  console.log('')

  // Search input
  console.log(`Query: ${query}${isSearching ? ' █' : ''}`)
  console.log('')

  // Results
  if (isSearching) {
    console.log('⏳ Searching...')
  } else if (results === null) {
    console.log('❌ Search error occurred')
  } else if (results.length === 0) {
    console.log('📭 No results found')
  } else {
    console.log(`📋 Found ${results.length} result${results.length !== 1 ? 's' : ''}:\n`)
    console.log(formatResultsCompact(results))
  }

  console.log('')
  console.log('───────────────────────────────────────────────────────────────────────────────')
  console.log('Press Ctrl+C to exit | Type ":help" and press Enter for commands')
}

async function realtimeSearchMode(embeddings: EmbeddingChunk[], initialOptions: SearchOptions) {
  if (!process.stdin.isTTY) {
    console.error('Error: Real-time search requires a TTY terminal')
    process.exit(1)
  }

  // Set up raw mode for character-by-character input
  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdin.setEncoding('utf8')

  let query = ''
  let results: SearchResult[] | null = null
  let options = initialOptions
  let isSearching = false
  let searchTimeout: NodeJS.Timeout | null = null
  let currentSearchQuery = ''

  // Initial render
  renderRealtimeSearch(query, results, options, false)

  const DEBOUNCE_MS = 400 // Wait 400ms after typing stops before searching

  const performDebouncedSearch = async (searchQuery: string) => {
    // Clear existing timeout
    if (searchTimeout) {
      clearTimeout(searchTimeout)
    }

    // Update current query being processed
    currentSearchQuery = searchQuery

    // Show searching state immediately for queries with content
    if (searchQuery.trim().length > 0) {
      isSearching = true
      renderRealtimeSearch(searchQuery, results, options, true)
    } else {
      results = null
      isSearching = false
      renderRealtimeSearch(searchQuery, results, options, false)
      return
    }

    // Debounce the actual search
    searchTimeout = setTimeout(async () => {
      // Only perform search if query hasn't changed
      if (currentSearchQuery !== searchQuery) {
        return
      }

      isSearching = true
      renderRealtimeSearch(searchQuery, results, options, true)

      try {
        const searchResults = await performSearchWithOptions(
          searchQuery,
          embeddings,
          options,
          true, // silent mode
        )

        // Only update if query hasn't changed during search
        if (currentSearchQuery === searchQuery) {
          results = searchResults
          isSearching = false
          renderRealtimeSearch(searchQuery, results, options, false)
        }
      } catch (error) {
        // Only update if query hasn't changed during search
        if (currentSearchQuery === searchQuery) {
          results = null
          isSearching = false
          renderRealtimeSearch(searchQuery, results, options, false)
        }
      }
    }, DEBOUNCE_MS)
  }

  // Handle character input
  process.stdin.on('data', async (key: string) => {
    // Handle Ctrl+C
    if (key === '\u0003') {
      process.stdin.setRawMode(false)
      process.stdin.pause()
      console.log('\n\n👋 Goodbye!')
      process.exit(0)
    }

    // Handle backspace/delete
    if (key === '\u007f' || key === '\b' || key === '\u001b[3~') {
      if (query.length > 0) {
        query = query.slice(0, -1)
        await performDebouncedSearch(query)
      }
      return
    }

    // Handle Enter (submit command mode if starts with :)
    if (key === '\r' || key === '\n') {
      if (query.trim().startsWith(':')) {
        // Clear search timeout
        if (searchTimeout) {
          clearTimeout(searchTimeout)
          searchTimeout = null
        }

        const parsed = parseCommand(query.trim(), options)
        if (parsed) {
          // Temporarily disable raw mode for command output
          process.stdin.setRawMode(false)

          // Clear screen before showing command output
          clearScreen()

          const { shouldExit, newOptions } = await handleCommand(parsed.command, parsed.args, options, embeddings)

          options = newOptions

          if (shouldExit) {
            process.stdin.pause()
            console.log('\n\n👋 Goodbye!')
            process.exit(0)
          }

          // Re-enable raw mode
          process.stdin.setRawMode(true)

          query = ''
          results = null
          currentSearchQuery = ''
          renderRealtimeSearch(query, results, options, false)
        } else {
          process.stdin.setRawMode(true)
        }
      }
      return
    }

    // Handle escape sequences (ignore arrow keys, etc.)
    if (key.length > 1 && key[0] === '\u001b') {
      return
    }

    // Handle regular characters
    if (key.length === 1 && key >= ' ') {
      query += key
      await performDebouncedSearch(query)
    }
  })

  // Handle errors
  process.stdin.on('error', (err) => {
    console.error('\n\nError reading input:', err)
    process.exit(1)
  })
}

async function interactiveMode(embeddings: EmbeddingChunk[], initialOptions: SearchOptions) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  let options = initialOptions

  console.log('\n✨ Interactive search mode started!')
  console.log('Type :help for available commands, or just start searching!\n')
  showOptions(options)

  const prompt = () => {
    rl.question('🔍 Search> ', async (input) => {
      const parsed = parseCommand(input, options)
      if (!parsed) {
        prompt()
        return
      }

      const { shouldExit, newOptions } = await handleCommand(parsed.command, parsed.args, options, embeddings)

      options = newOptions

      if (shouldExit) {
        console.log('\n👋 Goodbye!')
        rl.close()
        process.exit(0)
      } else {
        prompt()
      }
    })
  }

  prompt()
}

async function main() {
  const args = process.argv.slice(2)

  // Handle help flag
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: npm run search -- [--limit N] [--sdk SDK] [--rerank]')
    console.log('')
    console.log('Options:')
    console.log('  --limit N    Maximum number of results (default: 10)')
    console.log('  --sdk SDK    Filter results by SDK (e.g., react, nextjs)')
    console.log('  --rerank     Enable AI reranking for improved relevance')
    console.log('  --help, -h   Show this help message')
    console.log('')
    console.log('If no query is provided, real-time search mode will start.')
    console.log('In real-time mode, search results update as you type.')
    console.log('')
    console.log('Examples:')
    console.log('  npm run search                    # Start interactive mode')
    console.log('  npm run search -- "authentication" # Single search (one-shot mode)')
    console.log('  npm run search -- --limit 5        # Interactive mode with limit 5')
    process.exit(0)
  }

  // Parse initial options and track consumed arguments
  const consumedIndices = new Set<number>()
  let limit = 10
  let userSDK: SDK | undefined = undefined
  let rerank = false

  // Parse --limit
  const limitArgIndex = args.findIndex((arg) => arg.startsWith('--limit'))
  if (limitArgIndex !== -1) {
    consumedIndices.add(limitArgIndex)
    const limitArg = args[limitArgIndex]
    const limitValue = limitArg.split('=')[1]
    if (limitValue) {
      // Format: --limit=5
      limit = parseInt(limitValue, 10)
    } else {
      // Format: --limit 5
      const nextIndex = limitArgIndex + 1
      if (nextIndex < args.length && !args[nextIndex].startsWith('--')) {
        limit = parseInt(args[nextIndex], 10)
        consumedIndices.add(nextIndex)
      }
    }
    if (isNaN(limit) || limit <= 0) {
      console.error('Error: Invalid limit value')
      process.exit(1)
    }
  }

  // Parse --sdk
  const sdkArgIndex = args.findIndex((arg) => arg.startsWith('--sdk'))
  if (sdkArgIndex !== -1) {
    consumedIndices.add(sdkArgIndex)
    const sdkArg = args[sdkArgIndex]
    const sdkValue = sdkArg.split('=')[1]
    if (sdkValue) {
      // Format: --sdk=react
      userSDK = sdkValue as SDK
    } else {
      // Format: --sdk react
      const nextIndex = sdkArgIndex + 1
      if (nextIndex < args.length && !args[nextIndex].startsWith('--')) {
        userSDK = args[nextIndex] as SDK
        consumedIndices.add(nextIndex)
      }
    }
    if (userSDK && !VALID_SDKS.includes(userSDK)) {
      console.error(`Error: Invalid SDK "${userSDK}"`)
      console.error(`Valid SDKs: ${VALID_SDKS.join(', ')}`)
      process.exit(1)
    }
  }

  // Parse --rerank
  const rerankArgIndex = args.findIndex((arg) => arg === '--rerank')
  if (rerankArgIndex !== -1) {
    consumedIndices.add(rerankArgIndex)
    rerank = true
  }

  const initialOptions: SearchOptions = {
    limit: Math.min(limit, 50),
    sdk: userSDK,
    rerank,
  }

  // Check if a query was provided (one-shot mode)
  // Query is any non-flag argument that wasn't consumed as a flag value
  const query =
    args
      .map((arg, index) => ({ arg, index }))
      .filter(({ arg, index }) => !arg.startsWith('--') && !consumedIndices.has(index))
      .map(({ arg }) => arg)
      .join(' ')
      .trim() || undefined

  try {
    console.log(`📊 Loading embeddings...`)
    const distPath = path.resolve(__dirname, '../dist')
    const embeddings = await loadEmbeddings(distPath)
    console.log(`✓ Loaded ${embeddings.length.toLocaleString()} chunks`)

    if (query) {
      // One-shot mode: perform single search and exit
      await performSearchWithOptions(query, embeddings, initialOptions)
      process.exit(0)
    } else {
      // Real-time search mode: start real-time search
      await realtimeSearchMode(embeddings, initialOptions)
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

if (require.main === module) {
  main()
}
