/**
 * Migration: Remove `permanent` field from static redirects
 *
 * This script removes the `permanent` field from all entries in redirects/static/docs.json.
 *
 * Usage: npx tsx scripts/migrate-remove-permanent.ts
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REDIRECTS_PATH = path.join(__dirname, '../redirects/static/docs.json')

interface Redirect {
  source: string
  destination: string
  permanent?: boolean
}

const redirects: Redirect[] = JSON.parse(fs.readFileSync(REDIRECTS_PATH, 'utf-8'))

const updated = redirects.map(({ source, destination }) => ({
  source,
  destination,
}))

fs.writeFileSync(REDIRECTS_PATH, JSON.stringify(updated, null, 2) + '\n')

console.log(`Removed 'permanent' field from ${redirects.length} redirects`)
