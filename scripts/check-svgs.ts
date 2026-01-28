import fs from 'node:fs'
import { glob } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { optimize, Config } from 'svgo'

const IMAGES_DIR = 'public/images'
const DOCS_DIR = 'docs'

const args = process.argv.slice(2)
const fix = args.includes('--fix')

type Color = 'red' | 'green' | 'yellow' | 'blue' | 'gray'

const colorCodes: Record<Color, string> = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  gray: '\x1b[90m',
}

function log(color: Color, message: string, indent = 0): void {
  const padding = '  '.repeat(indent)
  console.log(`${colorCodes[color]}${padding}${message}\x1b[0m`)
}

function showHelp(): void {
  console.log(`
Usage: tsx scripts/check-svgs.ts [options]

Options:
  --fix        Optimize unoptimized SVGs
  -h, --help   Show this help message

Examples:
  npm run lint:check-svgs
  npm run lint:check-svgs -- --fix
`)
}

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
    // Purposefully disabled:
    // removeXMLNS,
    // convertStyleToAttrs,
    // removeRasterImages,
    // reusePaths,
  ],
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

function hasKebabCaseAttributes(svg: string): boolean {
  return /\b[a-z]+(-[a-z]+)+=/g.test(svg)
}

function runSVGO(svg: string): string {
  // SVGO treats camelCase as unknown attributes and removes them, so skip already-optimized files
  if (!hasKebabCaseAttributes(svg)) {
    return svg
  }
  const result = optimize(svg, svgoConfig)
  return 'data' in result ? result.data : svg
}

function kebabToCamelCase(str: string): string {
  return str.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
}

function camelCaseAttributes(svg: string): string {
  // Match and replace kebab-case attributes (e.g., strokeWidth=, fill-opacity=)
  return svg.replace(/\b([a-z]+(?:-[a-z]+)+)=/g, (_, attr) => `${kebabToCamelCase(attr)}=`)
}

function isColorValue(value: string): boolean {
  // Matches hex colors (#rgb, #rrggbb, #rrggbbaa), rgb/rgba, hsl/hsla
  return /^(#[0-9A-Fa-f]{3,8}|rgba?\s*\([^)]+\)|hsla?\s*\([^)]+\))$/.test(value.trim())
}

function replaceColorsWithCurrentColor(svg: string): string {
  return svg.replace(/(\w+)=["']([^"']+)["']/g, (match, attr, value) => {
    return isColorValue(value) ? `${attr}="currentColor"` : match
  })
}

interface UnoptimizedFile {
  path: string
  savedBytes: number
  percent: number
}

interface UnoptimizedInline {
  path: string
  count: number
  savedBytes: number
}

async function checkSvgFiles(imagesDir: string): Promise<UnoptimizedFile[]> {
  const unoptimized: UnoptimizedFile[] = []

  for await (const entry of glob(path.join(imagesDir, '**/*.svg'))) {
    const filePath = entry.toString()
    const before = fs.readFileSync(filePath, 'utf-8')
    const after = runSVGO(before)
    const beforeSize = byteLength(before)
    const savedBytes = beforeSize - byteLength(after)

    if (savedBytes > 0) {
      unoptimized.push({
        path: path.relative(imagesDir, filePath),
        savedBytes,
        percent: beforeSize > 0 ? (savedBytes / beforeSize) * 100 : 0,
      })
    }
  }

  return unoptimized
}

async function checkInlineSvgs(docsDir: string): Promise<UnoptimizedInline[]> {
  const unoptimized: UnoptimizedInline[] = []
  const inlineSvgRegex = /(\{<svg\b[^>]*>[\s\S]*?<\/svg>\s*\})/g

  for await (const entry of glob(path.join(docsDir, '**/*.mdx'))) {
    const filePath = entry.toString()
    const content = fs.readFileSync(filePath, 'utf-8')

    let count = 0
    let savedBytes = 0

    content.replace(inlineSvgRegex, (match) => {
      const svgMatch = match.match(/<svg\b[^>]*>[\s\S]*?<\/svg>/)
      if (!svgMatch) return match

      const originalSvg = svgMatch[0]
      let transformedSvg = runSVGO(originalSvg)
      transformedSvg = camelCaseAttributes(transformedSvg)
      transformedSvg = replaceColorsWithCurrentColor(transformedSvg)

      if (transformedSvg !== originalSvg) {
        count++
        savedBytes += byteLength(originalSvg) - byteLength(transformedSvg)
      }

      return match
    })

    if (count > 0) {
      unoptimized.push({
        path: path.relative(docsDir, filePath),
        count,
        savedBytes,
      })
    }
  }

  return unoptimized
}

async function fixSvgFiles(imagesDir: string, files: UnoptimizedFile[]): Promise<void> {
  for (const file of files) {
    const filePath = path.join(imagesDir, file.path)
    const before = fs.readFileSync(filePath, 'utf-8')
    const after = runSVGO(before)
    fs.writeFileSync(filePath, after, 'utf-8')
    log('gray', `optimized ${file.path} (saved ${formatBytes(file.savedBytes)})`, 2)
  }
}

async function fixInlineSvgs(docsDir: string, files: UnoptimizedInline[]): Promise<void> {
  const inlineSvgRegex = /(\{<svg\b[^>]*>[\s\S]*?<\/svg>\s*\})/g

  for (const file of files) {
    const filePath = path.join(docsDir, file.path)
    const content = fs.readFileSync(filePath, 'utf-8')

    const newContent = content.replace(inlineSvgRegex, (match) => {
      // Extract just the SVG part (remove the outer braces)
      const svgMatch = match.match(/<svg\b[^>]*>[\s\S]*?<\/svg>/)
      if (!svgMatch) return match

      const originalSvg = svgMatch[0]
      let transformedSvg = runSVGO(originalSvg)
      transformedSvg = camelCaseAttributes(transformedSvg)
      transformedSvg = replaceColorsWithCurrentColor(transformedSvg)

      // Reconstruct with braces
      return transformedSvg !== originalSvg ? `{${transformedSvg}}` : match
    })

    fs.writeFileSync(filePath, newContent, 'utf-8')
    log('gray', `optimized ${file.path} (${file.count} inline SVG${file.count > 1 ? 's' : ''})`, 2)
  }
}

async function main(): Promise<void> {
  log('blue', 'Checking SVG optimization...\n')

  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const projectRoot = path.join(__dirname, '..')
  const imagesDir = path.join(projectRoot, IMAGES_DIR)
  const docsDir = path.join(projectRoot, DOCS_DIR)

  try {
    const unoptimizedFiles = await checkSvgFiles(imagesDir)
    const unoptimizedInlines = await checkInlineSvgs(docsDir)

    if (fix && (unoptimizedFiles.length > 0 || unoptimizedInlines.length > 0)) {
      if (unoptimizedFiles.length > 0) {
        log('yellow', `Optimizing ${unoptimizedFiles.length} SVG file(s) in ${IMAGES_DIR}...`)
        await fixSvgFiles(imagesDir, unoptimizedFiles)
        console.log()
      }

      if (unoptimizedInlines.length > 0) {
        log('yellow', `Optimizing inline SVGs in ${unoptimizedInlines.length} file(s) in ${DOCS_DIR}...`)
        await fixInlineSvgs(docsDir, unoptimizedInlines)
        console.log()
      }
    }

    const totalFiles = unoptimizedFiles.length + unoptimizedInlines.length
    const hasIssues = !fix && totalFiles > 0

    if (hasIssues) {
      if (unoptimizedFiles.length > 0) {
        const totalSaved = unoptimizedFiles.reduce((sum, f) => sum + f.savedBytes, 0)
        log('yellow', `⚠ Unoptimized SVG files in ${IMAGES_DIR} (would save ${formatBytes(totalSaved)}):`)
        for (const file of unoptimizedFiles) {
          log('yellow', `${file.path} (${formatBytes(file.savedBytes)}, ${file.percent.toFixed(1)}%)`, 2)
        }
        console.log()
      }

      if (unoptimizedInlines.length > 0) {
        const totalSaved = unoptimizedInlines.reduce((sum, f) => sum + f.savedBytes, 0)
        const totalCount = unoptimizedInlines.reduce((sum, f) => sum + f.count, 0)
        log(
          'yellow',
          `⚠ Unoptimized inline SVGs in ${DOCS_DIR} (${totalCount} SVGs, would save ${formatBytes(totalSaved)}):`,
        )
        for (const file of unoptimizedInlines) {
          log('yellow', `${file.path} (${file.count} SVG${file.count > 1 ? 's' : ''})`, 2)
        }
        console.log()
      }

      log('red', `✗ Found ${totalFiles} file(s) with unoptimized SVGs`)
      log('gray', 'Run with --fix to optimize', 2)
      process.exit(1)
    } else {
      log('green', '✓ All SVGs are optimized!')
      process.exit(0)
    }
  } catch (error) {
    log('red', `Error checking SVGs: ${(error as Error).message}`)
    process.exit(1)
  }
}

if (args.includes('--help') || args.includes('-h')) {
  showHelp()
  process.exit(0)
}

main()
