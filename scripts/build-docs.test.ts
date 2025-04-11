import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { glob } from 'glob'

import { describe, expect, onTestFinished, test } from 'vitest'
import { build, createConfig, createBlankStore, invalidateFile } from './build-docs'

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
  ignoreWarnings: {},
  manifestOptions: {
    wrapDefault: true,
    collapseDefault: false,
    hideTitleDefault: false,
  },
  cleanDist: false,
}

describe('Basic Functionality', () => {
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

  test('Warning on missing description in frontmatter', async () => {
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

    expect(output).toContain('warning Frontmatter should have a "description" property')
  })

  test('should ignore non-MDX files in the docs folder', async () => {
    const { tempDir, pathJoin } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [[{ title: 'MDX Doc', href: '/docs/mdx-doc' }]],
        }),
      },
      {
        path: './docs/mdx-doc.mdx',
        content: `---
title: MDX Doc
---

# MDX Document`,
      },
      {
        path: './docs/non-mdx-file.txt',
        content: `This is a text file, not an MDX file.`,
      },
      {
        path: './docs/image.png',
        content: `fake image content`,
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

    // Verify only MDX files were processed
    expect(await fileExists(pathJoin('./dist/mdx-doc.mdx'))).toBe(true)
    expect(await fileExists(pathJoin('./dist/non-mdx-file.txt'))).toBe(false)
    expect(await fileExists(pathJoin('./dist/image.png'))).toBe(false)
  })
})

describe('Manifest Validation', () => {
  test('should fail build with completely malformed manifest JSON', async () => {
    const { tempDir } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: '{invalid json structure',
      },
      {
        path: './docs/simple-test.mdx',
        content: `---
title: Simple Test
---

# Simple Test`,
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

    await expect(promise).rejects.toThrow('Failed to parse manifest:')
  })

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
                      { title: 'SDK Item', sdk: ['nextjs', 'react'], href: '/docs/sdk-item' },
                      {
                        title: 'Nested Group',
                        sdk: ['nextjs', 'react'],
                        items: [[{ title: 'Nested Item', sdk: ['nextjs', 'react'], href: '/docs/nested-item' }]],
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
                  items: [[{ title: 'Vue Item', sdk: ['vue'], href: '/docs/vue-item' }]],
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
})

describe('SDK Processing', () => {
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
              items: [[{ title: 'Quickstart', href: '/docs/quickstart/react', sdk: ['react'] }]],
            },
            {
              title: 'Vue',
              sdk: ['vue'],
              items: [[{ title: 'Quickstart', href: '/docs/quickstart/vue', sdk: ['vue'] }]],
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
canonical: /docs/:sdk:/simple-test
---

# Simple Test Page

Testing with a simple page.`)

    expect(await readFile(pathJoin('./dist/simple-test.mdx'))).toBe(
      `---\ntemplate: wide\n---\n<SDKDocRedirectPage title="Simple Test" href="/docs/:sdk:/simple-test" sdks={["react"]} />`,
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
description: This document is available for React and Next.js.
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
      `---\ntemplate: wide\n---\n<SDKDocRedirectPage title="SDK Document" description="This document is available for React and Next.js." href="/docs/:sdk:/sdk-document" sdks={["react","nextjs"]} />`,
    )
  })

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
        validSdks: ['react', 'nextjs', 'js-frontend'],
      }),
    )

    expect(JSON.parse(await readFile(pathJoin('./dist/manifest.json')))).toEqual({
      navigation: [
        [
          {
            title: 'Top Level',
            sdk: ['react', 'nextjs'],
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
                        items: [
                          [
                            {
                              href: '/docs/:sdk:/deeply-nested-nextjs',
                              sdk: ['nextjs'],
                              title: 'Deeply Nested Page',
                            },
                          ],
                        ],
                      },
                      {
                        title: 'Deep Level',
                        sdk: ['react'],
                        items: [
                          [
                            {
                              title: 'Deeply Nested Page',
                              sdk: ['react'],
                              href: '/docs/:sdk:/deeply-nested-react',
                            },
                          ],
                        ],
                      },
                    ],
                  ],
                },
              ],
            ],
          },
        ],
      ],
    })

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

    // Page should NOT be available in js-frontend (filtered out by manifest)
    expect(await fileExists(pathJoin('./dist/js-frontend/deeply-nested-nextjs.mdx'))).toBe(false)
    expect(await fileExists(pathJoin('./dist/js-frontend/deeply-nested-react.mdx'))).toBe(false)
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
sdk: react, nextjs, js-frontend
---

# Multiple SDK Blocks

<If sdk="react">
  This content is for React users only.
</If>

<If sdk="nextjs">
  This content is for Next.js users only.
</If>

<If sdk="js-frontend">
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
        validSdks: ['react', 'nextjs', 'js-frontend'],
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
    expect(await fileExists(pathJoin('./dist/js-frontend/multiple-sdk-blocks.mdx'))).toBe(true)
    const jsContent = await readFile(pathJoin('./dist/js-frontend/multiple-sdk-blocks.mdx'))
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
sdk: react, nextjs, js-frontend
---

# Multiple SDK Test

<If sdk={["react", "nextjs"]}>
  This content is for React and Next.js users.
</If>

<If sdk={["js-frontend"]}>
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
        validSdks: ['react', 'nextjs', 'js-frontend'],
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
    const jsOutput = await readFile(pathJoin('./dist/js-frontend/multiple-sdk-test.mdx'))
    expect(jsOutput).toContain('This content is for JavaScript Frontend users.')
    expect(jsOutput).not.toContain('This content is for React and Next.js users.')
  })

  test('should embed canonical link in frontmatter', async () => {
    const { tempDir, pathJoin } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [
            [
              {
                title: 'Overview',
                href: '/docs/overview',
              },
            ],
          ],
        }),
      },
      {
        path: './docs/overview.mdx',
        content: `---
title: Overview
sdk: fastify, expressjs
---

# Hello World`,
      },
    ])

    await build(
      createBlankStore(),
      createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['fastify', 'expressjs'],
      }),
    )

    expect(await readFile(pathJoin('./dist/fastify/overview.mdx'))).toContain('canonical: /docs/:sdk:/overview')
    expect(await readFile(pathJoin('./dist/expressjs/overview.mdx'))).toContain('canonical: /docs/:sdk:/overview')
  })
})

describe('Heading Validation', () => {
  test('should error on duplicate headings', async () => {
    const { tempDir, pathJoin } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [[{ title: 'Duplicate Headings', href: '/docs/duplicate-headings' }]],
        }),
      },
      {
        path: './docs/duplicate-headings.mdx',
        content: `---
title: Duplicate Headings
---

# Heading {{ id: 'custom-id' }}

## Another Heading {{ id: 'custom-id' }}

[Link to first heading](#custom-id)`,
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
      'Doc "/docs/duplicate-headings" contains a duplicate heading id "custom-id", please ensure all heading ids are unique',
    )
  })

  test('should not error on duplicate headings if they are in different <If /> components', async () => {
    const { tempDir } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [[{ title: 'Quickstart', href: '/docs/quickstart' }]],
        }),
      },
      {
        path: './docs/quickstart.mdx',
        content: `---
title: Quickstart
description: Quickstart page
sdk: react, nextjs
---

<If sdk="react">
  # Title {{ id: 'title' }}
</If>

<If sdk="nextjs">
  # Title {{ id: 'title' }}
</If>`,
      },
    ])

    const output = await build(
      createBlankStore(),
      createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react', 'nextjs'],
      }),
    )

    expect(output).toBe('')
  })

  test('should error on duplicate headings if they are in different <If /> components but with the same sdk', async () => {
    const { tempDir } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [[{ title: 'Quickstart', href: '/docs/quickstart' }]],
        }),
      },
      {
        path: './docs/quickstart.mdx',
        content: `---
title: Quickstart
description: Quickstart page
sdk: react, nextjs
---

<If sdk="react">
  # Title {{ id: 'title' }}
</If>

<If sdk="react">
  # Title {{ id: 'title' }}
</If>`,
      },
    ])

    const promise = build(
      createBlankStore(),
      createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react', 'nextjs'],
      }),
    )

    await expect(promise).rejects.toThrow(
      'Doc "/docs/quickstart.mdx" contains a duplicate heading id "title", please ensure all heading ids are unique',
    )
  })

  test('should error on duplicate headings if they are in different <If /> components but with the same sdk without sdk in frontmatter', async () => {
    const { tempDir } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [[{ title: 'Quickstart', href: '/docs/quickstart' }]],
        }),
      },
      {
        path: './docs/quickstart.mdx',
        content: `---
title: Quickstart
description: Quickstart page
---

<If sdk="react">
  # Title {{ id: 'title' }}
</If>

<If sdk="react">
  # Title {{ id: 'title' }}
</If>`,
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
      'Doc "/docs/quickstart.mdx" contains a duplicate heading id "title", please ensure all heading ids are unique',
    )
  })
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

  test('<Include /> Component embeds content in to sdk scoped guide', async () => {
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
sdk: react
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

    expect(await readFile(pathJoin('./dist/react/simple-test.mdx'))).toContain('Test Partial Content')
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

  test('Should swap out links for <SDKLink /> in partials', async () => {
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
        path: './docs/_partials/links.mdx',
        content: `[SDK Filtered Page](/docs/sdk-filtered-page)`,
      },
      {
        path: './docs/core-page.mdx',
        content: `---
title: Core Page
---

# Core page

<Include src="_partials/links" />
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

  test('Should swap out links for <SDKLink /> inside a component', async () => {
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

<Properties>
  - afterMultiSessionSingleSignOutUrl
  - string

  go use [SDK Filtered Page](/docs/sdk-filtered-page)
</Properties>
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

  test('if the contents of a link starts with a ` and ends with a ` it should inject the code prop', async () => {
    const { tempDir, pathJoin } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [
            [
              { title: 'Link with code', href: '/docs/link-with-code' },
              { title: 'Sign In', href: '/docs/components/sign-in' },
            ],
          ],
        }),
      },
      {
        path: './docs/components/sign-in.mdx',
        content: `---
title: Sign In
description: Sign In component
sdk: react, nextjs
---

\`\`\`js
const x = 'y'
\`\`\`
`,
      },
      {
        path: './docs/link-with-code.mdx',
        content: `---
title: Link with code
description: Link with code
---
- [\`<SignIn />\`](/docs/components/sign-in)
`,
      },
    ])

    const output = await build(
      createBlankStore(),
      createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react', 'nextjs'],
      }),
    )

    expect(output).toBe('')

    expect(await readFile(pathJoin('./dist/link-with-code.mdx'))).toContain(
      `<SDKLink href="/docs/:sdk:/components/sign-in" sdks={["react","nextjs"]} code={true}>\\<SignIn /></SDKLink>`,
    )
  })

  test('if the contents of a link starts with a ` and ends with a ` it should inject the code prop (when in a partial)', async () => {
    const { tempDir, pathJoin } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [
            [
              { title: 'Link with code', href: '/docs/link-with-code' },
              { title: 'Sign In', href: '/docs/components/sign-in' },
            ],
          ],
        }),
      },
      {
        path: './docs/components/sign-in.mdx',
        content: `---
title: Sign In
description: Sign In component
sdk: react, nextjs
---

\`\`\`js
const x = 'y'
\`\`\`
`,
      },
      {
        path: './docs/_partials/links.mdx',
        content: `[\`<SignIn />\`](/docs/components/sign-in)`,
      },
      {
        path: './docs/link-with-code.mdx',
        content: `---
title: Link with code
description: Link with code
---
- <Include src="_partials/links" />
`,
      },
    ])

    const output = await build(
      createBlankStore(),
      createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react', 'nextjs'],
      }),
    )

    expect(output).toBe('')

    expect(await readFile(pathJoin('./dist/link-with-code.mdx'))).toContain(
      `<SDKLink href="/docs/:sdk:/components/sign-in" sdks={["react","nextjs"]} code={true}>\\<SignIn /></SDKLink>`,
    )
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

  test('should remove .mdx suffix from links in standard pages', async () => {
    const { tempDir, pathJoin } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [
            [
              { title: 'Target Page', href: '/docs/target-page' },
              { title: 'Standard Page', href: '/docs/standard-page' },
            ],
          ],
        }),
      },
      {
        path: './docs/target-page.mdx',
        content: `---
title: Target Page
---

# Target Page Content`,
      },
      {
        path: './docs/standard-page.mdx',
        content: `---
title: Standard Page
---

# Standard Page

[Link to Target with .mdx](/docs/target-page.mdx)
[Link to Target without .mdx](/docs/target-page)
[Link to Target with hash](/docs/target-page#target-page-content)
[Link to Target with hash and .mdx](/docs/target-page.mdx#target-page-content)`,
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

    // links should be processed to remove .mdx
    const standardPageContent = await readFile(pathJoin('./dist/standard-page.mdx'))
    expect(standardPageContent).toContain('[Link to Target with .mdx](/docs/target-page)')
    expect(standardPageContent).toContain('[Link to Target without .mdx](/docs/target-page)')
    expect(standardPageContent).toContain('[Link to Target with hash](/docs/target-page#target-page-content)')
    expect(standardPageContent).toContain('[Link to Target with hash and .mdx](/docs/target-page#target-page-content)')
    expect(standardPageContent).not.toContain('/docs/target-page.mdx')
  })

  test('should remove .mdx suffix from links in pages with partials', async () => {
    const { tempDir, pathJoin } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [
            [
              { title: 'Target Page', href: '/docs/target-page' },
              { title: 'Partials Page', href: '/docs/partials-page' },
            ],
          ],
        }),
      },
      {
        path: './docs/target-page.mdx',
        content: `---
title: Target Page
---

# Target Page Content`,
      },
      {
        path: './docs/_partials/links.mdx',
        content: `---
title: Links
---

[Link to Target with .mdx](/docs/target-page.mdx)
[Link to Target without .mdx](/docs/target-page)
[Link to Target with hash](/docs/target-page#target-page-content)
[Link to Target with hash and .mdx](/docs/target-page.mdx#target-page-content)`,
      },
      {
        path: './docs/partials-page.mdx',
        content: `---
title: Partials Page
---

<Include src="_partials/links" />`,
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

    // Partials should be processed to remove .mdx
    const partialsPageContent = await readFile(pathJoin('./dist/partials-page.mdx'))
    expect(partialsPageContent).toContain('[Link to Target with .mdx](/docs/target-page)')
    expect(partialsPageContent).toContain('[Link to Target without .mdx](/docs/target-page)')
    expect(partialsPageContent).toContain('[Link to Target with hash](/docs/target-page#target-page-content)')
    expect(partialsPageContent).toContain('[Link to Target with hash and .mdx](/docs/target-page#target-page-content)')
    expect(partialsPageContent).not.toContain('/docs/target-page.mdx')
  })

  test('should remove .mdx suffix from links in scoped pages', async () => {
    const { tempDir, pathJoin } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [
            [
              { title: 'Target Page', href: '/docs/target-page' },
              { title: 'Scoped Page', href: '/docs/scoped-page' },
            ],
          ],
        }),
      },
      {
        path: './docs/target-page.mdx',
        content: `---
title: Target Page
---

# Target Page Content`,
      },
      {
        path: './docs/_partials/links.mdx',
        content: `---
title: Links
---

[Link to Target with .mdx](/docs/target-page.mdx)
[Link to Target without .mdx](/docs/target-page)
[Link to Target with hash](/docs/target-page#target-page-content)
[Link to Target with hash and .mdx](/docs/target-page.mdx#target-page-content)`,
      },
      {
        path: './docs/scoped-page.mdx',
        content: `---
title: Scoped Page
sdk: expo
---

<Include src="_partials/links" />`,
      },
    ])

    await build(
      createBlankStore(),
      createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['expo'],
      }),
    )

    // Scoped page should be processed to remove .mdx
    const scopedPageContent = await readFile(pathJoin('./dist/expo/scoped-page.mdx'))
    expect(scopedPageContent).toContain('[Link to Target with .mdx](/docs/target-page)')
    expect(scopedPageContent).toContain('[Link to Target without .mdx](/docs/target-page)')
    expect(scopedPageContent).toContain('[Link to Target with hash](/docs/target-page#target-page-content)')
    expect(scopedPageContent).toContain('[Link to Target with hash and .mdx](/docs/target-page#target-page-content)')
    expect(scopedPageContent).not.toContain('/docs/target-page.mdx')
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

describe('Cache Handling', () => {
  test('should update cached files when their content changes', async () => {
    const { tempDir, pathJoin } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [[{ title: 'Cached Doc', href: '/docs/cached-doc' }]],
        }),
      },
      {
        path: './docs/cached-doc.mdx',
        content: `---
title: Original Title
---

# Original Content`,
      },
    ])

    // Create store to maintain cache across builds
    const store = createBlankStore()
    const config = createConfig({
      ...baseConfig,
      basePath: tempDir,
      validSdks: ['react'],
    })
    const invalidate = invalidateFile(store, config)

    // First build
    await build(store, config)

    // Check initial content
    const initialContent = await readFile(pathJoin('./dist/cached-doc.mdx'))
    expect(initialContent).toContain('Original Title')
    expect(initialContent).toContain('Original Content')

    // Update file content
    await fs.writeFile(
      pathJoin('./docs/cached-doc.mdx'),
      `---
title: Updated Title
---

# Updated Content`,
      'utf-8',
    )

    invalidate(pathJoin('./docs/cached-doc.mdx'))

    // Second build with same store (should detect changes)
    await build(store, config)

    // Check updated content
    const updatedContent = await readFile(pathJoin('./dist/cached-doc.mdx'))
    expect(updatedContent).toContain('Updated Title')
    expect(updatedContent).toContain('Updated Content')
  })
})

describe('Configuration Options', () => {
  describe('ignoreWarnings', () => {
    test('Should ignore certain warnings for a file when set', async () => {
      const { tempDir } = await createTempFiles([
        {
          path: './docs/manifest.json',
          content: JSON.stringify({
            navigation: [[]],
          }),
        },
        {
          path: './docs/index.mdx',
          content: `---
title: Index
description: This page has a description
---

# Page exists but not in manifest`,
        },
      ])

      const output = await build(
        createBlankStore(),
        createConfig({
          ...baseConfig,
          basePath: tempDir,
          validSdks: ['react'],
          ignoreWarnings: {
            '/docs/index.mdx': ['doc-not-in-manifest'],
          },
        }),
      )

      expect(output).not.toContain(
        'This doc is not in the manifest.json, but will still be publicly accessible and other docs can link to it',
      )
      expect(output).toBe('')
    })

    test('Should ignore multiple warnings for a single file', async () => {
      const { tempDir } = await createTempFiles([
        {
          path: './docs/manifest.json',
          content: JSON.stringify({
            navigation: [[]],
          }),
        },
        {
          path: './docs/problem-file.mdx',
          content: `---
title: Problem File
description: This page has a description
---

# Test Page

[Missing Link](/docs/non-existent)

<If sdk="invalid-sdk">
  This uses an invalid SDK
</If>
`,
        },
      ])

      const output = await build(
        createBlankStore(),
        createConfig({
          ...baseConfig,
          basePath: tempDir,
          validSdks: ['react'],
          ignoreWarnings: {
            '/docs/problem-file.mdx': ['doc-not-in-manifest', 'link-doc-not-found', 'invalid-sdk-in-if'],
          },
        }),
      )

      expect(output).not.toContain('This doc is not in the manifest.json')
      expect(output).not.toContain('Doc /docs/non-existent not found')
      expect(output).not.toContain('sdk "invalid-sdk" in <If /> is not a valid SDK')
      expect(output).toBe('')
    })

    test('Should ignore the same warning for multiple files', async () => {
      const { tempDir } = await createTempFiles([
        {
          path: './docs/manifest.json',
          content: JSON.stringify({
            navigation: [[]],
          }),
        },
        {
          path: './docs/file1.mdx',
          content: `---
title: File 1
description: This page has a description
---

[Missing Link](/docs/non-existent)`,
        },
        {
          path: './docs/file2.mdx',
          content: `---
title: File 2
description: This page has a description
---

[Another Missing Link](/docs/another-non-existent)`,
        },
      ])

      // Should complete without the ignored warnings
      const output = await build(
        createBlankStore(),
        createConfig({
          ...baseConfig,
          basePath: tempDir,
          validSdks: ['react'],
          ignoreWarnings: {
            '/docs/file1.mdx': ['doc-not-in-manifest', 'link-doc-not-found'],
            '/docs/file2.mdx': ['doc-not-in-manifest', 'link-doc-not-found'],
          },
        }),
      )

      // Check that warnings are suppressed for both files
      expect(output).not.toContain('Doc /docs/non-existent not found')
      expect(output).not.toContain('Doc /docs/another-non-existent not found')
      expect(output).toBe('')
    })

    test('Should only ignore specified warnings, leaving others intact', async () => {
      const { tempDir } = await createTempFiles([
        {
          path: './docs/manifest.json',
          content: JSON.stringify({
            navigation: [
              [
                {
                  title: 'Partial Ignore',
                  href: '/docs/partial-ignore',
                },
              ],
            ],
          }),
        },
        {
          path: './docs/partial-ignore.mdx',
          content: `---
title: Partial Ignore
description: This page has a description
---

[Missing Link](/docs/non-existent)

<If sdk="invalid-sdk">
  This uses an invalid SDK
</If>
`,
        },
      ])

      // Only ignore the link warning, but leave SDK warning
      const output = await build(
        createBlankStore(),
        createConfig({
          ...baseConfig,
          basePath: tempDir,
          validSdks: ['react'],
          ignoreWarnings: {
            '/docs/partial-ignore.mdx': ['link-doc-not-found'],
          },
        }),
      )

      expect(output).not.toContain(
        'This doc is not in the manifest.json, but will still be publicly accessible and other docs can link to it',
      )

      // Link warning should be suppressed
      expect(output).not.toContain('Doc /docs/non-existent not found')

      // But SDK warning should still appear
      expect(output).toContain('sdk "invalid-sdk" in <If /> is not a valid SDK')
    })

    test('Should handle ignoring warnings for component attribute validation', async () => {
      const { tempDir } = await createTempFiles([
        {
          path: './docs/manifest.json',
          content: JSON.stringify({
            navigation: [[]],
          }),
        },
        {
          path: './docs/component-issues.mdx',
          content: `---
title: Component Issues
description: This page has a description
---

<Include />
<Include src="wrong-path" />
`,
        },
      ])

      // Ignore component attribute warnings
      const output = await build(
        createBlankStore(),
        createConfig({
          ...baseConfig,
          basePath: tempDir,
          validSdks: ['react'],
          ignoreWarnings: {
            '/docs/component-issues.mdx': [
              'doc-not-in-manifest',
              'component-missing-attribute',
              'include-src-not-partials',
            ],
          },
        }),
      )

      // Component warnings should be suppressed
      expect(output).not.toContain('<Include /> component has no "src" attribute')
      expect(output).not.toContain('<Include /> prop "src" must start with "_partials/"')
      expect(output).toBe('')
    })

    test('Should ignore frontmatter description warning', async () => {
      const { tempDir } = await createTempFiles([
        {
          path: './docs/manifest.json',
          content: JSON.stringify({
            navigation: [[{ title: 'Missing Description', href: '/docs/missing-description' }]],
          }),
        },
        {
          path: './docs/missing-description.mdx',
          content: `---
title: Missing Description
---

# This page is missing a description
`,
        },
      ])

      const output = await build(
        createBlankStore(),
        createConfig({
          ...baseConfig,
          basePath: tempDir,
          validSdks: ['react'],
          ignoreWarnings: {
            '/docs/missing-description.mdx': ['frontmatter-missing-description'],
          },
        }),
      )

      expect(output).not.toContain('Frontmatter should have a "description" property')
      expect(output).toBe('')
    })

    test('Should ignore link hash warnings', async () => {
      const { tempDir } = await createTempFiles([
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
description: A page with links to another page
---

[Link with invalid hash](/docs/target-page#non-existent-section)
`,
        },
        {
          path: './docs/target-page.mdx',
          content: `---
title: Target Page
description: The page being linked to
---

# Target Page
`,
        },
      ])

      // Ignore hash warnings
      const output = await build(
        createBlankStore(),
        createConfig({
          ...baseConfig,
          basePath: tempDir,
          validSdks: ['react'],
          ignoreWarnings: {
            '/docs/source-page.mdx': ['link-hash-not-found'],
          },
        }),
      )

      // Hash warning should be suppressed
      expect(output).not.toContain('Hash "non-existent-section" not found in /docs/target-page')
      expect(output).toBe('')
    })

    test('Should allow non-fatal errors to be ignored for specific paths', async () => {
      const { tempDir } = await createTempFiles([
        {
          path: './docs/manifest.json',
          content: JSON.stringify({
            navigation: [
              [
                {
                  title: 'SDK Group',
                  sdk: ['react'],
                  items: [
                    [
                      {
                        title: 'SDK Doc',
                        href: '/docs/sdk-doc',
                        sdk: ['react', 'nodejs'], // nodejs not in parent
                      },
                    ],
                  ],
                },
              ],
            ],
          }),
        },
        {
          path: './docs/sdk-doc.mdx',
          content: `---
title: SDK Doc
sdk: react, nodejs
description: This page has a description
---

# SDK Document
`,
        },
      ])

      const output = await build(
        createBlankStore(),
        createConfig({
          ...baseConfig,
          basePath: tempDir,
          validSdks: ['react', 'nodejs'],
          ignoreWarnings: {
            '/docs/sdk-doc.mdx': ['doc-sdk-filtered-by-parent'],
          },
        }),
      )

      expect(output).toBe('')
    })

    test('Should respect ignoreWarnings in partials validation', async () => {
      const { tempDir } = await createTempFiles([
        {
          path: './docs/manifest.json',
          content: JSON.stringify({
            navigation: [[{ title: 'Test Page', href: '/docs/test-page' }]],
          }),
        },
        {
          path: './docs/_partials/test-partial.mdx',
          content: `[Missing Link](/docs/non-existent)`,
        },
        {
          path: './docs/test-page.mdx',
          content: `---
title: Test Page
description: Test page with partial
---

<Include src="_partials/test-partial" />

# Test Page`,
        },
      ])

      // Ignore link warnings in partials
      const output = await build(
        createBlankStore(),
        createConfig({
          ...baseConfig,
          basePath: tempDir,
          validSdks: ['react'],
          ignoreWarnings: {
            '/docs/_partials/test-partial.mdx': ['link-doc-not-found'],
          },
        }),
      )

      // Link warning in partial should be suppressed
      expect(output).not.toContain('Doc /docs/non-existent not found')
      expect(output).toBe('')
    })
  })
})
