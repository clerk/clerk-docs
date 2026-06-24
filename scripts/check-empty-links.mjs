import fs from 'node:fs'
import readdirp from 'readdirp'
import { remark } from 'remark'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
import remarkMdx from 'remark-mdx'
import { visit } from 'unist-util-visit'
import reporter from 'vfile-reporter'

/**
 * Check Empty Links Script
 *
 * This script checks for empty links in markdown and MDX files.
 * It provides friendly feedback about any empty links found and suggests how to fix them.
 *
 * Usage:
 *   node ./scripts/check-empty-links.mjs
 *   npm run lint:check-empty-links
 */

function isEmptyString(value) {
  return typeof value === 'string' && value.trim() === ''
}

// Resolves a JSX attribute to its static string value, or undefined if it isn't
// a static string. Covers plain strings (`href="..."`) and string/template
// expressions with no interpolation (`href={''}`, `href={``}`). Genuinely
// dynamic values (`href={someVar}`) return undefined so they aren't flagged.
function staticAttributeValue(attribute) {
  if (typeof attribute.value === 'string') {
    return attribute.value
  }

  const expression = attribute.value?.data?.estree?.body?.[0]?.expression

  if (expression?.type === 'Literal' && typeof expression.value === 'string') {
    return expression.value
  }

  if (expression?.type === 'TemplateLiteral' && expression.expressions.length === 0) {
    return expression.quasis.map((quasi) => quasi.value.cooked).join('')
  }

  return undefined
}

// Plugin to check empty links in markdown and MDX files
const remarkPluginCheckEmptyLinks = () => (tree, file) => {
  visit(tree, (node) => {
    if (node.type === 'link' || node.type === 'image' || node.type === 'definition') {
      if (isEmptyString(node.url)) {
        file.message(`Empty ${node.type} destination`, node)
      }
    }

    if (node.type === 'mdxJsxTextElement' || node.type === 'mdxJsxFlowElement') {
      const hrefAttribute = node.attributes?.find?.(
        (attribute) => attribute.type === 'mdxJsxAttribute' && attribute.name === 'href',
      )

      if (hrefAttribute && isEmptyString(staticAttributeValue(hrefAttribute))) {
        const elementName = node.name || 'JSX element'
        file.message(`Empty href attribute on <${elementName}>`, node)
      }
    }
  })
}

const processor = remark().use(remarkFrontmatter).use(remarkGfm).use(remarkMdx).use(remarkPluginCheckEmptyLinks)

async function main() {
  console.log('🔎 Checking for empty links...')

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
    console.log('✅ No empty links found!')
  }
}

main()
