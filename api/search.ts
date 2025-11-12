import embeddings from './embeddings.json' assert { type: 'json' }
import { OpenAI } from 'openai'
import { cosineSimilarity } from 'ai'

const apiKey = process.env.OPENAI_EMBEDDINGS_API_KEY

if (!apiKey) {
  throw new Error('OPENAI_EMBEDDINGS_API_KEY is not set')
}

const openai = new OpenAI({ apiKey })

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
