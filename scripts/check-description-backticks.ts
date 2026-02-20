import fs from 'node:fs'
import readdirp from 'readdirp'
import { remark } from 'remark'
import remarkFrontmatter from 'remark-frontmatter'
import { visit } from 'unist-util-visit'
import type { VFile } from 'vfile'
import reporter from 'vfile-reporter'

const fix = process.argv.includes('--fix')

const remarkPluginCheckDescriptionBackticks = () => (tree, file) => {
  visit(tree, 'yaml', (node) => {
    const lines = node.value.split('\n')
    let descriptionValue = ''
    let inDescription = false

    for (const line of lines) {
      if (line.match(/^description\s*:/)) {
        inDescription = true
        descriptionValue += line.replace(/^description\s*:\s*/, '')
      } else if (inDescription && /^\s+/.test(line)) {
        descriptionValue += '\n' + line
      } else {
        if (inDescription) break
      }
    }

    if (descriptionValue.includes('`')) {
      file.message('Description should not contain backticks', node)
    }
  })
}

function fixDescription(content: string): string {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return content

  const frontmatter = match[1]
  let inDescription = false
  const fixedFrontmatter = frontmatter
    .split('\n')
    .map((line) => {
      if (line.match(/^description\s*:/)) {
        inDescription = true
        return line.replaceAll('`', '')
      }
      if (inDescription && /^\s+/.test(line)) {
        return line.replaceAll('`', '')
      }
      inDescription = false
      return line
    })
    .join('\n')

  return (
    content.slice(0, match.index!) +
    '---\n' +
    fixedFrontmatter +
    '\n---' +
    content.slice(match.index! + match[0].length)
  )
}

const processor = remark().use(remarkFrontmatter).use(remarkPluginCheckDescriptionBackticks)

async function main() {
  console.log('🔎 Checking description fields for backticks...')

  const files = readdirp('docs', {
    fileFilter: '*.mdx',
    type: 'files',
  })

  const checkedFiles: VFile[] = []

  for await (const file of files) {
    const contents = await fs.promises.readFile(file.fullPath, 'utf8')
    const result = await processor.process({
      path: file.path,
      value: contents,
    })

    if (result.messages.length > 0) {
      checkedFiles.push(result)

      if (fix) {
        const fixed = fixDescription(contents)
        await fs.promises.writeFile(file.fullPath, fixed, 'utf8')
      }
    }
  }

  const output = reporter(checkedFiles, { quiet: true })

  if (fix && checkedFiles.length > 0) {
    console.log(`✅ Fixed ${checkedFiles.length} file(s)`)
  } else if (output) {
    console.log(output)
    console.log('Run with --fix to remove backticks from descriptions.\n')
    process.exitCode = 1
  } else {
    console.log('✅ No backticks found in description fields!')
  }
}

main()
