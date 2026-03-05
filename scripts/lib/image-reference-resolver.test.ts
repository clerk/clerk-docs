import { describe, expect, test } from 'vitest'
import {
  extractExplicitAssetReferences,
  resolvePreviewAssetReferences,
  previewAssetBasePath,
  resolvePreviewAssetReferencesWithIssue,
} from './image-reference-resolver'

describe('extractExplicitAssetReferences', () => {
  test('keeps current explicit /docs/images behavior', () => {
    const content = `
![hero](/docs/images/home/what-is-clerk.png)
<img src="/docs/images/logos/prisma.svg", />
`

    expect(extractExplicitAssetReferences(content)).toEqual([
      '/docs/images/home/what-is-clerk.png',
      '/docs/images/logos/prisma.svg',
    ])
  })
})

describe('resolvePreviewAssetReferences', () => {
  test('resolves preview.src to ui-components assets by extension probing', () => {
    const content = `---
title: Example
preview:
  src: '/sign-in'
---
Body
`

    const availableAssets = new Set<string>([
      `${previewAssetBasePath}/sign-in.svg`,
      `${previewAssetBasePath}/sign-in.png`,
    ])

    expect(resolvePreviewAssetReferences(content, availableAssets)).toEqual([
      `${previewAssetBasePath}/sign-in.svg`,
      `${previewAssetBasePath}/sign-in.png`,
    ])
  })

  test('supports png-only preview assets', () => {
    const content = `---
title: Example
preview:
  src: '/task-choose-organization'
---
Body
`

    const availableAssets = new Set<string>([`${previewAssetBasePath}/task-choose-organization.png`])

    expect(resolvePreviewAssetReferences(content, availableAssets)).toEqual([
      `${previewAssetBasePath}/task-choose-organization.png`,
    ])
  })

  test('keeps return signature as references-only', () => {
    const invalidContent = `---
title: Invalid
preview:
  src: '/nested/path'
---
Body
`

    const missingContent = `---
title: Missing
preview:
  src: '/user-profile'
---
Body
`

    const availableAssets = new Set<string>([`${previewAssetBasePath}/sign-in.svg`])

    expect(resolvePreviewAssetReferences(invalidContent, availableAssets)).toEqual([])
    expect(resolvePreviewAssetReferences(missingContent, availableAssets)).toEqual([])
  })
})

describe('resolvePreviewAssetReferencesWithIssue', () => {
  test('returns warning issue when preview.src is invalid', () => {
    const content = `---
title: Invalid
preview:
  src: '/nested/path'
---
Body
`

    const result = resolvePreviewAssetReferencesWithIssue(content, new Set<string>())

    expect(result.references).toEqual([])
    expect(result.issue).toEqual({
      previewSrc: '/nested/path',
      reason: 'invalid-src',
    })
  })

  test('returns warning issue when preview.src does not map to existing image', () => {
    const content = `---
title: Missing
preview:
  src: '/user-profile'
---
Body
`

    const result = resolvePreviewAssetReferencesWithIssue(content, new Set<string>())

    expect(result.references).toEqual([])
    expect(result.issue).toEqual({
      previewSrc: '/user-profile',
      reason: 'no-matching-asset',
    })
  })
})
