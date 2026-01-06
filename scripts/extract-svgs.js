#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

// Find project root (where the script is run from)
const PROJECT_ROOT = process.cwd()
const OUTPUT_DIR = path.join(PROJECT_ROOT, '.svgs')

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
}

// Recursively find all MDX files
function findMdxFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir)

  files.forEach((file) => {
    const filePath = path.join(dir, file)
    const stat = fs.statSync(filePath)

    if (stat.isDirectory()) {
      // Skip node_modules and hidden directories
      if (!file.startsWith('.') && file !== 'node_modules') {
        findMdxFiles(filePath, fileList)
      }
    } else if (file.endsWith('.mdx')) {
      fileList.push(filePath)
    }
  })

  return fileList
}

// Find MDX files containing inline SVGs
function findMdxFilesWithSvgs() {
  const docsDir = path.join(PROJECT_ROOT, 'docs')
  const allMdxFiles = findMdxFiles(docsDir)
  const filesWithSvgs = []

  console.log(`🔍 Scanning ${allMdxFiles.length} MDX files for inline SVGs...\n`)

  allMdxFiles.forEach((filePath) => {
    const content = fs.readFileSync(filePath, 'utf-8')
    if (content.includes('{<svg')) {
      // Convert absolute path to relative path from project root
      const relativePath = path.relative(PROJECT_ROOT, filePath)
      filesWithSvgs.push(relativePath)
    }
  })

  return filesWithSvgs
}

// Get files to process
const FILES = findMdxFilesWithSvgs()

if (FILES.length === 0) {
  console.log('❌ No MDX files with inline SVGs found.')
  process.exit(0)
}

console.log(`📋 Found ${FILES.length} file(s) with inline SVGs:\n`)
FILES.forEach((file) => console.log(`   - ${file}`))
console.log('')

// Helper function to convert camelCase to kebab-case
function camelToKebab(str) {
  return str.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
}

// Helper function to convert React-style props to HTML attributes
function convertAttributes(svgContent) {
  // First, replace "currentColor" with "#9394A0"
  svgContent = svgContent.replace(/["']currentColor["']/g, '"#9394A0"')

  // Remove React-style inline style attributes (e.g., style={{ fill: '...' }})
  svgContent = svgContent.replace(/\s+style=\{\{[^}]*\}\}/g, '')

  // Convert camelCase attributes to kebab-case, except viewBox
  const attributePattern = /\s([a-z][a-zA-Z0-9]*)(=)/g
  svgContent = svgContent.replace(attributePattern, (match, attr, equals) => {
    if (attr === 'viewBox' || attr === 'xmlns') {
      return match // Keep viewBox and xmlns as-is
    }
    return ' ' + camelToKebab(attr) + equals
  })

  return svgContent
}

// Helper function to add width, height, and xmlns to SVG
function processSvg(svgContent) {
  // Convert attributes
  svgContent = convertAttributes(svgContent)

  // Extract viewBox values
  const viewBoxMatch = svgContent.match(/viewBox=["']([^"']+)["']/)
  if (viewBoxMatch) {
    const viewBoxValues = viewBoxMatch[1].split(/\s+/)
    if (viewBoxValues.length === 4) {
      const width = viewBoxValues[2]
      const height = viewBoxValues[3]

      // Check if width and height already exist
      const hasWidth = /\swidth=/.test(svgContent)
      const hasHeight = /\sheight=/.test(svgContent)

      // Add width and height after viewBox if they don't exist
      if (!hasWidth || !hasHeight) {
        const widthAttr = hasWidth ? '' : ` width="${width}"`
        const heightAttr = hasHeight ? '' : ` height="${height}"`
        svgContent = svgContent.replace(/viewBox=["'][^"']+["']/, `$&${widthAttr}${heightAttr}`)
      }
    }
  }

  // Add xmlns if it doesn't exist
  if (!svgContent.includes('xmlns=')) {
    svgContent = svgContent.replace(/<svg/, '<svg xmlns="http://www.w3.org/2000/svg"')
  }

  return svgContent
}

// Helper function to sanitize filename
function sanitizeFilename(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// Extract card title from context
function extractCardTitle(content, svgIndex) {
  const lines = content.substring(0, svgIndex).split('\n')

  // Look backwards for the card title (usually in format: - [Title](link))
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    const titleMatch = line.match(/^-\s*\[([^\]]+)\]/)
    if (titleMatch) {
      return titleMatch[1]
    }
  }

  return null
}

// Process each file
FILES.forEach((filePath) => {
  const fullPath = path.join(PROJECT_ROOT, filePath)

  if (!fs.existsSync(fullPath)) {
    console.log(`⚠️  File not found: ${filePath}`)
    return
  }

  const content = fs.readFileSync(fullPath, 'utf-8')

  // Find all inline SVGs: {<svg...>...</svg>}
  const svgPattern = /\{<svg[^>]*>[\s\S]*?<\/svg>\}/g
  const svgs = content.match(svgPattern)

  if (!svgs || svgs.length === 0) {
    console.log(`ℹ️  No inline SVGs found in: ${filePath}`)
    return
  }

  console.log(`\n📄 Processing: ${filePath}`)
  console.log(`   Found ${svgs.length} SVG(s)`)

  svgs.forEach((svgBlock, index) => {
    // Remove the wrapping { and }
    let svgContent = svgBlock.substring(1, svgBlock.length - 1)

    // Find the context (card title) for this SVG
    const svgIndex = content.indexOf(svgBlock)
    const cardTitle = extractCardTitle(content, svgIndex)

    // Generate filename
    let filename
    if (cardTitle) {
      filename = `${sanitizeFilename(cardTitle)}.svg`
    } else {
      const baseName = path.basename(filePath, '.mdx')
      filename = `${baseName}-${index + 1}.svg`
    }

    // Process the SVG
    const processedSvg = processSvg(svgContent)

    // Write to file
    const outputPath = path.join(OUTPUT_DIR, filename)
    fs.writeFileSync(outputPath, processedSvg, 'utf-8')

    console.log(`   ✅ Exported: ${filename}${cardTitle ? ` (${cardTitle})` : ''}`)
  })
})

console.log(`\n✨ Done! SVGs exported to: ${OUTPUT_DIR}/\n`)
