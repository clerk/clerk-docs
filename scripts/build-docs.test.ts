import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {glob} from 'glob';


import { expect, onTestFinished, test } from 'vitest'
import { build, createBlankStore, createConfig } from './build-docs'

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

  onTestFinished(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true })
    } catch (error) {
      console.warn(`Warning: Failed to clean up temp folder ${tempDir}:`, error)
      throw error
    }
  })

  // Return the temp directory and cleanup function
  return {
    tempDir,
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

function treeDir(baseDir: string) {
  return glob('**/*', { 
    cwd: baseDir,
    nodir: true // Only return files, not directories
  });
}

const baseConfig = {
  docsPath: './docs',
  manifestPath: './docs/manifest.json',
  partialsPath: './_partials',
  distPath: './dist',
  ignorePaths: ["/docs/_partials"],
  manifestOptions: {
    wrapDefault: true,
    collapseDefault: false,
    hideTitleDefault: false
  }
}

test('Basic build test with simple files', async () => {
  // Create temp environment with minimal files array
  const { tempDir, pathJoin } = await createTempFiles([
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

  await build(createBlankStore(), createConfig({
    ...baseConfig,
    basePath: tempDir,
    validSdks: ["nextjs", "react"],
  }))

  expect(await fileExists(pathJoin('./dist/simple-test.mdx'))).toBe(true)
  expect(await readFile(pathJoin('./dist/simple-test.mdx'))).toBe(`---
title: Simple Test
---

# Simple Test Page

Testing with a simple page.`)

  expect(await fileExists(pathJoin('./dist/nextjs/manifest.json'))).toBe(true)
  expect(await readFile(pathJoin('./dist/nextjs/manifest.json'))).toBe(JSON.stringify({
    navigation: [[{ title: "Simple Test", href: "/docs/simple-test" }]]
  }))

  expect(await fileExists(pathJoin('./dist/react/manifest.json'))).toBe(true)
  expect(await readFile(pathJoin('./dist/react/manifest.json'))).toBe(JSON.stringify({
    navigation: [[{ title: "Simple Test", href: "/docs/simple-test" }]]
  }))

})

test('Two Docs, each grouped by a different SDK', async () => {
  // Create temp environment with minimal files array
  const { tempDir, pathJoin } = await createTempFiles([
    {
      path: './docs/manifest.json',
      content: JSON.stringify({
        navigation: [
          [
            {
              title: "React",
              sdk: ["react"],
              items: [
                [
                  { title: "Quickstart", href: "/docs/quickstart/react" }
                ]
              ]
            },
            {
              title: "Vue",
              sdk: ["vue"],
              items: [
                [
                  { title: "Quickstart", href: "/docs/quickstart/vue" }
                ]
              ]
            }
          ],
        ]
      })
    },
    {
      path: './docs/quickstart/react.mdx',
      content: `---
title: Quickstart
---

# React Quickstart`
    },
    {
      path: './docs/quickstart/vue.mdx',
      content: `---
title: Quickstart
---

# Vue Quickstart`
    }
  ])

  await build(createBlankStore(), createConfig({
    ...baseConfig,
    basePath: tempDir,
    validSdks: ["react", "vue"]
  }))

  expect(await fileExists(pathJoin('./dist/react/manifest.json'))).toBe(true)
  expect(await readFile(pathJoin('./dist/react/manifest.json'))).toBe(JSON.stringify({
    navigation: [
      [
        {
          title: "React",
          items: [
            [
              { title: "Quickstart", href: "/docs/quickstart/react" }
            ]
          ]
        },
      ],
    ]
  }))
  expect(await treeDir(pathJoin('./dist'))).toEqual([
    'vue/manifest.json',
    'react/manifest.json',
    'quickstart/vue.mdx',
    'quickstart/react.mdx',
  ])

  expect(await fileExists(pathJoin('./dist/vue/manifest.json'))).toBe(true)
  expect(await readFile(pathJoin('./dist/vue/manifest.json'))).toBe(JSON.stringify({
    navigation: [
      [
        {
          title: "Vue",
          items: [
            [
              { title: "Quickstart", href: "/docs/quickstart/vue" }
            ]
          ]
        },
      ],
    ]
  }))

})

test('sdk in frontmatter filters the docs', async () => {
  const { tempDir, pathJoin } = await createTempFiles([
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
sdk: react
---

# Simple Test Page

Testing with a simple page.`
      }])

  await build(createBlankStore(), createConfig({
    ...baseConfig,
    basePath: tempDir,
    validSdks: ["react"]
  }))

  expect(await readFile(pathJoin('./dist/react/manifest.json'))).toBe(JSON.stringify({
    navigation: [[{ title: "Simple Test", href: "/docs/react/simple-test" }]]
  }))

  expect(await readFile(pathJoin('./dist/react/simple-test.mdx'))).toBe(`---
title: Simple Test
sdk: react
---

# Simple Test Page

Testing with a simple page.`)

  expect(await readFile(pathJoin('./dist/simple-test.mdx'))).toBe(`<SDKDocRedirectPage title="Simple Test" url="/docs/simple-test" sdk={["react"]} />`)

  expect(await treeDir(pathJoin('./dist'))).toEqual([
    'simple-test.mdx',
    'react/simple-test.mdx',
    'react/manifest.json',
  ])
})

test('3 sdks in frontmatter generates 3 variants', async () => {
  const { tempDir, pathJoin } = await createTempFiles([
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
sdk: react, vue, astro
---

# Simple Test Page

Testing with a simple page.`
    }
  ])

  await build(createBlankStore(), createConfig({
    ...baseConfig,
    basePath: tempDir,
    validSdks: ["react", "vue", "astro"]
  }))

  expect(await readFile(pathJoin('./dist/react/manifest.json'))).toBe(JSON.stringify({
    navigation: [[{ title: "Simple Test", href: "/docs/react/simple-test" }]]
  }))
  expect(await readFile(pathJoin('./dist/vue/manifest.json'))).toBe(JSON.stringify({
    navigation: [[{ title: "Simple Test", href: "/docs/vue/simple-test" }]]
  }))
  expect(await readFile(pathJoin('./dist/astro/manifest.json'))).toBe(JSON.stringify({
    navigation: [[{ title: "Simple Test", href: "/docs/astro/simple-test" }]]
  }))
})