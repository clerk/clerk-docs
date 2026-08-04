// Guards against plain-text status tags drifting back into content. Statuses
// are rendered by pill components (`<BetaTag />` etc.) driven by frontmatter
// `tag` / manifest `tag` — never written as literal text. This checks the
// channels the schema enum can't reach:
//
//   1. Markdown headings at any depth: `## createOrg() (Beta)`
//   2. Frontmatter `title` values (rendered as the page h1)
//   3. `manifest.json` item titles (the sidenav)
//   4. Newly authored `[!CAUTION]` callouts (folded into `WARNING`; the alias
//      keeps old content rendering but new ones shouldn't be written)
//   5. Unknown status-ish words (`(Alpha)`, `(Preview)`, ...) — the lifecycle
//      is a closed set; introducing a new status requires a conversation, a
//      schema change, and a pill, not a parenthetical.
//
// Prose is deliberately out of scope: "this API is in beta" mid-sentence is
// legitimate English. `clerk-typedoc/` is excluded (auto-generated).

import fs from 'node:fs'
import path from 'node:path'
import readdirp from 'readdirp'

// Keep in sync with the `tag` enum in scripts/lib/schemas.ts plus the
// `maintainer` axis. Values are lowercase; matching is case-insensitive.
const KNOWN_STATUSES = ['experimental', 'beta', 'new', 'legacy', 'deprecated', 'removed', 'community']

// Status-ish words that are NOT part of the lifecycle. These fail with a
// different message: pick a real status or start the conversation to add one.
const UNKNOWN_STATUSES = [
  'alpha',
  'preview',
  'dev preview',
  'developer preview',
  'early access',
  'private beta',
  'public beta',
  'ga',
  'general availability',
  'stable',
  'unstable',
  'coming soon',
  'sunset',
  'sunsetted',
  'retired',
  'discontinued',
  'end of life',
  'eol',
  'in development',
]

const componentFor = (status: string) => `<${status.charAt(0).toUpperCase() + status.slice(1)}Tag />`

type Problem = { location: string; message: string }
const problems: Problem[] = []

const checkParenthetical = (text: string, location: string, context: 'heading' | 'title') => {
  for (const match of text.matchAll(/\(([^)]+)\)/g)) {
    const inner = match[1].trim().toLowerCase()
    if (KNOWN_STATUSES.includes(inner)) {
      const fix =
        context === 'heading'
          ? `append ${componentFor(inner)} to the heading`
          : `remove it and set the \`tag\` field to \`${inner === 'community' ? 'community (maintainer)' : inner}\``
      problems.push({
        location,
        message: `plain-text status "(${match[1].trim()})" — ${fix}`,
      })
    } else if (UNKNOWN_STATUSES.includes(inner)) {
      problems.push({
        location,
        message: `"(${match[1].trim()})" is not a lifecycle status (${KNOWN_STATUSES.join(', ')}) — pick one, or propose adding it before inventing it inline`,
      })
    }
  }
}

const checkMdxFile = (filePath: string, contents: string) => {
  const lines = contents.split('\n')
  let inFence = false
  let inFrontmatter = false

  lines.forEach((line, index) => {
    const location = `${filePath}:${index + 1}`

    if (index === 0 && line.trim() === '---') {
      inFrontmatter = true
      return
    }
    if (inFrontmatter) {
      if (line.trim() === '---') {
        inFrontmatter = false
        return
      }
      const titleMatch = line.match(/^title\s*:\s*(.*)$/)
      if (titleMatch) checkParenthetical(titleMatch[1], location, 'title')
      return
    }

    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence
      return
    }
    if (inFence) return

    if (/^\s*(>\s*)+\[!caution\]/i.test(line)) {
      problems.push({
        location,
        message:
          "`[!CAUTION]` was folded into `[!WARNING]` — the alias keeps old content rendering, but don't author new ones",
      })
    }

    const headingMatch = line.match(/^#{1,6}\s+(.*)$/)
    if (headingMatch) {
      // Strip the `{{ id: '...' }}` suffix so its contents aren't scanned
      const headingText = headingMatch[1].replace(/\{\{.*\}\}\s*$/, '')
      checkParenthetical(headingText, location, 'heading')
    }
  })
}

const checkManifest = (filePath: string) => {
  const manifest = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  const walk = (node: unknown, trail: string) => {
    if (Array.isArray(node)) {
      node.forEach((child, index) => walk(child, `${trail}[${index}]`))
      return
    }
    if (node === null || typeof node !== 'object') return
    const record = node as Record<string, unknown>
    if (typeof record.title === 'string') {
      checkParenthetical(record.title, `${filePath} → "${record.title}"`, 'title')
    }
    for (const [key, value] of Object.entries(record)) walk(value, `${trail}.${key}`)
  }
  walk(manifest, 'manifest')
}

async function main() {
  console.log('🔎 Checking for plain-text status tags...')

  const files = readdirp('docs', { fileFilter: '*.mdx', type: 'files' })
  for await (const file of files) {
    checkMdxFile(path.join('docs', file.path), fs.readFileSync(file.fullPath, 'utf8'))
  }

  checkManifest('docs/manifest.json')

  if (problems.length > 0) {
    for (const problem of problems) {
      console.log(`${problem.location}\n  ${problem.message}\n`)
    }
    console.log(`❌ ${problems.length} plain-text status tag(s) found. Statuses render as pills, not text.`)
    process.exitCode = 1
  } else {
    console.log('✅ No plain-text status tags found!')
  }
}

main()
