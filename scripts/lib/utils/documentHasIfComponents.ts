// checks if a document has any <If /> components

import { Node } from 'unist'
import { visit as mdastVisit } from 'unist-util-visit'
import { findComponent } from './findComponent'

export const documentHasIfComponents = (tree: Node) => {
  let found = false

  mdastVisit(tree, (node) => {
    const ifSrc = findComponent(node, 'If')

    if (ifSrc !== undefined) {
      found = true
    }
  })

  return found
}
