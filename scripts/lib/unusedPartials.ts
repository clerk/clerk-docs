import { remark } from 'remark'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
import remarkMdx from 'remark-mdx'
import { visit } from 'unist-util-visit'
import { resolvePartialPath } from './utils/resolvePartialPath'

type MdxFile = { path: string; content: string }

function isPartial(filePath: string): boolean {
  return filePath.startsWith('_partials/') || filePath.includes('/_partials/')
}

function includedPartials(file: MdxFile): string[] {
  const includes: string[] = []
  const tree = remark().use(remarkFrontmatter).use(remarkMdx).use(remarkGfm).parse(file.content)

  visit(tree, ['mdxJsxFlowElement', 'mdxJsxTextElement'], (node) => {
    if (node.name !== 'Include') return

    const src = node.attributes.find((attribute) => attribute.type === 'mdxJsxAttribute' && attribute.name === 'src')
    if (src?.type !== 'mdxJsxAttribute' || typeof src.value !== 'string') return

    const target = resolvePartialPath(file.path, src.value)
    if (target !== undefined) includes.push(target)
  })

  return includes
}

export function findUnusedPartials(files: MdxFile[]): string[] {
  const partials = new Set(files.filter((file) => isPartial(file.path)).map((file) => file.path))
  const references = new Map(files.map((file) => [file.path, includedPartials(file)]))
  const used = new Set<string>()
  const pending = files
    .filter((file) => !isPartial(file.path) && !file.path.startsWith('_tooltips/'))
    .flatMap((file) => references.get(file.path) ?? [])

  while (pending.length > 0) {
    const partial = pending.pop()!
    if (!partials.has(partial) || used.has(partial)) continue

    used.add(partial)
    pending.push(...(references.get(partial) ?? []))
  }

  return [...partials].filter((partial) => !used.has(partial)).sort()
}
