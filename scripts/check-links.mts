import { readFile, glob } from 'node:fs/promises'
import { remark } from 'remark'
import reporter from 'vfile-reporter'
import { visit } from 'unist-util-visit'
import remarkFrontmatter from 'remark-frontmatter'
import type { VFile } from 'vfile'
// import { toString } from 'mdast-util-to-string'
// import slugify from '@sindresorhus/slugify'

const ERRORS = {
  DOCS_LINKS_MUST_START_WITH_A_SLASH: 'Docs links must start with a slash',
}

const remarkPluginCheckLinks = () => (tree, file: VFile) => {
  visit(tree, function (node) {
    // TODO: Starter logic to begin checking anchor links
    // if (node.type === 'heading') {
    // const anchor = slugify(toString(node))
    // console.log('HEADING', anchor)
    // }

    if ('url' in node && node.url) {
      if (node.url.startsWith('docs')) {
        file.message(ERRORS.DOCS_LINKS_MUST_START_WITH_A_SLASH, node)
      }
    }
  })
}

const processor = remark().use(remarkFrontmatter).use(remarkPluginCheckLinks)

async function main() {
  console.log('🔎 Checking links...')

  const checkedFiles = [] as VFile[]

  for await (const file of glob('docs/**/*.mdx')) {
    const contents = await readFile(file, 'utf8')
    const result = await processor.process({
      path: file,
      value: contents,
    })

    if (result.messages.length > 0) {
      checkedFiles.push(result)
    }
  }

  const output = reporter(checkedFiles, { quiet: true })

  if (output) {
    console.log(output)
    process.exitCode = 1
  } else {
    console.log('✅ All links are valid!')
  }
}

main()
