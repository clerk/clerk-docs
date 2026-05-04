/**
 * Validates that prompt files in prompts/ produce Cursor deeplink URLs
 * within the 8,000 character limit.
 *
 * The deeplink URL is generated using URLSearchParams (which encodes
 * spaces as `+` instead of `%20`), so we measure the full URL length
 * to match what's actually sent to Cursor.
 *
 * All prompts must stay under the limit — the "Open in Cursor" button
 * will not show for prompts that exceed it.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const URL_LIMIT = 8000
const DEEPLINK_BASE = 'https://cursor.com/link/prompt'

/**
 * Prompts explicitly excluded from the URL length check.
 * Add filenames here only when a prompt intentionally exceeds
 * the limit (e.g., it's delivered via a different mechanism).
 */
const EXCLUDED_PROMPTS: string[] = ['core-3-upgrade.md']

function generateDeeplinkUrl(promptText: string): string {
  const url = new URL(DEEPLINK_BASE)
  url.searchParams.set('text', promptText)
  return url.toString()
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROMPTS_DIR = path.resolve(__dirname, '..', 'prompts')

type Color = 'red' | 'green' | 'yellow' | 'gray'

const colorCodes: Record<Color, string> = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  gray: '\x1b[90m',
}

function log(color: Color, message: string, indent = 0): void {
  const padding = '  '.repeat(indent)
  console.log(`${colorCodes[color]}${padding}${message}\x1b[0m`)
}

const files = fs.readdirSync(PROMPTS_DIR).filter((f) => f.endsWith('.md'))

if (files.length === 0) {
  log('gray', 'No .md files found in prompts/')
  process.exit(0)
}

let hasFailure = false
const failures: string[] = []
let excludedCount = 0

for (const file of files) {
  const content = fs.readFileSync(path.join(PROMPTS_DIR, file), 'utf8')
  const rawLength = content.length
  const urlLength = generateDeeplinkUrl(content).length

  if (EXCLUDED_PROMPTS.includes(file)) {
    log('yellow', `⊘ ${file} — URL ${urlLength} chars (raw ${rawLength}), excluded from check`)
    excludedCount++
  } else if (urlLength > URL_LIMIT) {
    log('red', `✗ ${file} — URL ${urlLength} chars (raw ${rawLength}), limit is ${URL_LIMIT}`)
    failures.push(file)
    hasFailure = true
  } else {
    log('green', `✓ ${file} — URL ${urlLength} chars (raw ${rawLength})`)
  }
}

const checkedCount = files.length - excludedCount
const excludedSuffix = excludedCount > 0 ? ` (${excludedCount} excluded)` : ''

console.log()

if (hasFailure) {
  log(
    'red',
    `✗ ${failures.length} of ${checkedCount} prompt(s) exceed the ${URL_LIMIT} char deeplink URL limit${excludedSuffix}`,
  )
  log('gray', 'The "Open in Cursor" button will not show for prompts over the limit', 1)
  log('gray', 'Compress the prompt or add the filename to `EXCLUDED_PROMPTS` in this script to bypass', 1)
  process.exit(1)
} else {
  log(
    'green',
    `✓ All ${checkedCount} checked prompt(s) are within the ${URL_LIMIT} char deeplink URL limit${excludedSuffix}`,
  )
}
