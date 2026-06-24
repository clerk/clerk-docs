// responsible for reading in the markdown files and parsing them
// This is only for parsing in the main docs files, not the partials or typedocs
// - throws a warning if the doc is not in the manifest.json
// - throws a warning if the filename contains characters that will be encoded by the browser
// - extracts the frontmatter and validates it
//    - title is required, will fail
//    - description is required, will warn if missing
//    - sdk is optional, but if present must be a valid sdk
// - validates (but does not embed) the partials and typedocs
// - extracts the headings and validates that they are unique

import { slugifyWithCounter } from './utils/slugify'
import { toString } from 'mdast-util-to-string'
import path from 'node:path'
import { remark } from 'remark'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
import remarkMdx from 'remark-mdx'
import { Node } from 'unist'
import { type BuildConfig } from './config'
import { errorMessages, safeFail, safeMessage, type WarningsSection } from './error-messages'
import { readMarkdownFile, type DocsFile } from './io'
import { checkPartials } from './plugins/checkPartials'
import { checkTypedoc } from './plugins/checkTypedoc'
import { extractFrontmatter, type Frontmatter } from './plugins/extractFrontmatter'
import { Prompt, checkPrompts } from './prompts'
import type { SDK } from './schemas'
import { markDocumentDirty, type Store } from './store'
import { extractComponentPropValueFromNode } from './utils/extractComponentPropValueFromNode'
import { extractHeadingFromHeadingNode } from './utils/extractHeadingFromHeadingNode'
import { findComponent } from './utils/findComponent'
import { removeMdxSuffix } from './utils/removeMdxSuffix'
import { checkTooltips } from './plugins/checkTooltips'
import { z } from 'zod'

const calloutRegex = new RegExp(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION|QUIZ)(\s+[0-9a-z-]+)?\]$/)
const stringSchema = z.string()

type MarkdownResource = { path: string; content: string; node: Node }

const getChildren = (node: Node): Node[] => {
  const children = (node as { children?: unknown }).children
  return Array.isArray(children)
    ? (children.filter((child) => typeof child === 'object' && child !== null) as Node[])
    : []
}

const resolvePartialPath = (file: DocsFile, partialSrc: string) => {
  if (partialSrc.startsWith('./') || partialSrc.startsWith('../')) {
    const docDir = path.dirname(file.filePathInDocsFolder)
    return path.normalize(path.join(docDir, `${removeMdxSuffix(partialSrc)}.mdx`)).replace(/\\/g, '/')
  }

  if (partialSrc.startsWith('_partials/')) {
    return `${removeMdxSuffix(partialSrc)}.mdx`
  }

  return undefined
}

const walkExpandedMarkdownTree = (
  config: BuildConfig,
  file: DocsFile,
  node: Node,
  resources: {
    partialsByPath: ReadonlyMap<string, MarkdownResource>
    tooltipsByPath: ReadonlyMap<string, MarkdownResource>
    typedocsByPath: ReadonlyMap<string, MarkdownResource>
  },
  visitor: (node: Node) => void,
  activeResourceStack = new Set<string>(),
) => {
  const partialSrc = extractComponentPropValueFromNode(
    config,
    node,
    undefined,
    'Include',
    'src',
    false,
    'docs',
    file.filePath,
    stringSchema,
  )

  if (partialSrc !== undefined) {
    const partialPath = resolvePartialPath(file, partialSrc)
    const partial = partialPath ? resources.partialsByPath.get(partialPath) : undefined
    const stackKey = partialPath ? `partial:${partialPath}` : undefined

    if (partial && stackKey && !activeResourceStack.has(stackKey)) {
      activeResourceStack.add(stackKey)
      walkExpandedMarkdownTree(config, file, partial.node, resources, visitor, activeResourceStack)
      activeResourceStack.delete(stackKey)
    }
    return
  }

  const typedocSrc = extractComponentPropValueFromNode(
    config,
    node,
    undefined,
    'Typedoc',
    'src',
    false,
    'docs',
    file.filePath,
    stringSchema,
  )

  if (typedocSrc !== undefined) {
    const typedocPath = `${removeMdxSuffix(typedocSrc)}.mdx`
    const typedoc = resources.typedocsByPath.get(typedocPath)
    const stackKey = `typedoc:${typedocPath}`

    if (typedoc && !activeResourceStack.has(stackKey)) {
      activeResourceStack.add(stackKey)
      walkExpandedMarkdownTree(config, file, typedoc.node, resources, visitor, activeResourceStack)
      activeResourceStack.delete(stackKey)
    }
    return
  }

  const tooltipSrc =
    node.type === 'link' &&
    'url' in node &&
    typeof node.url === 'string' &&
    node.url.startsWith('!') &&
    'children' in node
      ? removeMdxSuffix(node.url.substring(1))
      : undefined

  if (tooltipSrc !== undefined) {
    visitor(node)

    for (const child of getChildren(node)) {
      walkExpandedMarkdownTree(config, file, child, resources, visitor, activeResourceStack)
    }

    const tooltipPath = `_tooltips/${tooltipSrc}.mdx`
    const tooltip = resources.tooltipsByPath.get(tooltipPath)
    const stackKey = `tooltip:${tooltipPath}`

    if (tooltip && !activeResourceStack.has(stackKey)) {
      activeResourceStack.add(stackKey)
      walkExpandedMarkdownTree(config, file, tooltip.node, resources, visitor, activeResourceStack)
      activeResourceStack.delete(stackKey)
    }
    return
  }

  visitor(node)

  for (const child of getChildren(node)) {
    walkExpandedMarkdownTree(config, file, child, resources, visitor, activeResourceStack)
  }
}

const expandedMarkdownTreeHasIfComponents = (
  config: BuildConfig,
  file: DocsFile,
  node: Node,
  resources: {
    partialsByPath: ReadonlyMap<string, MarkdownResource>
    tooltipsByPath: ReadonlyMap<string, MarkdownResource>
    typedocsByPath: ReadonlyMap<string, MarkdownResource>
  },
) => {
  let found = false

  walkExpandedMarkdownTree(config, file, node, resources, (currentNode) => {
    if (found) return
    if (findComponent(currentNode, 'If') !== undefined) {
      found = true
    }
  })

  return found
}

export const parseInMarkdownFile =
  (config: BuildConfig, store: Store) =>
  async (
    file: DocsFile & { content?: string },
    partialsByPath: ReadonlyMap<string, { path: string; content: string; node: Node }>,
    tooltipsByPath: ReadonlyMap<string, { path: string; content: string; node: Node }>,
    typedocsByPath: ReadonlyMap<string, { path: string; content: string; node: Node }>,
    promptsByPath: ReadonlyMap<string, Prompt>,
    inManifest: boolean,
    section: WarningsSection,
  ) => {
    const markDirty = markDocumentDirty(store)
    const [error, fileContent] = file.content ? [null, file.content] : await readMarkdownFile(file.fullFilePath)

    if (error !== null) {
      throw new Error(errorMessages['markdown-read-error'](file.href), {
        cause: error,
      })
    }

    let frontmatter: Frontmatter | undefined = undefined

    const slugify = slugifyWithCounter()
    const headingsHashes = new Set<string>()
    let node: Node | undefined = undefined

    const vfile = await remark()
      .use(remarkFrontmatter)
      .use(remarkMdx)
      .use(remarkGfm)
      .use(() => (tree, vfile) => {
        node = tree

        if (inManifest === false) {
          safeMessage(config, vfile, file.filePath, section, 'doc-not-in-manifest', [])
        }

        if (file.href !== encodeURI(file.href)) {
          safeFail(config, vfile, file.filePath, section, 'invalid-href-encoding', [file.href])
        }
      })
      .use(
        extractFrontmatter(config, file.href, file.filePath, section, (fm) => {
          frontmatter = fm
        }),
      )
      .use(
        checkPartials(config, partialsByPath, file, { reportWarnings: true, embed: false }, (partial) => {
          markDirty(file.filePath, partial)
        }),
      )
      .use(
        checkTooltips(config, tooltipsByPath, file, { reportWarnings: true, embed: false }, (tooltip) => {
          markDirty(file.filePath, tooltip)
        }),
      )
      .use(
        checkTypedoc(config, typedocsByPath, file.filePath, { reportWarnings: true, embed: false }, (typedoc) => {
          markDirty(file.filePath, typedoc)
        }),
      )
      .use(checkPrompts(config, promptsByPath, file, { reportWarnings: true, update: false }))
      .process({
        path: file.relativeFilePath,
        value: fileContent,
      })

    if (node === undefined) {
      throw new Error(errorMessages['doc-parse-failed'](file.href))
    }

    const headingResources = { partialsByPath, tooltipsByPath, typedocsByPath }
    const documentContainsIfComponent = expandedMarkdownTreeHasIfComponents(config, file, node, headingResources)

    walkExpandedMarkdownTree(config, file, node, headingResources, (currentNode) => {
      if (currentNode.type !== 'text') return
      if (!('value' in currentNode)) return
      if (typeof currentNode.value !== 'string') return
      const lines = currentNode.value.split('\n')
      const callout = lines[0]
      if (!calloutRegex.test(callout)) return

      const match = calloutRegex.exec(callout.trim())

      if (match === null) {
        throw new Error(`Invalid callout: ${currentNode}`)
      }

      const id = match[2]?.trim()

      if (id !== undefined) {
        if (documentContainsIfComponent === false && headingsHashes.has(id)) {
          safeMessage(config, vfile, file.filePath, section, 'duplicate-heading-id', [file.href, id])
        }

        headingsHashes.add(id)
      }
    })

    walkExpandedMarkdownTree(config, file, node, headingResources, (currentNode) => {
      if (currentNode.type !== 'heading') return

      const id = extractHeadingFromHeadingNode(currentNode)

      if (id !== undefined) {
        if (documentContainsIfComponent === false && headingsHashes.has(id)) {
          safeMessage(config, vfile, file.filePath, section, 'duplicate-heading-id', [file.href, id])
        }

        headingsHashes.add(id)
      } else {
        const slug = slugify(toString(currentNode).trim())

        if (documentContainsIfComponent === false && headingsHashes.has(slug)) {
          safeMessage(config, vfile, file.filePath, section, 'duplicate-heading-id', [file.href, slug])
        }

        headingsHashes.add(slug)
      }
    })

    if (frontmatter === undefined) {
      throw new Error(errorMessages['frontmatter-parse-failed'](file.href))
    }

    return {
      file,
      sdk: (frontmatter as Frontmatter).sdk,
      vfile,
      headingsHashes,
      frontmatter: frontmatter as Frontmatter,
      node: node as Node,
      fileContent,
      distinctSDKVariants: null as SDK[] | null,
    }
  }
