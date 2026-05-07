import { describe, expect, test } from 'vitest'
import { buildLLMsDocsUrl } from './llms'

const baseDocsLink = '/docs/'

describe('buildLLMsDocsUrl', () => {
  test('appends .md to top-level guide paths', () => {
    expect(buildLLMsDocsUrl('cli.mdx', baseDocsLink)).toBe('{{SITE_URL}}/docs/cli.md')
  })

  test('appends .md to nested guide paths', () => {
    expect(buildLLMsDocsUrl('nextjs/getting-started/quickstart.mdx', baseDocsLink)).toBe(
      '{{SITE_URL}}/docs/nextjs/getting-started/quickstart.md',
    )
  })

  test('keeps root index as /docs/index.md', () => {
    expect(buildLLMsDocsUrl('index.mdx', baseDocsLink)).toBe('{{SITE_URL}}/docs/index.md')
  })

  test('collapses nested /index segments to the parent slug', () => {
    expect(buildLLMsDocsUrl('guides/index.mdx', baseDocsLink)).toBe('{{SITE_URL}}/docs/guides.md')
  })

  test('handles deeply nested /index paths', () => {
    expect(buildLLMsDocsUrl('nextjs/guides/billing/index.mdx', baseDocsLink)).toBe(
      '{{SITE_URL}}/docs/nextjs/guides/billing.md',
    )
  })

  test('respects a custom baseDocsLink', () => {
    expect(buildLLMsDocsUrl('cli.mdx', '/docs/pr/feature-branch/')).toBe('{{SITE_URL}}/docs/pr/feature-branch/cli.md')
  })

  test('does not strip a non-trailing index segment', () => {
    expect(buildLLMsDocsUrl('index/getting-started.mdx', baseDocsLink)).toBe(
      '{{SITE_URL}}/docs/index/getting-started.md',
    )
  })
})
