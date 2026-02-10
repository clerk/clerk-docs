import fs from 'node:fs'
import readdirp from 'readdirp'
import reporter from 'vfile-reporter'
import { VFile } from 'vfile'

/**
 * Checks MDX annotation expressions (e.g. `{{ target: '_blank' }}`) for
 * unquoted string values that would be treated as variable references at
 * runtime, causing `ReferenceError`.
 *
 * Valid:   {{ target: '_blank' }}  {{ collapsible: true }}  {{ mark: [1, 3] }}
 * Invalid: {{ target: _blank }}
 */

// Matches MDX annotation expressions: {{ ... }}, including multiline
const annotationRegex = /\{\{([\s\S]+?)\}\}/g

// Matches a key-value pair where the value is a bare identifier
// (not a quoted string, number, boolean, array, or object)
// e.g. `target: _blank` but not `target: '_blank'` or `collapsible: true`
const bareIdentifierValueRegex =
  /(\w+)\s*:\s*(?!true\b|false\b|null\b|undefined\b|\d|'|"|`|\[|\{)([a-zA-Z_$][a-zA-Z0-9_$]*)/g

/**
 * Strip fenced code blocks from file contents, replacing them with
 * whitespace of equal length to preserve character offsets.
 */
function stripCodeBlocks(contents) {
  return contents.replace(/^[ \t]*```[\s\S]*?^[ \t]*```/gm, (match) => ' '.repeat(match.length))
}

/**
 * Convert a character offset to a line and column number.
 */
function offsetToPosition(contents, offset) {
  let line = 1
  let column = 1
  for (let i = 0; i < offset && i < contents.length; i++) {
    if (contents[i] === '\n') {
      line++
      column = 1
    } else {
      column++
    }
  }
  return { line, column }
}

async function main() {
  console.log('Checking MDX annotations for unquoted values...')

  const files = readdirp('docs', {
    fileFilter: '*.mdx',
    type: 'files',
  })

  const checkedFiles = []

  for await (const entry of files) {
    const contents = await fs.promises.readFile(entry.fullPath, 'utf8')
    const stripped = stripCodeBlocks(contents)
    const vfile = new VFile({ path: entry.path, value: contents })

    let match
    annotationRegex.lastIndex = 0
    while ((match = annotationRegex.exec(stripped)) !== null) {
      const annotationContent = match[1]
      let bareMatch

      bareIdentifierValueRegex.lastIndex = 0
      while ((bareMatch = bareIdentifierValueRegex.exec(annotationContent)) !== null) {
        const key = bareMatch[1]
        const value = bareMatch[2]
        const pos = offsetToPosition(contents, match.index)
        vfile.message(
          `Unquoted annotation value: \`${key}: ${value}\` should be \`${key}: '${value}'\``,
          pos,
        )
      }
    }

    if (vfile.messages.length > 0) {
      checkedFiles.push(vfile)
    }
  }

  const output = reporter(checkedFiles, { quiet: true })

  if (output) {
    console.log(output)
    process.exitCode = 1
  } else {
    console.log('All MDX annotations have properly quoted values!')
  }
}

main()
