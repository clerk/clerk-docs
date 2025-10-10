import type { SDK } from './schemas'
import type { DocsFile } from './io'
import type { Frontmatter } from './plugins/extractFrontmatter'

type ExtractMetadataOptions = {
  frontmatter: Frontmatter
  file: DocsFile
  lastUpdated?: Date
  distinctSDKVariants?: SDK[] | null
  foundPartials: Set<string>
  foundTooltips: Set<string>
  foundTypedocs: Set<string>
  foundLinks: Set<string>
  backlinks: string[]
  headingsHashes: Set<string>
  inManifest: boolean
  sdkScoped?: boolean
  canonical?: string
  availableSdks?: SDK[]
  notAvailableSdks?: SDK[]
  activeSdk?: SDK
  buildTimestamp: string
  processingTimeMs: number
  wasCached: boolean
  cacheKey: string
  warnings: string[]
}

/**
 * Extracts comprehensive metadata from a document for JSON output
 */
export function extractDocumentMetadata(options: ExtractMetadataOptions) {
  return {
    // Frontmatter
    title: options.frontmatter.title,
    description: options.frontmatter.description,
    sdk: options.frontmatter.sdk,

    // File paths
    filePath: options.file.filePath,
    filePathInDocsFolder: options.file.filePathInDocsFolder,
    relativeFilePath: options.file.relativeFilePath,
    fullFilePath: options.file.fullFilePath,

    // URLs
    href: options.file.href,
    relativeHref: options.file.relativeHref,
    canonical: options.canonical,

    // Git metadata
    lastUpdated: options.lastUpdated?.toISOString(),

    // SDK scoping
    distinctSDKVariants: options.distinctSDKVariants ?? undefined,
    availableSdks: options.availableSdks,
    notAvailableSdks: options.notAvailableSdks,
    activeSdk: options.activeSdk,

    // Content references
    partials: Array.from(options.foundPartials).sort(),
    tooltips: Array.from(options.foundTooltips).sort(),
    typedocs: Array.from(options.foundTypedocs).sort(),
    links: Array.from(options.foundLinks).sort(),
    backlinks: options.backlinks.sort(),

    // Manifest info
    inManifest: options.inManifest,

    // Document properties
    headings: Array.from(options.headingsHashes).sort(),
    sdkScoped: options.sdkScoped,

    // Build/Debug info
    buildTimestamp: options.buildTimestamp,
    processingTimeMs: options.processingTimeMs,
    wasCached: options.wasCached,
    cacheKey: options.cacheKey,
    warnings: options.warnings,
  }
}
