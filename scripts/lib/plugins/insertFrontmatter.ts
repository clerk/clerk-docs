import { map as mdastMap } from 'unist-util-map'
import { VFile } from 'vfile'
import yaml from 'yaml'
import type { Node } from 'unist'

// Authored keys the build consumes and never publishes.
const BUILD_ONLY_KEYS = ['navTitle'] as const

export const insertFrontmatter =
  (newFrontmatter: Record<string, string | undefined>) => () => (tree: Node, vfile: VFile) => {
    return mdastMap(tree, (node) => {
      if (node.type !== 'yaml') return node
      if (!('value' in node)) return node
      if (typeof node.value !== 'string') return node

      const frontmatter = yaml.parse(node.value)
      if (frontmatter !== null && typeof frontmatter === 'object') {
        for (const key of BUILD_ONLY_KEYS) delete frontmatter[key]
      }

      const transformedFrontmatter = { ...frontmatter, ...newFrontmatter }

      node.value = yaml.stringify(transformedFrontmatter).split('\n').slice(0, -1).join('\n')

      return node
    })
  }
