#!/usr/bin/env tsx

/**
 * Check Duplicate Redirects Script
 *
 * This script checks for duplicate redirect sources in the static redirects file.
 * It provides friendly feedback about any duplicates found and suggests how to fix them.
 *
 * Usage:
 *   npx tsx scripts/check-duplicate-redirects.ts
 *   npm run lint:check-duplicate-redirects
 */

import fs from 'node:fs/promises'
import path from 'node:path'

interface Redirect {
  source: string
  destination: string
  permanent: boolean
}

function validateNoDuplicateSources(redirects: Redirect[]): boolean {
  const sourceMap = new Map<string, Redirect[]>()

  // Group redirects by source
  for (const redirect of redirects) {
    if (!sourceMap.has(redirect.source)) {
      sourceMap.set(redirect.source, [])
    }
    sourceMap.get(redirect.source)!.push(redirect)
  }

  // Find duplicates
  const duplicates: Array<{ source: string; redirects: Redirect[] }> = []
  for (const [source, redirectsForSource] of sourceMap.entries()) {
    if (redirectsForSource.length > 1) {
      duplicates.push({ source, redirects: redirectsForSource })
    }
  }

  if (duplicates.length > 0) {
    duplicates.forEach(({ source, redirects }) => {
      const destinations = redirects.map((r) => r.destination)
      const uniqueDestinations = [...new Set(destinations)]

      if (uniqueDestinations.length === 1) {
        console.log(`📝 "${source}" appears ${redirects.length} times`)
        console.log(`   All pointing to: ${uniqueDestinations[0]}`)
        console.log('   💡 This is just redundant - you can safely remove the duplicates')
      } else {
        console.log(`⚠️  "${source}" has ${redirects.length} conflicting destinations:`)
        destinations.forEach((dest, i) => {
          console.log(`   ${i + 1}. ${dest}`)
        })
        console.log('   💡 Please decide which destination is correct and remove the others')
      }
      console.log('')
    })

    console.log('🔧 To fix this, please:')
    console.log('   1. Edit redirects/static/docs.json')
    console.log('   2. Remove the duplicate entries listed above')
    console.log('   3. Run this check again to verify')
    console.log('')
    console.log('✨ Once cleaned up, your redirects will be ready to go!')

    return false
  }

  return true
}

async function checkDuplicateRedirects(): Promise<void> {
  console.log('🔎 Checking for duplicate redirect sources...')

  try {
    const redirectsPath = path.join(process.cwd(), 'redirects', 'static', 'docs.json')
    const content = await fs.readFile(redirectsPath, 'utf-8')
    const redirects: Redirect[] = JSON.parse(content)

    console.log(`📊 Found ${redirects.length} total redirects`)

    const isValid = validateNoDuplicateSources(redirects)

    if (isValid) {
      console.log('✅ No duplicate redirect sources found! Your redirects look great.')
    } else {
      process.exitCode = 1
    }
  } catch (error) {
    console.error('💥 Error reading redirects file:', error)
    process.exitCode = 1
  }
}

async function main() {
  try {
    await checkDuplicateRedirects()
  } catch (error) {
    console.error('💥 Error checking duplicate redirects:', error)
    process.exitCode = 1
  }
}

// Run the script if called directly
if (require.main === module) {
  main()
}
