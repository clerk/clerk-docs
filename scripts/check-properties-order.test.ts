import { describe, expect, test } from 'vitest'
import { checkPropertiesOrder } from './check-properties-order'

describe('checkPropertiesOrder', () => {
  test('alphabetizes properties regardless of optionality', () => {
    const content = `<Properties>
  - \`zebra?\`

  Optional zebra.

  ---

  - \`beta\`

  Required beta.

  ---

  - \`aardvark?\`

  Optional aardvark.

  ---

  - \`alpha\`

  Required alpha.
</Properties>`

    const result = checkPropertiesOrder(content, 'example.mdx')

    expect(result.file.messages).toHaveLength(1)
    expect(result.appliedFixes).toBe(1)
    expect(result.fixedContent).toBe(`<Properties>
  - \`aardvark?\`

  Optional aardvark.

  ---

  - \`alpha\`

  Required alpha.

  ---

  - \`beta\`

  Required beta.

  ---

  - \`zebra?\`

  Optional zebra.
</Properties>`)
  })

  test('moves an entire property entry without splitting thematic breaks inside code blocks', () => {
    const content = `<Properties>
  - \`zebra?\`

  \`\`\`yaml
  ---
  value: zebra
  \`\`\`

  ---

  - ~~\`alpha\`~~

  Required alpha.
</Properties>`

    const result = checkPropertiesOrder(content, 'example.mdx')

    expect(result.fixedContent).toContain('~~`alpha`~~\n\n  Required alpha.\n\n  ---\n\n  - `zebra?`')
    expect(result.fixedContent).toContain('```yaml\n  ---\n  value: zebra\n  ```')
  })

  test('accepts an already ordered table', () => {
    const content = `<Properties>
  - \`alpha\`

  Required alpha.

  ---

  - \`beta?\`

  Optional beta.
</Properties>`

    const result = checkPropertiesOrder(content, 'example.mdx')

    expect(result.file.messages).toHaveLength(0)
    expect(result.appliedFixes).toBe(0)
    expect(result.fixedContent).toBe(content)
  })

  test('accepts a one-property table', () => {
    const content = `<Properties>
  - \`alpha\`
  - \`string\`

  The only property.
</Properties>`

    const result = checkPropertiesOrder(content, 'example.mdx')

    expect(result.file.messages).toHaveLength(0)
    expect(result.appliedFixes).toBe(0)
    expect(result.fixedContent).toBe(content)
  })

  test('reports a missing separator between property entries', () => {
    const content = `<Properties>
  - \`alpha\`
  - \`string\`

  The first property.

  - \`beta\`
  - \`boolean\`

  The second property.
</Properties>`

    const result = checkPropertiesOrder(content, 'example.mdx')

    expect(result.file.messages.map((message) => message.reason)).toEqual([
      'Separate each Properties entry with a thematic break (---)',
    ])
    expect(result.appliedFixes).toBe(0)
    expect(result.fixedContent).toBe(content)
  })

  test('reports a missing separator before a property without a type', () => {
    const content = `<Properties>
  - \`alpha\`
  - \`string\`

  The first property.

  - \`beta\`

  The second property.
</Properties>`

    const result = checkPropertiesOrder(content, 'example.mdx')

    expect(result.file.messages.map((message) => message.reason)).toEqual([
      'Separate each Properties entry with a thematic break (---)',
    ])
    expect(result.appliedFixes).toBe(0)
    expect(result.fixedContent).toBe(content)
  })

  test('accepts a list of literal examples in a property description', () => {
    const content = `<Properties>
  - \`organizationPatterns\`
  - \`string[]\`

  Common examples:

  - \`["/orgs/:id", "/orgs/:id/(.*)"]\`
  - \`["/app/:any/orgs/:slug", "/app/:any/orgs/:slug/(.*)"]\`
</Properties>`

    const result = checkPropertiesOrder(content, 'example.mdx')

    expect(result.file.messages).toHaveLength(0)
    expect(result.appliedFixes).toBe(0)
    expect(result.fixedContent).toBe(content)
  })

  test.each([
    ['leading', '<Properties>\n  ---\n\n  - `alpha`\n  - `string`\n</Properties>'],
    ['trailing', '<Properties>\n  - `alpha`\n  - `string`\n\n  ---\n</Properties>'],
    [
      'repeated',
      '<Properties>\n  - `alpha`\n  - `string`\n\n  ---\n\n  ---\n\n  - `beta`\n  - `string`\n</Properties>',
    ],
  ])('reports a %s separator', (_, content) => {
    const result = checkPropertiesOrder(content, 'example.mdx')

    expect(result.file.messages.map((message) => message.reason)).toEqual([
      'Remove leading, trailing, or repeated separators from this Properties table',
    ])
    expect(result.appliedFixes).toBe(0)
    expect(result.fixedContent).toBe(content)
  })

  test('reports an entry without a property name list', () => {
    const content = `<Properties>
  - \`zebra\`
  - \`string\`

  ---

  This entry has no property list.

  ---

  - \`alpha\`
  - \`string\`
</Properties>`

    const result = checkPropertiesOrder(content, 'example.mdx')

    expect(result.file.messages.map((message) => message.reason)).toEqual([
      'Each Properties entry must start with a property name list',
    ])
    expect(result.appliedFixes).toBe(0)
    expect(result.fixedContent).toBe(content)
  })

  test('reports a plain-text property name without rewriting the table', () => {
    const content = `<Properties>
  - zebra
  - \`string\`

  Plain-text property name.

  ---

  - \`alpha\`
  - \`string\`

  Code-formatted property name.
</Properties>`

    const result = checkPropertiesOrder(content, 'example.mdx')

    expect(result.file.messages.map((message) => message.reason)).toEqual([
      'Each Properties entry must start with a property name list',
    ])
    expect(result.appliedFixes).toBe(0)
    expect(result.fixedContent).toBe(content)
  })

  test('reports prose mixed with a code-formatted property name without rewriting the table', () => {
    const content = `<Properties>
  - Configure \`zebra\`
  - \`string\`

  Prose before a code-formatted property name.

  ---

  - \`alpha\`
  - \`string\`

  Supported property name.
</Properties>`

    const result = checkPropertiesOrder(content, 'example.mdx')

    expect(result.file.messages.map((message) => message.reason)).toEqual([
      'Each Properties entry must start with a property name list',
    ])
    expect(result.appliedFixes).toBe(0)
    expect(result.fixedContent).toBe(content)
  })

  test('preserves fixes to a nested Properties table when reordering its parent', () => {
    const content = `<Properties>
  - \`zebra\`

  Contains a nested table.

  <Properties>
    - \`delta?\`

    Optional delta.

    ---

    - \`charlie\`

    Required charlie.
  </Properties>

  ---

  - \`alpha\`

  Required alpha.
</Properties>`

    const result = checkPropertiesOrder(content, 'example.mdx')

    expect(result.file.messages).toHaveLength(2)
    expect(result.appliedFixes).toBe(2)
    expect(result.fixedContent).toBe(`<Properties>
  - \`alpha\`

  Required alpha.

  ---

  - \`zebra\`

  Contains a nested table.

  <Properties>
    - \`charlie\`

    Required charlie.

    ---

    - \`delta?\`

    Optional delta.
  </Properties>
</Properties>`)

    const secondPass = checkPropertiesOrder(result.fixedContent, 'example.mdx')

    expect(secondPass.file.messages).toHaveLength(0)
    expect(secondPass.appliedFixes).toBe(0)
    expect(secondPass.fixedContent).toBe(result.fixedContent)
  })

  test('skips a table that opts out with order="manual"', () => {
    const content = `<Properties order="manual">
  - \`zebra\`

  Intentionally first.

  ---

  - \`alpha\`

  Intentionally second.
</Properties>`

    const result = checkPropertiesOrder(content, 'example.mdx')

    expect(result.file.messages).toHaveLength(0)
    expect(result.appliedFixes).toBe(0)
    expect(result.fixedContent).toBe(content)
  })

  test('a fix still leaves an unfixable malformed table flagged on a second pass', () => {
    const content = `<Properties>
  - \`zebra\`

  Z.

  ---

  - \`alpha\`

  A.
</Properties>

<Properties>
  ---

  - \`beta\`

  B.
</Properties>`

    const result = checkPropertiesOrder(content, 'example.mdx')

    // The sortable table is fixed, but the malformed one still reports.
    expect(result.appliedFixes).toBe(1)

    const recheck = checkPropertiesOrder(result.fixedContent, 'example.mdx')

    expect(recheck.appliedFixes).toBe(0)
    expect(recheck.file.messages).toHaveLength(1)
  })
})
