import fs from 'node:fs/promises'
import path from 'node:path'
import readdirp from 'readdirp'
import { findUnusedPartials } from './lib/unusedPartials'

async function main() {
  const docsPath = path.resolve(__dirname, '../docs')
  const entries = await readdirp.promise(docsPath, { type: 'files', fileFilter: '*.mdx' })
  const files = await Promise.all(
    entries.map(async (entry) => ({
      path: entry.path.replaceAll('\\', '/'),
      content: await fs.readFile(entry.fullPath, 'utf8'),
    })),
  )
  const unused = findUnusedPartials(files)

  if (unused.length > 0) {
    console.error(`Unused docs partials (${unused.length}):`)
    unused.forEach((filePath) => console.error(`  docs/${filePath}`))
    process.exitCode = 1
    return
  }

  console.info('All docs partials are used')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
