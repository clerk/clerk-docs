import { map as mdastMap } from 'unist-util-map'
import { VFile } from 'vfile'
import yaml from 'yaml'
import type { Node } from 'unist'

export const insertFrontmatter =
  (newFrontmatter: Record<string, string | undefined>) => () => (tree: Node, vfile: VFile) => {
    return mdastMap(tree, (node) => {
      if (node.type !== 'yaml') return node
      if (!('value' in node)) return node
      if (typeof node.value !== 'string') return node

      const frontmatter = yaml.parse(node.value)

      const transformedFrontmatter = { ...frontmatter, ...newFrontmatter }

      node.value = yaml.stringify(transformedFrontmatter).split('\n').slice(0, -1).join('\n')

      return node
    })
  }
