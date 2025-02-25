import fs from 'node:fs'
import readdirp from 'readdirp'
import { remark } from 'remark'
import remarkFrontmatter from 'remark-frontmatter'
import { visit } from 'unist-util-visit'
import reporter from 'vfile-reporter'

const ERRORS = {
  MISSING_TITLE(file) {
    return 'Missing title in frontmatter'
  },
  INVALID_TITLE_FORMAT(file, title) {
    return 'Title starting or ending with backticks must be wrapped in quotes.'
  },
}

// Plugin to check frontmatter
const remarkPluginCheckFrontmatter = () => (tree, file) => {
  visit(tree, 'yaml', (node) => {
    try {
      // Parse the YAML content by splitting on newlines and looking for title
      const frontmatter = node.value.split('\n').reduce((acc, line) => {
        const [key, ...values] = line.split(':')
        if (key && values.length) {
          acc[key.trim()] = values.join(':').trim()
        }
        return acc
      }, {})

      if (!frontmatter.title) {
        file.message(ERRORS.MISSING_TITLE(file.path), node)
        return
      }

      const title = frontmatter.title
      if ((title.startsWith('`') || title.endsWith('`')) && !(title.startsWith("'") && title.endsWith("'"))) {
        file.message(ERRORS.INVALID_TITLE_FORMAT(file.path, title), node)
      }
    } catch (error) {
      file.message(`Error parsing frontmatter: ${error.message}`, node)
    }
  })
}

const processor = remark().use(remarkFrontmatter).use(remarkPluginCheckFrontmatter)

async function main() {
  console.log('🔎 Checking frontmatter titles...')

  const files = readdirp('docs', {
    fileFilter: '*.mdx',
    type: 'files',
  })

  const checkedFiles = []

  for await (const file of files) {
    const contents = await fs.promises.readFile(file.fullPath, 'utf8')
    const result = await processor.process({
      path: file.path,
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
    console.log('✅ All frontmatter titles are properly formatted!')
  }
}

main()
