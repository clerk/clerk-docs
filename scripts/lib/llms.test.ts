import { describe, expect, test } from 'vitest'
import {
  assertConsistentReferenceUrlShapes,
  emitSdkFirstReferenceUrls,
  formatLLMsDocLine,
  listOutputDocsFiles,
  normalizeFrontmatterDescription,
  writeLLMs,
  writeLLMsFull,
} from './llms'

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
        url: '{{SITE_URL}}/docs/quickstart.md',
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
        url: '{{SITE_URL}}/docs/overview.md',
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

    expect(result.map((entry) => entry.url)).toEqual(['{{SITE_URL}}/docs.md', '{{SITE_URL}}/docs/guides.md'])
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

  test('emits SDK-specific references in the same SDK-first shape as shared references', async () => {
    const result = await writeLLMs(
      [
        {
          path: 'nextjs/reference/hooks/use-auth.mdx',
          url: '{{SITE_URL}}/docs/nextjs/reference/hooks/use-auth.md',
          content: '',
          title: 'useAuth',
          description: undefined,
        },
        {
          path: 'reference/nextjs/clerk-middleware.mdx',
          url: '{{SITE_URL}}/docs/reference/nextjs/clerk-middleware.md',
          content: '',
          title: 'clerkMiddleware',
          description: undefined,
        },
      ],
      ['nextjs'],
    )

    expect(result).toContain('/docs/nextjs/reference/hooks/use-auth.md')
    expect(result).toContain('/docs/nextjs/reference/clerk-middleware.md')
    expect(result).not.toContain('/docs/reference/nextjs/')
  })

  test('normalizes aliased reference path segments to the public SDK key', async () => {
    const result = await writeLLMs(
      [
        {
          path: 'reference/javascript/overview.mdx',
          url: '{{SITE_URL}}/docs/reference/javascript/overview.md',
          content: '',
          title: 'JavaScript Overview',
          description: undefined,
        },
      ],
      ['js-frontend'],
    )

    expect(result).toContain('/docs/js-frontend/reference/overview.md')
    expect(result).not.toContain('/docs/reference/javascript/')
  })
})

describe('assertConsistentReferenceUrlShapes', () => {
  test('rejects any non-canonical reference-first URL left in a generated file', () => {
    const content = 'https://clerk.com/docs/reference/nextjs/clerk-middleware.md'

    expect(() => assertConsistentReferenceUrlShapes(content, ['nextjs'])).toThrow(
      'Generated LLM file contains a non-canonical reference-first URL for nextjs',
    )
  })

  test('ignores intentionally reference-first canonical frontmatter', () => {
    const content = [
      'canonical: /docs/reference/nextjs/overview',
      'https://clerk.com/docs/nextjs/reference/clerk-middleware.md',
    ].join('\n')

    expect(() => assertConsistentReferenceUrlShapes(content, ['nextjs'])).not.toThrow()
  })

  test('does not treat a third-party reference URL as a mixed shape', () => {
    const content = [
      'https://clerk.com/docs/js-frontend/reference/overview.md',
      'https://supabase.com/docs/reference/javascript/initializing',
    ].join('\n')

    expect(() => assertConsistentReferenceUrlShapes(content, ['js-frontend'])).not.toThrow()
  })

  test('does not treat a reference-first path in a third-party query value as a Clerk link', () => {
    const content = [
      'https://clerk.com/docs/nextjs/reference/clerk-middleware.md',
      'https://example.test/?next=/docs/reference/nextjs/overview',
    ].join('\n')

    expect(() => assertConsistentReferenceUrlShapes(content, ['nextjs'])).not.toThrow()
  })
})

describe('emitSdkFirstReferenceUrls', () => {
  test('normalizes every reference link, including aliased SDK path segments', () => {
    const content = [
      '[Next.js](/docs/reference/nextjs/overview)',
      '<SDKLink href="/docs/reference/javascript/overview">JavaScript</SDKLink>',
    ].join('\n')

    expect(emitSdkFirstReferenceUrls(content, ['nextjs', 'js-frontend'])).toBe(
      [
        '[Next.js](/docs/nextjs/reference/overview)',
        '<SDKLink href="/docs/js-frontend/reference/overview">JavaScript</SDKLink>',
      ].join('\n'),
    )
  })

  test('normalizes absolute Clerk hosts (clerk.com and clerkstage.dev previews) but leaves look-alike hosts untouched', () => {
    const content = [
      'https://clerk.com/docs/reference/javascript/overview',
      'https://clerk-docs-git-my-branch.clerkstage.dev/docs/reference/javascript/overview',
      'https://supabase.com/docs/reference/javascript/initializing',
      'https://clerk.com.evil.dev/docs/reference/javascript/phishing',
    ].join('\n')

    expect(emitSdkFirstReferenceUrls(content, ['js-frontend'])).toBe(
      [
        'https://clerk.com/docs/js-frontend/reference/overview',
        'https://clerk-docs-git-my-branch.clerkstage.dev/docs/js-frontend/reference/overview',
        'https://supabase.com/docs/reference/javascript/initializing',
        'https://clerk.com.evil.dev/docs/reference/javascript/phishing',
      ].join('\n'),
    )
  })

  test('does not rewrite a reference-first path embedded in a third-party query or deeper path', () => {
    const content = [
      'https://example.test/login?next=/docs/reference/javascript/overview',
      'https://cdn.example.test/proxy//docs/reference/javascript/overview',
    ].join('\n')

    // Left byte-for-byte unchanged — the boundary before `/docs` (`=`, `/`) means it isn't a Clerk link.
    expect(emitSdkFirstReferenceUrls(content, ['js-frontend'])).toBe(content)
  })
})

describe('writeLLMsFull', () => {
  test('normalizes reference links while preserving canonical frontmatter', async () => {
    const result = await writeLLMsFull(
      [
        {
          path: 'reference/nextjs/overview.mdx',
          url: '{{SITE_URL}}/docs/reference/nextjs/overview.md',
          content: `---
canonical: /docs/reference/nextjs/overview
---

[Middleware](/docs/reference/nextjs/clerk-middleware)`,
          title: 'Next.js Overview',
          description: undefined,
        },
      ],
      ['nextjs'],
    )

    expect(result).toContain('canonical: /docs/reference/nextjs/overview')
    expect(result).not.toContain('canonical: /docs/nextjs/reference/overview')
    expect(result).toContain('](/docs/nextjs/reference/clerk-middleware)')
    expect(result).not.toContain('](/docs/reference/nextjs/clerk-middleware)')
  })
})
