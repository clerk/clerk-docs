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

  let effected = false

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

          if (changedTypedocFiles.includes(src)) {
            effected = true
          }
        },
      )
    })
    .process({
      path: file.path,
      value: contents,
    })

  return effected
}

async function main() {
  const changedTypedocFiles = process.argv.slice(2).map((file) => file.replace('.mdx', ''))

  const files = readdirp('docs', { fileFilter: '*.mdx', type: 'files' })

  const effectedFiles = new Set<string>()

  for await (const file of files) {
    if (await processFiles(file, changedTypedocFiles)) {
      effectedFiles.add(file.path)
    }
  }

  console.log(Array.from(effectedFiles).join('\n'))
}

main()
