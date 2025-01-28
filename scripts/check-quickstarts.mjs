import { execSync } from 'child_process'
import path from 'path'

const quickstartsDir = './docs/quickstarts'

try {
  // Check for changes in the quickstarts directory using git status
  const gitStatus = execSync(`git status --porcelain ${quickstartsDir}`).toString()

  if (gitStatus.length > 0) {
    console.log('⚠️  Changes found in the following quickstarts:')

    // Split the status output into lines and format them
    gitStatus
      .split('\n')
      .filter((line) => line.trim())
      .forEach((line) => {
        const [, filePath] = line.trim().split(/\s+/)
        console.log(`- ${path.relative(quickstartsDir, filePath)}`)
      })

    console.log('⚠️  Please update the corresponding quickstart in the Dashboard')
    process.exit(0)
  }

  console.log('✅ No changes detected in quickstarts directory')
  process.exit(0)
} catch (error) {
  console.error(`Error checking directory: ${error.message}`)
  process.exit(1)
}
