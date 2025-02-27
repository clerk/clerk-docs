import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {glob} from 'glob';


import { expect, onTestFinished, test, vi } from 'vitest'
import { build, createBlankStore, createConfig } from './build-docs'

const tempConfig = {
  // Set to true to use local repo temp directory instead of system temp
  useLocalTemp: false,
  
  // Local temp directory path (relative to project root)
  localTempPath: './.temp-test',
  
  // Whether to preserve temp directories after tests
  // (helpful for debugging, but requires manual cleanup)
  preserveTemp: false
}

async function createTempFiles(
  files: { path: string; content: string }[],
  options?: { 
    prefix?: string;         // Prefix for the temp directory name
    preserveTemp?: boolean;  // Override global preserveTemp setting
    useLocalTemp?: boolean;  // Override global useLocalTemp setting
  }
) {
  const prefix = options?.prefix || 'clerk-docs-test-'
  const preserve = options?.preserveTemp ?? tempConfig.preserveTemp
  const useLocalTemp = options?.useLocalTemp ?? tempConfig.useLocalTemp
  
  // Determine base directory for temp files
  let baseDir: string
  
  if (useLocalTemp) {
    // Use local directory in the repo
    baseDir = tempConfig.localTempPath
    await fs.mkdir(baseDir, { recursive: true })
  } else {
    // Use system temp directory
    baseDir = os.tmpdir()
  }
  
  // Create temp folder with unique name
  const tempDir = await fs.mkdtemp(path.join(baseDir, prefix))

  // Create all files
  for (const file of files) {
    // Ensure the directory exists
    const filePath = path.join(tempDir, file.path)
    const dirPath = path.dirname(filePath)

    await fs.mkdir(dirPath, { recursive: true })

    // Write the file
    await fs.writeFile(filePath, file.content)
  }

  // Register cleanup unless preserveTemp is true
  if (!preserve) {
    onTestFinished(async () => {
      try {
        await fs.rm(tempDir, { recursive: true, force: true })
      } catch (error) {
        console.warn(`Warning: Failed to clean up temp folder ${tempDir}:`, error)
      }
    })
  } else {
    // Log the location for manual inspection
    console.log(`Preserving temp directory for inspection: ${tempDir}`)
  }

  // Return useful helpers
  return {
    tempDir,
    pathJoin: (...paths: string[]) => path.join(tempDir, ...paths),
    
    // Get a list of all files in the temp directory
    listFiles: async () => {
      return glob('**/*', { 
        cwd: tempDir,
        nodir: true 
      })
    },
    
    // Read file contents
    readFile: async (filePath: string): Promise<string> => {
      return fs.readFile(path.join(tempDir, filePath), 'utf-8')
    }
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

  const distFiles = await treeDir(pathJoin('./dist'))

  expect(distFiles.length).toBe(4)
  expect(distFiles).toContain('vue/manifest.json')
  expect(distFiles).toContain('react/manifest.json')
  expect(distFiles).toContain('quickstart/vue.mdx')
  expect(distFiles).toContain('quickstart/react.mdx')

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

  const distFiles = await treeDir(pathJoin('./dist'))

  expect(distFiles.length).toBe(3)
  expect(distFiles).toContain('simple-test.mdx')
  expect(distFiles).toContain('react/simple-test.mdx')
  expect(distFiles).toContain('react/manifest.json')
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

  const distFiles = await treeDir(pathJoin('./dist'))

  expect(distFiles.length).toBe(7)
  expect(distFiles).toContain('simple-test.mdx')
  expect(distFiles).toContain('react/simple-test.mdx')
  expect(distFiles).toContain('react/manifest.json')
  expect(distFiles).toContain('vue/simple-test.mdx')
  expect(distFiles).toContain('vue/manifest.json')
  expect(distFiles).toContain('astro/simple-test.mdx')
  expect(distFiles).toContain('astro/manifest.json')
})

test('<If> content filtered out when sdk is in frontmatter', async () => {
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
sdk: react, expo
---

# Simple Test Page

<If sdk="react">
  React Content
</If>

Testing with a simple page.`
    }
  ])

  await build(createBlankStore(), createConfig({
    ...baseConfig,
    basePath: tempDir,
    validSdks: ["react", "expo"]
  }))

  expect(await readFile(pathJoin('./dist/react/simple-test.mdx'))).toContain('React Content')

  expect(await readFile(pathJoin('./dist/expo/simple-test.mdx'))).not.toContain('React Content')
})

test('Invalid SDK in frontmatter fails the build', async () => {
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
sdk: react, expo, coffeescript
---

# Simple Test Page

Testing with a simple page.`
    }
  ])

  const promise = build(createBlankStore(), createConfig({
    ...baseConfig,
    basePath: tempDir,
    validSdks: ["react", "expo"]
  }))

  await expect(promise).rejects.toThrow(`Invalid SDK ["coffeescript"], the valid SDKs are ["react","expo"]`)
})

test('Invalid SDK in <If> fails the build', async () => {
  const { tempDir } = await createTempFiles([
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
sdk: react, expo
---

# Simple Test Page

<If sdk="astro">
  astro Content
</If>

Testing with a simple page.`
    }
  ])

  const logSpy = vi.spyOn(console, 'info')


  await build(createBlankStore(), createConfig({
    ...baseConfig,
    basePath: tempDir,
    validSdks: ["react", "expo"]
  }))


  expect(logSpy).toHaveBeenCalledWith(`/docs/simple-test.mdx
8:1-10:6 warning sdk \"astro\" in <If /> is not a valid SDK

⚠ 1 warning`)
})

