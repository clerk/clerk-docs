import yaml from 'yaml'

export const explicitAssetPathRegex = /\/docs\/images\/[^\s)"'}\]]+/g
export const previewAssetBasePath = '/docs/images/ui-components'
export const previewAssetExtensions = ['svg', 'png', 'jpg', 'jpeg', 'webp', 'gif'] as const

const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---/

function extractFrontmatter(content: string): Record<string, unknown> | undefined {
  const frontmatterMatch = content.match(frontmatterRegex)
  if (!frontmatterMatch) return undefined

  try {
    const parsed = yaml.parse(frontmatterMatch[1])
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    return undefined
  }

  return undefined
}

function normalizeAssetPath(path: string): string {
  return path.replace(/[,;:]+$/, '')
}

function getPreviewSlug(previewSrc: string): string | undefined {
  const normalizedSrc = previewSrc.split(/[?#]/)[0]
  if (!normalizedSrc.startsWith('/')) return undefined

  const slug = normalizedSrc.slice(1)
  if (!slug) return undefined
  if (!/^[a-z0-9-]+$/.test(slug)) return undefined

  return slug
}

export type PreviewIssueReason = 'invalid-src' | 'no-matching-asset'

export interface PreviewResolutionIssue {
  previewSrc: string
  reason: PreviewIssueReason
}

export interface PreviewResolution {
  references: string[]
  issue?: PreviewResolutionIssue
}

export function extractExplicitAssetReferences(content: string): string[] {
  const references = new Set<string>()
  const matches = content.matchAll(explicitAssetPathRegex)

  for (const match of matches) {
    const assetPath = normalizeAssetPath(match[0])
    if (assetPath.startsWith('/docs/images/')) {
      references.add(assetPath)
    }
  }

  return Array.from(references)
}

export function resolvePreviewAssetReferencesWithIssue(
  content: string,
  availableAssets: Set<string>,
): PreviewResolution {
  const frontmatter = extractFrontmatter(content)
  if (!frontmatter) return { references: [] }

  const previewValue = frontmatter.preview
  if (!previewValue || typeof previewValue !== 'object' || Array.isArray(previewValue)) return { references: [] }

  const previewSrc = (previewValue as Record<string, unknown>).src
  if (typeof previewSrc !== 'string') return { references: [] }

  const slug = getPreviewSlug(previewSrc)
  if (!slug) {
    return {
      references: [],
      issue: {
        previewSrc,
        reason: 'invalid-src',
      },
    }
  }

  const references: string[] = []

  for (const extension of previewAssetExtensions) {
    const candidate = `${previewAssetBasePath}/${slug}.${extension}`
    if (availableAssets.has(candidate)) {
      references.push(candidate)
    }
  }

  if (references.length === 0) {
    return {
      references,
      issue: {
        previewSrc,
        reason: 'no-matching-asset',
      },
    }
  }

  return { references }
}

export function resolvePreviewAssetReferences(content: string, availableAssets: Set<string>): string[] {
  return resolvePreviewAssetReferencesWithIssue(content, availableAssets).references
}
