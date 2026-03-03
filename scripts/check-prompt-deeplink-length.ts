/**
 * Validates that prompt files in prompts/ have URL-encoded lengths
 * within Cursor's 8,000 character deeplink limit.
 *
 * Quickstart prompts (used with the "Open in Cursor" button) fail CI if over limit.
 * Other prompts (e.g. upgrade guides) warn but don't fail.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ENCODED_LIMIT = 8000
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROMPTS_DIR = path.resolve(__dirname, '..', 'prompts')

// Prompts that power the Cursor deeplink button — must stay under the limit
const ENFORCED_PROMPTS = ['nextjs-quickstart.md', 'react-vite-quickstart.md']

let hasFailure = false

const files = fs.readdirSync(PROMPTS_DIR).filter((f) => f.endsWith('.md'))

if (files.length === 0) {
  console.log('No .md files found in prompts/')
  process.exit(0)
}

for (const file of files) {
  const content = fs.readFileSync(path.join(PROMPTS_DIR, file), 'utf8')
  const rawLength = content.length
  const encodedLength = encodeURIComponent(content).length
  const enforced = ENFORCED_PROMPTS.includes(file)

  if (encodedLength > ENCODED_LIMIT) {
    if (enforced) {
      console.error(`FAIL: ${file} — encoded ${encodedLength} chars (raw ${rawLength}), limit is ${ENCODED_LIMIT}`)
      hasFailure = true
    } else {
      console.warn(`WARN: ${file} — encoded ${encodedLength} chars (raw ${rawLength}), exceeds ${ENCODED_LIMIT} limit`)
    }
  } else {
    console.log(`OK:   ${file} — encoded ${encodedLength} chars (raw ${rawLength})`)
  }
}

if (hasFailure) {
  process.exit(1)
}
