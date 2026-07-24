import { execSync } from 'child_process'
import path from 'path'

// Quickstarts moved from docs/quickstarts to docs/getting-started/quickstart* in
// the IA restructure (#2443)
const quickstartsDir = './docs/getting-started'
const quickstartsGlob = `${quickstartsDir}/quickstart*`

try {
  let changedFiles = ''

  // Check if we're in a PR
  if (process.env.GITHUB_BASE_REF) {
    // Get names of files that have changed. The `--` guards against git treating
    // the glob as a revision when it matches nothing.
    changedFiles = execSync(
      `git diff --name-only origin/${process.env.GITHUB_BASE_REF}...HEAD -- '${quickstartsGlob}'`,
    ).toString()
  } else {
    // If we aren't in a PR (dev env), check working directory changes
    changedFiles = execSync(`git status --porcelain -- '${quickstartsGlob}'`).toString()
  }
  if (changedFiles.length > 0) {
    console.log('⚠️  Changes found in the following quickstarts:')

    // git prints paths relative to the repo root, which is not the cwd when
    // clerk-docs is nested inside clerk/clerk — resolve both sides to absolute
    const repoRoot = execSync('git rev-parse --show-toplevel').toString().trim()

    // Split the output into lines and format them
    changedFiles
      .split('\n')
      .filter((line) => line.trim())
      .forEach((line) => {
        // For PR diff, the line is just the filepath
        // For local status, we need to extract the filepath from the status line
        const filePath = process.env.GITHUB_BASE_REF ? line : line.trim().split(/\s+/)[1]
        if (filePath) {
          console.log(`- ${path.relative(path.resolve(quickstartsDir), path.resolve(repoRoot, filePath))}`)
        }
      })

    // Keep empty string to make the output more readable in the GH Actions comment
    console.log('')
    console.log('⚠️  Please update the corresponding quickstarts in the Dashboard')
    process.exit(0)
  }

  console.log('✅ No changes detected in quickstarts directory')
  process.exit(0)
} catch (error) {
  console.error(`Error checking directory: ${error.message}`)
  process.exit(1)
}
