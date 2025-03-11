import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { glob } from 'glob'

import { describe, expect, onTestFinished, test } from 'vitest'
import { build, createConfig, createBlankStore } from './build-docs'

const tempConfig = {
  // Set to true to use local repo temp directory instead of system temp
  useLocalTemp: false,

  // Local temp directory path (relative to project root)
  localTempPath: './.temp-test',

  // Whether to preserve temp directories after tests
  // (helpful for debugging, but requires manual cleanup)
  preserveTemp: false,
}

async function createTempFiles(
  files: { path: string; content: string }[],
  options?: {
    prefix?: string // Prefix for the temp directory name
    preserveTemp?: boolean // Override global preserveTemp setting
    useLocalTemp?: boolean // Override global useLocalTemp setting
  },
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
    tempDir: path.join(tempDir, 'scripts'), // emulate that the base path is the scripts folder, to emulate __dirname
    pathJoin: (...paths: string[]) => path.join(tempDir, ...paths),

    // Get a list of all files in the temp directory
    listFiles: async () => {
      return glob('**/*', {
        cwd: tempDir,
        nodir: true,
      })
    },

    // Read file contents
    readFile: async (filePath: string): Promise<string> => {
      return fs.readFile(path.join(tempDir, filePath), 'utf-8')
    },
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
  return str.replace(/\r\n/g, '\n').trim()
}

function treeDir(baseDir: string) {
  return glob('**/*', {
    cwd: baseDir,
    nodir: true, // Only return files, not directories
  })
}

const baseConfig = {
  docsPath: '../docs',
  manifestPath: '../docs/manifest.json',
  partialsPath: '../docs/_partials',
  distPath: '../dist',
  ignorePaths: ['/docs/_partials'],
  manifestOptions: {
    wrapDefault: true,
    collapseDefault: false,
    hideTitleDefault: false,
  },
}

test('Basic build test with simple files', async () => {
  // Create temp environment with minimal files array
  const { tempDir, pathJoin } = await createTempFiles([
    {
      path: './docs/manifest.json',
      content: JSON.stringify({
        navigation: [[{ title: 'Simple Test', href: '/docs/simple-test' }]],
      }),
    },
    {
      path: './docs/simple-test.mdx',
      content: `---
title: Simple Test
description: This is a simple test page
---

# Simple Test Page

Testing with a simple page.`,
    },
  ])

  const output = await build(
    createBlankStore(),
    createConfig({
      ...baseConfig,
      basePath: tempDir,
      validSdks: ['nextjs', 'react'],
    }),
  )

  expect(output).toBe('')

  expect(await fileExists(pathJoin('./dist/simple-test.mdx'))).toBe(true)
  expect(await readFile(pathJoin('./dist/simple-test.mdx'))).toBe(`---
title: Simple Test
description: This is a simple test page
---

# Simple Test Page

Testing with a simple page.`)

  expect(await fileExists(pathJoin('./dist/manifest.json'))).toBe(true)
  expect(await readFile(pathJoin('./dist/manifest.json'))).toBe(
    JSON.stringify({
      navigation: [[{ title: 'Simple Test', href: '/docs/simple-test' }]],
    }),
  )
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
              title: 'React',
              sdk: ['react'],
              items: [[{ title: 'Quickstart', href: '/docs/quickstart/react' }]],
            },
            {
              title: 'Vue',
              sdk: ['vue'],
              items: [[{ title: 'Quickstart', href: '/docs/quickstart/vue' }]],
            },
          ],
        ],
      }),
    },
    {
      path: './docs/quickstart/react.mdx',
      content: `---
title: Quickstart
---

# React Quickstart`,
    },
    {
      path: './docs/quickstart/vue.mdx',
      content: `---
title: Quickstart
---

# Vue Quickstart`,
    },
  ])

  await build(
    createBlankStore(),
    createConfig({
      ...baseConfig,
      basePath: tempDir,
      validSdks: ['react', 'vue'],
    }),
  )

  expect(await fileExists(pathJoin('./dist/manifest.json'))).toBe(true)
  expect(await readFile(pathJoin('./dist/manifest.json'))).toBe(
    JSON.stringify({
      navigation: [
        [
          {
            title: 'React',
            sdk: ['react'],
            items: [[{ title: 'Quickstart', href: '/docs/:sdk:/quickstart/react', sdk: ['react'] }]],
          },
          {
            title: 'Vue',
            sdk: ['vue'],
            items: [[{ title: 'Quickstart', href: '/docs/:sdk:/quickstart/vue', sdk: ['vue'] }]],
          },
        ],
      ],
    }),
  )

  const distFiles = await treeDir(pathJoin('./dist'))

  expect(distFiles.length).toBe(3)
  expect(distFiles).toContain('manifest.json')
  expect(distFiles).toContain('quickstart/vue.mdx')
  expect(distFiles).toContain('quickstart/react.mdx')
})

test('sdk in frontmatter filters the docs', async () => {
  const { tempDir, pathJoin } = await createTempFiles([
    {
      path: './docs/manifest.json',
      content: JSON.stringify({
        navigation: [[{ title: 'Simple Test', href: '/docs/simple-test' }]],
      }),
    },
    {
      path: './docs/simple-test.mdx',
      content: `---
title: Simple Test
sdk: react
---

# Simple Test Page

Testing with a simple page.`,
    },
  ])

  await build(
    createBlankStore(),
    createConfig({
      ...baseConfig,
      basePath: tempDir,
      validSdks: ['react'],
    }),
  )

  expect(await readFile(pathJoin('./dist/manifest.json'))).toBe(
    JSON.stringify({ navigation: [[{ title: 'Simple Test', href: '/docs/:sdk:/simple-test', sdk: ['react'] }]] }),
  )

  expect(await readFile(pathJoin('./dist/react/simple-test.mdx'))).toBe(`---
title: Simple Test
sdk: react
---

# Simple Test Page

Testing with a simple page.`)

  expect(await readFile(pathJoin('./dist/simple-test.mdx'))).toBe(
    `<SDKDocRedirectPage title="Simple Test" url="/docs/simple-test" sdk={["react"]} />`,
  )

  const distFiles = await treeDir(pathJoin('./dist'))

  expect(distFiles.length).toBe(3)
  expect(distFiles).toContain('simple-test.mdx')
  expect(distFiles).toContain('manifest.json')
  expect(distFiles).toContain('react/simple-test.mdx')
})

test('3 sdks in frontmatter generates 3 variants', async () => {
  const { tempDir, pathJoin } = await createTempFiles([
    {
      path: './docs/manifest.json',
      content: JSON.stringify({
        navigation: [[{ title: 'Simple Test', href: '/docs/simple-test' }]],
      }),
    },
    {
      path: './docs/simple-test.mdx',
      content: `---
title: Simple Test
sdk: react, vue, astro
---

# Simple Test Page

Testing with a simple page.`,
    },
  ])

  await build(
    createBlankStore(),
    createConfig({
      ...baseConfig,
      basePath: tempDir,
      validSdks: ['react', 'vue', 'astro'],
    }),
  )

  expect(await readFile(pathJoin('./dist/manifest.json'))).toBe(
    JSON.stringify({
      navigation: [[{ title: 'Simple Test', href: '/docs/:sdk:/simple-test', sdk: ['react', 'vue', 'astro'] }]],
    }),
  )

  const distFiles = await treeDir(pathJoin('./dist'))

  expect(distFiles.length).toBe(5)
  expect(distFiles).toContain('simple-test.mdx')
  expect(distFiles).toContain('manifest.json')
  expect(distFiles).toContain('react/simple-test.mdx')
  expect(distFiles).toContain('vue/simple-test.mdx')
  expect(distFiles).toContain('astro/simple-test.mdx')
})

test('<If> content filtered out when sdk is in frontmatter', async () => {
  const { tempDir, pathJoin } = await createTempFiles([
    {
      path: './docs/manifest.json',
      content: JSON.stringify({
        navigation: [[{ title: 'Simple Test', href: '/docs/simple-test' }]],
      }),
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

Testing with a simple page.`,
    },
  ])

  await build(
    createBlankStore(),
    createConfig({
      ...baseConfig,
      basePath: tempDir,
      validSdks: ['react', 'expo'],
    }),
  )

  expect(await readFile(pathJoin('./dist/react/simple-test.mdx'))).toContain('React Content')

  expect(await readFile(pathJoin('./dist/expo/simple-test.mdx'))).not.toContain('React Content')
})

test('Invalid SDK in frontmatter fails the build', async () => {
  const { tempDir, pathJoin } = await createTempFiles([
    {
      path: './docs/manifest.json',
      content: JSON.stringify({
        navigation: [[{ title: 'Simple Test', href: '/docs/simple-test' }]],
      }),
    },
    {
      path: './docs/simple-test.mdx',
      content: `---
title: Simple Test
sdk: react, expo, coffeescript
---

# Simple Test Page

Testing with a simple page.`,
    },
  ])

  const promise = build(
    createBlankStore(),
    createConfig({
      ...baseConfig,
      basePath: tempDir,
      validSdks: ['react', 'expo'],
    }),
  )

  await expect(promise).rejects.toThrow(`Invalid SDK ["coffeescript"], the valid SDKs are ["react","expo"]`)
})

test('Invalid SDK in <If> fails the build', async () => {
  const { tempDir } = await createTempFiles([
    {
      path: './docs/manifest.json',
      content: JSON.stringify({
        navigation: [[{ title: 'Simple Test', href: '/docs/simple-test' }]],
      }),
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

Testing with a simple page.`,
    },
  ])

  const output = await build(
    createBlankStore(),
    createConfig({
      ...baseConfig,
      basePath: tempDir,
      validSdks: ['react', 'expo'],
    }),
  )

  expect(output).toContain(`warning sdk \"astro\" in <If /> is not a valid SDK`)
})

test('should fail when child SDK is not in parent SDK list', async () => {
  const { tempDir } = await createTempFiles([
    {
      path: './docs/manifest.json',
      content: JSON.stringify({
        navigation: [
          [
            {
              title: 'Authentication',
              sdk: ['react'],
              items: [
                [
                  {
                    title: 'Login',
                    href: '/docs/auth/login',
                    sdk: ['react', 'python'], // python not in parent
                  },
                ],
              ],
            },
          ],
        ],
      }),
    },
    {
      path: './docs/auth/login.mdx',
      content: `---
title: Login
sdk: react, python
---

# Login Page

Authentication login documentation.`,
    },
  ])

  const promise = build(
    createBlankStore(),
    createConfig({
      ...baseConfig,
      basePath: tempDir,
      validSdks: ['react', 'python', 'nextjs'],
    }),
  )

  await expect(promise).rejects.toThrow(
    'Doc "Login" is attempting to use ["react","python"] But its being filtered down to ["react"] in the manifest.json',
  )
})

describe('Includes and Partials', () => {
  test('<Include /> Component embeds content in to guide', async () => {
    const { tempDir, pathJoin } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [[{ title: 'Simple Test', href: '/docs/simple-test' }]],
        }),
      },
      {
        path: './docs/_partials/test-partial.mdx',
        content: `Test Partial Content`,
      },
      {
        path: './docs/simple-test.mdx',
        content: `---
title: Simple Test
---

<Include src="_partials/test-partial" />

# Simple Test Page`,
      },
    ])

    await build(
      createBlankStore(),
      createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
      }),
    )

    expect(await readFile(pathJoin('./dist/simple-test.mdx'))).toContain('Test Partial Content')
  })

  test('Invalid partial src fails the build', async () => {
    const { tempDir } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [[{ title: 'Simple Test', href: '/docs/simple-test' }]],
        }),
      },
      {
        path: './docs/simple-test.mdx',
        content: `---
title: Simple Test
---

<Include src="_partials/test-partial" />

# Simple Test Page`,
      },
    ])

    const output = await build(
      createBlankStore(),
      createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
      }),
    )

    expect(output).toContain(`warning Partial /docs/_partials/test-partial.mdx not found`)
  })

  test('Fail if partial is within a partial', async () => {
    const { tempDir } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [[{ title: 'Simple Test', href: '/docs/simple-test' }]],
        }),
      },
      {
        path: './docs/_partials/test-partial-1.mdx',
        content: `<Include src="_partials/test-partial-2" />`,
      },
      {
        path: './docs/_partials/test-partial-2.mdx',
        content: `Test Partial Content`,
      },
      {
        path: './docs/simple-test.mdx',
        content: `---
title: Simple Test
---

<Include src="_partials/test-partial-1" />

# Simple Test Page`,
      },
    ])

    const promise = build(
      createBlankStore(),
      createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
      }),
    )

    await expect(promise).rejects.toThrow(`Partials inside of partials is not yet supported`)
  })

  test(`Warning if <Include /> src doesn't start with "_partials/"`, async () => {
    const { tempDir } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [[{ title: 'Simple Test', href: '/docs/simple-test' }]],
        }),
      },
      {
        path: './docs/simple-test.mdx',
        content: `---
title: Simple Test
---

<Include src="test-partial" />

# Simple Test Page`,
      },
    ])

    const output = await build(
      createBlankStore(),
      createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
      }),
    )

    expect(output).toContain(`warning <Include /> prop "src" must start with "_partials/"`)
  })
})

describe('Link Validation and Processing', () => {
  test('Fail if link is to non-existent page', async () => {
    const { tempDir } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [[{ title: 'Simple Test', href: '/docs/simple-test' }]],
        }),
      },
      {
        path: './docs/simple-test.mdx',
        content: `---
title: Simple Test
---

[Non Existent Page](/docs/non-existent-page)

# Simple Test Page`,
      },
    ])

    const output = await build(
      createBlankStore(),
      createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
      }),
    )

    expect(output).toContain(`warning Doc /docs/non-existent-page not found`)
  })

  test('Validate link between two pages is valid', async () => {
    const { tempDir } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [[{ title: 'Simple Test', href: '/docs/simple-test' }]],
        }),
      },
      {
        path: './docs/simple-test.mdx',
        content: `---
title: Simple Test
---

[Core Page](/docs/core-page)

# Simple Test Page`,
      },
      {
        path: './docs/core-page.mdx',
        content: `---
title: Core Page
---

# Core Page`,
      },
    ])

    const output = await build(
      createBlankStore(),
      createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
      }),
    )

    expect(output).not.toContain(`warning Doc /docs/core-page not found`)
  })

  test('Warn if link is to existent page but with invalid hash', async () => {
    const { tempDir } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [[{ title: 'Simple Test', href: '/docs/simple-test' }]],
        }),
      },
      {
        path: './docs/simple-test.mdx',
        content: `---
title: Simple Test
---

[Simple Test](/docs/simple-test#non-existent-hash)  

# Simple Test Page`,
      },
    ])

    const output = await build(
      createBlankStore(),
      createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
      }),
    )

    expect(output).toContain(`warning Hash "non-existent-hash" not found in /docs/simple-test`)
  })

  test('Pick up on id in heading for hash alias', async () => {
    const { tempDir } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [
            [
              { title: 'Simple Test', href: '/docs/simple-test' },
              { title: 'Headings', href: '/docs/headings' },
            ],
          ],
        }),
      },
      {
        path: './docs/headings.mdx',
        content: `---
title: Headings
---

# test {{ toc: false, id: 'my-heading' }}`,
      },
      {
        path: './docs/simple-test.mdx',
        content: `---
title: Simple Test
---

[Headings](/docs/headings#my-heading)`,
      },
    ])

    const output = await build(
      createBlankStore(),
      createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
      }),
    )

    expect(output).not.toContain(`warning Hash "my-heading" not found in /docs/headings`)
  })

  test('Swap out links for <SDKLink /> when a link points to an sdk generated guide', async () => {
    const { tempDir, pathJoin } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [
            [
              { title: 'SDK Filtered Page', href: '/docs/sdk-filtered-page' },
              { title: 'Core Page', href: '/docs/core-page' },
            ],
          ],
        }),
      },
      {
        path: './docs/sdk-filtered-page.mdx',
        content: `---
title: SDK Filtered Page
sdk: react, nextjs
---

SDK filtered page`,
      },
      {
        path: './docs/core-page.mdx',
        content: `---
title: Core Page
---

# Core page

[SDK Filtered Page](/docs/sdk-filtered-page)
`,
      },
    ])

    await build(
      createBlankStore(),
      createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react', 'nextjs'],
      }),
    )

    expect(await readFile(pathJoin('./dist/core-page.mdx'))).toContain(
      `<SDKLink href="/docs/:sdk:/sdk-filtered-page" sdks={["react","nextjs"]}>SDK Filtered Page</SDKLink>`,
    )
  })
})

describe('SDK Filtering', () => {
  test('should handle SDK filtering with deeply nested manifest structures', async () => {
    const { tempDir, pathJoin } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [
            [
              {
                title: 'Top Level',
                items: [
                  [
                    {
                      title: 'Mid Level',
                      sdk: ['react', 'nextjs'],
                      items: [
                        [
                          {
                            title: 'Deep Level',
                            sdk: ['nextjs'],
                            items: [[{ title: 'Deeply Nested Page', href: '/docs/deeply-nested-nextjs' }]],
                          },
                          {
                            title: 'Deep Level',
                            sdk: ['react'],
                            items: [[{ title: 'Deeply Nested Page', href: '/docs/deeply-nested-react' }]],
                          },
                        ],
                      ],
                    },
                  ],
                ],
              },
            ],
          ],
        }),
      },
      {
        path: './docs/deeply-nested-nextjs.mdx',
        content: `---
title: Deeply Nested Page
sdk: nextjs
---

Content for Next.js users.`,
      },
      {
        path: './docs/deeply-nested-react.mdx',
        content: `---
title: Deeply Nested Page
sdk: react
---

Content for React users.`,
      },
    ])

    await build(
      createBlankStore(),
      createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react', 'nextjs', 'javascript-frontend'],
      }),
    )

    // Page should be available in nextjs (from manifest deep nesting)
    expect(await fileExists(pathJoin('./dist/nextjs/deeply-nested-nextjs.mdx'))).toBe(true)
    expect(await fileExists(pathJoin('./dist/nextjs/deeply-nested-react.mdx'))).toBe(false)
    expect(await readFile(pathJoin('./dist/nextjs/deeply-nested-nextjs.mdx'))).toContain('Content for Next.js users.')
    expect(await readFile(pathJoin('./dist/nextjs/deeply-nested-nextjs.mdx'))).not.toContain('Content for React users.')

    // Page should be available in react (from parent manifest item)
    expect(await fileExists(pathJoin('./dist/react/deeply-nested-react.mdx'))).toBe(true)
    expect(await fileExists(pathJoin('./dist/react/deeply-nested-nextjs.mdx'))).toBe(false)
    expect(await readFile(pathJoin('./dist/react/deeply-nested-react.mdx'))).toContain('Content for React users.')
    expect(await readFile(pathJoin('./dist/react/deeply-nested-react.mdx'))).not.toContain('Content for Next.js users.')

    // Page should NOT be available in javascript-frontend (filtered out by manifest)
    expect(await fileExists(pathJoin('./dist/javascript-frontend/deeply-nested-nextjs.mdx'))).toBe(false)
    expect(await fileExists(pathJoin('./dist/javascript-frontend/deeply-nested-react.mdx'))).toBe(false)
  })

  test('should correctly process multiple <If /> blocks with different SDKs in a single document', async () => {
    const { tempDir, pathJoin } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [
            [
              {
                title: 'Multiple SDK Blocks',
                href: '/multiple-sdk-blocks',
              },
            ],
          ],
        }),
      },
      {
        path: './docs/multiple-sdk-blocks.mdx',
        content: `---
title: Multiple SDK Blocks
sdk: react, nextjs, javascript-frontend
---

# Multiple SDK Blocks

<If sdk="react">
  This content is for React users only.
</If>

<If sdk="nextjs">
  This content is for Next.js users only.
</If>

<If sdk="javascript-frontend">
  This content is for JavaScript Frontend users only.
</If>

Common content for all SDKs.`,
      },
    ])

    await build(
      createBlankStore(),
      createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react', 'nextjs', 'javascript-frontend'],
      }),
    )

    // Check React version
    expect(await fileExists(pathJoin('./dist/react/multiple-sdk-blocks.mdx'))).toBe(true)
    const reactContent = await readFile(pathJoin('./dist/react/multiple-sdk-blocks.mdx'))
    expect(reactContent).toContain('This content is for React users only.')
    expect(reactContent).not.toContain('This content is for Next.js users only.')
    expect(reactContent).not.toContain('This content is for JavaScript Frontend users only.')
    expect(reactContent).toContain('Common content for all SDKs.')

    // Check Next.js version
    expect(await fileExists(pathJoin('./dist/nextjs/multiple-sdk-blocks.mdx'))).toBe(true)
    const nextjsContent = await readFile(pathJoin('./dist/nextjs/multiple-sdk-blocks.mdx'))
    expect(nextjsContent).not.toContain('This content is for React users only.')
    expect(nextjsContent).toContain('This content is for Next.js users only.')
    expect(nextjsContent).not.toContain('This content is for JavaScript Frontend users only.')
    expect(nextjsContent).toContain('Common content for all SDKs.')

    // Check JavaScript Frontend version
    expect(await fileExists(pathJoin('./dist/javascript-frontend/multiple-sdk-blocks.mdx'))).toBe(true)
    const jsContent = await readFile(pathJoin('./dist/javascript-frontend/multiple-sdk-blocks.mdx'))
    expect(jsContent).not.toContain('This content is for React users only.')
    expect(jsContent).not.toContain('This content is for Next.js users only.')
    expect(jsContent).toContain('This content is for JavaScript Frontend users only.')
    expect(jsContent).toContain('Common content for all SDKs.')
  })

  test('should handle nested <If /> components correctly', async () => {
    const { tempDir, pathJoin } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [
            [
              {
                title: 'Parent Group',
                sdk: ['react', 'nextjs'],
                items: [[{ title: 'Nested SDK Page', href: '/docs/nested-sdk-page' }]],
              },
            ],
          ],
        }),
      },
      {
        path: './docs/nested-sdk-page.mdx',
        content: `---
title: Nested SDK Page
sdk: react, nextjs
---

# Nested SDK Filtering

<If sdk={["nextjs", "react"]}>
  This content is for React users.
  
  <If sdk="nextjs">
    This is nested content specifically for Next.js users who are also using React.
  </If>
</If>

Common content for all SDKs.`,
      },
    ])

    await build(
      createBlankStore(),
      createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react', 'nextjs'],
      }),
    )

    // Check React output has only React content
    const reactOutput = await readFile(pathJoin('./dist/react/nested-sdk-page.mdx'))
    expect(reactOutput).toContain('This content is for React users.')
    expect(reactOutput).not.toContain('This is nested content specifically for Next.js users')

    // Check Next.js output has both React and Next.js content
    const nextjsOutput = await readFile(pathJoin('./dist/nextjs/nested-sdk-page.mdx'))
    expect(nextjsOutput).toContain('This content is for React users.')
    expect(nextjsOutput).toContain('This is nested content specifically for Next.js users')
  })

  test('should support <If /> components with array syntax for multiple SDKs', async () => {
    const { tempDir, pathJoin } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [
            [
              {
                title: 'Multiple SDK Test',
                href: '/docs/multiple-sdk-test',
              },
            ],
          ],
        }),
      },
      {
        path: './docs/multiple-sdk-test.mdx',
        content: `---
title: Multiple SDK Test
sdk: react, nextjs, javascript-frontend
---

# Multiple SDK Test

<If sdk={["react", "nextjs"]}>
  This content is for React and Next.js users.
</If>

<If sdk={["javascript-frontend"]}>
  This content is for JavaScript Frontend users.
</If>

Common content for all SDKs.`,
      },
    ])

    await build(
      createBlankStore(),
      createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react', 'nextjs', 'javascript-frontend'],
      }),
    )

    // Check React output has React content but not JavaScript Frontend content
    const reactOutput = await readFile(pathJoin('./dist/react/multiple-sdk-test.mdx'))
    expect(reactOutput).toContain('This content is for React and Next.js users.')
    expect(reactOutput).not.toContain('This content is for JavaScript Frontend users.')

    // Check Next.js output has Next.js content but not JavaScript Frontend content
    const nextjsOutput = await readFile(pathJoin('./dist/nextjs/multiple-sdk-test.mdx'))
    expect(nextjsOutput).toContain('This content is for React and Next.js users.')
    expect(nextjsOutput).not.toContain('This content is for JavaScript Frontend users.')

    // Check JavaScript Frontend output has JavaScript Frontend content but not React/Next.js content
    const jsOutput = await readFile(pathJoin('./dist/javascript-frontend/multiple-sdk-test.mdx'))
    expect(jsOutput).toContain('This content is for JavaScript Frontend users.')
    expect(jsOutput).not.toContain('This content is for React and Next.js users.')
  })
})

describe('Manifest Handling', () => {
  test('should apply manifest options (wrapDefault, collapseDefault, hideTitleDefault) correctly', async () => {
    const { tempDir, pathJoin } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [
            [
              {
                title: 'Group One',
                items: [[{ title: 'Item One', href: '/docs/item-one' }]],
                wrap: true,
                collapse: true,
                hideTitle: false,
              },
              {
                title: 'Group Two',
                items: [[{ title: 'Item Two', href: '/docs/item-two' }]],
                wrap: true,
                collapse: false,
                hideTitle: true,
              },
              {
                title: 'Group Three',
                items: [[{ title: 'Item Three', href: '/docs/item-three' }]],
                wrap: false,
                collapse: true,
                hideTitle: false,
              },
              {
                title: 'Group Four',
                items: [[{ title: 'Item Four', href: '/docs/item-four' }]],
                wrap: false,
                collapse: false,
                hideTitle: true,
              },
            ],
          ],
        }),
      },
      { path: './docs/item-one.mdx', content: `---\ntitle: Item One\n---\nItem One` },
      { path: './docs/item-two.mdx', content: `---\ntitle: Item Two\n---\nItem Two` },
      { path: './docs/item-three.mdx', content: `---\ntitle: Item Three\n---\nItem Three` },
      { path: './docs/item-four.mdx', content: `---\ntitle: Item Four\n---\nItem Four` },
    ])

    await build(
      createBlankStore(),
      createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['nextjs'],
        manifestOptions: {
          wrapDefault: false,
          collapseDefault: false,
          hideTitleDefault: false,
        },
      }),
    )

    const manifest = JSON.parse(await readFile(pathJoin('./dist/manifest.json')))
    const groups = manifest.navigation[0]

    expect(groups[0].wrap).toBe(true)
    expect(groups[0].collapse).toBe(true)
    expect(groups[0].hideTitle).toBe(undefined)

    expect(groups[1].wrap).toBe(true)
    expect(groups[1].collapse).toBe(undefined)
    expect(groups[1].hideTitle).toBe(true)

    expect(groups[2].wrap).toBe(undefined)
    expect(groups[2].collapse).toBe(true)
    expect(groups[2].hideTitle).toBe(undefined)

    expect(groups[3].wrap).toBe(undefined)
    expect(groups[3].collapse).toBe(undefined)
    expect(groups[3].hideTitle).toBe(true)
  })

  test('should properly inherit SDK filtering from parent groups to child items', async () => {
    const { tempDir, pathJoin } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [
            [
              {
                title: 'SDK Group',
                sdk: ['nextjs', 'react'],
                items: [
                  [
                    {
                      title: 'Sub Group',
                      items: [
                        [
                          { title: 'SDK Item', href: '/docs/sdk-item' },
                          { title: 'Nested Group', items: [[{ title: 'Nested Item', href: '/docs/nested-item' }]] },
                        ],
                      ],
                    },
                  ],
                ],
              },
              {
                title: 'Generic Group',
                items: [
                  [
                    {
                      title: 'Sub Group',
                      items: [[{ title: 'Generic Item', href: '/docs/generic-item' }]],
                    },
                  ],
                ],
              },
              {
                title: 'Vue Group',
                sdk: ['vue'],
                items: [
                  [
                    {
                      title: 'Sub Group',
                      items: [[{ title: 'Vue Item', href: '/docs/vue-item' }]],
                    },
                  ],
                ],
              },
            ],
          ],
        }),
      },
      {
        path: './docs/sdk-item.mdx',
        content: `---\ntitle: SDK Item\n---\nSDK specific content`,
      },
      {
        path: './docs/nested-item.mdx',
        content: `---\ntitle: Nested Item\n---\nNested SDK specific content`,
      },
      {
        path: './docs/generic-item.mdx',
        content: `---\ntitle: Generic Item\n---\nGeneric content`,
      },
      {
        path: './docs/vue-item.mdx',
        content: `---\ntitle: Vue Item\n---\nVue specific content`,
      },
    ])

    await build(
      createBlankStore(),
      createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['nextjs', 'react', 'vue'],
      }),
    )

    // Check manifest
    const manifest = JSON.parse(await readFile(pathJoin('./dist/manifest.json')))

    expect(manifest).toEqual({
      navigation: [
        [
          {
            title: 'SDK Group',
            sdk: ['nextjs', 'react'],
            items: [
              [
                {
                  title: 'Sub Group',
                  sdk: ['nextjs', 'react'],
                  items: [
                    [
                      { title: 'SDK Item', sdk: ['nextjs', 'react'], href: '/docs/:sdk:/sdk-item' },
                      {
                        title: 'Nested Group',
                        sdk: ['nextjs', 'react'],
                        items: [[{ title: 'Nested Item', sdk: ['nextjs', 'react'], href: '/docs/:sdk:/nested-item' }]],
                      },
                    ],
                  ],
                },
              ],
            ],
          },
          {
            title: 'Generic Group',
            items: [
              [
                {
                  title: 'Sub Group',
                  items: [[{ title: 'Generic Item', href: '/docs/generic-item' }]],
                },
              ],
            ],
          },
          {
            title: 'Vue Group',
            sdk: ['vue'],
            items: [
              [
                {
                  title: 'Sub Group',
                  sdk: ['vue'],
                  items: [[{ title: 'Vue Item', sdk: ['vue'], href: '/docs/:sdk:/vue-item' }]],
                },
              ],
            ],
          },
        ],
      ],
    })
  })

  test('Check link and hash in partial is valid', async () => {
    const { tempDir } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [
            [
              { title: 'Page 1', href: '/docs/page-1' },
              { title: 'Page 2', href: '/docs/page-2' },
            ],
          ],
        }),
      },
      {
        path: './docs/page-1.mdx',
        content: `---
title: Page 1
---

<Include src="_partials/links" />`,
      },
      {
        path: './docs/_partials/links.mdx',
        content: `---
title: Links
---

[Page 2](/docs/page-2#my-heading)
[Page 2](/docs/page-3)`,
      },
      {
        path: './docs/page-2.mdx',
        content: `---
title: Page 2
---

test`,
      },
    ])

    const output = await build(
      createBlankStore(),
      createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
      }),
    )

    expect(output).toContain(`warning Hash "my-heading" not found in /docs/page-2`)
    expect(output).toContain(`warning Doc /docs/page-3 not found`)
  })
})

describe('Path and File Handling', () => {
  test('should ignore paths specified in ignorePaths during processing', async () => {
    const { tempDir, pathJoin, listFiles } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [
            [
              { title: 'Regular Guide', href: '/docs/regular-guide' },
              { title: 'Ignored Guide', href: '/docs/ignored/ignored-guide' },
            ],
          ],
        }),
      },
      {
        path: './docs/regular-guide.mdx',
        content: `---
title: Regular Guide
---

# Regular Guide Content`,
      },
      {
        path: './docs/ignored/ignored-guide.mdx',
        content: `---
title: Ignored Guide
---

# Ignored Guide Content`,
      },
    ])

    await build(
      createBlankStore(),
      createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
        ignorePaths: ['/docs/ignored'],
      }),
    )

    // Check that only the regular guide was processed
    const distFiles = (await listFiles()).filter((file) => file.startsWith('dist/'))

    expect(distFiles).toContain('dist/regular-guide.mdx')
    expect(distFiles).toContain('dist/manifest.json')
    expect(distFiles).not.toContain('dist/ignored/ignored-guide.mdx')

    // Verify that the manifest was filtered correctly
    expect(JSON.parse(await readFile(pathJoin('./dist/manifest.json')))).toEqual({
      navigation: [
        [
          {
            title: 'Regular Guide',
            href: '/docs/regular-guide',
          },
          {
            title: 'Ignored Guide',
            href: '/docs/ignored/ignored-guide',
          },
        ],
      ],
    })
  })

  test('should detect file path conflicts when a core doc path matches an SDK path', async () => {
    const { tempDir } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [[{ title: 'React Doc', href: '/docs/react/conflict' }]],
        }),
      },
      {
        path: './docs/react/conflict.mdx',
        content: `---
title: React Doc
---

# This will cause a conflict because it's in a path that starts with "react"`,
      },
    ])

    // This should throw an error because the file path starts with an SDK name
    const promise = build(
      createBlankStore(),
      createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
      }),
    )

    await expect(promise).rejects.toThrow(
      'Doc "/docs/react/conflict" is attempting to write out a doc to react/conflict.mdx but the first part of the path is a valid SDK, this causes a file path conflict.',
    )
  })

  test('should remove .mdx suffix from markdown links', async () => {
    const { tempDir, pathJoin } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [
            [
              { title: 'Source Page', href: '/docs/source-page' },
              { title: 'Target Page', href: '/docs/target-page' },
            ],
          ],
        }),
      },
      {
        path: './docs/source-page.mdx',
        content: `---
title: Source Page
---

# Source Page

[Link to Target with .mdx](/docs/target-page.mdx)
[Link to Target without .mdx](/docs/target-page)
[Link to Target with hash](/docs/target-page#target-page-content)
[Link to Target with hash and .mdx](/docs/target-page.mdx#target-page-content)`,
      },
      {
        path: './docs/target-page.mdx',
        content: `---
title: Target Page
---

# Target Page Content`,
      },
    ])

    await build(
      createBlankStore(),
      createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
      }),
    )

    // Both links should be processed to remove .mdx
    const sourcePageContent = await readFile(pathJoin('./dist/source-page.mdx'))

    // The link should have .mdx removed
    expect(sourcePageContent).toContain('[Link to Target with .mdx](/docs/target-page)')
    expect(sourcePageContent).toContain('[Link to Target without .mdx](/docs/target-page)')
    expect(sourcePageContent).toContain('[Link to Target with hash](/docs/target-page#target-page-content)')
    expect(sourcePageContent).toContain(
      '[Link to Target with hash and .mdx](/docs/target-page#target-page-content)',
    )
    expect(sourcePageContent).not.toContain('/docs/target-page.mdx')
  })
})

describe('Edge Cases', () => {
  test('should report errors for malformed frontmatter', async () => {
    const { tempDir } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [[{ title: 'Malformed Frontmatter', href: '/docs/malformed-frontmatter' }]],
        }),
      },
      {
        path: './docs/malformed-frontmatter.mdx',
        content: `---
title: Malformed Frontmatter
description: \`This frontmatter has an unbalanced quote
---

# Content with malformed frontmatter`,
      },
    ])

    // This should throw a parsing error
    const promise = build(
      createBlankStore(),
      createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
      }),
    )

    await expect(promise).rejects.toThrow('Plain value cannot start with reserved character')
  })

  test('should require and validate mandatory frontmatter fields', async () => {
    const { tempDir } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [[{ title: 'Missing Title', href: '/docs/missing-title' }]],
        }),
      },
      {
        path: './docs/missing-title.mdx',
        content: `---
description: This frontmatter is missing the required title field
---

# Content with missing title in frontmatter`,
      },
    ])

    // This should throw an error about missing title
    const promise = build(
      createBlankStore(),
      createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
      }),
    )

    await expect(promise).rejects.toThrow('Frontmatter must have a "title" property')
  })

  test('should fail on special characters in paths', async () => {
    const { tempDir } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [[{ title: 'Space in url', href: '/docs/space in url' }]],
        }),
      },
      {
        path: './docs/space in url.mdx',
        content: `---\ntitle: Space in url\n---`,
      },
    ])

    const promise = build(
      createBlankStore(),
      createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
      }),
    )

    await expect(promise).rejects.toThrow(
      'Href "/docs/space in url" contains characters that will be encoded by the browser, please remove them',
    )
  })
})

describe('Error Reporting', () => {
  test('should produce clear and informative error messages for validation failures', async () => {
    const { tempDir } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [[{ title: 'Validation Error', href: '/docs/validation-error' }]],
        }),
      },
      {
        path: './docs/validation-error.mdx',
        content: `---
title: Validation Error
sdk: react, invalid-sdk
---

# Validation Error Page

This page has an invalid SDK in frontmatter.`,
      },
    ])

    // This should throw an error with specific message about invalid SDK
    const promise = build(
      createBlankStore(),
      createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
      }),
    )

    await expect(promise).rejects.toThrow('Invalid SDK ["invalid-sdk"], the valid SDKs are ["react"]')
  })

  test('should handle errors when a referenced document exists but is invalid', async () => {
    const { tempDir } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [
            [
              { title: 'Valid Document', href: '/docs/valid-document' },
              { title: 'Invalid Reference', href: '/docs/invalid-reference' },
            ],
          ],
        }),
      },
      {
        path: './docs/valid-document.mdx',
        content: `---
title: Valid Document
---

# Valid Document

[Link to Invalid Reference](/docs/invalid-reference#non-existent-header)`,
      },
      {
        path: './docs/invalid-reference.mdx',
        content: `---
title: Invalid Reference
---

# Invalid Reference

This document doesn't have the referenced header.`,
      },
    ])

    // Should complete with warnings
    const output = await build(
      createBlankStore(),
      createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
      }),
    )

    // Should report warning about missing hash
    expect(output).toContain('warning Hash "non-existent-header" not found in /docs/invalid-reference')
  })

  test('should complete build workflow when errors are present in some files', async () => {
    const { tempDir, pathJoin } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [
            [
              { title: 'Valid Document', href: '/docs/valid-document' },
              { title: 'Document with Warnings', href: '/docs/document-with-warnings' },
            ],
          ],
        }),
      },
      {
        path: './docs/valid-document.mdx',
        content: `---
title: Valid Document
---

# Valid Document

This is a completely valid document.`,
      },
      {
        path: './docs/document-with-warnings.mdx',
        content: `---
title: Document with Warnings
---

# Document with Warnings

[Broken Link](/docs/non-existent-document)

<If sdk="invalid-sdk">
  This content has an invalid SDK.
</If>`,
      },
    ])

    // Should complete with warnings
    const output = await build(
      createBlankStore(),
      createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
      }),
    )

    // Check that the build completed and valid files were created
    expect(await fileExists(pathJoin('./dist/valid-document.mdx'))).toBe(true)
    expect(await fileExists(pathJoin('./dist/document-with-warnings.mdx'))).toBe(true)

    // Check that warnings were reported
    expect(output).toContain('warning Doc /docs/non-existent-document not found')
    expect(output).toContain('warning sdk "invalid-sdk" in <If /> is not a valid SDK')
  })
})

describe('Advanced Features', () => {
  test('should correctly handle links with anchors to specific sections of documents', async () => {
    const { tempDir, pathJoin } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [
            [
              { title: 'Source Document', href: '/docs/source-document' },
              { title: 'Target Document', href: '/docs/target-document' },
            ],
          ],
        }),
      },
      {
        path: './docs/source-document.mdx',
        content: `---
title: Source Document
---

# Source Document

[Link to Section 1](/docs/target-document#section-1)
[Link to Section 2](/docs/target-document#section-2)
[Link to Invalid Section](/docs/target-document#invalid-section)`,
      },
      {
        path: './docs/target-document.mdx',
        content: `---
title: Target Document
---

# Target Document

## Section 1

Content for section 1.

## Section 2

Content for section 2.`,
      },
    ])

    const output = await build(
      createBlankStore(),
      createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
      }),
    )

    // Valid links should work without warnings
    expect(output).not.toContain('warning Hash "section-1" not found')
    expect(output).not.toContain('warning Hash "section-2" not found')

    // Invalid link should produce a warning
    expect(output).toContain('warning Hash "invalid-section" not found in /docs/target-document')
  })

  test('should process target="_blank" links in manifest correctly', async () => {
    const { tempDir, pathJoin } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [
            [
              { title: 'Normal Link', href: '/docs/normal-link' },
              { title: 'External Link', href: 'https://example.com', target: '_blank' },
            ],
          ],
        }),
      },
      {
        path: './docs/normal-link.mdx',
        content: `---
title: Normal Link
---

# Normal Link

This is a normal document.`,
      },
    ])

    await build(
      createBlankStore(),
      createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
      }),
    )

    // Check that the manifest contains the target="_blank" attribute
    const manifest = JSON.parse(await readFile(pathJoin('./dist/manifest.json')))
    expect(manifest).toEqual({
      navigation: [
        [
          { title: 'Normal Link', href: '/docs/normal-link' },
          { title: 'External Link', href: 'https://example.com', target: '_blank' },
        ],
      ],
    })
  })

  test('should generate appropriate landing pages for SDK-specific docs', async () => {
    const { tempDir, pathJoin } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [[{ title: 'SDK Document', href: '/docs/sdk-document' }]],
        }),
      },
      {
        path: './docs/sdk-document.mdx',
        content: `---
title: SDK Document
sdk: react, nextjs
---

# SDK Document

This document is available for React and Next.js.`,
      },
    ])

    await build(
      createBlankStore(),
      createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react', 'nextjs'],
      }),
    )

    // Check that SDK-specific versions were created
    expect(await fileExists(pathJoin('./dist/react/sdk-document.mdx'))).toBe(true)
    expect(await fileExists(pathJoin('./dist/nextjs/sdk-document.mdx'))).toBe(true)

    // Check that a landing page was created at the original URL
    expect(await fileExists(pathJoin('./dist/sdk-document.mdx'))).toBe(true)

    // Verify landing page content
    const landingPage = await readFile(pathJoin('./dist/sdk-document.mdx'))
    expect(landingPage).toBe(
      '<SDKDocRedirectPage title="SDK Document" url="/docs/sdk-document" sdk={["react","nextjs"]} />',
    )
  })
})
