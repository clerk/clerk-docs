import fs from 'node:fs/promises'
import readdirp from 'readdirp'
import { remark } from 'remark'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
import remarkMdx from 'remark-mdx'
import type { Node } from 'unist'
import { VFile } from 'vfile'
import reporter from 'vfile-reporter'
import { errorMessages } from './lib/error-messages'
import { findAbsoluteClerkLinks } from './lib/plugins/validateLinks'

const fix = process.argv.includes('--fix')
const processor = remark().use(remarkFrontmatter).use(remarkMdx).use(remarkGfm)

// Build an explicit Markdown link through the processor so any special characters
// in the path (parens, brackets, entities) are escaped correctly, rather than
// interpolating them into `[url](url)` by hand.
function serializeRelativeLink(url: string): string {
  const tree = {
    type: 'root',
    children: [{ type: 'paragraph', children: [{ type: 'link', url, children: [{ type: 'text', value: url }] }] }],
  } as unknown as Node
  return processor.stringify(tree).trim()
}

export function checkRelativeLinks(
  content: string,
  path?: string,
): { file: VFile; fixedContent: string; appliedFixes: number } {
  const file = new VFile({ path, value: content })
  const tree = processor.parse(file) as Node
  const links = findAbsoluteClerkLinks(tree)

  for (const link of links) {
    file.message(errorMessages['link-same-origin-must-be-relative'](link.absoluteUrl, link.relativeUrl), link.position)
  }

  const replacements = links.flatMap((link) => {
    const start = link.position?.start.offset
    const end = link.position?.end.offset
    if (start === undefined || end === undefined) return []

    const linkSource = content.slice(start, end)

    // A bare autolink is the whole node: GFM renders the URL as a link, but a bare
    // relative path would be plain text. Serialize an explicit Markdown link so the
    // autofix keeps it clickable.
    if (link.nodeType === 'link' && linkSource === link.absoluteUrl) {
      return [{ start, end, value: serializeRelativeLink(link.relativeUrl) }]
    }

    // Otherwise replace only the destination URL in place. Anchor to the structural
    // marker for the node type — `](` for an inline link, `]:` for a reference
    // definition — so a label, identifier, or title that repeats the URL is never
    // rewritten instead of the destination. When the source URL is entity/escape-
    // encoded it won't match the parser-decoded value verbatim; leaving it unreplaced
    // reports the link without corrupting the source.
    const markerRegex = link.nodeType === 'definition' ? /\]\s*:\s*<?/ : /\]\s*\(\s*<?/
    const marker = markerRegex.exec(linkSource)
    if (!marker) return []

    const destinationStart = (marker.index ?? 0) + marker[0].length
    if (!linkSource.startsWith(link.absoluteUrl, destinationStart)) return []

    return [
      {
        start: start + destinationStart,
        end: start + destinationStart + link.absoluteUrl.length,
        value: link.relativeUrl,
      },
    ]
  })

  const fixedContent = replacements
    .slice()
    .sort((a, b) => b.start - a.start)
    .reduce((result, replacement) => {
      return result.slice(0, replacement.start) + replacement.value + result.slice(replacement.end)
    }, content)

  return { file, fixedContent, appliedFixes: replacements.length }
}

async function main() {
  const files = readdirp('docs', { fileFilter: '*.mdx', type: 'files' })
  const checkedFiles: VFile[] = []
  let reportedLinks = 0
  let fixedLinks = 0

  for await (const entry of files) {
    const content = await fs.readFile(entry.fullPath, 'utf8')
    const result = checkRelativeLinks(content, entry.path)

    if (result.file.messages.length === 0) continue

    checkedFiles.push(result.file)
    reportedLinks += result.file.messages.length
    fixedLinks += result.appliedFixes

    if (fix) {
      await fs.writeFile(entry.fullPath, result.fixedContent, 'utf8')
    }
  }

  const output = reporter(checkedFiles, { quiet: true })
  const unfixableLinks = reportedLinks - fixedLinks

  if (fix && reportedLinks > 0) {
    console.log(`Fixed ${fixedLinks} same-origin Clerk link(s)`)
    if (unfixableLinks > 0) {
      console.log(output)
      console.log(
        `${unfixableLinks} same-origin Clerk link(s) could not be rewritten automatically; fix them by hand.\n`,
      )
      process.exitCode = 1
    }
  } else if (output) {
    console.log(output)
    console.log('Run with --fix to rewrite same-origin Clerk links as relative links.\n')
    process.exitCode = 1
  } else {
    console.log('No absolute same-origin Clerk links found')
  }
}

if (require.main === module) {
  main()
}
