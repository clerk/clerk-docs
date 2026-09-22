import fs from 'node:fs/promises'
import readdirp from 'readdirp'
import { remark } from 'remark'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
import remarkMdx from 'remark-mdx'
import { toString } from 'mdast-util-to-string'
import type { List, PhrasingContent, Root, RootContent } from 'mdast'
import type { Position } from 'unist'
import { visit } from 'unist-util-visit'
import { VFile } from 'vfile'
import reporter from 'vfile-reporter'

const fix = process.argv.includes('--fix')
const processor = remark().use(remarkFrontmatter).use(remarkMdx).use(remarkGfm)

type PropertyGroup = {
  name: string
  start: number
  end: number
}

type Replacement = {
  start: number
  end: number
  firstPropertyStart: number
  lastPropertyEnd: number
  propertyRanges: Array<{ start: number; end: number }>
  separators: string[]
}

type PropertiesAnalysis = {
  error?: string
  replacement?: Replacement
}

type MdxJsxAttribute = {
  type: 'mdxJsxAttribute'
  name: string
  value: string | null | { type: string }
}

type PropertiesNode = {
  type: 'mdxJsxFlowElement'
  name: string | null
  attributes?: Array<MdxJsxAttribute | { type: string }>
  children: RootContent[]
  position?: Position
}

// Tables whose order is meaningful (e.g. rate-limit references ordered by
// importance, not name) opt out with `<Properties order="manual">`. The checker
// skips them entirely — neither sorted nor validated for structure.
function hasManualOrder(node: PropertiesNode): boolean {
  return (node.attributes ?? []).some(
    (attribute): attribute is MdxJsxAttribute =>
      attribute.type === 'mdxJsxAttribute' &&
      (attribute as MdxJsxAttribute).name === 'order' &&
      (attribute as MdxJsxAttribute).value === 'manual',
  )
}

function isCodeNameNode(node: PhrasingContent): boolean {
  if (node.type === 'inlineCode') return true
  if (node.type !== 'delete' && node.type !== 'link') return false

  return node.children.length === 1 && node.children[0].type === 'inlineCode'
}

function propertyName(list: List | undefined): string | undefined {
  const firstItem = list?.children[0]
  const nameParagraph = firstItem?.children[0]
  if (nameParagraph?.type !== 'paragraph' || !isCodeNameNode(nameParagraph.children[0])) return

  const hasUnsupportedContent = nameParagraph.children.slice(1).some((child) => {
    if (isCodeNameNode(child)) return false
    return child.type !== 'text' || !/^(?:,\s*|\s+\((?:required|optional)\))$/.test(child.value)
  })
  if (hasUnsupportedContent) return

  const name = toString(firstItem).trim()
  return name || undefined
}

function isPropertyShapedList(node: RootContent): node is List {
  if (node.type !== 'list' || node.children.length === 0 || node.children.length > 2) return false

  const nameParagraph = node.children[0]?.children[0]
  if (nameParagraph?.type !== 'paragraph' || nameParagraph.children.length !== 1) return false

  const name = propertyName(node)
  if (!name || !/^[A-Za-z_$][\w$.[\]()-]*(?: \((?:required|optional)\))?\??$/.test(name)) return false

  const nameNode = nameParagraph.children[0]
  if (nameNode.type === 'inlineCode') return true
  if (nameNode.type !== 'delete' && nameNode.type !== 'link') return false

  return nameNode.children.length === 1 && nameNode.children[0].type === 'inlineCode'
}

function alphabeticalName(name: string): string {
  return name.replaceAll('?', '').toLocaleLowerCase('en')
}

function compareProperties(a: PropertyGroup, b: PropertyGroup): number {
  return alphabeticalName(a.name).localeCompare(alphabeticalName(b.name), 'en')
}

function analyzeProperties(content: string, node: PropertiesNode): PropertiesAnalysis {
  const nodeStart = node.position?.start.offset
  const nodeEnd = node.position?.end.offset
  if (nodeStart === undefined || nodeEnd === undefined) return {}

  const openingTagEnd = content.indexOf('>', nodeStart)
  const closingTagStart = content.lastIndexOf('</Properties>', nodeEnd)
  if (openingTagEnd === -1 || closingTagStart === -1) return {}

  const childGroups: RootContent[][] = [[]]
  for (const child of node.children) {
    if (child.type === 'thematicBreak') {
      childGroups.push([])
    } else {
      childGroups.at(-1)!.push(child)
    }
  }

  if (childGroups.some((group) => group.length === 0)) {
    return { error: 'Remove leading, trailing, or repeated separators from this Properties table' }
  }

  const groups = childGroups.map((children): PropertyGroup | undefined => {
    const lists = children.filter((child): child is List => child.type === 'list')
    if (lists.slice(1).some(isPropertyShapedList)) return

    const name = propertyName(lists[0])
    const start = children[0]?.position?.start.offset
    const end = children.at(-1)?.position?.end.offset
    if (!name || start === undefined || end === undefined) return

    return {
      name,
      start,
      end,
    }
  })

  if (groups.some((group) => !group)) {
    const hasMultipleProperties = childGroups.some((children) =>
      children
        .filter((child): child is List => child.type === 'list')
        .slice(1)
        .some(isPropertyShapedList),
    )

    return {
      error: hasMultipleProperties
        ? 'Separate each Properties entry with a thematic break (---)'
        : 'Each Properties entry must start with a property name list',
    }
  }

  const properties = groups as PropertyGroup[]
  const sorted = properties.slice().sort(compareProperties)
  if (properties.every((property, index) => property === sorted[index])) return {}

  const firstStart = childGroups[0][0].position!.start.offset!
  const lastEnd = childGroups.at(-1)!.at(-1)!.position!.end.offset!
  const separators: string[] = []

  for (let index = 0; index < childGroups.length - 1; index++) {
    const currentEnd = childGroups[index].at(-1)!.position!.end.offset!
    const nextStart = childGroups[index + 1][0].position!.start.offset!
    separators.push(content.slice(currentEnd, nextStart))
  }

  return {
    replacement: {
      start: openingTagEnd + 1,
      end: closingTagStart,
      firstPropertyStart: firstStart,
      lastPropertyEnd: lastEnd,
      propertyRanges: sorted.map(({ start, end }) => ({ start, end })),
      separators,
    },
  }
}

export function checkPropertiesOrder(
  content: string,
  path?: string,
): { file: VFile; fixedContent: string; appliedFixes: number } {
  const file = new VFile({ path, value: content })
  const tree = processor.parse(file) as Root
  const replacements: Replacement[] = []

  visit(tree, 'mdxJsxFlowElement', (node) => {
    if (node.name !== 'Properties') return
    if (hasManualOrder(node as PropertiesNode)) return
    const { error, replacement } = analyzeProperties(content, node as PropertiesNode)
    if (error) {
      file.message(error, node)
      return
    }
    if (!replacement) return

    file.message('Order Properties entries alphabetically by property name', node)
    replacements.push(replacement)
  })

  const fixedContent = replacements
    .slice()
    .sort((a, b) => b.start - a.start)
    .reduce((result, replacement) => {
      const reordered = replacement.propertyRanges.reduce((value, property, index) => {
        const source = result.slice(property.start, property.end)
        if (index === 0) return source
        return value + replacement.separators[index - 1] + source
      }, '')
      const value =
        result.slice(replacement.start, replacement.firstPropertyStart) +
        reordered +
        result.slice(replacement.lastPropertyEnd, replacement.end)

      return result.slice(0, replacement.start) + value + result.slice(replacement.end)
    }, content)

  return { file, fixedContent, appliedFixes: replacements.length }
}

async function main() {
  const files = readdirp('docs', { fileFilter: '*.mdx', type: 'files' })
  const checkedFiles: VFile[] = []
  let fixedTables = 0

  for await (const entry of files) {
    const content = await fs.readFile(entry.fullPath, 'utf8')
    const result = checkPropertiesOrder(content, entry.path)
    if (result.file.messages.length === 0) continue

    if (!fix) {
      checkedFiles.push(result.file)
      continue
    }

    fixedTables += result.appliedFixes
    if (result.appliedFixes > 0) {
      await fs.writeFile(entry.fullPath, result.fixedContent, 'utf8')
    }

    // Re-check the fixed content: malformed tables (bad separators, a missing
    // property name) can't be reordered automatically, so anything still
    // flagged here is an error --fix couldn't resolve.
    const recheck = checkPropertiesOrder(result.fixedContent, entry.path)
    if (recheck.file.messages.length > 0) {
      checkedFiles.push(recheck.file)
    }
  }

  const output = reporter(checkedFiles, { quiet: true })

  if (fix && fixedTables > 0) {
    console.log(`Fixed ${fixedTables} Properties table(s)`)
  }

  if (output) {
    console.log(output)
    console.log(
      fix ? 'The above could not be fixed automatically.\n' : 'Run with --fix to reorder Properties tables.\n',
    )
    process.exitCode = 1
  } else if (fixedTables === 0) {
    console.log('All Properties tables use the expected order')
  }
}

if (require.main === module) {
  main()
}
