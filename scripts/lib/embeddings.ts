import { slugifyWithCounter } from '@sindresorhus/slugify'
import { toString } from 'mdast-util-to-string'
import { remark } from 'remark'
import remarkFrontmatter from 'remark-frontmatter'
import remarkMdx from 'remark-mdx'
import { Node } from 'unist'
import { visit as mdastVisit } from 'unist-util-visit'
import { encoding_for_model } from 'tiktoken'
import yaml from 'yaml'
import { extractHeadingFromHeadingNode } from './utils/extractHeadingFromHeadingNode'

export interface Frontmatter {
  title?: string
  description?: string
  [key: string]: unknown
}

export interface Chunk {
  content: string
  headingContext: string[]
  headingSlug?: string // slug for the primary heading
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
 * Extract headings with their slugs from MDX content
 * Returns a map of heading text -> slug (custom ID or auto-generated)
 */
export async function extractHeadingsWithSlugs(content: string): Promise<Map<string, string>> {
  const headingSlugs = new Map<string, string>()
  const slugify = slugifyWithCounter()

  const processor = remark()
    .use(remarkFrontmatter)
    .use(remarkMdx)
    .use(() => (tree: Node) => {
      mdastVisit(tree, (node) => {
        if (node.type === 'heading') {
          const headingText = toString(node).trim()
          if (!headingText) return

          // Check for custom ID first
          const customId = extractHeadingFromHeadingNode(node)
          const slug = customId !== undefined ? customId : slugify(headingText)

          headingSlugs.set(headingText, slug)
        }
      })
    })

  await processor.process(content)

  return headingSlugs
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

        // Extract text from headings (preserve markdown syntax for chunkByHeadings)
        if (node.type === 'heading') {
          const headingText = toString(node)
          if (headingText) {
            // Preserve markdown heading syntax so chunkByHeadings can detect and split on headings
            const level = 'depth' in node && typeof node.depth === 'number' ? node.depth : 1
            const hashes = '#'.repeat(level)
            textContent += `${hashes} ${headingText}\n`
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
        headingSlug: chunk.headingSlug,
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
      headingSlug: chunk.headingSlug,
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
            headingSlug: splitChunk.headingSlug,
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
          headingSlug: splitChunk.headingSlug,
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
export function chunkByHeadings(content: string, headingSlugs?: Map<string, string>): Chunk[] {
  const MAX_TOKENS = 7000 // Leave buffer for OpenAI's 8192 limit
  const MIN_TOKENS = 200
  const TARGET_MAX_TOKENS = 800

  const lines = content.split('\n')
  const chunks: Chunk[] = []
  let currentChunk: { content: string; headingContext: string[]; startIndex: number } | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmedLine = line.trim()

    // Detect heading levels (markdown syntax)
    const h2Match = trimmedLine.match(/^##\s+(.+)$/)
    const h3Match = trimmedLine.match(/^###\s+(.+)$/)

    if (h2Match) {
      // Save current chunk if exists
      if (currentChunk) {
        const chunkContent = currentChunk.content.trim()
        if (chunkContent) {
          const primaryHeading = currentChunk.headingContext[0]
          const headingSlug = primaryHeading && headingSlugs?.get(primaryHeading)
          chunks.push({
            content: chunkContent,
            headingContext: [...currentChunk.headingContext],
            headingSlug,
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
      // Always create a new chunk for H3 headings (each heading should be its own chunk)
      if (currentChunk) {
        const chunkContent = currentChunk.content.trim()
        if (chunkContent) {
          const primaryHeading = currentChunk.headingContext[0]
          const headingSlug = primaryHeading && headingSlugs?.get(primaryHeading)
          chunks.push({
            content: chunkContent,
            headingContext: [...currentChunk.headingContext],
            headingSlug,
            startIndex: currentChunk.startIndex,
            endIndex: i - 1,
          })
        }
      }

      // Start new chunk with h3 heading
      // Use H3 as primary heading (first in context) so it gets its own slug
      // Keep parent H2 as context for reference
      const parentH2 = currentChunk?.headingContext[0]
      currentChunk = {
        content: line + '\n',
        headingContext: parentH2 ? [h3Match[1], parentH2] : [h3Match[1]],
        startIndex: i,
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
          const primaryHeading = currentChunk.headingContext[0]
          const headingSlug = primaryHeading && headingSlugs?.get(primaryHeading)
          chunks.push({
            content: chunkContent,
            headingContext: [...currentChunk.headingContext],
            headingSlug,
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
        const primaryHeading = currentChunk.headingContext[0]
        const headingSlug = primaryHeading && headingSlugs?.get(primaryHeading)
        const tempChunk: Chunk = {
          content: chunkContent,
          headingContext: [...currentChunk.headingContext],
          headingSlug,
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
      const primaryHeading = currentChunk.headingContext[0]
      const headingSlug = primaryHeading && headingSlugs?.get(primaryHeading)
      chunks.push({
        content: chunkContent,
        headingContext: [...currentChunk.headingContext],
        headingSlug,
        startIndex: currentChunk.startIndex,
        endIndex: lines.length - 1,
      })
    }
  }

  // Post-process: ensure all chunks have heading slugs assigned
  // Don't merge chunks - each heading should remain its own chunk
  const processedChunks: Chunk[] = []
  for (const chunk of chunks) {
    // Ensure heading slug is set from headingContext
    if (!chunk.headingSlug && headingSlugs && chunk.headingContext.length > 0) {
      // Use the primary heading (first in context)
      const primaryHeading = chunk.headingContext[0]
      chunk.headingSlug = headingSlugs.get(primaryHeading)
    }
    processedChunks.push(chunk)
  }

  // Final pass: split any chunks that still exceed MAX_TOKENS
  const finalChunks: Chunk[] = []
  for (const chunk of processedChunks) {
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
