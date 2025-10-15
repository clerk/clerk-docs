// responsible for reading in and parsing the partials markdown
// for validation see validators/checkPartials.ts
// partials can now embed other partials recursively
// this also removes the .mdx suffix from the urls in the markdown

import path from 'node:path'
import readdirp from 'readdirp'
import { remark } from 'remark'
import remarkFrontmatter from 'remark-frontmatter'
import remarkMdx from 'remark-mdx'
import type { Node } from 'unist'
import { visit as mdastVisit } from 'unist-util-visit'
import type { BuildConfig } from './config'
import { errorMessages } from './error-messages'
import { readMarkdownFile } from './io'
import { removeMdxSuffixPlugin } from './plugins/removeMdxSuffixPlugin'
import { getPartialsCache, markDocumentDirty, type Store } from './store'
import { extractComponentPropValueFromNode } from './utils/extractComponentPropValueFromNode'
import { removeMdxSuffix } from './utils/removeMdxSuffix'
import { z } from 'zod'

export const readPartialsFolder = (config: BuildConfig) => async () => {
  // Read all partials from the docs directory, including:
  // 1. Global partials in /docs/_partials/
  // 2. Relative partials in any subdirectory's _partials folder (e.g., /docs/billing/_partials/)
  const files = await readdirp.promise(config.docsPath, {
    type: 'files',
    fileFilter: (entry) => {
      // Only include .mdx files that are inside any _partials folder
      // Check for both "/_partials/" (relative partials) and starting with "_partials/" (global partials)
      return (entry.path.includes('/_partials/') || entry.path.startsWith('_partials/')) && entry.path.endsWith('.mdx')
    },
  })

  return files
}

export const readPartial = (config: BuildConfig, store: Store) => async (filePath: string) => {
  const setDirty = markDocumentDirty(store)

  // filePath can be:
  // 1. Global partial: "_partials/billing/enable-billing.mdx" -> /docs/_partials/billing/enable-billing.mdx
  // 2. Relative partial: "billing/_partials/local.mdx" -> /docs/billing/_partials/local.mdx
  const isRelativePartial = filePath.includes('/_partials/') && !filePath.startsWith('_partials/')
  const isGlobalPartial = filePath.startsWith('_partials/')

  if (!isRelativePartial && !isGlobalPartial) {
    throw new Error(`Invalid partial path: ${filePath}. Must start with "_partials/" or contain "/_partials/"`)
  }

  const fullPath = path.join(config.docsPath, filePath)

  const [error, content] = await readMarkdownFile(fullPath)

  if (error) {
    throw new Error(errorMessages['partial-read-error'](fullPath), { cause: error })
  }

  let partialNode: Node | null = null

  try {
    const vfile = await remark()
      .use(remarkFrontmatter)
      .use(remarkMdx)
      .use(() => (tree) => {
        partialNode = tree
      })
      .use(removeMdxSuffixPlugin(config))
      .process({
        path: `docs/${filePath}`,
        value: content,
      })

    if (partialNode === null) {
      throw new Error(errorMessages['partial-parse-error'](filePath))
    }

    // Handle nested partials by finding and replacing Include nodes
    // We need to handle this carefully because we need to splice in multiple children
    let hasIncludes = false
    mdastVisit(partialNode as Node, (node) => {
      if (
        (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') &&
        'name' in node &&
        node.name === 'Include'
      ) {
        hasIncludes = true
      }
    })

    if (hasIncludes) {
      // Collect all Include nodes and their paths
      const includesToReplace: Array<{ src: string; path: string }> = []

      mdastVisit(partialNode as Node, (node) => {
        const isIncludeComponent =
          (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') &&
          'name' in node &&
          node.name === 'Include'

        if (!isIncludeComponent) return

        const partialSrc = extractComponentPropValueFromNode(
          config,
          node,
          undefined,
          'Include',
          'src',
          false,
          'partials',
          filePath,
          z.string(),
        )

        if (!partialSrc) return

        // Resolve the nested partial path
        let nestedPath: string

        if (partialSrc.startsWith('./') || partialSrc.startsWith('../')) {
          const parentDir = path.dirname(filePath)
          nestedPath = path.normalize(path.join(parentDir, `${removeMdxSuffix(partialSrc)}.mdx`)).replace(/\\/g, '/')
        } else if (partialSrc.startsWith('_partials/')) {
          nestedPath = `${removeMdxSuffix(partialSrc)}.mdx`
        } else {
          return
        }

        // Check for circular dependency
        if (nestedPath === filePath) {
          throw new Error(`Circular dependency detected: partial ${filePath} includes itself`)
        }

        includesToReplace.push({ src: partialSrc, path: nestedPath })
      })

      // Load all nested partials
      const uniquePaths = Array.from(new Set(includesToReplace.map((i) => i.path)))
      const partialsCache = getPartialsCache(store)
      const partialsMap = new Map(
        (
          await Promise.all(
            uniquePaths.map(async (nestedPath) => {
              try {
                const nestedPartial = await partialsCache(nestedPath, () => readPartial(config, store)(nestedPath))
                // Track the dependency: when nestedPath changes, the parent partial should be invalidated
                // dirtyDocMap convention for partials:
                //   - Keys: relative paths (e.g., "guides/_partials/child.mdx")
                //   - Values: absolute system paths (e.g., "/var/.../docs/guides/_partials/parent.mdx")
                // nestedPath is already relative: "guides/_partials/child.mdx"
                // fullPath is the absolute system path of the parent
                setDirty(fullPath, nestedPath)
                return [nestedPath, nestedPartial.node] as const
              } catch (error) {
                console.error(`Failed to load nested partial ${nestedPath}:`, error)
                return null
              }
            }),
          )
        ).filter((p) => p !== null),
      )

      // Now replace Include nodes with their content
      // We need to traverse the tree and replace nodes in the children arrays
      const replaceIncludes = (node: any): any => {
        if ('children' in node && Array.isArray(node.children)) {
          const newChildren: Node[] = []

          for (const child of node.children) {
            const isInclude =
              (child.type === 'mdxJsxFlowElement' || child.type === 'mdxJsxTextElement') &&
              'name' in child &&
              child.name === 'Include'

            if (isInclude) {
              const partialSrc = extractComponentPropValueFromNode(
                config,
                child,
                undefined,
                'Include',
                'src',
                false,
                'partials',
                filePath,
                z.string(),
              )

              if (partialSrc) {
                const include = includesToReplace.find((i) => i.src === partialSrc)
                if (include) {
                  const loadedNode = partialsMap.get(include.path)
                  if (loadedNode && loadedNode.type === 'root' && 'children' in loadedNode) {
                    // Splice in the children of the root node
                    newChildren.push(...(loadedNode.children as Node[]))
                    continue
                  }
                }
              }
            }

            // Not an Include or couldn't replace - keep the node and recurse
            newChildren.push(replaceIncludes(child))
          }

          return { ...node, children: newChildren }
        }

        return node
      }

      partialNode = replaceIncludes(partialNode)
    }

    return {
      path: filePath,
      content,
      vfile,
      node: partialNode as Node,
    }
  } catch (error) {
    console.error(`✗ Error parsing partial: ${filePath}`)
    throw error
  }
}

export const readPartialsMarkdown = (config: BuildConfig, store: Store) => async (paths: string[]) => {
  const read = readPartial(config, store)
  const partialsCache = getPartialsCache(store)

  return Promise.all(paths.map(async (markdownPath) => partialsCache(markdownPath, () => read(markdownPath))))
}
