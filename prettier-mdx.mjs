import * as prettier from 'prettier'
import { remark } from 'remark'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
import remarkMdx from 'remark-mdx'
import { visit } from 'unist-util-visit'

const DISABLE_PRETTIER_RE = /[{,\s]prettier\s*:\s*false[},\s]/

const processor = remark()
  .data('settings', {
    bullet: '-',
    bulletOther: '*',
    rule: '-',
    emphasis: '_',
    quote: "'",
    incrementListMarker: false,
  })
  .use(remarkFrontmatter)
  .use(remarkGfm, { tablePipeAlign: false })
  .use(remarkMdx, { printWidth: 120 })
  .use(remarkDisallowDiffLang)

function remarkDisallowDiffLang() {
  return function traverse(tree) {
    visit(tree, 'code', (node) => {
      if (node.lang === 'diff') {
        let position = `${node.position.start.line}:${node.position.start.column}`
        throw new Error(
          `The \`diff\` language is not supported (${position}). Please use the \`del\` and \`ins\` props instead. https://github.com/clerk/clerk-docs/blob/main/CONTRIBUTING.md#highlighting`,
        )
      }
    })
  }
}

function formatAnnotation(annotation, prettierOptions) {
  let prefix = 'let _ = '

  return prettier
    .format(`${prefix}${annotation}`, {
      ...prettierOptions,
      trailingComma: 'none',
      printWidth: 99999,
      parser: 'babel',
    })
    .then((formatted) => {
      return `${formatted
        /**
         * Despite setting `printWidth` to `99999` we’ll still get a multi-line result sometimes, e.g.
         * {
         *   ins: [
         *     [11, 13],
         *     [20, 25]
         *   ]
         * }
         *
         * This will replace newlines with either:
         * - An empty string if the chars surrounding the newline are the same, e.g. `[[`, `{{`
         * - A single space otherwise, e.g. `{ a`
         */
        .replace(/(?<=(\S))\n\s*(?=(\S))/g, (_, beforeNewline, afterNewline) =>
          beforeNewline === afterNewline ? '' : ' ',
        )
        .slice(prefix.length)
        .trimEnd()
        .replaceAll('\\', '/*__ANNOTATION_ESCAPE__*/')}`
    })
}
function replaceAnnotationMarkers(text) {
  return text.replaceAll('/*__ANNOTATION_ESCAPE__*/', '\\')
}

function remarkCollectAnnotations(annotations) {
  return function traverse(tree, vfile) {
    visit(tree, (node) => {
      if (node.type === 'mdxTextExpression') {
        let value = node.value.trim()
        if (value.startsWith('{') && value.endsWith('}')) {
          annotations.push([node.value, node.position.start.offset, node.position.end.offset])
        }
      } else if (node.type === 'code' && node.position) {
        let blockText = vfile.value.slice(node.position.start.offset, node.position.end.offset)
        let [, prefix, annotation] = blockText.match(/^(```\S+\s+)({\s*{.*?}\s*})\n/) ?? []
        if (annotation) {
          annotations.push([
            annotation.slice(1, -1),
            node.position.start.offset + prefix.length,
            node.position.start.offset + prefix.length + annotation.length,
          ])
        }
      }
    })
  }
}

/**
 * Format [annotations](https://github.com/bradlc/mdx-annotations)
 * Excluding code block annotations
 */
async function formatAnnotations(text, prettierOptions) {
  let annotations = []

  await processor().use(remarkCollectAnnotations, annotations).process(text)

  let offset = 0
  for (let [annotation, start, end] of annotations) {
    let formatted = await formatAnnotation(annotation, prettierOptions)
    text = text.slice(0, start + offset) + `{${formatted}}` + text.slice(end + offset)
    offset += formatted.length - annotation.length
  }

  return text
}

function remarkFormatCodeBlocks(prettierOptions) {
  return async function traverse(tree) {
    let promises = []

    visit(tree, 'code', (node) => {
      let prettierDisabled = !prettierOptions.mdxFormatCodeBlocks || DISABLE_PRETTIER_RE.test(node.meta ?? '')
      let prettierEnabled = !prettierDisabled

      if (prettierEnabled) {
        let parser = inferParser(prettierOptions, { language: node.lang })

        if (parser) {
          promises.push(
            prettier
              .format(node.value, {
                ...prettierOptions,
                parser,
                printWidth: 100,
              })
              .then((formatted) => {
                let newValue = formatted.trimEnd()
                /**
                 * If the formatter added a semi-colon to the start then remove it.
                 * Prevents `<Example />` from becoming `;<Example />`
                 */
                if (newValue.startsWith(';') && !node.value.startsWith(';')) {
                  newValue = newValue.slice(1)
                }
                node.value = newValue
              })
              .catch((error) => {
                if (error instanceof SyntaxError) {
                  error.message = error.message.replace(
                    /\((\d+):(\d+)\)/,
                    (_, line, column) =>
                      `(${parseInt(line, 10) + node.position.start.line}:${parseInt(column, 10) + node.position.start.column - 1})`,
                  )
                }
                throw error
              }),
          )
        }
      }
    })

    await Promise.all(promises)
  }
}

// https://github.com/prettier/prettier/blob/8a88cdce6d4605f206305ebb9204a0cabf96a070/src/utils/infer-parser.js#L61
function inferParser(prettierOptions, fileInfo) {
  let languages = prettierOptions.plugins.flatMap((plugin) => plugin.languages ?? [])
  let language = getLanguageByLanguageName(languages, fileInfo.language)
  return language?.parsers[0]
}

// https://github.com/prettier/prettier/blob/8a88cdce6d4605f206305ebb9204a0cabf96a070/src/utils/infer-parser.js#L24
function getLanguageByLanguageName(languages, languageName) {
  if (!languageName) {
    return
  }

  return (
    languages.find(({ name }) => name.toLowerCase() === languageName) ??
    languages.find(({ aliases }) => aliases?.includes(languageName)) ??
    languages.find(({ extensions }) => extensions?.includes(`.${languageName}`))
  )
}

/**
 * remark will escape the opening bracket in callouts: `> \[!NOTE]`
 * We visit each callout and replace the opening bracket with a temporary marker (`__CALLOUT_MARKER__`)
 * _After_ remark does its thing we replace the marker with an opening bracket
 */
function remarkAddCalloutMarkers() {
  return function traverse(tree) {
    visit(tree, 'blockquote', (node) => {
      if (node.children[0]?.type === 'paragraph' && node.children[0].children[0]?.type === 'text') {
        node.children[0].children[0].value = node.children[0].children[0].value.replace(
          /^\[\s*!\s*([A-Z]+)\s*\]/,
          '__CALLOUT_MARKER__!$1]',
        )
      }
    })
  }
}
function replaceCalloutMarkers(text) {
  return text.replaceAll('\\_\\_CALLOUT\\_MARKER\\_\\_', '[')
}

export const parsers = {
  'mdx-custom': {
    astFormat: 'mdx-custom',
    parse(text) {
      return { text }
    },
  },
}

export const printers = {
  'mdx-custom': {
    async print(ast, prettierOptions) {
      let text = ast.stack[0].text

      text = await formatAnnotations(text, prettierOptions)
      text = String(
        await processor().use(remarkFormatCodeBlocks, prettierOptions).use(remarkAddCalloutMarkers).process(text),
      )
      text = replaceCalloutMarkers(text)
      text = replaceAnnotationMarkers(text)

      return text
    },
  },
}

export const options = {
  mdxFormatCodeBlocks: {
    type: 'boolean',
    category: 'Global',
    default: true,
    description: 'Format the code within fenced code blocks.',
  },
}
