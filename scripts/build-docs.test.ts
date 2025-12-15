import { glob } from 'glob'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import simpleGit from 'simple-git'

import { describe, expect, onTestFinished, test, vi } from 'vitest'
import { build } from './build-docs'
import { createConfig } from './lib/config'
import { createBlankStore, invalidateFile } from './lib/store'
import * as ioModule from './lib/io'

const tempConfig = {
  // Set to true to use local repo temp directory instead of system temp
  useLocalTemp: false,

  // Local temp directory path (relative to project root)
  localTempPath: './.temp-test',

  // Whether to preserve temp directories after tests
  // (helpful for debugging, but requires manual cleanup)
  preserveTemp: false,

  // Whether to setup a git repository in each test
  setupGit: false,
}

async function createTempFiles(
  files: { path: string; content: string }[],
  {
    tempDirectoryPrefix = 'clerk-docs-test-',
    preserveTemp = tempConfig.preserveTemp,
    useLocalTemp = tempConfig.useLocalTemp,
    setupGit = tempConfig.setupGit,
  } = {},
) {
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
  const tempDir = await fs.mkdtemp(path.join(baseDir, tempDirectoryPrefix))

  // Create all files
  for (const file of files) {
    // Ensure the directory exists
    const filePath = path.join(tempDir, file.path)
    const dirPath = path.dirname(filePath)

    await fs.mkdir(dirPath, { recursive: true })

    // Write the file
    await fs.writeFile(filePath, file.content)
  }

  const initialCommitDate = new Date()

  if (setupGit) {
    // Initialize git repository
    const git = simpleGit(tempDir)

    await git.init()

    // Locally set the git user config
    await git.addConfig('user.name', 'Test User')
    await git.addConfig('user.email', 'test@example.com')

    // Add all files to git
    await git.add('.')

    // Use a fixed date for the initial commit
    initialCommitDate.setMilliseconds(0) // git will drop off the milliseconds so if we don't do that then the times will miss-match
    await git.commit('Initial commit', undefined, {
      '--date': initialCommitDate.toISOString(),
    })
  }

  // Register cleanup unless preserveTemp is true
  if (!preserveTemp) {
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
    listFiles: async (folderPath?: string) => {
      return (
        await glob('**/*', {
          cwd: folderPath ? path.join(tempDir, folderPath) : tempDir,
          nodir: true,
        })
      ).sort() // ensure a consistent order for tests
    },

    // Read file contents
    readFile: async (filePath: string): Promise<string> => {
      return fs.readFile(path.join(tempDir, filePath), 'utf-8')
    },

    // Write file contents
    writeFile: async (filePath: string, content: string) => {
      return fs.writeFile(path.join(tempDir, filePath), content)
    },

    // Pass through the git instance incase we need to use it for something
    git: setupGit ? simpleGit(tempDir) : undefined,

    // Return the initial commit date
    initialCommitDate,
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
  dataPath: '../data',
  docsPath: '../docs',
  baseDocsLink: '/docs/',
  manifestPath: '../docs/manifest.json',
  partialsFolderName: '_partials',
  typedocPath: '../typedoc',
  distPath: '../dist',
  ignorePaths: [],
  ignoreLinks: [],
  ignoreWarnings: {
    docs: {},
    partials: {},
    typedoc: {},
    tooltips: {},
  },
  manifestOptions: {
    wrapDefault: true,
    hideTitleDefault: false,
  },
  flags: {
    skipGit: true,
    skipApiErrors: true,
  },
} satisfies Partial<Parameters<typeof createConfig>[0]>

describe('Basic Functionality', () => {
  test('Basic build test with simple files', async () => {
    // Create temp environment with minimal files array
    const { tempDir, pathJoin, initialCommitDate } = await createTempFiles(
      [
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
      ],
      { setupGit: true },
    )

    const output = await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['nextjs', 'react'],
        flags: {
          skipGit: false,
          skipApiErrors: true,
        },
      }),
    )

    expect(output).toBe('')

    expect(await fileExists(pathJoin('./dist/simple-test.mdx'))).toBe(true)
    expect(await readFile(pathJoin('./dist/simple-test.mdx'))).toBe(`---
title: Simple Test
description: This is a simple test page
lastUpdated: ${initialCommitDate.toISOString()}
sdkScoped: "false"
canonical: /docs/simple-test
sourceFile: /docs/simple-test.mdx
---

# Simple Test Page

Testing with a simple page.`)

    expect(await fileExists(pathJoin('./dist/manifest.json'))).toBe(true)
    expect(JSON.parse(await readFile(pathJoin('./dist/manifest.json')))).toEqual({
      flags: {},
      navigation: [[{ title: 'Simple Test', href: '/docs/simple-test' }]],
    })
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
      await createConfig({
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
      await createConfig({
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

  test('should copy over and process redirects', async () => {
    const { tempDir, readFile } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [],
        }),
      },
      {
        path: './redirects/static.json',
        content: JSON.stringify([
          {
            source: '/docs/page-1',
            destination: '/docs/page-2',
            permanent: true,
          },
          {
            source: '/docs/page-2',
            destination: '/docs/page-3',
            permanent: true,
          },
        ]),
      },
      {
        path: './redirects/dynamic.jsonc',
        content: JSON.stringify([
          {
            source: '/docs/login/:path*',
            destination: '/docs/signin/:path*',
            permanent: true,
          },
        ]),
      },
    ])

    await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
        redirects: {
          static: {
            inputPath: '../redirects/static.json',
            outputPath: '_redirects/static.json',
          },
          dynamic: {
            inputPath: '../redirects/dynamic.jsonc',
            outputPath: '_redirects/dynamic.jsonc',
          },
        },
      }),
    )

    expect(JSON.parse(await readFile('./dist/_redirects/static.json'))).toEqual({
      '/docs/page-1': {
        source: '/docs/page-1',
        destination: '/docs/page-3',
        permanent: true,
      },
      '/docs/page-2': {
        source: '/docs/page-2',
        destination: '/docs/page-3',
        permanent: true,
      },
    })
    expect(JSON.parse(await readFile('./dist/_redirects/dynamic.jsonc'))).toEqual([
      {
        source: '/docs/login/:path*',
        destination: '/docs/signin/:path*',
        permanent: true,
      },
    ])
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
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
      }),
    )

    await expect(promise).rejects.toThrow('Failed to parse manifest:')
  })

  test('should apply manifest options (wrapDefault, hideTitleDefault) correctly', async () => {
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
                hideTitle: false,
              },
              {
                title: 'Group Two',
                items: [[{ title: 'Item Two', href: '/docs/item-two' }]],
                wrap: true,
                hideTitle: true,
              },
              {
                title: 'Group Three',
                items: [[{ title: 'Item Three', href: '/docs/item-three' }]],
                wrap: false,
                hideTitle: false,
              },
              {
                title: 'Group Four',
                items: [[{ title: 'Item Four', href: '/docs/item-four' }]],
                wrap: false,
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
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['nextjs'],
        manifestOptions: {
          wrapDefault: false,
          hideTitleDefault: false,
        },
      }),
    )

    const manifest = JSON.parse(await readFile(pathJoin('./dist/manifest.json')))
    const groups = manifest.navigation[0]

    expect(groups[0].wrap).toBe(true)
    expect(groups[0].hideTitle).toBe(undefined)

    expect(groups[1].wrap).toBe(true)
    expect(groups[1].hideTitle).toBe(true)

    expect(groups[2].wrap).toBe(undefined)
    expect(groups[2].hideTitle).toBe(undefined)

    expect(groups[3].wrap).toBe(undefined)
    expect(groups[3].hideTitle).toBe(true)
  })

  test('should properly pass down SDK filtering from parent groups to child items', async () => {
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
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['nextjs', 'react', 'vue'],
      }),
    )

    // Check manifest
    const manifest = JSON.parse(await readFile(pathJoin('./dist/manifest.json')))

    expect(manifest).toEqual({
      flags: {},
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

  test('Setting the sdk on an item should not bubble up if siblings are core docs', async () => {
    const { tempDir, pathJoin } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [
            [
              {
                title: 'Group',
                items: [
                  [
                    { title: 'Item 1', href: '/docs/item-1' },
                    { title: 'Item 2', href: '/docs/item-2' },
                  ],
                ],
              },
            ],
          ],
        }),
      },
      {
        path: './docs/item-1.mdx',
        content: `---
title: Item 1
sdk: expressjs, fastify
---

# Item 1`,
      },
      {
        path: './docs/item-2.mdx',
        content: `---
title: Item 2
---

# Item 2`,
      },
    ])

    await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['expressjs', 'fastify', 'nextjs', 'react'],
      }),
    )

    // Check manifest
    const manifest = JSON.parse(await readFile(pathJoin('./dist/manifest.json')))

    expect(manifest).toEqual({
      flags: {},
      navigation: [
        [
          {
            title: 'Group',
            items: [
              [
                { title: 'Item 1', sdk: ['expressjs', 'fastify'], href: '/docs/:sdk:/item-1' },
                { title: 'Item 2', href: '/docs/item-2' },
              ],
            ],
          },
        ],
      ],
    })
  })

  test('External links should still get sdk scoping if applied to the group', async () => {
    const { tempDir, pathJoin } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [
            [
              {
                title: 'Group',
                sdk: ['expressjs'],
                items: [
                  [
                    { title: 'Item 1', href: '/docs/item-1' },
                    { title: 'Item 2', href: 'https://example.com' },
                  ],
                ],
              },
            ],
          ],
        }),
      },
      {
        path: './docs/item-1.mdx',
        content: `---
title: Item 1
---

# Item 1`,
      },
    ])

    await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['expressjs', 'react'],
      }),
    )

    // Check manifest
    const manifest = JSON.parse(await readFile(pathJoin('./dist/manifest.json')))

    expect(manifest).toEqual({
      flags: {},
      navigation: [
        [
          {
            title: 'Group',
            sdk: ['expressjs'],
            items: [
              [
                { title: 'Item 1', sdk: ['expressjs'], href: '/docs/item-1' },
                { title: 'Item 2', sdk: ['expressjs'], href: 'https://example.com' },
              ],
            ],
          },
        ],
      ],
    })
  })

  test('should properly inherit SDK filtering from child items up to parent groups', async () => {
    const { tempDir, pathJoin } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [
            [
              {
                title: 'SDK Group',
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
        content: `---\ntitle: SDK Item\nsdk: react\n---\nSDK specific content`,
      },
      {
        path: './docs/nested-item.mdx',
        content: `---\ntitle: Nested Item\nsdk: nextjs\n---\nNested SDK specific content`,
      },
      {
        path: './docs/generic-item.mdx',
        content: `---\ntitle: Generic Item\n---\nGeneric content`,
      },
      {
        path: './docs/vue-item.mdx',
        content: `---\ntitle: Vue Item\nsdk: vue\n---\nVue specific content`,
      },
    ])

    await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['nextjs', 'react', 'vue'],
      }),
    )

    // Check manifest
    const manifest = JSON.parse(await readFile(pathJoin('./dist/manifest.json')))

    expect(manifest).toEqual({
      flags: {},
      navigation: [
        [
          {
            title: 'SDK Group',
            sdk: ['react', 'nextjs'],
            items: [
              [
                {
                  title: 'Sub Group',
                  sdk: ['react', 'nextjs'],
                  items: [
                    [
                      { title: 'SDK Item', sdk: ['react'], href: '/docs/sdk-item' },
                      {
                        title: 'Nested Group',
                        sdk: ['nextjs'],
                        items: [[{ title: 'Nested Item', sdk: ['nextjs'], href: '/docs/nested-item' }]],
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
        content: `[Page 2](/docs/page-2#my-heading)
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
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
      }),
    )

    expect(output).toContain(`warning Hash "my-heading" not found in /docs/page-2`)
    expect(output).toContain(
      `warning Matching file not found for path: /docs/page-3. Expected file to exist at /docs/page-3.mdx`,
    )
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
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
      }),
    )

    // Check that the manifest contains the target="_blank" attribute
    const manifest = JSON.parse(await readFile(pathJoin('./dist/manifest.json')))
    expect(manifest).toEqual({
      flags: {},
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
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react', 'vue'],
      }),
    )

    expect(await fileExists(pathJoin('./dist/manifest.json'))).toBe(true)
    expect(JSON.parse(await readFile(pathJoin('./dist/manifest.json')))).toEqual({
      flags: {},
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
    })

    expect(JSON.parse(await readFile(pathJoin('./dist/directory.json')))).toEqual([
      { path: 'quickstart/react.mdx', url: '/docs/quickstart/react' },
      { path: 'quickstart/vue.mdx', url: '/docs/quickstart/vue' },
    ])

    const distFiles = await treeDir(pathJoin('./dist'))

    expect(distFiles.length).toBe(4)
    expect(distFiles).toContain('manifest.json')
    expect(distFiles).toContain('directory.json')
    expect(distFiles).toContain('quickstart/vue.mdx')
    expect(distFiles).toContain('quickstart/react.mdx')
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
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react', 'vue', 'astro'],
      }),
    )

    expect(JSON.parse(await readFile(pathJoin('./dist/manifest.json')))).toEqual({
      flags: {},
      navigation: [[{ title: 'Simple Test', href: '/docs/:sdk:/simple-test', sdk: ['react', 'vue', 'astro'] }]],
    })

    expect(JSON.parse(await readFile(pathJoin('./dist/directory.json')))).toEqual([
      { path: 'simple-test.mdx', url: '/docs/simple-test' },
      { path: 'vue/simple-test.mdx', url: '/docs/vue/simple-test' },
      { path: 'react/simple-test.mdx', url: '/docs/react/simple-test' },
      { path: 'astro/simple-test.mdx', url: '/docs/astro/simple-test' },
    ])

    const distFiles = await treeDir(pathJoin('./dist'))

    expect(distFiles.length).toBe(6)
    expect(distFiles).toContain('manifest.json')
    expect(distFiles).toContain('directory.json')
    expect(distFiles).toContain('simple-test.mdx')
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
      await createConfig({
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
      await createConfig({
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
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react', 'expo'],
      }),
    )

    expect(output).toContain(`warning sdk \"astro\" in <If /> is not a valid SDK`)
  })

  test('<If> SDK not in frontmatter fails the build', async () => {
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

<If sdk="nextjs">
  Next.js Content
</If>

Testing with a simple page.`,
      },
    ])

    const promise = build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react', 'expo', 'nextjs'],
      }),
    )

    await expect(promise).rejects.toThrow(
      `<If /> component is attempting to filter to sdk "nextjs" but it is not available in the docs frontmatter ["react", "expo"]`,
    )
  })

  test('<If> SDK not in manifest fails the build', async () => {
    const { tempDir } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [
            [
              {
                title: 'React Section',
                sdk: ['react'],
                items: [[{ title: 'Simple Test', href: '/docs/simple-test' }]],
              },
            ],
          ],
        }),
      },
      {
        path: './docs/simple-test.mdx',
        content: `---
title: Simple Test
description: A simple test page
---

# Simple Test Page

<If sdk="expo">
  Expo Content
</If>

Testing with a simple page.`,
      },
    ])

    const promise = build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react', 'expo'],
      }),
    )

    await expect(promise).rejects.toThrow(
      `<If /> component is attempting to filter to sdk "expo" but it is not available in the manifest.json for /docs/simple-test`,
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
      await createConfig({
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
    expect(await readFile(pathJoin('./dist/sdk-document.mdx'))).toBe(
      `---
template: wide
redirectPage: "true"
availableSdks: react,nextjs
notAvailableSdks: ""
search:
  exclude: true
canonical: /docs/:sdk:/sdk-document
---
<SDKDocRedirectPage title="SDK Document" description="This document is available for React and Next.js." href="/docs/:sdk:/sdk-document" sdks={["react","nextjs"]} />`,
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
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react', 'nextjs', 'js-frontend'],
      }),
    )

    expect(JSON.parse(await readFile(pathJoin('./dist/manifest.json')))).toEqual({
      flags: {},
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
                              href: '/docs/deeply-nested-nextjs',
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
                              href: '/docs/deeply-nested-react',
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
    expect(await fileExists(pathJoin('./dist/deeply-nested-nextjs.mdx'))).toBe(true)
    expect(await readFile(pathJoin('./dist/deeply-nested-nextjs.mdx'))).toContain('Content for Next.js users.')
    expect(await readFile(pathJoin('./dist/deeply-nested-nextjs.mdx'))).not.toContain('Content for React users.')

    // Page should be available in react (from parent manifest item)
    expect(await fileExists(pathJoin('./dist/deeply-nested-react.mdx'))).toBe(true)
    expect(await readFile(pathJoin('./dist/deeply-nested-react.mdx'))).toContain('Content for React users.')
    expect(await readFile(pathJoin('./dist/deeply-nested-react.mdx'))).not.toContain('Content for Next.js users.')

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
      await createConfig({
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
      await createConfig({
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
      await createConfig({
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

  test('should handle <If /> components with `notSdk` prop', async () => {
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
sdk: nextjs, react
---

# Hello World

<If notSdk="nextjs">
  This content is for React users only.
</If>

<If notSdk="react">
  This content is for Next.js users only.
</If>`,
      },
    ])

    await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['nextjs', 'react'],
      }),
    )

    expect(await readFile(pathJoin('./dist/nextjs/overview.mdx'))).toContain('This content is for Next.js users only.')
    expect(await readFile(pathJoin('./dist/react/overview.mdx'))).toContain('This content is for React users only.')
  })

  test('should handle <If /> components with both `sdk` and `notSdk` props', async () => {
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
sdk: nextjs, react
---

# Hello World

<If notSdk="nextjs" sdk="react">
  This content is for React users only.
</If>
`,
      },
    ])

    const promise = build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['nextjs', 'react'],
      }),
    )

    await expect(promise).rejects.toThrow(
      'Cannot pass both "sdk" and "notSdk" props to <If /> component, you must choose one or the other.',
    )
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
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['fastify', 'expressjs'],
      }),
    )

    expect(await readFile(pathJoin('./dist/fastify/overview.mdx'))).toContain('canonical: /docs/:sdk:/overview')
    expect(await readFile(pathJoin('./dist/expressjs/overview.mdx'))).toContain('canonical: /docs/:sdk:/overview')
  })

  test('should process documents with SDK already in path without redirect page', async () => {
    const { tempDir, readFile, listFiles } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [[{ title: 'React Guide', href: '/docs/references/react/guide' }]],
        }),
      },
      {
        path: './docs/references/react/guide.mdx',
        content: `---
title: React Guide
description: React Guide
sdk: react
---

# React Guide
`,
      },
    ])

    await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
      }),
    )

    expect(await readFile('./dist/references/react/guide.mdx')).toBe(`---
title: React Guide
description: React Guide
sdk: react
sdkScoped: "true"
canonical: /docs/references/react/guide
availableSdks: react
notAvailableSdks: ""
activeSdk: react
sourceFile: /docs/references/react/guide.mdx
---

# React Guide
`)

    expect(await listFiles('dist/')).toEqual(['directory.json', 'manifest.json', 'references/react/guide.mdx'])

    expect(JSON.parse(await readFile('./dist/manifest.json'))).toEqual({
      flags: {},
      navigation: [
        [
          {
            href: '/docs/references/react/guide',
            sdk: ['react'],
            title: 'React Guide',
          },
        ],
      ],
    })

    expect(JSON.parse(await readFile('./dist/directory.json'))).toEqual([
      {
        path: 'references/react/guide.mdx',
        url: '/docs/references/react/guide',
      },
    ])
  })

  test('should process single SDK documents without redirect page', async () => {
    const { tempDir, readFile, listFiles } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [[{ title: 'React Guide', href: '/docs/guide' }]],
        }),
      },
      {
        path: './docs/guide.mdx',
        content: `---
title: React Guide
description: React Guide
sdk: react
---

# React Guide
`,
      },
    ])

    await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
      }),
    )

    expect(await readFile('./dist/guide.mdx')).toBe(`---
title: React Guide
description: React Guide
sdk: react
sdkScoped: "true"
canonical: /docs/guide
availableSdks: react
notAvailableSdks: ""
activeSdk: react
sourceFile: /docs/guide.mdx
---

# React Guide
`)

    expect(await listFiles('dist/')).toEqual(['directory.json', 'guide.mdx', 'manifest.json'])

    expect(JSON.parse(await readFile('./dist/manifest.json'))).toEqual({
      flags: {},
      navigation: [
        [
          {
            href: '/docs/guide',
            sdk: ['react'],
            title: 'React Guide',
          },
        ],
      ],
    })

    expect(JSON.parse(await readFile('./dist/directory.json'))).toEqual([
      {
        path: 'guide.mdx',
        url: '/docs/guide',
      },
    ])
  })

  test('should add sdkScoped false and canonical URL to non-SDK-scoped documents', async () => {
    const { tempDir, readFile } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [[{ title: 'API Doc', href: '/docs/api-doc' }]],
        }),
      },
      {
        path: './docs/api-doc.mdx',
        content: `---
title: API Documentation
description: x
---

# API Documentation
`,
      },
    ])

    await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
      }),
    )

    expect(await readFile('./dist/api-doc.mdx')).toBe(`---
title: API Documentation
description: x
sdkScoped: "false"
canonical: /docs/api-doc
sourceFile: /docs/api-doc.mdx
---

# API Documentation
`)
  })

  test('should remove /index from canonical URLs for index.mdx files', async () => {
    const { tempDir, readFile } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [
            [
              { title: 'Home', href: '/docs/index' },
              { title: 'Guides', href: '/docs/guides/index' },
              { title: 'SDK Overview', href: '/docs/sdk/index' },
            ],
          ],
        }),
      },
      {
        path: './docs/index.mdx',
        content: `---
title: Home
description: Welcome to the docs
---

# Welcome
`,
      },
      {
        path: './docs/guides/index.mdx',
        content: `---
title: Guides
description: Guides overview
---

# Guides Overview
`,
      },
      {
        path: './docs/sdk/index.mdx',
        content: `---
title: SDK Overview
description: SDK documentation
sdk: react, nextjs
---

# SDK Overview
`,
      },
    ])

    await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react', 'nextjs'],
      }),
    )

    // Test root index.mdx - canonical should be /docs not /docs/index
    expect(await readFile('./dist/index.mdx')).toContain('canonical: /docs\n')

    // Test nested index.mdx - canonical should be /docs/guides not /docs/guides/index
    expect(await readFile('./dist/guides/index.mdx')).toContain('canonical: /docs/guides\n')

    // Test SDK-scoped nested index.mdx - canonical should be /docs/:sdk:/sdk not /docs/:sdk:/sdk/index
    expect(await readFile('./dist/react/sdk/index.mdx')).toContain('canonical: /docs/:sdk:/sdk\n')
    expect(await readFile('./dist/nextjs/sdk/index.mdx')).toContain('canonical: /docs/:sdk:/sdk\n')
  })

  test('should not inject :sdk: for single SDK documents when multiple SDKs are available', async () => {
    const { tempDir, readFile, listFiles } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [
            [
              {
                title: 'Next.js Quickstart (Pages Router)',
                href: '/docs/quickstarts/nextjs-pages-router',
              },
            ],
          ],
        }),
      },
      {
        path: './docs/quickstarts/nextjs-pages-router.mdx',
        content: `---
title: Next.js Quickstart (Pages Router)
description: Add authentication and user management to your Next.js app with Clerk.
sdk: nextjs
---

# Next.js Quickstart (Pages Router)
`,
      },
    ])

    await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react', 'nextjs'], // Multiple SDKs available, but document only supports nextjs
      }),
    )

    // Should NOT inject :sdk: in manifest because document only supports one SDK
    expect(JSON.parse(await readFile('./dist/manifest.json'))).toEqual({
      flags: {},
      navigation: [
        [
          {
            href: '/docs/quickstarts/nextjs-pages-router', // Should NOT have :sdk:
            sdk: ['nextjs'],
            title: 'Next.js Quickstart (Pages Router)',
          },
        ],
      ],
    })

    // Should process document without redirect page
    expect(await listFiles('dist/')).toEqual(['directory.json', 'manifest.json', 'quickstarts/nextjs-pages-router.mdx'])

    expect(await readFile('./dist/quickstarts/nextjs-pages-router.mdx')).toBe(`---
title: Next.js Quickstart (Pages Router)
description: Add authentication and user management to your Next.js app with Clerk.
sdk: nextjs
sdkScoped: "true"
canonical: /docs/quickstarts/nextjs-pages-router
availableSdks: nextjs
notAvailableSdks: react
activeSdk: nextjs
sourceFile: /docs/quickstarts/nextjs-pages-router.mdx
---

# Next.js Quickstart (Pages Router)
`)
  })

  test('SDK scoping of the manifest in the manifest takes precedence over the sdk in the file', async () => {
    const { tempDir, readFile } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [
            [
              {
                title: 'Quickstart',
                sdk: ['nextjs'],
                items: [
                  [
                    {
                      title: 'Next.js Quickstart',
                      href: '/docs/quickstart',
                    },
                  ],
                ],
              },
              {
                title: 'Quickstart',
                sdk: ['react', 'ios'],
                href: '/docs/quickstart',
              },
            ],
          ],
        }),
      },
      {
        path: './docs/quickstart.mdx',
        content: `---
title: Quickstart
sdk: nextjs
---

Next.js Quickstart`,
      },
      {
        path: './docs/quickstart.react.mdx',
        content: `---
title: React Quickstart
sdk: react
---

React Quickstart`,
      },
      {
        path: './docs/quickstart.ios.mdx',
        content: `---
title: iOS Quickstart
sdk: ios
---

iOS Quickstart`,
      },
    ])

    await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['nextjs', 'react', 'ios'],
      }),
    )

    expect(JSON.parse(await readFile('./dist/manifest.json'))).toEqual({
      flags: {},
      navigation: [
        [
          {
            items: [
              [
                {
                  href: '/docs/:sdk:/quickstart',
                  sdk: ['nextjs', 'react', 'ios'],
                  title: 'Next.js Quickstart',
                },
              ],
            ],
            sdk: ['nextjs'],
            title: 'Quickstart',
          },
          {
            href: '/docs/:sdk:/quickstart',
            sdk: ['react', 'ios'],
            title: 'Quickstart',
          },
        ],
      ],
    })
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
description: Duplicate Headings page
---

# Heading {{ id: 'custom-id' }}

## Another Heading {{ id: 'custom-id' }}

[Link to first heading](#custom-id)`,
      },
    ])

    const output = await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
      }),
    )

    expect(output).toContain(
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
      await createConfig({
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

    const output = await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react', 'nextjs'],
      }),
    )

    expect(output).toContain(
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

    const output = await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
      }),
    )

    expect(output).toContain(
      'Doc "/docs/quickstart.mdx" contains a duplicate heading id "title", please ensure all heading ids are unique',
    )
  })

  test('Should support id in a call out block', async () => {
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

> [!NOTE my-callout]
> This is a call out

[Link to call out](#my-callout)
`,
      },
    ])

    const output = await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
      }),
    )

    expect(output).toBe('')
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
      await createConfig({
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
sdk: react, nextjs
---

<Include src="_partials/test-partial" />

# Simple Test Page`,
      },
    ])

    await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react', 'nextjs'],
      }),
    )

    expect(await readFile(pathJoin('./dist/react/simple-test.mdx'))).toContain('Test Partial Content')
    expect(await readFile(pathJoin('./dist/react/simple-test.mdx'))).not.toContain(
      '<Include src="_partials/test-partial" />',
    )
    expect(await readFile(pathJoin('./dist/nextjs/simple-test.mdx'))).toContain('Test Partial Content')
    expect(await readFile(pathJoin('./dist/nextjs/simple-test.mdx'))).not.toContain(
      '<Include src="_partials/test-partial" />',
    )
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
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
      }),
    )

    expect(output).toContain(`warning Partial /docs/_partials/test-partial.mdx not found`)
  })

  test('Circular partial dependencies should throw an error', async () => {
    const { tempDir } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [[{ title: 'Simple Test', href: '/docs/simple-test' }]],
        }),
      },
      {
        path: './docs/_partials/test-partial-1.mdx',
        content: `<Include src="_partials/test-partial-1" />`,
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
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
      }),
    )

    await expect(promise).rejects.toThrow(`Circular dependency detected`)
  })

  test('Nested partials should work (partial inside a partial)', async () => {
    const { tempDir, pathJoin, readFile } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [[{ title: 'Test Page', href: '/docs/test-page' }]],
        }),
      },
      {
        path: './docs/_partials/level-2-partial.mdx',
        content: `## Level 2 Content

This is content from the nested partial.`,
      },
      {
        path: './docs/_partials/level-1-partial.mdx',
        content: `## Level 1 Content

<Include src="_partials/level-2-partial" />

More content after nested partial.`,
      },
      {
        path: './docs/test-page.mdx',
        content: `---
title: Test Page
description: Testing nested partials
---

# Test Page

<Include src="_partials/level-1-partial" />

End of page.`,
      },
    ])

    const output = await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
      }),
    )

    expect(output).toBe('')

    // Verify the content was properly embedded
    const testPageContent = await readFile('./dist/test-page.mdx')

    // Should contain content from level 1 partial
    expect(testPageContent).toContain('## Level 1 Content')
    expect(testPageContent).toContain('More content after nested partial')

    // Should contain content from level 2 partial (nested)
    expect(testPageContent).toContain('## Level 2 Content')
    expect(testPageContent).toContain('This is content from the nested partial')

    // Should contain the page's own content
    expect(testPageContent).toContain('# Test Page')
    expect(testPageContent).toContain('End of page')

    // Should NOT contain any Include tags (they should all be resolved)
    expect(testPageContent).not.toContain('<Include')
  })

  test('Nested partials should validate links correctly', async () => {
    const { tempDir } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [
            [{ title: 'Test Page', href: '/docs/test-page' }],
            [{ title: 'Target Page', href: '/docs/target-page' }],
          ],
        }),
      },
      {
        path: './docs/_partials/nested-with-link.mdx',
        content: `Check out [Target Page](/docs/target-page) for more info.`,
      },
      {
        path: './docs/_partials/parent-partial.mdx',
        content: `## Parent Content

<Include src="_partials/nested-with-link" />

Also see [Target Page](/docs/target-page#heading).`,
      },
      {
        path: './docs/test-page.mdx',
        content: `---
title: Test Page
description: Testing nested partial link validation
---

<Include src="_partials/parent-partial" />`,
      },
      {
        path: './docs/target-page.mdx',
        content: `---
title: Target Page
description: Target
---

## Heading

Content here.`,
      },
    ])

    // This should pass - all links are valid
    const output = await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
      }),
    )

    expect(output).toBe('')
  })

  test('Nested partials should detect invalid links', async () => {
    const { tempDir } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [[{ title: 'Test Page', href: '/docs/test-page' }]],
        }),
      },
      {
        path: './docs/_partials/nested-with-bad-link.mdx',
        content: `Check out [Non-existent Page](/docs/does-not-exist) for more info.`,
      },
      {
        path: './docs/_partials/parent-partial.mdx',
        content: `<Include src="_partials/nested-with-bad-link" />`,
      },
      {
        path: './docs/test-page.mdx',
        content: `---
title: Test Page
---

<Include src="_partials/parent-partial" />`,
      },
    ])

    const output = await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
      }),
    )

    // Should detect the invalid link in the nested partial
    expect(output).toContain('does-not-exist')
  })

  test('Nested partials should detect invalid hash links', async () => {
    const { tempDir } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [
            [{ title: 'Test Page', href: '/docs/test-page' }],
            [{ title: 'Target Page', href: '/docs/target-page' }],
          ],
        }),
      },
      {
        path: './docs/_partials/nested-with-bad-hash.mdx',
        content: `See [Target Section](/docs/target-page#non-existent-heading).`,
      },
      {
        path: './docs/_partials/parent-partial.mdx',
        content: `<Include src="_partials/nested-with-bad-hash" />`,
      },
      {
        path: './docs/test-page.mdx',
        content: `---
title: Test Page
---

<Include src="_partials/parent-partial" />`,
      },
      {
        path: './docs/target-page.mdx',
        content: `---
title: Target Page
---

## Actual Heading

Content here.`,
      },
    ])

    const output = await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
      }),
    )

    // Should detect the invalid hash in the nested partial
    expect(output).toContain('non-existent-heading')
  })

  test('Deeply nested partials (3 levels) should work', async () => {
    const { tempDir, readFile } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [[{ title: 'Test Page', href: '/docs/test-page' }]],
        }),
      },
      {
        path: './docs/_partials/level-3-partial.mdx',
        content: `### Level 3 Content

This is the deepest level.`,
      },
      {
        path: './docs/_partials/level-2-partial.mdx',
        content: `## Level 2 Content

<Include src="_partials/level-3-partial" />

Back to level 2.`,
      },
      {
        path: './docs/_partials/level-1-partial.mdx',
        content: `## Level 1 Content

<Include src="_partials/level-2-partial" />

Back to level 1.`,
      },
      {
        path: './docs/test-page.mdx',
        content: `---
title: Test Page
description: Testing deeply nested partials
---

# Test Page

<Include src="_partials/level-1-partial" />

End of page.`,
      },
    ])

    const output = await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
      }),
    )

    expect(output).toBe('')

    // Verify the content was properly embedded from all levels
    const testPageContent = await readFile('./dist/test-page.mdx')

    // Should contain content from all three levels
    expect(testPageContent).toContain('## Level 1 Content')
    expect(testPageContent).toContain('Back to level 1')
    expect(testPageContent).toContain('## Level 2 Content')
    expect(testPageContent).toContain('Back to level 2')
    expect(testPageContent).toContain('### Level 3 Content')
    expect(testPageContent).toContain('This is the deepest level')

    // Should NOT contain any Include tags
    expect(testPageContent).not.toContain('<Include')
  })

  test(`Warning if <Include /> src doesn't start with "_partials/" or relative path`, async () => {
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
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
      }),
    )

    expect(output).toContain(
      `warning <Include /> prop "src" must start with "_partials/" (global) or "./_partials/" or "../_partials/" (relative)`,
    )
  })

  test('Relative partial - basic ./_partials inclusion', async () => {
    const { tempDir, pathJoin } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [[{ title: 'Billing Page', href: '/docs/billing/for-b2c' }]],
        }),
      },
      {
        path: './docs/billing/_partials/local-partial.mdx',
        content: `This is a local partial content`,
      },
      {
        path: './docs/billing/for-b2c.mdx',
        content: `---
title: Billing Page
---

<Include src="./_partials/local-partial" />

# Billing Page`,
      },
    ])

    await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
      }),
    )

    const content = await readFile(pathJoin('./dist/billing/for-b2c.mdx'))
    expect(content).toContain('This is a local partial content')
    expect(content).not.toContain('<Include src="./_partials/local-partial" />')
  })

  test('Relative partial - parent directory ../_partials inclusion', async () => {
    const { tempDir, pathJoin } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [[{ title: 'Deep Page', href: '/docs/billing/plans/premium' }]],
        }),
      },
      {
        path: './docs/billing/_partials/shared-content.mdx',
        content: `Shared billing content from parent directory`,
      },
      {
        path: './docs/billing/plans/premium.mdx',
        content: `---
title: Premium Plan
---

<Include src="../_partials/shared-content" />

# Premium Plan Details`,
      },
    ])

    await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
      }),
    )

    const content = await readFile(pathJoin('./dist/billing/plans/premium.mdx'))
    expect(content).toContain('Shared billing content from parent directory')
    expect(content).not.toContain('<Include src="../_partials/shared-content" />')
  })

  test('Relative partial - multiple levels up ../../_partials inclusion', async () => {
    const { tempDir, pathJoin } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [[{ title: 'Deep Page', href: '/docs/billing/plans/enterprise/features' }]],
        }),
      },
      {
        path: './docs/billing/_partials/enterprise-features.mdx',
        content: `Enterprise features from billing folder`,
      },
      {
        path: './docs/billing/plans/enterprise/features.mdx',
        content: `---
title: Enterprise Features
---

<Include src="../../_partials/enterprise-features" />

# Features List`,
      },
    ])

    await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
      }),
    )

    const content = await readFile(pathJoin('./dist/billing/plans/enterprise/features.mdx'))
    expect(content).toContain('Enterprise features from billing folder')
    expect(content).not.toContain('<Include src="../../_partials/enterprise-features" />')
  })

  test('Nested relative partials - relative partial includes another relative partial', async () => {
    const { tempDir, pathJoin } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [[{ title: 'Test Page', href: '/docs/guides/test' }]],
        }),
      },
      {
        path: './docs/guides/_partials/nested-child.mdx',
        content: `## Nested Child Content`,
      },
      {
        path: './docs/guides/_partials/parent-partial.mdx',
        content: `## Parent Partial

<Include src="../_partials/nested-child" />

End of parent partial`,
      },
      {
        path: './docs/guides/test.mdx',
        content: `---
title: Test Page
---

<Include src="./_partials/parent-partial" />

# Test Page`,
      },
    ])

    await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
      }),
    )

    const content = await readFile(pathJoin('./dist/guides/test.mdx'))
    expect(content).toContain('## Parent Partial')
    expect(content).toContain('## Nested Child Content')
    expect(content).toContain('End of parent partial')
    expect(content).not.toContain('<Include')
  })

  test('Nested relative partials - relative partial includes global partial', async () => {
    const { tempDir, pathJoin } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [[{ title: 'Test Page', href: '/docs/guides/test' }]],
        }),
      },
      {
        path: './docs/_partials/global-shared.mdx',
        content: `Global shared content`,
      },
      {
        path: './docs/guides/_partials/local-with-global.mdx',
        content: `## Local Partial

<Include src="_partials/global-shared" />

End of local partial`,
      },
      {
        path: './docs/guides/test.mdx',
        content: `---
title: Test Page
---

<Include src="./_partials/local-with-global" />

# Test Page`,
      },
    ])

    await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
      }),
    )

    const content = await readFile(pathJoin('./dist/guides/test.mdx'))
    expect(content).toContain('## Local Partial')
    expect(content).toContain('Global shared content')
    expect(content).toContain('End of local partial')
    expect(content).not.toContain('<Include')
  })

  test('Relative partial - going up many levels ../../../../_partials inclusion', async () => {
    const { tempDir, pathJoin } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [[{ title: 'Deep Page', href: '/docs/guides/features/advanced/deep/page' }]],
        }),
      },
      {
        path: './docs/_partials/shared-content.mdx',
        content: `Top-level shared content from root partials folder`,
      },
      {
        path: './docs/guides/features/advanced/deep/page.mdx',
        content: `---
title: Deep Nested Page
---

<Include src="../../../../_partials/shared-content" />

# Deep Nested Content`,
      },
    ])

    await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
      }),
    )

    const content = await readFile(pathJoin('./dist/guides/features/advanced/deep/page.mdx'))
    expect(content).toContain('Top-level shared content from root partials folder')
    expect(content).not.toContain('<Include src="../../../../_partials/shared-content" />')
  })

  test('Relative partial - going into another folder ../../xyz/abc/_partials inclusion', async () => {
    const { tempDir, pathJoin } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [[{ title: 'Test Page', href: '/docs/billing/plans/page' }]],
        }),
      },
      {
        path: './docs/authentication/strategies/_partials/oauth-config.mdx',
        content: `OAuth configuration details from authentication folder`,
      },
      {
        path: './docs/billing/plans/page.mdx',
        content: `---
title: Billing Plans
---

<Include src="../../authentication/strategies/_partials/oauth-config" />

# Plan Configuration`,
      },
    ])

    await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
      }),
    )

    const content = await readFile(pathJoin('./dist/billing/plans/page.mdx'))
    expect(content).toContain('OAuth configuration details from authentication folder')
    expect(content).not.toContain('<Include src="../../authentication/strategies/_partials/oauth-config" />')
  })

  test('Error case - relative partial not found', async () => {
    const { tempDir } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [[{ title: 'Test Page', href: '/docs/guides/test' }]],
        }),
      },
      {
        path: './docs/guides/test.mdx',
        content: `---
title: Test Page
---

<Include src="./_partials/nonexistent" />

# Test Page`,
      },
    ])

    const output = await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
      }),
    )

    expect(output).toContain('warning Partial')
    expect(output).toContain('not found')
  })

  test('Relative partial works with SDK-scoped documents', async () => {
    const { tempDir, pathJoin } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [[{ title: 'SDK Test', href: '/docs/guides/sdk-test' }]],
        }),
      },
      {
        path: './docs/guides/_partials/sdk-content.mdx',
        content: `SDK-specific local content`,
      },
      {
        path: './docs/guides/sdk-test.mdx',
        content: `---
title: SDK Test
sdk: react, nextjs
---

<Include src="./_partials/sdk-content" />

# SDK Test Page`,
      },
    ])

    await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react', 'nextjs'],
      }),
    )

    const reactContent = await readFile(pathJoin('./dist/react/guides/sdk-test.mdx'))
    expect(reactContent).toContain('SDK-specific local content')
    expect(reactContent).not.toContain('<Include src="./_partials/sdk-content" />')

    const nextjsContent = await readFile(pathJoin('./dist/nextjs/guides/sdk-test.mdx'))
    expect(nextjsContent).toContain('SDK-specific local content')
    expect(nextjsContent).not.toContain('<Include src="./_partials/sdk-content" />')
  })

  test('Should validate heading within a partial', async () => {
    const { tempDir } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [
            [{ title: 'Simple Test', href: '/docs/test-page-1' }],
            [{ title: 'Test Page 2', href: '/docs/test-page-2' }],
          ],
        }),
      },
      {
        path: './docs/_partials/test-partial.mdx',
        content: `# Heading`,
      },
      {
        path: './docs/test-page-1.mdx',
        content: `---
title: Test Page 1
description: This is a test page
---

<Include src="_partials/test-partial" />`,
      },
      {
        path: './docs/test-page-2.mdx',
        content: `---
title: Test Page 2
description: This is a test page
---

[Test Page](/docs/test-page-1#heading)`,
      },
    ])

    const output = await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
      }),
    )

    expect(output).not.toContain(`warning Hash "heading" not found in /docs/test-page-1`)
    expect(output).toBe('')
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
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
      }),
    )

    expect(output).toContain(
      `warning Matching file not found for path: /docs/non-existent-page. Expected file to exist at /docs/non-existent-page.mdx`,
    )
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
      await createConfig({
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
      await createConfig({
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
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
      }),
    )

    expect(output).not.toContain(`warning Hash "my-heading" not found in /docs/headings`)
  })

  test('should validate hashes in links to distinct variant sdk scoped guides', async () => {
    const { tempDir } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [
            [
              { title: 'API Doc', href: '/docs/api-doc' },
              { title: 'Page 2', href: '/docs/page-2' },
            ],
          ],
        }),
      },
      {
        path: './docs/api-doc.mdx',
        content: `---
title: API Documentation
description: x
sdk: nextjs
---

# API Documentation`,
      },
      {
        path: './docs/api-doc.react.mdx',
        content: `---
title: API Documentation for React
description: x
sdk: react
---

# React`,
      },
      {
        path: './docs/page-2.mdx',
        content: `---
title: Page 2
description: x
---

[API Doc](/docs/api-doc#react)`,
      },
    ])

    const output = await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react', 'nextjs'],
      }),
    )

    expect(output).toBe('')
  })

  test('should validate hashes in sdk specific links to distinct variant sdk scoped guides', async () => {
    const { tempDir } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [
            [
              { title: 'API Doc', href: '/docs/api-doc' },
              { title: 'Page 2', href: '/docs/page-2' },
            ],
          ],
        }),
      },
      {
        path: './docs/api-doc.mdx',
        content: `---
title: API Documentation
description: x
sdk: nextjs
---

# API Documentation`,
      },
      {
        path: './docs/api-doc.react.mdx',
        content: `---
title: API Documentation for React
description: x
sdk: react
---

# React`,
      },
      {
        path: './docs/page-2.mdx',
        content: `---
title: Page 2
description: x
---

[API Doc](/docs/react/api-doc#react)`,
      },
    ])

    const output = await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react', 'nextjs'],
      }),
    )

    expect(output).toBe('')
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
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react', 'nextjs'],
      }),
    )

    expect(await readFile(pathJoin('./dist/core-page.mdx'))).toContain(
      `<SDKLink href="/docs/:sdk:/sdk-filtered-page" sdks={["react","nextjs"]}>SDK Filtered Page</SDKLink>`,
    )
  })

  test('Swap out links for <SDKLink /> when a link points to a sdk manifest filtered page', async () => {
    const { tempDir, pathJoin } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [
            [
              {
                title: 'nextjs',
                sdk: ['nextjs'],
                items: [[{ title: 'SDK Filtered Page', href: '/docs/references/nextjs/sdk-filtered-page' }]],
              },
              { title: 'Core Page', href: '/docs/core-page' },
            ],
          ],
        }),
      },
      {
        path: './docs/references/nextjs/sdk-filtered-page.mdx',
        content: `---
title: SDK Filtered Page
---

SDK filtered page`,
      },
      {
        path: './docs/core-page.mdx',
        content: `---
title: Core Page
---

# Core page

[SDK Filtered Page](/docs/references/nextjs/sdk-filtered-page)
`,
      },
    ])

    await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react', 'nextjs'],
      }),
    )

    expect(await readFile(pathJoin('./dist/core-page.mdx'))).toContain(
      `<SDKLink href="/docs/references/nextjs/sdk-filtered-page" sdks={["nextjs"]}>SDK Filtered Page</SDKLink>`,
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
      await createConfig({
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
      await createConfig({
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
      await createConfig({
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
      await createConfig({
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
      await createConfig({
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

  test('Links with only a hash to the same page are valid', async () => {
    const { tempDir } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [[{ title: 'Page 1', href: '/docs/page-1' }]],
        }),
      },
      {
        path: './docs/page-1.mdx',
        content: `---
title: Page 1
description: This is a test page
---

# Heading

[Valid Link to self](#heading)`,
      },
    ])

    const output = await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
      }),
    )

    expect(output).toBe('')
  })

  test('Invalid Links with only a hash to the same page should be reported', async () => {
    const { tempDir } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [[{ title: 'Page 1', href: '/docs/page-1' }]],
        }),
      },
      {
        path: './docs/page-1.mdx',
        content: `---
title: Page 1
description: This is a test page
---

[Invalid Link to self](#invalid-heading)`,
      },
    ])

    const output = await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
      }),
    )

    expect(output).toContain(`warning Hash "invalid-heading" not found in /docs/page-1`)
  })

  test('Should skip swapping out <SDKLink /> when the link is in a <Cards /> component', async () => {
    const { tempDir, readFile } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [
            [
              { title: 'Page', href: '/docs/index' },
              { title: 'Standard Card', href: '/docs/standard-card' },
              { title: 'SDK Scoped Page', href: '/docs/sdk-scoped-page' },
            ],
          ],
        }),
      },
      {
        path: './docs/standard-card.mdx',
        content: `---
title: Standard Card
description: Just a standard card
---

# Standard Card`,
      },
      {
        path: './docs/sdk-scoped-page.mdx',
        content: `---
title: SDK Scoped Page
description: A card that is scoped to a specific SDK
sdk: react
---

# SDK Scoped Page`,
      },
      {
        path: './docs/index.mdx',
        content: `---
title: Page
description: A page that contains cards
---

<Cards>
  - [Standard card](/docs/standard-card.mdx)
  - Just a standard car

  ---

  - [SDK Scoped Card](/docs/sdk-scoped-page.mdx)
  - A card that is scoped to a specific SDK
</Cards>`,
      },
    ])

    const output = await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
      }),
    )

    expect(output).toBe('')

    const indexContent = await readFile('./dist/index.mdx')

    expect(indexContent).toContain('* [Standard card](/docs/standard-card)')
    expect(indexContent).toContain('* [SDK Scoped Card](/docs/sdk-scoped-page)')
  })

  test('Url hash links should be included when swapping out sdk scoped links to <SDKLink />', async () => {
    const { tempDir, readFile } = await createTempFiles([
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
description: This is a test page
sdk: react, nextjs
---

# Content
`,
      },
      {
        path: './docs/page-2.mdx',
        content: `---
title: Page 2
description: This is a test page
---

[Hash Link](/docs/page-1#content)`,
      },
    ])

    const output = await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react', 'nextjs'],
      }),
    )

    expect(output).toBe('')

    const page2Content = await readFile('./dist/page-2.mdx')
    expect(page2Content).toContain(
      '<SDKLink href="/docs/:sdk:/page-1#content" sdks={["react","nextjs"]}>Hash Link</SDKLink>',
    )
  })

  test('Should not inject sdk scoping for links to the same sdk', async () => {
    const { tempDir, readFile } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [
            [
              { title: 'Doc 1', href: '/docs/doc-1' },
              { title: 'Doc 2', href: '/docs/doc-2' },
            ],
          ],
        }),
      },
      {
        path: './docs/doc-1.mdx',
        content: `---
title: Doc 1
sdk: react
---

Doc 1`,
      },
      {
        path: './docs/doc-2.mdx',
        content: `---
title: Doc 2
sdk: react
---

[Link to doc 1](/docs/doc-1)`,
      },
    ])

    await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
      }),
    )

    expect(await readFile('./dist/doc-2.mdx')).toBe(`---
title: Doc 2
sdk: react
sdkScoped: "true"
canonical: /docs/doc-2
availableSdks: react
notAvailableSdks: ""
activeSdk: react
sourceFile: /docs/doc-2.mdx
---

[Link to doc 1](/docs/doc-1)
`)
  })

  test('Reference-style link to SDK-scoped doc is swapped to <SDKLink /> with scoping', async () => {
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
description: Scoped page
sdk: react, nextjs
---

## Heading
`,
      },
      {
        path: './docs/core-page.mdx',
        content: `---
title: Core Page
description: Core page
---

# Core page

This is a [SDK Filtered Page][sdk-ref].

[sdk-ref]: /docs/sdk-filtered-page`,
      },
    ])

    await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react', 'nextjs'],
      }),
    )

    const content = await readFile(pathJoin('./dist/core-page.mdx'))
    expect(content).toContain(
      `<SDKLink href="/docs/:sdk:/sdk-filtered-page" sdks={["react","nextjs"]}>SDK Filtered Page</SDKLink>`,
    )
  })

  test('Reference-style link with hash to SDK-scoped doc preserves hash in <SDKLink />', async () => {
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
description: Scoped page
sdk: react, nextjs
---

## Custom Heading
`,
      },
      {
        path: './docs/core-page.mdx',
        content: `---
title: Core Page
description: Core page
---

# Core page

See [SDK Filtered Page][sdk-ref].

[sdk-ref]: /docs/sdk-filtered-page#custom-heading`,
      },
    ])

    await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react', 'nextjs'],
      }),
    )

    const content = await readFile(pathJoin('./dist/core-page.mdx'))
    expect(content).toContain(
      `<SDKLink href="/docs/:sdk:/sdk-filtered-page#custom-heading" sdks={["react","nextjs"]}>SDK Filtered Page</SDKLink>`,
    )
  })

  test('Reference-style link to core doc stays as normal link and validates', async () => {
    const { tempDir, pathJoin } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [
            [
              { title: 'Core Target', href: '/docs/core-target' },
              { title: 'Core Page', href: '/docs/core-page' },
            ],
          ],
        }),
      },
      {
        path: './docs/core-target.mdx',
        content: `---
title: Core Target
description: Target doc
---

# Core Target`,
      },
      {
        path: './docs/core-page.mdx',
        content: `---
title: Core Page
description: Core page
---

# Core page

See [Core Target][core-ref].

[core-ref]: /docs/core-target`,
      },
    ])

    const output = await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react', 'nextjs'],
      }),
    )

    expect(output).toBe('')
    const content = await readFile(pathJoin('./dist/core-page.mdx'))
    expect(content).toContain('[Core Target](/docs/core-target)')
  })

  test('Allow the author to point directly to a specific SDK variant of a sdk scoped doc', async () => {
    const { tempDir, readFile } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [
            [
              { title: 'Doc 1', href: '/docs/doc-1' },
              { title: 'Doc 2', href: '/docs/doc-2' },
            ],
          ],
        }),
      },
      {
        path: './docs/doc-1.mdx',
        content: `---
title: Doc 1
description: x
sdk: nextjs, react, expo
---

# Doc 1

Documentation specific to Next.js`,
      },

      {
        path: './docs/doc-2.mdx',
        content: `---
title: Doc 2
description: x
---

[Link to specific variant of doc 1](/docs/react/doc-1)
`,
      },
    ])

    const output = await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['nextjs', 'react', 'expo'],
      }),
    )

    expect(output).toBe('')

    expect(await readFile('./dist/doc-2.mdx')).toContain(
      `<SDKLink href="/docs/react/doc-1" sdks={["react"]}>Link to specific variant of doc 1</SDKLink>`,
    )
  })

  test('Allow the author to point directly to a specific SDK variant of a sdk scoped doc from within a Cards component', async () => {
    const { tempDir, readFile } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [
            [
              { title: 'Doc 1', href: '/docs/quickstart' },
              { title: 'Doc 2', href: '/docs/doc-2' },
            ],
          ],
        }),
      },
      {
        path: './docs/quickstart.mdx',
        content: `---
title: Doc 1
description: x
sdk: nextjs
---

# Doc 1

Documentation specific to Next.js`,
      },
      {
        path: './docs/quickstart.react.mdx',
        content: `---
title: Doc 1 for React
description: x
sdk: react
---

# Doc 1 for React
`,
      },
      {
        path: './docs/doc-2.mdx',
        content: `---
title: Doc 2
description: x
---

<Cards>
  - [Next.js](/docs/nextjs/quickstart)
  - Easily add secure, beautiful, and fast authentication to Next.js with Clerk.

  ---

  - [React](/docs/react/quickstart)
  - Get started installing and initializing Clerk in a new React + Vite app.
</Cards>
`,
      },
    ])

    const output = await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['nextjs', 'react', 'expo'],
      }),
    )

    expect(output).toBe('')

    expect(await readFile('./dist/doc-2.mdx')).toBe(
      `---
title: Doc 2
description: x
sdkScoped: "false"
canonical: /docs/doc-2
sourceFile: /docs/doc-2.mdx
---

<Cards>
  * [Next.js](/docs/nextjs/quickstart)
  * Easily add secure, beautiful, and fast authentication to Next.js with Clerk.

  ***

  * [React](/docs/react/quickstart)
  * Get started installing and initializing Clerk in a new React + Vite app.
</Cards>
`,
    )
  })

  test('Should embed links in sdk scoped docs', async () => {
    const { tempDir, readFile, listFiles } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [
            [
              { title: 'Guide 1', href: '/docs/guide-1' },
              { title: 'Guide 2', href: '/docs/guide-2' },
            ],
          ],
        }),
      },
      {
        path: './docs/guide-1.mdx',
        content: `---
title: Guide 1
description: x
sdk: react
---

# Guide 1`,
      },
      {
        path: './docs/guide-2.mdx',
        content: `---
title: Guide 2
description: x
sdk: react
---

# Guide 2`,
      },
      {
        path: './docs/guide-2.nextjs.mdx',
        content: `---
title: Guide 2
description: x
sdk: nextjs
---

[Link](/docs/guide-1)
`,
      },
    ])

    const output = await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react', 'nextjs'],
      }),
    )

    expect(output).toBe('')

    expect(await readFile('./dist/nextjs/guide-2.mdx')).toBe(`---
title: Guide 2
description: x
sdk: react, nextjs
sdkScoped: "true"
canonical: /docs/:sdk:/guide-2
availableSdks: react,nextjs
notAvailableSdks: ""
activeSdk: nextjs
sourceFile: /docs/guide-2.nextjs.mdx
---

<SDKLink href="/docs/guide-1" sdks={["react"]}>Link</SDKLink>
`)
  })

  test('Should convert links to multi-SDK documents even when target SDK is supported', async () => {
    const { tempDir, readFile } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [
            [
              { title: 'Guide 1', href: '/docs/guide-1' },
              { title: 'Guide 2', href: '/docs/guide-2' },
            ],
          ],
        }),
      },
      {
        path: './docs/guide-1.mdx',
        content: `---
title: Guide 1 for React
description: x
sdk: react
---

# Guide 1 for React

[\`<Guide 2>\`](/docs/guide-2)
`,
      },
      {
        path: './docs/guide-1.nextjs.mdx',
        content: `---
title: Guide 1 for Nextjs
description: x
sdk: nextjs
---
# Guide 1 for Nextjs
`,
      },
      {
        path: './docs/guide-2.mdx',
        content: `---
title: '<Guide 2>'
description: x
sdk: react, nextjs
---

# Guide 2 Component
`,
      },
    ])

    const output = await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react', 'nextjs'],
      }),
    )

    expect(output).toBe('')

    // When viewing the React version of the guide-1
    const reactGuide1 = await readFile('./dist/react/guide-1.mdx')

    // This should fail because the current logic doesn't convert the link
    // since all SDKs of the component (react, nextjs, astro, vue, nuxt)
    // are supported by the guide-1 document (which has all those SDK variants)
    // But it SHOULD be converted to show users which SDKs the component supports
    expect(reactGuide1).toContain(
      `<SDKLink href="/docs/:sdk:/guide-2" sdks={["react","nextjs"]} code={true}>\\<Guide 2></SDKLink>`,
    )
  })

  test('Should prevent doc links not starting with a slash', async () => {
    const title = 'Docs link missing starting slash'
    const href = '/docs/missing-starting-slash'
    const badDocLink = 'docs/link-to-something'
    const { tempDir } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [[{ title, href }]],
        }),
      },
      {
        path: `.${href}.mdx`,
        content: `---
title: ${title}
description: Page description
---

[Doc Link](${badDocLink})`,
      },
    ])

    const output = await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
      }),
    )

    expect(output).toContain(`Doc link must start with a slash (/docs/...). Fix url: ${badDocLink}`)
  })
})

describe('Path and File Handling', () => {
  test('should ignore paths specified in ignorePaths during processing', async () => {
    const { tempDir } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [
            [
              { title: 'Core Guide', href: '/docs/core-guide' },
              { title: 'Scoped Guide', href: '/docs/scoped-guide' },
            ],
          ],
        }),
      },
      {
        path: './docs/_partials/ignored-partial.mdx',
        content: `[Ignored Guide](/docs/ignored/ignored-guide)`,
      },
      {
        path: './docs/core-guide.mdx',
        content: `---
title: Core Guide
description: Not sdk specific guide
---

<Include src="_partials/ignored-partial" />
[Ignored Guide](/docs/ignored/ignored-guide)`,
      },
      {
        path: './docs/scoped-guide.mdx',
        content: `---
title: Scoped Guide
description: guide specific to react
sdk: react
---

[Ignored Guide](/docs/ignored/ignored-guide)`,
      },
    ])

    const output = await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
        ignorePaths: ['/docs/ignored'],
      }),
    )

    expect(output).toBe('')
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
      await createConfig({
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
      await createConfig({
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
        content: `[Link to Target with .mdx](/docs/target-page.mdx)
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
      await createConfig({
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
        content: `[Link to Target with .mdx](/docs/target-page.mdx)
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
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['expo'],
      }),
    )

    // Scoped page should be processed to remove .mdx
    const scopedPageContent = await readFile(pathJoin('./dist/scoped-page.mdx'))
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
      await createConfig({
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
      await createConfig({
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
      await createConfig({
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
      await createConfig({
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
      await createConfig({
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
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
      }),
    )

    // Check that the build completed and valid files were created
    expect(await fileExists(pathJoin('./dist/valid-document.mdx'))).toBe(true)
    expect(await fileExists(pathJoin('./dist/document-with-warnings.mdx'))).toBe(true)

    // Check that warnings were reported
    expect(output).toContain(
      'warning Matching file not found for path: /docs/non-existent-document. Expected file to exist at /docs/non-existent-document.mdx',
    )
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
    const config = await createConfig({
      ...baseConfig,
      basePath: tempDir,
      validSdks: ['react'],
    })
    const invalidate = invalidateFile(store, config)

    // First build
    await build(config, store)

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
    await build(config, store)

    // Check updated content
    const updatedContent = await readFile(pathJoin('./dist/cached-doc.mdx'))

    expect(updatedContent).toContain('Updated Title')
    expect(updatedContent).toContain('Updated Content')
  })

  test('should invalidate linked pages when the markdown changes', async () => {
    const { tempDir, pathJoin } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [
            [
              { title: 'Cached Doc', href: '/docs/cached-doc' },
              { title: 'Linked Doc', href: '/docs/linked-doc' },
            ],
          ],
        }),
      },
      {
        path: './docs/cached-doc.mdx',
        content: `---
title: Original Title
---

[Link to Linked Doc](/docs/linked-doc)`,
      },
      {
        path: './docs/linked-doc.mdx',
        content: `---
title: Linked Doc
sdk: react, nextjs
---

# Linked Doc`,
      },
    ])

    // Create store to maintain cache across builds
    const store = createBlankStore()
    const config = await createConfig({
      ...baseConfig,
      basePath: tempDir,
      validSdks: ['react', 'nextjs', 'astro'],
    })
    const invalidate = invalidateFile(store, config)

    // First build
    await build(config, store)

    expect(await readFile(pathJoin('./dist/cached-doc.mdx'))).toContain(
      '<SDKLink href="/docs/:sdk:/linked-doc" sdks={["react","nextjs"]}>Link to Linked Doc</SDKLink>',
    )

    // Update file content
    await fs.writeFile(
      pathJoin('./docs/linked-doc.mdx'),
      `---
title: Linked Doc
sdk: react, nextjs, astro
---

# Linked Doc`,
      'utf-8',
    )

    invalidate(pathJoin('./docs/linked-doc.mdx'))

    // Second build with same store (should detect changes)
    await build(config, store)

    // Check updated content
    expect(await readFile(pathJoin('./dist/cached-doc.mdx'))).toContain(
      '<SDKLink href="/docs/:sdk:/linked-doc" sdks={["react","nextjs","astro"]}>Link to Linked Doc</SDKLink>',
    )
  })

  test('should invalidate linked pages when the partial changes', async () => {
    const { tempDir, pathJoin } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [
            [
              { title: 'Cached Doc', href: '/docs/cached-doc' },
              { title: 'Linked Doc', href: '/docs/linked-doc' },
            ],
          ],
        }),
      },
      {
        path: './docs/_partials/partial.mdx',
        content: `[Link to Linked Doc](/docs/linked-doc)`,
      },
      {
        path: './docs/cached-doc.mdx',
        content: `---
title: Original Title
---

<Include src="_partials/partial" />`,
      },
      {
        path: './docs/linked-doc.mdx',
        content: `---
title: Linked Doc
sdk: react, nextjs
---

# Linked Doc`,
      },
    ])

    // Create store to maintain cache across builds
    const store = createBlankStore()
    const config = await createConfig({
      ...baseConfig,
      basePath: tempDir,
      validSdks: ['react', 'nextjs', 'astro'],
    })
    const invalidate = invalidateFile(store, config)

    // First build
    await build(config, store)

    expect(await readFile(pathJoin('./dist/cached-doc.mdx'))).toContain(
      '<SDKLink href="/docs/:sdk:/linked-doc" sdks={["react","nextjs"]}>Link to Linked Doc</SDKLink>',
    )

    // Update file content
    await fs.writeFile(
      pathJoin('./docs/linked-doc.mdx'),
      `---
title: Linked Doc
sdk: react, nextjs, astro
---

# Linked Doc`,
      'utf-8',
    )

    invalidate(pathJoin('./docs/linked-doc.mdx'))

    // Second build with same store (should detect changes)
    await build(config, store)

    // Check updated content
    expect(await readFile(pathJoin('./dist/cached-doc.mdx'))).toContain(
      '<SDKLink href="/docs/:sdk:/linked-doc" sdks={["react","nextjs","astro"]}>Link to Linked Doc</SDKLink>',
    )
  })

  test('should invalidate linked pages when the typedoc changes', async () => {
    const { tempDir, pathJoin } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [
            [
              { title: 'Cached Doc', href: '/docs/cached-doc' },
              { title: 'Linked Doc', href: '/docs/linked-doc' },
            ],
          ],
        }),
      },
      {
        path: './typedoc/component.mdx',
        content: `[Link to Linked Doc](/docs/linked-doc)`,
      },
      {
        path: './docs/cached-doc.mdx',
        content: `---
title: Original Title
---

<Typedoc src="component" />`,
      },
      {
        path: './docs/linked-doc.mdx',
        content: `---
title: Linked Doc
sdk: react, nextjs
---

# Linked Doc`,
      },
    ])

    // Create store to maintain cache across builds
    const store = createBlankStore()
    const config = await createConfig({
      ...baseConfig,
      basePath: tempDir,
      validSdks: ['react', 'nextjs', 'astro'],
    })
    const invalidate = invalidateFile(store, config)

    // First build
    await build(config, store)

    expect(await readFile(pathJoin('./dist/cached-doc.mdx'))).toContain(
      '<SDKLink href="/docs/:sdk:/linked-doc" sdks={["react","nextjs"]}>Link to Linked Doc</SDKLink>',
    )

    // Update file content
    await fs.writeFile(
      pathJoin('./docs/linked-doc.mdx'),
      `---
title: Linked Doc
sdk: react, nextjs, astro
---

# Linked Doc`,
      'utf-8',
    )

    invalidate(pathJoin('./docs/linked-doc.mdx'))

    // Second build with same store (should detect changes)
    await build(config, store)

    // Check updated content
    expect(await readFile(pathJoin('./dist/cached-doc.mdx'))).toContain(
      '<SDKLink href="/docs/:sdk:/linked-doc" sdks={["react","nextjs","astro"]}>Link to Linked Doc</SDKLink>',
    )
  })

  test('should update doc content when the partial changes in a sdk scoped doc', async () => {
    const { tempDir, pathJoin } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [[{ title: 'Cached Doc', href: '/docs/cached-doc' }]],
        }),
      },
      {
        path: './docs/_partials/partial.mdx',
        content: `# Original Content`,
      },
      {
        path: './docs/cached-doc.mdx',
        content: `---
title: Original Title
sdk: react
---

<Include src="_partials/partial" />`,
      },
    ])

    // Create store to maintain cache across builds
    const store = createBlankStore()
    const config = await createConfig({
      ...baseConfig,
      basePath: tempDir,
      validSdks: ['react'],
    })
    const invalidate = invalidateFile(store, config)

    // First build
    await build(config, store)

    // Check initial content
    const initialContent = await readFile(pathJoin('./dist/cached-doc.mdx'))
    expect(initialContent).toContain('Original Content')

    // Update file content
    await fs.writeFile(pathJoin('./docs/_partials/partial.mdx'), `# Updated Content`)

    invalidate(pathJoin('./docs/_partials/partial.mdx'))

    // Second build with same store (should detect changes)
    await build(config, store)

    // Check updated content
    const updatedContent = await readFile(pathJoin('./dist/cached-doc.mdx'))
    expect(updatedContent).toContain('Updated Content')
  })

  test('should update doc content when a relative partial changes', async () => {
    const { tempDir, pathJoin } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [[{ title: 'Billing Doc', href: '/docs/billing/for-b2c' }]],
        }),
      },
      {
        path: './docs/billing/_partials/local-partial.mdx',
        content: `# Original Local Content`,
      },
      {
        path: './docs/billing/for-b2c.mdx',
        content: `---
title: Billing for B2C
sdk: react
---

<Include src="./_partials/local-partial" />`,
      },
    ])

    // Create store to maintain cache across builds
    const store = createBlankStore()
    const config = await createConfig({
      ...baseConfig,
      basePath: tempDir,
      validSdks: ['react'],
    })
    const invalidate = invalidateFile(store, config)

    // First build
    await build(config, store)

    // Update file content
    await fs.writeFile(pathJoin('./docs/billing/_partials/local-partial.mdx'), `# Updated Local Content`)

    // Invalidate the relative partial
    invalidate(pathJoin('./docs/billing/_partials/local-partial.mdx'))

    // Second build with same store (should detect changes)
    await build(config, store)

    // Check updated content
    const updatedContent = await readFile(pathJoin('./dist/billing/for-b2c.mdx'))
    expect(updatedContent).toContain('Updated Local Content')
  })

  test('should update guide when a nested relative partial changes', async () => {
    const { tempDir, pathJoin } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [[{ title: 'Guides Test', href: '/docs/guides/test' }]],
        }),
      },
      {
        path: './docs/guides/_partials/nested-child.mdx',
        content: `## Original Nested Child Content`,
      },
      {
        path: './docs/guides/_partials/parent-partial.mdx',
        content: `## Parent Partial

<Include src="./nested-child" />

End of parent partial`,
      },
      {
        path: './docs/guides/test.mdx',
        content: `---
title: Test Guide
sdk: react
---

# Test Guide

<Include src="./_partials/parent-partial" />`,
      },
    ])

    // Create store to maintain cache across builds
    const store = createBlankStore()
    const config = await createConfig({
      ...baseConfig,
      basePath: tempDir,
      validSdks: ['react'],
    })
    const invalidate = invalidateFile(store, config)

    // First build
    await build(config, store)

    // Update the nested child partial
    await fs.writeFile(pathJoin('./docs/guides/_partials/nested-child.mdx'), `## Updated Nested Child Content`)

    // Invalidate the nested child partial
    invalidate(pathJoin('./docs/guides/_partials/nested-child.mdx'))

    // Second build with same store
    // The guide (test.mdx) IS tracked in dirtyDocMap as depending on parent-partial.mdx
    // (via markDirty in checkPartials), so invalidating the parent will automatically
    // invalidate the guide, ensuring the changes propagate all the way through
    await build(config, store)

    // Check updated content - should contain the updated nested child content
    const updatedContent = await readFile(pathJoin('./dist/guides/test.mdx'))
    expect(updatedContent).toContain('## Parent Partial')
    expect(updatedContent).toContain('## Updated Nested Child Content')
    expect(updatedContent).toContain('End of parent partial')
    expect(updatedContent).not.toContain('Original Nested Child Content')
  })

  test('should cache shared nested partial when included by multiple parent partials', async () => {
    const { tempDir, pathJoin } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [
            [
              { title: 'Page A', href: '/docs/page-a' },
              { title: 'Page B', href: '/docs/page-b' },
            ],
          ],
        }),
      },
      {
        path: './docs/_partials/shared-nested.mdx',
        content: `## Original Shared Content

This content is shared across multiple parent partials.`,
      },
      {
        path: './docs/_partials/parent-a.mdx',
        content: `## Parent A

<Include src="_partials/shared-nested" />

End of parent A.`,
      },
      {
        path: './docs/_partials/parent-b.mdx',
        content: `## Parent B

<Include src="_partials/shared-nested" />

End of parent B.`,
      },
      {
        path: './docs/page-a.mdx',
        content: `---
title: Page A
---

# Page A

<Include src="_partials/parent-a" />`,
      },
      {
        path: './docs/page-b.mdx',
        content: `---
title: Page B
---

# Page B

<Include src="_partials/parent-b" />`,
      },
    ])

    // Create store to maintain cache across builds
    const store = createBlankStore()
    const config = await createConfig({
      ...baseConfig,
      basePath: tempDir,
      validSdks: ['react'],
    })
    const invalidate = invalidateFile(store, config)

    // First build
    await build(config, store)

    // Verify both pages have the shared nested content
    const pageAContent = await readFile(pathJoin('./dist/page-a.mdx'))
    expect(pageAContent).toContain('Original Shared Content')

    const pageBContent = await readFile(pathJoin('./dist/page-b.mdx'))
    expect(pageBContent).toContain('Original Shared Content')

    // Now update the shared nested partial
    await fs.writeFile(
      pathJoin('./docs/_partials/shared-nested.mdx'),
      `## Updated Shared Content

This content has been updated and should propagate to all parent partials.`,
    )

    // Invalidate the shared nested partial
    invalidate(pathJoin('./docs/_partials/shared-nested.mdx'))

    // Second build with same store (should pick up changes)
    await build(config, store)

    // Verify both pages now have the updated content
    const updatedPageAContent = await readFile(pathJoin('./dist/page-a.mdx'))
    expect(updatedPageAContent).toContain('This content has been updated and should propagate to all parent partials')
    expect(updatedPageAContent).not.toContain('Original Shared Content')

    const updatedPageBContent = await readFile(pathJoin('./dist/page-b.mdx'))
    expect(updatedPageBContent).toContain('This content has been updated and should propagate to all parent partials')
    expect(updatedPageBContent).not.toContain('Original Shared Content')
  })

  test('should only read shared nested partial from filesystem once (caching proof)', async () => {
    const { tempDir, pathJoin } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [
            [
              { title: 'Page A', href: '/docs/page-a' },
              { title: 'Page B', href: '/docs/page-b' },
              { title: 'Page C', href: '/docs/page-c' },
            ],
          ],
        }),
      },
      {
        path: './docs/_partials/shared-nested.mdx',
        content: `## Shared Nested Partial

This partial should only be read from disk once.`,
      },
      {
        path: './docs/_partials/parent-a.mdx',
        content: `<Include src="_partials/shared-nested" />`,
      },
      {
        path: './docs/_partials/parent-b.mdx',
        content: `<Include src="_partials/shared-nested" />`,
      },
      {
        path: './docs/_partials/parent-c.mdx',
        content: `<Include src="_partials/shared-nested" />`,
      },
      {
        path: './docs/page-a.mdx',
        content: `---
title: Page A
---

<Include src="_partials/parent-a" />`,
      },
      {
        path: './docs/page-b.mdx',
        content: `---
title: Page B
---

<Include src="_partials/parent-b" />`,
      },
      {
        path: './docs/page-c.mdx',
        content: `---
title: Page C
---

<Include src="_partials/parent-c" />`,
      },
    ])

    const store = createBlankStore()
    const config = await createConfig({
      ...baseConfig,
      basePath: tempDir,
      validSdks: ['react'],
    })

    // Spy on the readMarkdownFile function to count file reads
    const readMarkdownFileSpy = vi.spyOn(ioModule, 'readMarkdownFile')

    // Build once
    await build(config, store)

    // Count how many times the shared nested partial was read from disk
    const sharedNestedPath = pathJoin('./docs/_partials/shared-nested.mdx')
    const sharedNestedReads = readMarkdownFileSpy.mock.calls.filter((call) => call[0] === sharedNestedPath).length

    // The shared nested partial should only be read from disk ONCE
    // Even though it's included by 3 different parent partials
    expect(sharedNestedReads).toBe(1)

    // Verify all three pages have the content (functionality check)
    for (const page of ['page-a', 'page-b', 'page-c']) {
      const content = await readFile(pathJoin(`./dist/${page}.mdx`))
      expect(content).toContain('## Shared Nested Partial')
      expect(content).toContain('This partial should only be read from disk once')
    }

    // Cleanup
    readMarkdownFileSpy.mockRestore()
  })

  test('should update doc content when the typedoc changes in a sdk scoped doc', async () => {
    const { tempDir, pathJoin } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [[{ title: 'Cached Doc', href: '/docs/cached-doc' }]],
        }),
      },
      {
        path: './typedoc/component.mdx',
        content: `# Original Content`,
      },
      {
        path: './docs/cached-doc.mdx',
        content: `---
title: Original Title
sdk: react
---

<Typedoc src="component" />`,
      },
    ])

    // Create store to maintain cache across builds
    const store = createBlankStore()
    const config = await createConfig({
      ...baseConfig,
      basePath: tempDir,
      validSdks: ['react'],
    })
    const invalidate = invalidateFile(store, config)

    // First build
    await build(config, store)

    // Check initial content
    const initialContent = await readFile(pathJoin('./dist/cached-doc.mdx'))
    expect(initialContent).toContain('Original Content')

    // Update file content
    await fs.writeFile(pathJoin('./typedoc/component.mdx'), `# Updated Content`)

    invalidate(pathJoin('./typedoc/component.mdx'))

    // Second build with same store (should detect changes)
    await build(config, store)

    // Check updated content
    const updatedContent = await readFile(pathJoin('./dist/cached-doc.mdx'))
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
        await createConfig({
          ...baseConfig,
          basePath: tempDir,
          validSdks: ['react'],
          ignoreWarnings: {
            docs: {
              'index.mdx': ['doc-not-in-manifest'],
            },
            partials: {},
            typedoc: {},
            tooltips: {},
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
        await createConfig({
          ...baseConfig,
          basePath: tempDir,
          validSdks: ['react'],
          ignoreWarnings: {
            docs: {
              'problem-file.mdx': ['doc-not-in-manifest', 'link-doc-not-found', 'invalid-sdk-in-if'],
            },
            partials: {},
            typedoc: {},
            tooltips: {},
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
        await createConfig({
          ...baseConfig,
          basePath: tempDir,
          validSdks: ['react'],
          ignoreWarnings: {
            docs: {
              'file1.mdx': ['doc-not-in-manifest', 'link-doc-not-found'],
              'file2.mdx': ['doc-not-in-manifest', 'link-doc-not-found'],
            },
            partials: {},
            typedoc: {},
            tooltips: {},
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
        await createConfig({
          ...baseConfig,
          basePath: tempDir,
          validSdks: ['react'],
          ignoreWarnings: {
            docs: {
              'partial-ignore.mdx': ['link-doc-not-found'],
            },
            partials: {},
            typedoc: {},
            tooltips: {},
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
        await createConfig({
          ...baseConfig,
          basePath: tempDir,
          validSdks: ['react'],
          ignoreWarnings: {
            docs: {
              'component-issues.mdx': [
                'doc-not-in-manifest',
                'component-missing-attribute',
                'include-src-not-partials',
              ],
            },
            partials: {},
            typedoc: {},
            tooltips: {},
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
        await createConfig({
          ...baseConfig,
          basePath: tempDir,
          validSdks: ['react'],
          ignoreWarnings: {
            docs: {
              'missing-description.mdx': ['frontmatter-missing-description'],
            },
            partials: {},
            typedoc: {},
            tooltips: {},
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
        await createConfig({
          ...baseConfig,
          basePath: tempDir,
          validSdks: ['react'],
          ignoreWarnings: {
            docs: {
              'source-page.mdx': ['link-hash-not-found'],
            },
            partials: {},
            typedoc: {},
            tooltips: {},
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
                        sdk: ['react', 'js-backend'], // js-backend not in parent
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
sdk: react, js-backend
description: This page has a description
---

# SDK Document
`,
        },
      ])

      const output = await build(
        await createConfig({
          ...baseConfig,
          basePath: tempDir,
          validSdks: ['react', 'js-backend'],
          ignoreWarnings: {
            docs: {
              'sdk-doc.mdx': ['doc-sdk-filtered-by-parent'],
            },
            partials: {},
            typedoc: {},
            tooltips: {},
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
        await createConfig({
          ...baseConfig,
          basePath: tempDir,
          validSdks: ['react'],
          ignoreWarnings: {
            partials: {
              '_partials/test-partial.mdx': ['link-doc-not-found'],
            },
            docs: {},
            typedoc: {},
            tooltips: {},
          },
        }),
      )

      // Link warning in partial should be suppressed
      expect(output).not.toContain('Doc /docs/non-existent not found')
      expect(output).toBe('')
    })
  })
})

describe('Typedoc Validation', () => {
  test('should validate typedoc component with valid src', async () => {
    const { tempDir } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [[{ title: 'API Doc', href: '/docs/api-doc' }]],
        }),
      },
      {
        path: './docs/api-doc.mdx',
        content: `---
title: API Documentation
description: Generated API docs
---

# API Documentation

<Typedoc src="api/client" />
`,
      },
      {
        path: './typedoc/api/client.mdx',
        content: `# Client API

\`\`\`typescript
interface Client {
  signIn(): Promise<void>;
  signOut(): Promise<void>;
}
\`\`\`
`,
      },
    ])

    const output = await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
      }),
    )

    // Should succeed without warnings
    expect(output).toBe('')
  })

  test('should warn when typedoc src does not exist', async () => {
    const { tempDir } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [[{ title: 'API Doc', href: '/docs/api-doc' }]],
        }),
      },
      {
        path: './docs/api-doc.mdx',
        content: `---
title: API Documentation
description: Generated API docs
---

# API Documentation

<Typedoc src="api/non-existent" />
`,
      },
      {
        path: './typedoc/api/client.mdx',
        content: `# Client API

\`\`\`typescript
interface Client {
  signIn(): Promise<void>;
  signOut(): Promise<void>;
}
\`\`\`
`,
      },
    ])

    const output = await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
      }),
    )

    // Should warn about non-existent typedoc
    expect(output).toContain('warning Typedoc api/non-existent.mdx not found')
  })

  test('should fail when typedoc folder does not exist', async () => {
    const { tempDir } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [[{ title: 'API Doc', href: '/docs/api-doc' }]],
        }),
      },
      {
        path: './docs/api-doc.mdx',
        content: `---
title: API Documentation
description: Generated API docs
---

# API Documentation

<Typedoc src="api/client" />
`,
      },
      // Intentionally NOT creating the typedoc folder
    ])

    // Create a config with a non-existent typedoc path
    const configWithMissingFolder = await createConfig({
      ...baseConfig,
      basePath: tempDir,
      typedocPath: '../non-existent-typedoc-folder',
      validSdks: ['react'],
    })

    // Should fail due to missing typedoc folder
    const promise = build(configWithMissingFolder)
    await expect(promise).rejects.toThrow('Typedoc folder')
  })

  test('should ignore typedoc warnings when configured to do so', async () => {
    const { tempDir } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [[{ title: 'API Doc', href: '/docs/api-doc' }]],
        }),
      },
      {
        path: './docs/api-doc.mdx',
        content: `---
title: API Documentation
description: Generated API docs
---

# API Documentation

<Typedoc src="api/non-existent" />
`,
      },
      {
        path: './typedoc/api/client.mdx',
        content: `# Client API

\`\`\`typescript
interface Client {
  signIn(): Promise<void>;
  signOut(): Promise<void>;
}
\`\`\`
`,
      },
    ])

    const output = await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
        ignoreWarnings: {
          docs: {
            'api-doc.mdx': ['typedoc-not-found'],
          },
          partials: {},
          typedoc: {},
          tooltips: {},
        },
      }),
    )

    // Warning should be suppressed
    expect(output).not.toContain('warning Typedoc api/non-existent.mdx not found')
    expect(output).toBe('')
  })

  test('should validate heading hashes within typedoc content', async () => {
    const { tempDir } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [
            [
              { title: 'API Doc', href: '/docs/api-doc' },
              { title: 'Reference', href: '/docs/reference' },
            ],
          ],
        }),
      },
      {
        path: './docs/api-doc.mdx',
        content: `---
title: API Documentation
description: Generated API docs
---

# API Documentation

<Typedoc src="api/client-with-sections" />
`,
      },
      {
        path: './docs/reference.mdx',
        content: `---
title: API Reference
description: Reference to API docs
---

# API Reference

[Client API Methods](/docs/api-doc#client-methods)
[Invalid Section](/docs/api-doc#non-existent-section)
`,
      },
      {
        path: './typedoc/api/client-with-sections.mdx',
        content: `# Client API

## Client Methods

\`\`\`typescript
interface Client {
  signIn(): Promise<void>;
  signOut(): Promise<void>;
}
\`\`\`
`,
      },
    ])

    const output = await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
      }),
    )

    // Valid heading hash should not produce warning
    expect(output).not.toContain('warning Hash "client-methods" not found in /docs/api-doc')

    // Invalid heading hash should produce warning
    expect(output).toContain('warning Hash "non-existent-section" not found in /docs/api-doc')
  })

  test('should handle missing src attribute in Typedoc component', async () => {
    const { tempDir } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [[{ title: 'API Doc', href: '/docs/api-doc' }]],
        }),
      },
      {
        path: './docs/api-doc.mdx',
        content: `---
title: API Documentation
description: Generated API docs
---

# API Documentation

<Typedoc />
`,
      },
      {
        path: './typedoc/api/client.mdx',
        content: `# Client API`,
      },
    ])

    const output = await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
      }),
    )

    // Should warn about missing src attribute
    expect(output).toContain('warning <Typedoc /> component has no "src" attribute')
  })

  test('Should fail it typedoc file links to a non-existent file', async () => {
    const { tempDir } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [[{ title: 'API Doc', href: '/docs/api-doc' }]],
        }),
      },
      {
        path: './typedoc/api/client.mdx',
        content: `[Non-existent File](/docs/non-existent-file)`,
      },
      {
        path: './docs/api-doc.mdx',
        content: `---
title: API Documentation
description: Generated API docs
---

# API Documentation

<Typedoc src="api/client" />
`,
      },
    ])

    const output = await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
      }),
    )

    expect(output).toContain(
      'warning Matching file not found for path: /docs/non-existent-file. Expected file to exist at /docs/non-existent-file.mdx',
    )
  })

  test('Should fail if typedoc file links to non-existent hash', async () => {
    const { tempDir } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [
            [
              { title: 'API Doc', href: '/docs/api-doc' },
              { title: 'Overview', href: '/docs/overview' },
            ],
          ],
        }),
      },
      {
        path: './docs/overview.mdx',
        content: `---
title: Overview
description: Overview of the API
---

# Overview

`,
      },
      {
        path: './typedoc/api/client.mdx',
        content: `[Non-existent Hash](/docs/overview#non-existent-hash)`,
      },
      {
        path: './docs/api-doc.mdx',
        content: `---
title: API Documentation
description: Generated API docs
---

# API Documentation

<Typedoc src="api/client" />
`,
      },
    ])

    const output = await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
      }),
    )

    expect(output).toContain('Hash "non-existent-hash" not found in /docs/overview')
  })

  test('should embed typedoc into the doc', async () => {
    const { tempDir, readFile } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [[{ title: 'API Doc', href: '/docs/api-doc' }]],
        }),
      },
      {
        path: './typedoc/api/client.mdx',
        content: `# Client API`,
      },
      {
        path: './docs/api-doc.mdx',
        content: `---
title: API Documentation
description: Generated API docs
---

# API Documentation

<Typedoc src="api/client" />
`,
      },
    ])

    const output = await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
      }),
    )

    expect(output).toBe('')

    expect(await readFile('./dist/api-doc.mdx')).toContain('Client API')
  })

  test('should embed typedoc into a sdk scoped doc', async () => {
    const { tempDir, readFile } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [[{ title: 'API Doc', href: '/docs/api-doc' }]],
        }),
      },
      {
        path: './typedoc/api/client.mdx',
        content: `# Client API`,
      },
      {
        path: './docs/api-doc.mdx',
        content: `---
title: API Documentation
description: Generated API docs
sdk: react, nextjs
---

# API Documentation

<Typedoc src="api/client" />
`,
      },
    ])

    const output = await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react', 'nextjs'],
      }),
    )

    expect(output).toBe('')

    expect(await readFile('./dist/react/api-doc.mdx')).toContain('Client API')
    expect(await readFile('./dist/nextjs/api-doc.mdx')).toContain('Client API')
  })

  test('Links in typedoc pointing to sdk scoped doc, used in an sdk scoped doc, should be replaced with <SDKLink />', async () => {
    const { tempDir, readFile } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [
            [
              { title: 'Doc 1', href: '/docs/reference/react/doc-1' },
              { title: 'Doc 2', href: '/docs/doc-2' },
            ],
          ],
        }),
      },
      {
        path: './docs/reference/react/doc-1.mdx',
        content: `---
title: Doc 1
sdk: react
---

Doc Content`,
      },
      {
        path: './_typedoc/doc.mdx',
        content: `[Doc 1](/docs/reference/react/doc-1)`,
      },
      {
        path: './docs/doc-2.mdx',
        content: `---
title: Doc 2
sdk: expo, nextjs
---

<Typedoc src="doc" />`,
      },
    ])

    await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        typedocPath: '../_typedoc',
        validSdks: ['react', 'expo', 'nextjs'],
      }),
    )

    expect(await readFile('./dist/expo/doc-2.mdx')).toBe(`---
title: Doc 2
sdk: expo, nextjs
sdkScoped: "true"
canonical: /docs/:sdk:/doc-2
availableSdks: expo,nextjs
notAvailableSdks: react
activeSdk: expo
sourceFile: /docs/doc-2.mdx
---

<SDKLink href="/docs/reference/react/doc-1" sdks={["react"]}>Doc 1</SDKLink>
`)
  })
})

describe('API Errors Generation', () => {
  test('should generate api errors', async () => {
    const { tempDir, readFile } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [
            [{ title: 'Backend API', href: '/docs/guides/development/errors/backend-api' }],
            [{ title: 'Frontend API', href: '/docs/guides/development/errors/frontend-api' }],
          ],
        }),
      },
      {
        path: './data/api_errors.json',
        content: await fs.readFile(path.join(__dirname, '..', 'data', 'api_errors.json'), 'utf-8'),
      },
    ])

    const output = await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
        flags: {
          skipApiErrors: false,
          skipGit: true,
        },
      }),
    )

    expect(output).toBe('')

    const bapi = await readFile('./dist/guides/development/errors/backend-api.mdx')
    const fapi = await readFile('./dist/guides/development/errors/frontend-api.mdx')

    expect(bapi).toContain('title: Backend API errors')
    expect(fapi).toContain('title: Frontend API errors')

    // Headings
    expect(bapi).toContain('## Actor Tokens')
    expect(fapi).toContain('## Actor Tokens')

    // Error names
    expect(bapi).toContain('### <code><wbr />Actor<wbr />Token<wbr />Cannot<wbr />Be<wbr />Revoked</code>')
    expect(fapi).toContain('### <code><wbr />Actor<wbr />Token<wbr />Already<wbr />Used</code>')

    // Error Schema
    expect(bapi).toContain('"longMessage":')
    expect(bapi).toContain('"shortMessage":')
    expect(bapi).toContain('"code":')
    expect(bapi).toContain('"meta":')

    expect(fapi).toContain('"longMessage":')
    expect(fapi).toContain('"shortMessage":')
    expect(fapi).toContain('"code":')
    expect(fapi).toContain('"meta":')

    // Error status codes
    expect(bapi).toContain('Status Code: 400')
    expect(fapi).toContain('Status Code: 400')
  })
})

describe('LLMs', () => {
  test('Should output llms.txt overview', async () => {
    const { tempDir, readFile } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [[{ title: 'API Doc', href: '/docs/api-doc' }]],
        }),
      },
      {
        path: './docs/api-doc.mdx',
        content: `---
title: API Documentation
description: Generated API docs
---

# API Documentation
`,
      },
    ])

    await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
        llms: {
          overviewPath: 'llms.txt',
        },
      }),
    )

    expect(await readFile('./dist/llms.txt')).toEqual(`# Clerk

## Docs

- [API Documentation]({{SITE_URL}}/docs/api-doc)`)
  })

  test('Should output llms-full.txt full pages', async () => {
    const { tempDir, readFile } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [[{ title: 'API Doc', href: '/docs/api-doc' }]],
        }),
      },
      {
        path: './docs/api-doc.mdx',
        content: `---
title: API Documentation
description: Generated API docs
---

# API Documentation
`,
      },
    ])

    await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
        llms: {
          fullPath: 'llms-full.txt',
        },
      }),
    )

    expect(await readFile('./dist/llms-full.txt')).toEqual(`---
title: API Documentation
description: Generated API docs
sdkScoped: "false"
canonical: /docs/api-doc
sourceFile: /docs/api-doc.mdx
---

# API Documentation
`)
  })
})

describe('Multiple document variants for pages', () => {
  test('Should pick up and use the react specific version of the doc', async () => {
    const { tempDir, readFile, listFiles } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [[{ title: 'API Doc', href: '/docs/api-doc' }]],
        }),
      },
      {
        path: './docs/api-doc.mdx',
        content: `---
title: API Documentation
description: x
sdk: nextjs, remix
---

Documentation specific to Next.js and Remix`,
      },
      {
        path: './docs/api-doc.react.mdx',
        content: `---
title: API Documentation for React
description: x
---

Documentation specific to React.js`,
      },
    ])

    const output = await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react', 'nextjs', 'remix'],
      }),
    )

    expect(output).toBe('')

    expect(JSON.parse(await readFile('./dist/manifest.json'))).toEqual({
      flags: {},
      navigation: [
        [
          {
            title: 'API Doc',
            href: '/docs/:sdk:/api-doc',
            sdk: ['nextjs', 'remix', 'react'],
          },
        ],
      ],
    })

    expect(await readFile('./dist/nextjs/api-doc.mdx')).toBe(`---
title: API Documentation
description: x
sdk: nextjs, remix, react
sdkScoped: "true"
canonical: /docs/:sdk:/api-doc
availableSdks: nextjs,remix,react
notAvailableSdks: ""
activeSdk: nextjs
sourceFile: /docs/api-doc.mdx
---

Documentation specific to Next.js and Remix
`)

    expect(await readFile('./dist/remix/api-doc.mdx')).toBe(`---
title: API Documentation
description: x
sdk: nextjs, remix, react
sdkScoped: "true"
canonical: /docs/:sdk:/api-doc
availableSdks: nextjs,remix,react
notAvailableSdks: ""
activeSdk: remix
sourceFile: /docs/api-doc.mdx
---

Documentation specific to Next.js and Remix
`)

    expect(await readFile('./dist/react/api-doc.mdx')).toBe(`---
title: API Documentation for React
description: x
sdkScoped: "true"
canonical: /docs/:sdk:/api-doc
sdk: nextjs, remix, react
availableSdks: nextjs,remix,react
notAvailableSdks: ""
activeSdk: react
sourceFile: /docs/api-doc.react.mdx
---

Documentation specific to React.js
`)

    expect(await readFile('./dist/api-doc.mdx')).toBe(`---
template: wide
redirectPage: "true"
availableSdks: nextjs,remix,react
notAvailableSdks: ""
search:
  exclude: true
canonical: /docs/:sdk:/api-doc
---
<SDKDocRedirectPage title="API Documentation" description="x" href="/docs/:sdk:/api-doc" sdks={["nextjs","remix","react"]} />`)

    expect(await listFiles('dist/')).toEqual([
      'api-doc.mdx',
      'directory.json',
      'manifest.json',
      'nextjs/api-doc.mdx',
      'react/api-doc.mdx',
      'remix/api-doc.mdx',
    ])
  })

  test('Should pick up and use the sdk specific version of the doc', async () => {
    const { tempDir, readFile, listFiles } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [[{ title: 'Test', href: '/docs/test' }]],
        }),
      },
      {
        path: './docs/test.mdx',
        content: `---
title: Documentation
sdk: react
---

Documentation specific to React`,
      },
      {
        path: './docs/test.nextjs.mdx',
        content: `---
title: Documentation for Next.js
sdk: nextjs
---

Documentation specific to Next.js`,
      },
    ])

    await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react', 'nextjs'],
      }),
    )

    expect(JSON.parse(await readFile('./dist/manifest.json'))).toEqual({
      flags: {},
      navigation: [
        [
          {
            title: 'Test',
            href: '/docs/:sdk:/test',
            sdk: ['react', 'nextjs'],
          },
        ],
      ],
    })

    expect(await readFile('./dist/nextjs/test.mdx')).toBe(`---
title: Documentation for Next.js
sdk: react, nextjs
sdkScoped: "true"
canonical: /docs/:sdk:/test
availableSdks: react,nextjs
notAvailableSdks: ""
activeSdk: nextjs
sourceFile: /docs/test.nextjs.mdx
---

Documentation specific to Next.js
`)

    expect(await readFile('./dist/react/test.mdx')).toBe(`---
title: Documentation
sdk: react, nextjs
sdkScoped: "true"
canonical: /docs/:sdk:/test
availableSdks: react,nextjs
notAvailableSdks: ""
activeSdk: react
sourceFile: /docs/test.mdx
---

Documentation specific to React
`)

    expect(await readFile('./dist/test.mdx')).toBe(`---
template: wide
redirectPage: "true"
availableSdks: react,nextjs
notAvailableSdks: ""
search:
  exclude: true
canonical: /docs/:sdk:/test
---
<SDKDocRedirectPage title="Documentation" href="/docs/:sdk:/test" sdks={["react","nextjs"]} />`)

    expect(await listFiles('dist/')).toEqual([
      'directory.json',
      'manifest.json',
      'nextjs/test.mdx',
      'react/test.mdx',
      'test.mdx',
    ])
  })

  test('Should have correct sdks in <SDKLink />', async () => {
    const { tempDir, readFile } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [
            [
              { title: 'API Doc', href: '/docs/api-doc' },
              { title: 'Overview', href: '/docs/overview' },
            ],
          ],
        }),
      },
      {
        path: './docs/api-doc.mdx',
        content: `---
title: API Documentation
description: x
sdk: nextjs, remix
---

Documentation specific to Next.js and Remix`,
      },
      {
        path: './docs/api-doc.react.mdx',
        content: `---
title: API Documentation for React
description: x
---

Documentation specific to React.js`,
      },
      {
        path: './docs/overview.mdx',
        content: `---
title: Overview
description: x
---

[API Doc](/docs/api-doc)`,
      },
    ])

    await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react', 'nextjs', 'remix'],
      }),
    )

    expect(await readFile('./dist/overview.mdx')).toBe(`---
title: Overview
description: x
sdkScoped: "false"
canonical: /docs/overview
sourceFile: /docs/overview.mdx
---

<SDKLink href="/docs/:sdk:/api-doc" sdks={["nextjs","remix","react"]}>API Doc</SDKLink>
`)
  })

  test('Should work with dev mode', async () => {
    const { tempDir, readFile, writeFile, pathJoin } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [
            [
              { title: 'API Doc', href: '/docs/api-doc' },
              { title: 'Overview', href: '/docs/overview' },
            ],
          ],
        }),
      },
      {
        path: './docs/api-doc.mdx',
        content: `---
title: API Documentation
description: x
sdk: nextjs, remix
---

Documentation specific to Next.js and Remix`,
      },
      {
        path: './docs/api-doc.react.mdx',
        content: `---
title: API Documentation for React
description: x
---

Documentation specific to React.js`,
      },
      {
        path: './docs/overview.mdx',
        content: `---
title: Overview
description: x
---

[API Doc](/docs/api-doc)`,
      },
    ])

    const config = await createConfig({
      ...baseConfig,
      basePath: tempDir,
      validSdks: ['react', 'nextjs', 'remix'],
    })
    const store = createBlankStore()
    const invalidate = invalidateFile(store, config)

    await build(config, store)

    expect(await readFile('./dist/react/api-doc.mdx')).toBe(`---
title: API Documentation for React
description: x
sdkScoped: "true"
canonical: /docs/:sdk:/api-doc
sdk: nextjs, remix, react
availableSdks: nextjs,remix,react
notAvailableSdks: ""
activeSdk: react
sourceFile: /docs/api-doc.react.mdx
---

Documentation specific to React.js
`)

    await writeFile(
      './docs/api-doc.react.mdx',
      `---
title: API Documentation for React
description: x
---

Updated Documentation specific to React.js
`,
    )

    invalidate(pathJoin('./docs/api-doc.react.mdx'))

    await build(config, store)

    expect(await readFile('./dist/react/api-doc.mdx')).toBe(`---
title: API Documentation for React
description: x
sdkScoped: "true"
canonical: /docs/:sdk:/api-doc
sdk: nextjs, remix, react
availableSdks: nextjs,remix,react
notAvailableSdks: ""
activeSdk: react
sourceFile: /docs/api-doc.react.mdx
---

Updated Documentation specific to React.js
`)
  })

  test('processes navigation with nested collapsible items and SDK-specific variants', async () => {
    const { tempDir, readFile } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [
            [
              {
                title: 'Docs',
                items: [
                  [
                    { title: 'Doc 1', sdk: ['nextjs'], items: [[{ title: 'Doc 1', href: '/docs/doc-1' }]] },
                    { title: 'Doc 1', sdk: ['react', 'remix'], href: '/docs/doc-1' },
                    { title: 'Doc 2', href: '/docs/doc-2' },
                    {
                      title: 'Doc 3 & 4',
                      items: [
                        [
                          { title: 'Doc 3', href: '/docs/doc-3' },
                          { title: 'Doc 4', href: '/docs/doc-4' },
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
        path: './docs/doc-1.mdx',
        content: `---
title: Doc 1
sdk: nextjs
---

# Doc 1`,
      },
      {
        path: './docs/doc-1.react.mdx',
        content: `---
title: Doc 1 for React
sdk: react
---

# Doc 1 for React`,
      },
      {
        path: './docs/doc-1.remix.mdx',
        content: `---
title: Doc 1 for Remix
sdk: remix
---

# Doc 1 for Remix`,
      },
      {
        path: './docs/doc-2.mdx',
        content: `---
title: Doc 2
---

# Doc 2`,
      },
      {
        path: './docs/doc-3.mdx',
        content: `---
title: Doc 3
sdk: vue
---

# Doc 3`,
      },
      {
        path: './docs/doc-4.mdx',
        content: `---
title: Doc 4
sdk: react
---

# Doc 4`,
      },
    ])

    await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react', 'nextjs', 'remix', 'vue'],
      }),
    )

    expect(JSON.parse(await readFile('./dist/manifest.json'))).toEqual({
      flags: {},
      navigation: [
        [
          {
            title: 'Docs',
            items: [
              [
                {
                  title: 'Doc 1',
                  sdk: ['nextjs'],
                  items: [
                    [
                      {
                        href: '/docs/:sdk:/doc-1',
                        title: 'Doc 1',
                        sdk: ['nextjs', 'react', 'remix'],
                      },
                    ],
                  ],
                },
                {
                  href: '/docs/:sdk:/doc-1',
                  title: 'Doc 1',
                  sdk: ['react', 'remix'],
                },
                {
                  href: '/docs/doc-2',
                  title: 'Doc 2',
                },
                {
                  title: 'Doc 3 & 4',
                  sdk: ['vue', 'react'],
                  items: [
                    [
                      {
                        href: '/docs/doc-3',
                        sdk: ['vue'],
                        title: 'Doc 3',
                      },
                      {
                        href: '/docs/doc-4',
                        sdk: ['react'],
                        title: 'Doc 4',
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
  })
})

describe('Test tooltips', () => {
  test('Should embed tooltips into a doc', async () => {
    const { tempDir, readFile } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [[{ title: 'API Doc', href: '/docs/api-doc' }]],
        }),
      },
      {
        path: './docs/api-doc.mdx',
        content: `---
title: API Documentation
description: x
---

[Tooltip](!ABC)
`,
      },
      {
        path: './docs/_tooltips/ABC.mdx',
        content: `React.js is a framework or a library idk`,
      },
    ])

    await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
        tooltips: {
          inputPath: '../docs/_tooltips',
          outputPath: './_tooltips',
        },
      }),
    )

    expect(await readFile('./dist/api-doc.mdx')).toBe(`---
title: API Documentation
description: x
sdkScoped: "false"
canonical: /docs/api-doc
sourceFile: /docs/api-doc.mdx
---

<Tooltip><TooltipTrigger>Tooltip</TooltipTrigger><TooltipContent>React.js is a framework or a library idk</TooltipContent></Tooltip>
`)
  })

  test('Should validate links in tooltips', async () => {
    const { tempDir } = await createTempFiles([
      {
        path: './docs/manifest.json',
        content: JSON.stringify({
          navigation: [[{ title: 'API Doc', href: '/docs/api-doc' }]],
        }),
      },
      {
        path: './docs/api-doc.mdx',
        content: `---
title: API Documentation
description: x
---

[Tooltip](!ABC)
`,
      },
      {
        path: './docs/_tooltips/ABC.mdx',
        content: `This is an invalid link [Invalid Link](/docs/invalid-link)`,
      },
    ])

    const output = await build(
      await createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
        tooltips: {
          inputPath: '../docs/_tooltips',
          outputPath: './_tooltips',
        },
      }),
    )

    expect(output).toContain(
      'warning Matching file not found for path: /docs/invalid-link. Expected file to exist at /docs/invalid-link.mdx',
    )
  })
})
