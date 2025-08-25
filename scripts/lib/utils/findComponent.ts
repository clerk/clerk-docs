// hunts a markdown tree for a specific component

import type { Node } from 'unist'

export const findComponent = (node: Node, componentName: string) => {
  // Check if it's an MDX component
  if (node.type !== 'mdxJsxFlowElement' && node.type !== 'mdxJsxTextElement') {
    return undefined
  }

  // Check if it's the correct component
  if (!('name' in node)) return undefined
  if (node.name !== componentName) return undefined

  return node
}
