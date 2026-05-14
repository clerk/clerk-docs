import { describe, expect, test } from 'vitest'
import { formatLLMsDocLine, listOutputDocsFiles, normalizeFrontmatterDescription, writeLLMs } from './llms'

describe('formatLLMsDocLine', () => {
  test('appends description after a colon when present', () => {
    expect(
      formatLLMsDocLine({
        title: 'Quickstart',
        url: 'https://example.com/docs/quickstart',
        description: 'Get up and running with Clerk in minutes.',
        path: 'quickstart.mdx',
        content: '',
      }),
    ).toBe('- [Quickstart](https://example.com/docs/quickstart): Get up and running with Clerk in minutes.')
  })

  test('omits the colon when no description is provided', () => {
    expect(
      formatLLMsDocLine({
        title: 'Quickstart',
        url: 'https://example.com/docs/quickstart',
        description: undefined,
        path: 'quickstart.mdx',
        content: '',
      }),
    ).toBe('- [Quickstart](https://example.com/docs/quickstart)')
  })
})

describe('normalizeFrontmatterDescription', () => {
  test('returns trimmed string when description is non-empty', () => {
    expect(normalizeFrontmatterDescription('  Hello world  ')).toBe('Hello world')
  })

  test('collapses internal whitespace and newlines into single spaces', () => {
    expect(normalizeFrontmatterDescription('Line one\nLine two\t  with  spaces')).toBe('Line one Line two with spaces')
  })

  test('returns undefined for empty or whitespace-only strings', () => {
    expect(normalizeFrontmatterDescription('')).toBeUndefined()
    expect(normalizeFrontmatterDescription('   ')).toBeUndefined()
  })

  test('returns undefined for non-string input', () => {
    expect(normalizeFrontmatterDescription(undefined)).toBeUndefined()
    expect(normalizeFrontmatterDescription(null)).toBeUndefined()
    expect(normalizeFrontmatterDescription(123)).toBeUndefined()
  })
})

describe('listOutputDocsFiles', () => {
  test('extracts title and description from frontmatter', () => {
    const docs = new Map<string, string>([
      [
        'quickstart.mdx',
        `---
title: Quickstart
description: Get up and running with Clerk in minutes.
---

Body content`,
      ],
    ])

    const result = listOutputDocsFiles(docs, [{ path: 'quickstart.mdx', url: '/docs/quickstart' }])

    expect(result).toEqual([
      {
        path: 'quickstart.mdx',
        url: '{{SITE_URL}}/docs/quickstart',
        content: docs.get('quickstart.mdx'),
        title: 'Quickstart',
        description: 'Get up and running with Clerk in minutes.',
      },
    ])
  })

  test('leaves description undefined when frontmatter omits it', () => {
    const docs = new Map<string, string>([
      [
        'overview.mdx',
        `---
title: Overview
---

Body`,
      ],
    ])

    const result = listOutputDocsFiles(docs, [{ path: 'overview.mdx', url: '/docs/overview' }])

    expect(result).toEqual([
      {
        path: 'overview.mdx',
        url: '{{SITE_URL}}/docs/overview',
        content: docs.get('overview.mdx'),
        title: 'Overview',
        description: undefined,
      },
    ])
  })

  test('skips entries without a title', () => {
    const docs = new Map<string, string>([
      [
        'no-title.mdx',
        `---
description: A description but no title
---

Body`,
      ],
    ])

    const result = listOutputDocsFiles(docs, [{ path: 'no-title.mdx', url: '/docs/no-title' }])

    expect(result).toEqual([])
  })

  test('filters out paths starting with ~/', () => {
    const docs = new Map<string, string>([
      [
        '~/quick-redirect.mdx',
        `---
title: Quick Redirect
---

Body`,
      ],
    ])

    const result = listOutputDocsFiles(docs, [{ path: '~/quick-redirect.mdx', url: '/docs/quick-redirect' }])

    expect(result).toEqual([])
  })

  test('prefixes the supplied URL with {{SITE_URL}} verbatim, including the docs root', () => {
    const docs = new Map<string, string>([
      [
        'index.mdx',
        `---
title: Welcome
---

Body`,
      ],
      [
        'guides/index.mdx',
        `---
title: Guides
---

Body`,
      ],
    ])

    const result = listOutputDocsFiles(docs, [
      { path: 'index.mdx', url: '/docs' },
      { path: 'guides/index.mdx', url: '/docs/guides' },
    ])

    expect(result.map((entry) => entry.url)).toEqual(['{{SITE_URL}}/docs', '{{SITE_URL}}/docs/guides'])
  })

  test('throws when a doc cannot be found in the docs map', () => {
    const docs = new Map<string, string>()

    expect(() => listOutputDocsFiles(docs, [{ path: 'missing.mdx', url: '/docs/missing' }])).toThrow(
      'Doc not found: missing.mdx',
    )
  })
})

describe('writeLLMs', () => {
  test('renders a markdown list with descriptions when available', async () => {
    const result = await writeLLMs(
      [
        {
          path: 'quickstart.mdx',
          url: '{{SITE_URL}}/docs/quickstart',
          content: '',
          title: 'Quickstart',
          description: 'Get up and running with Clerk in minutes.',
        },
        {
          path: 'overview.mdx',
          url: '{{SITE_URL}}/docs/overview',
          content: '',
          title: 'Overview',
          description: undefined,
        },
      ],
      ['react'],
    )

    expect(result).toBe(
      [
        '# Clerk',
        '',
        '## Docs',
        '',
        '- [Quickstart]({{SITE_URL}}/docs/quickstart): Get up and running with Clerk in minutes.',
        '- [Overview]({{SITE_URL}}/docs/overview)',
      ].join('\n'),
    )
  })
})
