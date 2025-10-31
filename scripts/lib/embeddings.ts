import { toString } from 'mdast-util-to-string'
import { remark } from 'remark'
import remarkFrontmatter from 'remark-frontmatter'
import remarkMdx from 'remark-mdx'
import { Node } from 'unist'
import { visit as mdastVisit } from 'unist-util-visit'
import { encoding_for_model } from 'tiktoken'
import yaml from 'yaml'

export interface Frontmatter {
  title?: string
  description?: string
  [key: string]: unknown
}

export interface Chunk {
  content: string
  headingContext: string[]
  startIndex: number
  endIndex: number
}

/**
 * Extract frontmatter from markdown content
 */
export function extractFrontmatter(content: string): Frontmatter {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n/)
  if (!frontmatterMatch) {
    return {}
  }

  try {
    return (yaml.parse(frontmatterMatch[1]) as Frontmatter) || {}
  } catch {
    return {}
  }
}

/**
 * Extract plain text from MDX markdown content
 * Strips MDX components, code blocks, and preserves structure
 */
export async function extractTextFromMdx(content: string): Promise<string> {
  let textContent = ''

  const processor = remark()
    .use(remarkFrontmatter)
    .use(remarkMdx)
    .use(() => (tree: Node) => {
      mdastVisit(tree, (node) => {
        // Skip frontmatter
        if (node.type === 'yaml') {
          return
        }

        // Skip code blocks
        if (node.type === 'code') {
          return
        }

        // Skip JSX/MDX components
        if (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') {
          return
        }

        // Extract text from headings
        if (node.type === 'heading') {
          const headingText = toString(node)
          if (headingText) {
            textContent += headingText + '\n'
          }
          return
        }

        // Extract text from paragraphs
        if (node.type === 'paragraph') {
          const paraText = toString(node)
          if (paraText) {
            textContent += paraText + '\n\n'
          }
          return
        }

        // Extract text from list items
        if (node.type === 'listItem') {
          const itemText = toString(node)
          if (itemText) {
            textContent += `- ${itemText}\n`
          }
          return
        }
      })
    })

  await processor.process(content)

  return textContent.trim()
}

// Cache the encoder for text-embedding-3-small (uses cl100k_base encoding)
let encoder: ReturnType<typeof encoding_for_model> | null = null

/**
 * Get accurate token count using tiktoken
 * Uses cl100k_base encoding for text-embedding-3-small model
 * Falls back to gpt-3.5-turbo encoding if text-embedding-3-small isn't recognized
 */
export function estimateTokens(text: string): number {
  if (!encoder) {
    try {
      // text-embedding-3-small uses cl100k_base encoding (same as GPT-3.5/4)
      encoder = encoding_for_model('text-embedding-3-small')
    } catch {
      // Fallback to gpt-3.5-turbo which uses the same cl100k_base encoding
      encoder = encoding_for_model('gpt-3.5-turbo')
    }
  }
  return encoder.encode(text).length
}

/**
 * Split a chunk that exceeds the maximum token limit
 */
function splitOversizedChunk(chunk: Chunk, maxTokens: number): Chunk[] {
  const content = chunk.content
  const tokens = estimateTokens(content)

  if (tokens <= maxTokens) {
    return [chunk]
  }

  // Try splitting by paragraphs first
  const paragraphs = content.split(/\n\n+/)
  const splitChunks: Chunk[] = []
  let currentSplit = ''
  let currentTokens = 0

  for (const para of paragraphs) {
    const paraTokens = estimateTokens(para)

    // If adding this paragraph would exceed limit, save current split
    if (currentTokens + paraTokens > maxTokens && currentSplit) {
      splitChunks.push({
        content: currentSplit.trim(),
        headingContext: [...chunk.headingContext],
        startIndex: chunk.startIndex,
        endIndex: chunk.endIndex,
      })
      currentSplit = para
      currentTokens = paraTokens
    } else {
      currentSplit += (currentSplit ? '\n\n' : '') + para
      currentTokens += paraTokens
    }
  }

  // Add remaining content
  if (currentSplit.trim()) {
    splitChunks.push({
      content: currentSplit.trim(),
      headingContext: [...chunk.headingContext],
      startIndex: chunk.startIndex,
      endIndex: chunk.endIndex,
    })
  }

  // If still too large, split by sentences
  const finalChunks: Chunk[] = []
  for (const splitChunk of splitChunks) {
    const splitTokens = estimateTokens(splitChunk.content)
    if (splitTokens > maxTokens) {
      // Split by sentences (period, exclamation, question mark followed by space)
      const sentences = splitChunk.content.split(/([.!?]\s+)/)
      let currentSentence = ''
      let currentSentenceTokens = 0

      for (let i = 0; i < sentences.length; i++) {
        const sentence = sentences[i]
        const sentenceTokens = estimateTokens(sentence)

        if (currentSentenceTokens + sentenceTokens > maxTokens && currentSentence) {
          finalChunks.push({
            content: currentSentence.trim(),
            headingContext: [...splitChunk.headingContext],
            startIndex: splitChunk.startIndex,
            endIndex: splitChunk.endIndex,
          })
          currentSentence = sentence
          currentSentenceTokens = sentenceTokens
        } else {
          currentSentence += sentence
          currentSentenceTokens += sentenceTokens
        }
      }

      if (currentSentence.trim()) {
        finalChunks.push({
          content: currentSentence.trim(),
          headingContext: [...splitChunk.headingContext],
          startIndex: splitChunk.startIndex,
          endIndex: splitChunk.endIndex,
        })
      }
    } else {
      finalChunks.push(splitChunk)
    }
  }

  return finalChunks
}

/**
 * Chunk content by headings with smart merging/splitting
 * Ensures chunks are between 200-7000 tokens (max 7000 to leave buffer for OpenAI's 8192 limit)
 */
export function chunkByHeadings(content: string): Chunk[] {
  const MAX_TOKENS = 7000 // Leave buffer for OpenAI's 8192 limit
  const MIN_TOKENS = 200
  const TARGET_MAX_TOKENS = 800

  const lines = content.split('\n')
  const chunks: Chunk[] = []
  let currentChunk: { content: string; headingContext: string[]; startIndex: number } | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmedLine = line.trim()

    // Detect heading levels
    const h2Match = trimmedLine.match(/^##\s+(.+)$/)
    const h3Match = trimmedLine.match(/^###\s+(.+)$/)

    if (h2Match) {
      // Save current chunk if exists
      if (currentChunk) {
        const chunkContent = currentChunk.content.trim()
        if (chunkContent) {
          chunks.push({
            content: chunkContent,
            headingContext: [...currentChunk.headingContext],
            startIndex: currentChunk.startIndex,
            endIndex: i - 1,
          })
        }
      }

      // Start new chunk with h2 heading
      currentChunk = {
        content: line + '\n',
        headingContext: [h2Match[1]],
        startIndex: i,
      }
    } else if (h3Match) {
      // If we have a current chunk, check if we should merge or split
      if (currentChunk) {
        const chunkContent = currentChunk.content.trim()
        const tokens = estimateTokens(chunkContent)

        // If chunk is too small (< MIN_TOKENS), merge with next section
        if (tokens < MIN_TOKENS) {
          currentChunk.content += line + '\n'
          currentChunk.headingContext.push(h3Match[1])
        } else {
          // Save current chunk and start new one
          chunks.push({
            content: chunkContent,
            headingContext: [...currentChunk.headingContext],
            startIndex: currentChunk.startIndex,
            endIndex: i - 1,
          })

          currentChunk = {
            content: line + '\n',
            headingContext: [...currentChunk.headingContext, h3Match[1]],
            startIndex: i,
          }
        }
      } else {
        // No current chunk, start new one with h3
        currentChunk = {
          content: line + '\n',
          headingContext: [h3Match[1]],
          startIndex: i,
        }
      }
    } else {
      // Regular content line
      if (currentChunk) {
        currentChunk.content += line + '\n'

        // Check if adding this line would exceed target max tokens
        const tokens = estimateTokens(currentChunk.content)
        if (tokens > TARGET_MAX_TOKENS) {
          // Save current chunk
          const chunkContent = currentChunk.content.trim()
          chunks.push({
            content: chunkContent,
            headingContext: [...currentChunk.headingContext],
            startIndex: currentChunk.startIndex,
            endIndex: i,
          })
          currentChunk = null
        }
      } else {
        // Content without heading - create a chunk for it
        currentChunk = {
          content: line + '\n',
          headingContext: [],
          startIndex: i,
        }
      }
    }

    // Safety check: if current chunk exceeds MAX_TOKENS, force split it
    if (currentChunk) {
      const tokens = estimateTokens(currentChunk.content)
      if (tokens > MAX_TOKENS) {
        // Split immediately
        const chunkContent = currentChunk.content.trim()
        const tempChunk: Chunk = {
          content: chunkContent,
          headingContext: [...currentChunk.headingContext],
          startIndex: currentChunk.startIndex,
          endIndex: i,
        }
        const splitChunks = splitOversizedChunk(tempChunk, MAX_TOKENS)
        chunks.push(...splitChunks.slice(0, -1)) // Add all but last

        // Continue with last split chunk
        if (splitChunks.length > 0) {
          const lastChunk = splitChunks[splitChunks.length - 1]
          currentChunk = {
            content: lastChunk.content,
            headingContext: lastChunk.headingContext,
            startIndex: lastChunk.startIndex,
          }
        } else {
          currentChunk = null
        }
      }
    }
  }

  // Save final chunk
  if (currentChunk) {
    const chunkContent = currentChunk.content.trim()
    if (chunkContent) {
      chunks.push({
        content: chunkContent,
        headingContext: [...currentChunk.headingContext],
        startIndex: currentChunk.startIndex,
        endIndex: lines.length - 1,
      })
    }
  }

  // Post-process: merge chunks that are too small
  const mergedChunks: Chunk[] = []
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    const tokens = estimateTokens(chunk.content)

    if (tokens < MIN_TOKENS && mergedChunks.length > 0) {
      // Merge with previous chunk, but check if result would exceed MAX_TOKENS
      const prevChunk = mergedChunks[mergedChunks.length - 1]
      const mergedContent = prevChunk.content + '\n\n' + chunk.content
      const mergedTokens = estimateTokens(mergedContent)

      if (mergedTokens <= MAX_TOKENS) {
        prevChunk.content = mergedContent
        prevChunk.headingContext = [...new Set([...prevChunk.headingContext, ...chunk.headingContext])]
        prevChunk.endIndex = chunk.endIndex
      } else {
        // Can't merge, add as separate chunk
        mergedChunks.push(chunk)
      }
    } else {
      mergedChunks.push(chunk)
    }
  }

  // Final pass: split any chunks that still exceed MAX_TOKENS
  const finalChunks: Chunk[] = []
  for (const chunk of mergedChunks) {
    const tokens = estimateTokens(chunk.content)
    if (tokens > MAX_TOKENS) {
      const splitChunks = splitOversizedChunk(chunk, MAX_TOKENS)
      finalChunks.push(...splitChunks)
    } else {
      finalChunks.push(chunk)
    }
  }

  return finalChunks
}

/**
 * Calculate cosine similarity between two embedding vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have the same length')
  }

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB)
  if (denominator === 0) {
    return 0
  }

  return dotProduct / denominator
}
