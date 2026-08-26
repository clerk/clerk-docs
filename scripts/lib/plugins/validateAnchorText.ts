// Flags markdown links whose visible anchor text is vague or leads with a generic
// call to action (eg "here", "this page", "Learn more about ..."). Enforces the
// styleguide's "Use descriptive anchor text" rule: hyperlinks should be anchored
// with relevant, keyword-rich text, and any call-to-action verb ("Learn more",
// "Read more", ...) belongs outside the link, not in the anchor.

import { toString } from 'mdast-util-to-string'
import { Node } from 'unist'
import { visit as mdastVisit } from 'unist-util-visit'
import type { VFile } from 'vfile'
import { type BuildConfig } from '../config'
import { safeError, type WarningsSection } from '../error-messages'

// Vague phrases that carry no information about the link's destination. Compared
// case-insensitively against the whole anchor text, so a link reading "here" is
// flagged while "read the migration guide" (which merely contains a word) is not.
const VAGUE_ANCHOR_PHRASES = new Set([
  'here',
  'this page',
  'this guide',
  'this section',
  'this article',
  'this document',
  'this doc',
])

// Generic call-to-action lead-ins. Flagged when the anchor text *begins* with one
// (whether standalone, like "Learn more", or swallowing keywords, like "Learn more
// about the Auth object"). The call to action should sit outside the link and the
// anchor should carry only the keyword phrase — "Learn more about [the Auth object]".
const CTA_LEAD_INS = ['learn more', 'read more', 'see more', 'find out more', 'click here']

// Matches an anchor that starts with a CTA lead-in followed by a non-alphanumeric
// boundary (whitespace, punctuation, dash) or the end of the string. The boundary
// stops "learn moreover ..." from matching while still catching "Learn more: x" and
// "Learn more—x", not just the space-separated "Learn more about x".
const CTA_LEAD_IN_REGEX = new RegExp(`^(?:${CTA_LEAD_INS.join('|')})(?![\\p{L}\\p{N}])`, 'u')

// Normalize anchor text for comparison: lowercase, collapse internal whitespace,
// and strip surrounding punctuation so "Here." and "here »" match "here".
const normalizeAnchorText = (text: string): string =>
  text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')

const isVagueAnchor = (normalized: string): boolean =>
  VAGUE_ANCHOR_PHRASES.has(normalized) || CTA_LEAD_IN_REGEX.test(normalized)

export const validateAnchorText =
  (config: BuildConfig, filePath: string, section: WarningsSection) => () => (tree: Node, vfile: VFile) => {
    // Reference-style links carry only an identifier, so map each definition's
    // identifier to its URL up front to resolve those links' real destination.
    const definitionUrls = new Map<string, string>()
    mdastVisit(
      tree,
      (node) => node.type === 'definition',
      (node) => {
        if (
          'identifier' in node &&
          typeof node.identifier === 'string' &&
          'url' in node &&
          typeof node.url === 'string'
        ) {
          definitionUrls.set(node.identifier, node.url)
        }
      },
    )

    const resolveUrl = (node: Node): string => {
      if ('url' in node && typeof node.url === 'string') return node.url
      if ('identifier' in node && typeof node.identifier === 'string') return definitionUrls.get(node.identifier) ?? ''
      return ''
    }

    mdastVisit(
      tree,
      // Both inline links ([text](url)) and reference-style links ([text][ref] or
      // the shortcut [text]) can carry vague anchor text, so check both node types.
      (node) => node.type === 'link' || node.type === 'linkReference',
      (node) => {
        if (!('children' in node)) return

        const anchorText = toString(node)
        const normalized = normalizeAnchorText(anchorText)

        if (normalized === '') return

        if (isVagueAnchor(normalized)) {
          safeError(
            config,
            vfile,
            filePath,
            section,
            'link-vague-anchor-text',
            [anchorText, resolveUrl(node)],
            node.position,
          )
        }
      },
    )
  }
