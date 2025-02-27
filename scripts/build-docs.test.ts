import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

import { expect, test } from 'vitest'
import { build, createBlankStore } from './build-docs'

async function createTempFiles(files: {
  path: string;
  content: string;
}[]) {
  // Create temp folder with unique name
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clerk-docs-test-'))

  // Create all files
  for (const file of files) {
    // Ensure the directory exists
    const filePath = path.join(tempDir, file.path)
    const dirPath = path.dirname(filePath)

    await fs.mkdir(dirPath, { recursive: true })

    // Write the file
    await fs.writeFile(filePath, file.content)
  }

  // Return the temp directory and cleanup function
  return {
    files: files.reduce((acc, file) => {
      acc[file.path] = file.content
      return acc
    }, {} as Record<string, string>),
    tempDir,
    cleanup: async () => {
      try {
        await fs.rm(tempDir, { recursive: true, force: true })
      } catch (error) {
        console.warn(`Warning: Failed to clean up temp folder ${tempDir}:`, error)
      }
    },
    pathJoin: (...paths: string[]) => path.join(tempDir, ...paths)
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function readFile(filePath: string): Promise<string> {
  return normalizeString(await fs.readFile(filePath, 'utf-8'))
}

function normalizeString(str: string): string {
  return str.replace(/\r\n/g, '\n').trim();
}

test('Basic build test with simple files', async () => {
  // Create temp environment with minimal files array
  const { files, tempDir, cleanup, pathJoin } = await createTempFiles([
    {
      path: './docs/manifest.json',
      content: JSON.stringify({
        navigation: [[{ title: "Simple Test", href: "/docs/simple-test" }]]
      })
    },
    {
      path: './docs/simple-test.mdx',
      content: `---
title: Simple Test
---

# Simple Test Page

Testing with a simple page.`
    }
  ])

  const config = {
    basePath: tempDir,
    docsRelativePath: './docs',
    docsFolder: pathJoin('./docs'),
    manifestFilePath: pathJoin('./docs/manifest.json'),
    partialsPath: './_partials',
    distPath: pathJoin('./dist'),
    ignorePaths: ["/docs/_partials"],
    validSdks: ["nextjs", "react"],
    manifestOptions: {
      wrapDefault: true,
      collapseDefault: false,
      hideTitleDefault: false
    }
  }

  await build(createBlankStore(), config)

  expect(await fileExists(pathJoin('./dist/simple-test.mdx'))).toBe(true)
  expect(await readFile(pathJoin('./dist/simple-test.mdx'))).toBe(files['./docs/simple-test.mdx'])

  expect(await fileExists(pathJoin('./dist/nextjs/manifest.json'))).toBe(true)
  expect(await readFile(pathJoin('./dist/nextjs/manifest.json'))).toBe(JSON.stringify({
    navigation: [[{ title: "Simple Test", href: "/docs/simple-test" }]]
  }))

  expect(await fileExists(pathJoin('./dist/react/manifest.json'))).toBe(true)
  expect(await readFile(pathJoin('./dist/react/manifest.json'))).toBe(JSON.stringify({
    navigation: [[{ title: "Simple Test", href: "/docs/simple-test" }]]
  }))

  await cleanup()
})

