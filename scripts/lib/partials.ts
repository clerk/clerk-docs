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
import { map as mdastMap } from 'unist-util-map'
import reporter from 'vfile-reporter'
import type { BuildConfig } from './config'
import { errorMessages } from './error-messages'
import { readMarkdownFile } from './io'
import { removeMdxSuffixPlugin } from './plugins/removeMdxSuffixPlugin'
import { getPartialsCache, type Store } from './store'
import { extractComponentPropValueFromNode } from './utils/extractComponentPropValueFromNode'
import { removeMdxSuffix } from './utils/removeMdxSuffix'
import { z } from 'zod'

export const readPartialsFolder = (config: BuildConfig) => async () => {
  return readdirp.promise(config.partialsPath, {
    type: 'files',
    fileFilter: '*.mdx',
  })
}

export const readPartial = (config: BuildConfig) => async (filePath: string) => {
  const fullPath = path.join(config.partialsPath, filePath)

  const [error, content] = await readMarkdownFile(fullPath)

  if (error) {
    throw new Error(errorMessages['partial-read-error'](fullPath), { cause: error })
  }

  let partialNode: Node | null = null

  try {
    const partialContentVFile = await remark()
      .use(remarkFrontmatter)
      .use(remarkMdx)
      .use(() => (tree) => {
        partialNode = tree
      })
      .use(removeMdxSuffixPlugin(config))
      .process({
        path: `docs/_partials/${filePath}`,
        value: content,
      })

    const partialContentReport = reporter([partialContentVFile], { quiet: true })

    if (partialContentReport !== '') {
      console.error(partialContentReport)
      process.exit(1)
    }

    if (partialNode === null) {
      throw new Error(errorMessages['partial-parse-error'](filePath))
    }

    // Now handle nested partials by finding and resolving all Include components
    const hasNestedPartials = (() => {
      let found = false
      mdastVisit(
        partialNode,
        (node) =>
          (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') &&
          'name' in node &&
          node.name === 'Include',
        () => {
          found = true
        },
      )
      return found
    })()

    if (hasNestedPartials) {
      // Collect all nested partial paths that need to be loaded
      const nestedPartialPaths: string[] = []
      mdastVisit(
        partialNode,
        (node) =>
          (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') &&
          'name' in node &&
          node.name === 'Include',
        (node) => {
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

          if (partialSrc && partialSrc.startsWith('_partials/')) {
            const nestedPath = `${removeMdxSuffix(partialSrc).replace('_partials/', '')}.mdx`
            if (!nestedPartialPaths.includes(nestedPath)) {
              nestedPartialPaths.push(nestedPath)
            }
          }
        },
      )

      // Load all nested partials (this may recursively load more)
      const nestedPartials = await Promise.all(
        nestedPartialPaths.map(async (nestedPath) => {
          // Check for circular dependency
          if (nestedPath === filePath) {
            throw new Error(`Circular dependency detected: partial ${filePath} includes itself`)
          }

          const nestedFullPath = path.join(config.partialsPath, nestedPath)
          const [error, nestedContent] = await readMarkdownFile(nestedFullPath)

          if (error) {
            throw new Error(errorMessages['partial-read-error'](nestedFullPath), { cause: error })
          }

          // Recursively read the nested partial (it will handle its own nested includes)
          const nestedPartial = await readPartial(config)(nestedPath)

          return {
            path: nestedPath,
            node: nestedPartial.node,
          }
        }),
      )

      // Now replace all Include nodes with their resolved content
      partialNode = mdastMap(partialNode, (node: Node): Node => {
        const isIncludeComponent =
          (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') &&
          'name' in node &&
          node.name === 'Include'

        if (!isIncludeComponent) {
          return node
        }

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

        if (!partialSrc || !partialSrc.startsWith('_partials/')) {
          return node
        }

        const nestedPath = `${removeMdxSuffix(partialSrc).replace('_partials/', '')}.mdx`
        const nestedPartial = nestedPartials.find((p) => p.path === nestedPath)

        if (!nestedPartial) {
          return node
        }

        // Replace the Include node with the nested partial's content
        return Object.assign({}, nestedPartial.node)
      }) as Node
    }

    return {
      path: filePath,
      content,
      vfile: partialContentVFile,
      node: partialNode as Node,
    }
  } catch (error) {
    console.error(`✗ Error parsing partial: ${filePath}`)
    throw error
  }
}

export const readPartialsMarkdown = (config: BuildConfig, store: Store) => async (paths: string[]) => {
  const read = readPartial(config)
  const partialsCache = getPartialsCache(store)

  return Promise.all(paths.map(async (markdownPath) => partialsCache(markdownPath, () => read(markdownPath))))
}
