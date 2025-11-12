import fs from 'node:fs/promises'
import { OpenAI } from 'openai'
import { cosineSimilarity } from 'ai'
import path from 'path'

const apiKey = process.env.OPENAI_EMBEDDINGS_API_KEY

if (!apiKey) {
  throw new Error('OPENAI_EMBEDDINGS_API_KEY is not set')
}

const openai = new OpenAI({ apiKey })

type Embedding = {
  embedding: number[]
  content: string
  canonical: string
  heading: string
  sdk?: string[]
}

const embeddingsPath = path.join(process.cwd(), 'embeddings.json')
const embeddings = JSON.parse(await fs.readFile(embeddingsPath, 'utf8')) as Embedding[]

export async function GET(request: Request) {
  const url = new URL(request.url)
  const searchParams = url.searchParams
  const query = searchParams.get('q')

  if (!query) {
    return Response.json({ error: 'Query is required' }, { status: 400 })
  }

  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: query,
    dimensions: 1_536,
    encoding_format: 'float',
  })

  const searchEmbedding = response.data[0].embedding

  const results = embeddings
    .map((chunk) => {
      const similarity = cosineSimilarity(searchEmbedding, chunk.embedding)
      return {
        ...chunk,
        similarity,
      }
    })
    .sort((a, b) => b.similarity - a.similarity)
    .filter((result, index) => index < 5)

  return Response.json({ query, results })
}
