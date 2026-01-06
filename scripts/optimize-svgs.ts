import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { optimize, Config } from 'svgo'
import readdirp from 'readdirp'

const svgoConfig: Config = {
  multipass: true,
  plugins: [
    'removeDoctype',
    'removeXMLProcInst',
    'removeComments',
    'removeEditorsNSData',
    'cleanupAttrs',
    'mergeStyles',
    'inlineStyles',
    'minifyStyles',
    'cleanupIds',
    'removeUselessDefs',
    'cleanupNumericValues',
    'cleanupListOfValues',
    'convertColors',
    'removeUnknownsAndDefaults',
    'removeNonInheritableGroupAttrs',
    'removeUselessStrokeAndFill',
    'removeViewBox',
    'cleanupEnableBackground',
    'removeHiddenElems',
    'removeEmptyText',
    'convertShapeToPath',
    'moveElemsAttrsToGroup',
    'moveGroupAttrsToElems',
    'collapseGroups',
    'convertPathData',
    'convertEllipseToCircle',
    'convertTransform',
    'removeEmptyAttrs',
    'removeEmptyContainers',
    'mergePaths',
    'removeUnusedNS',
    'removeMetadata',
    'removeTitle',
    'removeDesc',
    'sortAttrs',
    'sortDefsChildren',
    // Disabled: removeXMLNS, convertStyleToAttrs, removeRasterImages, reusePaths
  ],
}

function hasKebabCaseAttributes(svg: string): boolean {
  // Check if SVG has any kebab-case attributes (not yet converted to React)
  return /\b[a-z]+(-[a-z]+)+=/g.test(svg)
}

function kebabToCamelCase(str: string): string {
  return str.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
}

function isColorValue(value: string): boolean {
  // Matches hex colors (#rgb, #rrggbb, #rrggbbaa), rgb/rgba, hsl/hsla
  return /^(#[0-9A-Fa-f]{3,8}|rgba?\s*\([^)]+\)|hsla?\s*\([^)]+\))$/.test(value.trim())
}

function camelCaseAttributes(svg: string): string {
  // Match kebab-case attributes (e.g., stroke-width=, fill-opacity=)
  return svg.replace(/\b([a-z]+(?:-[a-z]+)+)=/g, (_, attr) => {
    return `${kebabToCamelCase(attr)}=`
  })
}

function replaceColorsWithCurrentColor(svg: string): string {
  // Match any attribute with a color value and replace with currentColor
  return svg.replace(/(\w+)=["']([^"']+)["']/g, (match, attr, value) => {
    if (isColorValue(value)) {
      return `${attr}="currentColor"`
    }
    return match
  })
}

function byteLength(str: string): number {
  return Buffer.byteLength(str, 'utf-8')
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB']
  const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
}

function optimizeSVG(svg: string): string {
  // Skip if SVG has no kebab-case attributes (already Reactified).
  // SVGO would treat camelCase as unknown attributes and remove them.
  if (!hasKebabCaseAttributes(svg)) {
    return svg
  }
  const result = optimize(svg, svgoConfig)
  if ('data' in result) {
    return result.data
  }
  return svg
}

function transformInlineSvg(svg: string): string {
  let transformed = optimizeSVG(svg)
  transformed = camelCaseAttributes(transformed)
  transformed = replaceColorsWithCurrentColor(transformed)
  return transformed
}

async function processInlineSvgs(
  filePath: string,
  dryRun: boolean,
  verbose: boolean,
): Promise<{
  modified: boolean
  count: number
  savedBytes: number
  transformations: Array<{ before: string; after: string }>
}> {
  const content = await fs.readFile(filePath, 'utf-8')

  // Match inline SVGs wrapped in {<svg>...</svg>} or - {<svg>...</svg>}
  // This handles both patterns shown in the examples
  const inlineSvgRegex = /(\{<svg\b[^>]*>[\s\S]*?<\/svg>\s*\})/g

  let modified = false
  let count = 0
  let savedBytes = 0
  const transformations: Array<{ before: string; after: string }> = []

  const newContent = content.replace(inlineSvgRegex, (match) => {
    // Extract just the SVG part (remove the outer braces)
    const svgMatch = match.match(/<svg\b[^>]*>[\s\S]*?<\/svg>/)
    if (!svgMatch) return match

    const originalSvg = svgMatch[0]
    const transformedSvg = transformInlineSvg(originalSvg)

    if (transformedSvg !== originalSvg) {
      modified = true
      count++
      savedBytes += byteLength(originalSvg) - byteLength(transformedSvg)
      if (verbose) {
        transformations.push({ before: originalSvg, after: transformedSvg })
      }
      // Reconstruct with braces
      return `{${transformedSvg}}`
    }

    return match
  })

  if (modified && !dryRun) {
    await fs.writeFile(filePath, newContent, 'utf-8')
  }

  return { modified, count, savedBytes, transformations }
}

async function optimizeSvgFile(
  filePath: string,
  dryRun: boolean,
  verbose: boolean,
): Promise<{ saved: number; percent: number; before?: string; after?: string }> {
  const before = await fs.readFile(filePath, 'utf-8')
  const after = optimizeSVG(before)
  const beforeSize = byteLength(before)
  const saved = beforeSize - byteLength(after)

  if (saved > 0 && !dryRun) {
    await fs.writeFile(filePath, after, 'utf-8')
  }

  return {
    saved,
    percent: beforeSize > 0 ? (saved / beforeSize) * 100 : 0,
    before: verbose && saved > 0 ? before : undefined,
    after: verbose && saved > 0 ? after : undefined,
  }
}

async function main() {
  const args = process.argv.slice(2)
  const helpFlag = args.includes('--help') || args.includes('-h')

  if (helpFlag) {
    console.log(`
SVG Optimization Script

Usage:
  npm run optimize-svgs [options]

Options:
  --dry-run     Preview changes without modifying files
  --check       Check for unoptimized SVGs (exits with code 1 if found)
  --verbose     Show before/after of each transformation
  --help, -h    Show this help message

Examples:
  npm run optimize-svgs              # Optimize all SVGs
  npm run optimize-svgs -- --dry-run # Preview all changes
  npm run optimize-svgs -- --check   # CI check for unoptimized SVGs
`)
    return
  }

  const dryRun = args.includes('--dry-run')
  const checkMode = args.includes('--check')
  const verbose = args.includes('--verbose')

  // In check mode, we act like dry-run but track if there are unoptimized files
  const effectiveDryRun = dryRun || checkMode

  if (checkMode) {
    console.log('CHECK MODE - Checking for unoptimized SVGs\n')
  } else if (dryRun) {
    console.log('DRY RUN MODE - No files will be modified\n')
  }

  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const projectRoot = path.join(__dirname, '..')
  const imagesDir = path.join(projectRoot, 'public', 'images')
  const docsDir = path.join(projectRoot, 'docs')

  let filesOptimized = 0
  let filesModified = 0

  // Optimize SVG files
  {
    console.log('Optimizing SVG files in `public/images`...\n')

    const svgFiles = await readdirp.promise(imagesDir, {
      fileFilter: '*.svg',
      type: 'files',
    })

    let totalSaved = 0

    for (const file of svgFiles) {
      const filePath = path.join(imagesDir, file.path)
      const { saved, percent, before, after } = await optimizeSvgFile(filePath, effectiveDryRun, verbose)

      if (saved > 0) {
        filesOptimized++
        totalSaved += saved
        const prefix = checkMode ? '  ✗ ' : effectiveDryRun ? '  → ' : '  ✓ '
        console.log(
          `${prefix}${file.path} (${effectiveDryRun ? 'would save' : 'saved'} ${formatBytes(saved)}, ${percent.toFixed(1)}%)`,
        )
        if (verbose && before && after) {
          console.log('\n    Before:')
          console.log(`    ${before}`)
          console.log('\n    After:')
          console.log(`    ${after}`)
          console.log('')
        }
      }
    }

    console.log(`\nFiles: ${svgFiles.length} processed, ${filesOptimized} optimized`)
    console.log(`Total saved: ${formatBytes(totalSaved)}\n`)
  }

  // Transform inline SVGs
  {
    console.log('Transforming inline SVGs in `docs`...\n')

    const mdxFiles = await readdirp.promise(docsDir, {
      fileFilter: '*.mdx',
      type: 'files',
    })

    let totalInlineSvgs = 0
    let totalInlineSaved = 0

    for (const file of mdxFiles) {
      const filePath = path.join(docsDir, file.path)
      const { modified, count, savedBytes, transformations } = await processInlineSvgs(
        filePath,
        effectiveDryRun,
        verbose,
      )

      if (modified) {
        filesModified++
        totalInlineSvgs += count
        totalInlineSaved += savedBytes
        const prefix = checkMode ? '  ✗ ' : effectiveDryRun ? '  → ' : '  ✓ '
        console.log(
          `${prefix}${file.path} (${count} SVG${count > 1 ? 's' : ''} ${effectiveDryRun ? 'would be' : ''} transformed)`,
        )
        if (verbose && transformations.length > 0) {
          for (const { before, after } of transformations) {
            console.log('\n    Before:')
            console.log(`    ${before}`)
            console.log('\n    After:')
            console.log(`    ${after}`)
            console.log('')
          }
        }
      }
    }

    console.log(`\nFiles: ${mdxFiles.length} scanned, ${filesModified} modified`)
    console.log(`Inline SVGs transformed: ${totalInlineSvgs}`)
    console.log(`Total saved: ${formatBytes(totalInlineSaved)}\n`)
  }

  // In check mode, exit with error if any unoptimized SVGs were found
  if (checkMode) {
    const hasUnoptimized = filesOptimized > 0 || filesModified > 0
    if (hasUnoptimized) {
      console.log('✗ Found unoptimized SVGs. Run `npm run optimize-svgs` to fix.\n')
      process.exit(1)
    } else {
      console.log('✓ All SVGs are optimized.\n')
    }
  } else {
    console.log('SVG optimization complete!')
  }
}

main().catch((error) => {
  console.error('Optimize SVGs Error:', error)
  process.exit(1)
})
