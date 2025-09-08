// goes through the markdown tree and ensures that all the heading ids are unique

import { slugifyWithCounter } from '@sindresorhus/slugify'
import { toString } from 'mdast-util-to-string'
import { Node } from 'unist'
import { visit as mdastVisit } from 'unist-util-visit'
import type { VFile } from 'vfile'
import { type BuildConfig } from '../config'
import { safeMessage, type WarningsSection } from '../error-messages'
import { extractHeadingFromHeadingNode } from '../utils/extractHeadingFromHeadingNode'

export const validateUniqueHeadings =
  (config: BuildConfig, filePath: string, section: WarningsSection) => () => (tree: Node, vfile: VFile) => {
    const headingsHashes = new Set<string>()
    const slugify = slugifyWithCounter()

    mdastVisit(
      tree,
      (node) => node.type === 'heading',
      (node) => {
        const id = extractHeadingFromHeadingNode(node)

        if (id !== undefined) {
          if (headingsHashes.has(id)) {
            safeMessage(config, vfile, filePath, section, 'duplicate-heading-id', [filePath, id])
          }

          headingsHashes.add(id)
        } else {
          const slug = slugify(toString(node).trim())

          if (headingsHashes.has(slug)) {
            safeMessage(config, vfile, filePath, section, 'duplicate-heading-id', [filePath, slug])
          }

          headingsHashes.add(slug)
        }
      },
    )
  }
