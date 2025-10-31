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
 * Chunk content by headings with smart merging/splitting
 */
export function chunkByHeadings(content: string): Chunk[] {
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

        // If chunk is too small (< 200 tokens), merge with next section
        if (tokens < 200) {
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
      } else {
        // Content without heading - create a chunk for it
        currentChunk = {
          content: line + '\n',
          headingContext: [],
          startIndex: i,
        }
      }
    }

    // Check if current chunk is too large (> 800 tokens)
    if (currentChunk) {
      const tokens = estimateTokens(currentChunk.content)
      if (tokens > 800) {
        // Split at paragraph boundaries
        const paragraphs = currentChunk.content.split(/\n\n+/)
        let currentSplit = ''
        let splitStart = currentChunk.startIndex

        for (let j = 0; j < paragraphs.length; j++) {
          const para = paragraphs[j]
          const paraTokens = estimateTokens(currentSplit + para)

          if (paraTokens > 800 && currentSplit) {
            // Save current split
            chunks.push({
              content: currentSplit.trim(),
              headingContext: [...currentChunk.headingContext],
              startIndex: splitStart,
              endIndex: i - (paragraphs.length - j),
            })
            currentSplit = para + '\n\n'
            splitStart = i - (paragraphs.length - j) + 1
          } else {
            currentSplit += para + '\n\n'
          }
        }

        // Update current chunk with remaining content
        if (currentSplit.trim()) {
          currentChunk.content = currentSplit.trim()
          currentChunk.startIndex = splitStart
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

    if (tokens < 200 && mergedChunks.length > 0) {
      // Merge with previous chunk
      const prevChunk = mergedChunks[mergedChunks.length - 1]
      prevChunk.content += '\n\n' + chunk.content
      prevChunk.headingContext = [...new Set([...prevChunk.headingContext, ...chunk.headingContext])]
      prevChunk.endIndex = chunk.endIndex
    } else {
      mergedChunks.push(chunk)
    }
  }

  return mergedChunks
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
