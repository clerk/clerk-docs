/**
 * This script finds documentation pages that use the <Typedoc /> MDX component and checks if they reference any of the Typedoc files you specify.
 *
 * Usage:
 *   tsx scripts/extract-typedoc-pages.ts clerk-typedoc/path/to/file1.json clerk-typedoc/path/to/file2.json ...
 *
 * Pass the list of Typedoc files as arguments, including the 'clerk-typedoc/' prefix. The script will handle removing this prefix as needed.
 */

import fs from 'node:fs/promises'
import readdirp from 'readdirp'
import { remark } from 'remark'
import remarkFrontmatter from 'remark-frontmatter'
import remarkMdx from 'remark-mdx'
import { visit } from 'unist-util-visit'

const processFiles = async (file: readdirp.EntryInfo, changedTypedocFiles: string[]) => {
  const contents = await fs.readFile(file.fullPath, 'utf8')

  const matchedSources = new Set<string>()

  await remark()
    .use(remarkFrontmatter)
    .use(remarkMdx)
    .use(() => (tree, file) => {
      visit(
        tree,
        (node) => {
          if (node.type !== 'mdxJsxFlowElement') return false
          if (!('name' in node)) return false
          if (node.name !== 'Typedoc') return false

          return true
        },
        (node) => {
          if (!('attributes' in node)) return
          if (!Array.isArray(node.attributes)) return

          const src = node.attributes.find((attribute) => attribute.name === 'src')?.value

          if (!src) {
            return
          }

          if (typeof src === 'string' && changedTypedocFiles.includes(src)) {
            matchedSources.add(src)
          }
        },
      )
    })
    .process({
      path: file.path,
      value: contents,
    })

  return Array.from(matchedSources)
}

async function main() {
  const argv = process.argv.slice(2)
  const withSrc = argv.includes('--with-src')

  const changedTypedocFiles = argv
    .filter((arg) => arg !== '--with-src')
    .map((file) => file.replace('clerk-typedoc/', '').replace('.mdx', ''))

  const files = readdirp('docs', { fileFilter: '*.mdx', type: 'files' })

  const effectedFiles = new Map<string, string[]>()

  for await (const file of files) {
    const matches = await processFiles(file, changedTypedocFiles)
    if (matches.length > 0) {
      effectedFiles.set(file.path, matches)
    }
  }

  if (withSrc) {
    console.log(
      Array.from(effectedFiles.entries())
        .map(([docPath, sources]) => `${docPath}\n  - ${sources.join('\n  - ')}`)
        .join('\n'),
    )
  } else {
    // Backwards-compatible: print only the effected guide paths
    console.log(Array.from(effectedFiles.keys()).join('\n'))
  }
}

main()
