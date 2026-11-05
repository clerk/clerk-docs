import { describe, expect, test } from 'vitest'
import { findUnusedPartials } from './unusedPartials'

describe('findUnusedPartials', () => {
  test('follows global and relative includes through nested partials', () => {
    expect(
      findUnusedPartials([
        { path: 'guides/start.mdx', content: '<Include src="_partials/parent" />' },
        { path: '_partials/parent.mdx', content: '<Include src="../guides/_partials/child.mdx" />' },
        { path: 'guides/_partials/child.mdx', content: 'Used content' },
      ]),
    ).toEqual([])
  })

  test('reports an entire orphaned chain, even when its partials reference each other', () => {
    expect(
      findUnusedPartials([
        { path: 'guides/start.mdx', content: 'A page with no includes' },
        { path: '_partials/orphan.mdx', content: '<Include src="_partials/orphan-child" />' },
        { path: '_partials/orphan-child.mdx', content: 'Unused content' },
      ]),
    ).toEqual(['_partials/orphan-child.mdx', '_partials/orphan.mdx'])
  })

  test('recognizes multiline and inline MDX includes', () => {
    expect(
      findUnusedPartials([
        { path: 'index.mdx', content: 'Text <Include\n  src="./_partials/inline"\n/> more text' },
        { path: '_partials/inline.mdx', content: 'Shared text' },
      ]),
    ).toEqual([])
  })

  test('ignores includes inside code blocks and MDX comments', () => {
    expect(
      findUnusedPartials([
        {
          path: 'index.mdx',
          content: [
            '```mdx',
            '<Include src="_partials/code-example" />',
            '```',
            '{/* <Include src="_partials/commented-out" /> */}',
          ].join('\n'),
        },
        { path: '_partials/code-example.mdx', content: 'Unused content' },
        { path: '_partials/commented-out.mdx', content: 'Unused content' },
      ]),
    ).toEqual(['_partials/code-example.mdx', '_partials/commented-out.mdx'])
  })

  test('does not treat tooltips as docs pages', () => {
    expect(
      findUnusedPartials([
        { path: '_tooltips/term.mdx', content: '<Include src="_partials/orphan" />' },
        { path: '_partials/orphan.mdx', content: 'Unused content' },
      ]),
    ).toEqual(['_partials/orphan.mdx'])
  })
})
