import { describe, expect, test } from 'vitest'
import { checkRelativeLinks } from './check-relative-links'

describe('checkRelativeLinks', () => {
  test('reports and fixes absolute same-origin links while preserving bare autolinks', () => {
    const content = [
      '[Support](https://clerk.com/contact/support "https://clerk.com/contact/support")',
      '[Docs](https://clerk.com/docs?source=test#overview)',
      'https://clerk.com/contact/support',
    ].join('\n')
    const result = checkRelativeLinks(content, 'example.mdx')

    expect(result.file.messages).toHaveLength(3)
    expect(result.fixedContent).toBe(
      [
        '[Support](/contact/support "https://clerk.com/contact/support")',
        '[Docs](/docs?source=test#overview)',
        '[/contact/support](/contact/support)',
      ].join('\n'),
    )
  })

  test('reports and fixes reference-style same-origin links', () => {
    const content = ['[Support][support]', '', '[support]: https://clerk.com/contact/support'].join('\n')
    const result = checkRelativeLinks(content, 'example.mdx')

    expect(result.file.messages).toHaveLength(1)
    expect(result.fixedContent).toBe(['[Support][support]', '', '[support]: /contact/support'].join('\n'))
  })

  test('does not rewrite a network-path reference into an off-origin link', () => {
    const content = '[Attacker](https://clerk.com//attacker.example)'
    const result = checkRelativeLinks(content, 'example.mdx')

    expect(result.file.messages).toHaveLength(0)
    expect(result.fixedContent).toBe(content)
  })

  test('ignores code blocks, external origins, and the /discord redirect exception', () => {
    const content = `
[Discord](https://clerk.com/discord)
[External](https://example.com/docs)

\`\`\`ts
// https://clerk.com/docs/reference/backend/overview
\`\`\`
`.trim()
    const result = checkRelativeLinks(content, 'example.mdx')

    expect(result.file.messages).toHaveLength(0)
    expect(result.fixedContent).toBe(content)
  })

  test('fixes Clerk-owned paths that are not the /discord exception', () => {
    const content = ['[Glossary term](https://clerk.com/glossary#session)', '[Terms](https://clerk.com/terms)'].join(
      '\n',
    )
    const result = checkRelativeLinks(content, 'example.mdx')

    expect(result.file.messages).toHaveLength(2)
    expect(result.fixedContent).toBe(['[Glossary term](/glossary#session)', '[Terms](/terms)'].join('\n'))
  })

  test('reports but does not corrupt a link whose title repeats an entity-encoded destination', () => {
    // remark decodes `&amp;` on the node URL, so the absolute URL does not appear
    // verbatim at the destination. The fix must not fall through to the matching
    // title and rewrite that instead.
    const content = '[x](https://clerk.com/a?b=1&amp;c=2 "https://clerk.com/a?b=1&c=2")'
    const result = checkRelativeLinks(content, 'example.mdx')

    expect(result.file.messages).toHaveLength(1)
    expect(result.appliedFixes).toBe(0)
    expect(result.fixedContent).toBe(content)
  })

  test('reports but does not corrupt a reference definition whose title repeats an entity-encoded destination', () => {
    // Same collision as above, but on a definition — the destination anchors after
    // `]:`, never the identifier or the title.
    const content = ['[x][id]', '', '[id]: https://clerk.com/a?b=1&amp;c=2 "https://clerk.com/a?b=1&c=2"'].join('\n')
    const result = checkRelativeLinks(content, 'example.mdx')

    expect(result.file.messages).toHaveLength(1)
    expect(result.appliedFixes).toBe(0)
    expect(result.fixedContent).toBe(content)
  })

  test('escapes special characters when rewriting a bare autolink into a Markdown link', () => {
    // A bare relative path with parentheses would break if interpolated directly;
    // serializing through the processor escapes it so it stays a single link.
    const content = 'https://clerk.com/a(b)c'
    const result = checkRelativeLinks(content, 'example.mdx')

    expect(result.file.messages).toHaveLength(1)
    expect(result.fixedContent).toBe('[/a(b)c](/a\\(b\\)c)')
  })
})
