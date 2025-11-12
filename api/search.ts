import embeddings from './embeddings.json'

export async function GET(request: Request) {
  console.log(embeddings[0])
  return Response.json({ firstEmbedding: embeddings[0] })
}
