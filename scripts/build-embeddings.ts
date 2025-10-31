import 'dotenv/config'
import fs from 'node:fs/promises'
import path from 'node:path'
import OpenAI from 'openai'
import { chunkByHeadings, estimateTokens, extractFrontmatter, extractTextFromMdx } from './lib/embeddings'

interface DirectoryEntry {
  path: string
  url: string
}

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

const EMBEDDING_MODEL = 'text-embedding-3-small'
const PRICE_PER_1K_TOKENS = 0.00002 // $0.00002 per 1K tokens for text-embedding-3-small

async function main() {
  const args = process.argv.slice(2)
  const skipConfirmation = args.includes('--skip-confirmation') || args.includes('-y')

  // Check for OpenAI API key
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    console.error('Error: OPENAI_API_KEY environment variable is not set')
    console.error('Please set it in your .env file or export it:')
    console.error('  export OPENAI_API_KEY=your_api_key_here')
    process.exit(1)
  }

  const openaiClient = new OpenAI({ apiKey })
  const distPath = path.resolve(__dirname, '../dist')
  const directoryJsonPath = path.join(distPath, 'directory.json')
  const embeddingsJsonPath = path.join(distPath, 'embeddings.json')

  // Load directory.json
  console.log('📂 Loading directory.json...')
  let directoryEntries: DirectoryEntry[]
  try {
    const directoryContent = await fs.readFile(directoryJsonPath, 'utf-8')
    directoryEntries = JSON.parse(directoryContent) as DirectoryEntry[]
  } catch (error) {
    console.error(`Error reading directory.json: ${error}`)
    process.exit(1)
  }

  console.log(`✓ Found ${directoryEntries.length} files in directory.json\n`)

  // Phase 1: Analysis & Cost Estimation
  console.log('📊 Phase 1: Analyzing files and estimating costs...\n')

  const analysisResults: Array<{
    filePath: string
    url: string
    title: string
    chunks: Array<{ content: string; tokens: number }>
  }> = []

  let totalFiles = 0
  let totalChunks = 0
  let totalTokens = 0

  for (const entry of directoryEntries) {
    const filePath = path.join(distPath, entry.path)

    // Skip if file doesn't exist
    try {
      await fs.access(filePath)
    } catch {
      continue
    }

    // Skip partials
    if (entry.path.includes('_partials/')) {
      continue
    }

    totalFiles++

    try {
      const content = await fs.readFile(filePath, 'utf-8')
      const frontmatter = extractFrontmatter(content)
      const textContent = await extractTextFromMdx(content)
      const chunks = chunkByHeadings(textContent)

      const chunkData = chunks.map((chunk) => ({
        content: chunk.content,
        tokens: estimateTokens(chunk.content),
      }))

      const fileTokens = chunkData.reduce((sum, chunk) => sum + chunk.tokens, 0)
      totalChunks += chunks.length
      totalTokens += fileTokens

      analysisResults.push({
        filePath: entry.path,
        url: entry.url,
        title: (frontmatter.title as string) || 'Untitled',
        chunks: chunkData,
      })
    } catch (error) {
      console.warn(`⚠️  Warning: Failed to process ${entry.path}: ${error}`)
    }
  }

  // Calculate estimated cost
  const estimatedCost = (totalTokens / 1000) * PRICE_PER_1K_TOKENS

  console.log('='.repeat(60))
  console.log('📊 Cost Estimation Summary')
  console.log('='.repeat(60))
  console.log(`Files to process:     ${totalFiles}`)
  console.log(`Total chunks:         ${totalChunks}`)
  console.log(`Total tokens:         ${totalTokens.toLocaleString()}`)
  console.log(`Estimated cost:       $${estimatedCost.toFixed(4)}`)
  console.log('='.repeat(60))
  console.log()

  // Ask for confirmation
  if (!skipConfirmation) {
    const readline = await import('readline')
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })

    const answer = await new Promise<string>((resolve) => {
      rl.question('Continue with embedding generation? (y/n): ', resolve)
    })

    rl.close()

    if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
      console.log('Aborted.')
      process.exit(0)
    }
  }

  console.log()
  console.log('🚀 Phase 2: Generating embeddings...\n')

  // Phase 2: Generate embeddings
  const allChunks: EmbeddingChunk[] = []
  let processedChunks = 0
  let errors = 0

  for (const result of analysisResults) {
    const filePath = path.join(distPath, result.filePath)

    try {
      const content = await fs.readFile(filePath, 'utf-8')
      const frontmatter = extractFrontmatter(content)
      const textContent = await extractTextFromMdx(content)
      const chunks = chunkByHeadings(textContent)

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]
        processedChunks++

        try {
          // Generate embedding
          const response = await openaiClient.embeddings.create({
            model: EMBEDDING_MODEL,
            input: chunk.content,
          })

          const embedding = response.data[0].embedding

          const chunkId = `${result.url}-chunk-${i}`

          allChunks.push({
            id: chunkId,
            content: chunk.content,
            embedding,
            url: result.url,
            title: result.title,
            chunk_index: i,
            file_path: result.filePath,
          })

          // Progress indicator
          if (processedChunks % 50 === 0 || processedChunks === totalChunks) {
            console.log(`  Processing chunk ${processedChunks}/${totalChunks}...`)
          }
        } catch (error) {
          errors++
          console.warn(`  ⚠️  Failed to generate embedding for chunk ${i} in ${result.filePath}: ${error}`)
        }
      }
    } catch (error) {
      errors++
      console.warn(`⚠️  Failed to process file ${result.filePath}: ${error}`)
    }
  }

  console.log()
  console.log('💾 Writing embeddings to embeddings.json...')

  // Write embeddings file
  const embeddingsFile: EmbeddingsFile = {
    chunks: allChunks,
  }

  await fs.writeFile(embeddingsJsonPath, JSON.stringify(embeddingsFile, null, 2))

  // Final summary
  const actualTokens = allChunks.reduce((sum, chunk) => sum + estimateTokens(chunk.content), 0)
  const actualCost = (actualTokens / 1000) * PRICE_PER_1K_TOKENS

  console.log()
  console.log('='.repeat(60))
  console.log('✅ Embedding Generation Complete!')
  console.log('='.repeat(60))
  console.log(`Files processed:      ${totalFiles}`)
  console.log(`Chunks generated:     ${allChunks.length}`)
  console.log(`Errors encountered:   ${errors}`)
  console.log(`Total tokens:          ${actualTokens.toLocaleString()}`)
  console.log(`Estimated cost:       $${actualCost.toFixed(4)}`)
  console.log(`Output file:           ${embeddingsJsonPath}`)
  console.log('='.repeat(60))
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
}
