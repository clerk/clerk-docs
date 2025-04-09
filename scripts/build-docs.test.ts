import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { glob } from 'glob'

import { describe, expect, onTestFinished, test } from 'vitest'
import { build, createConfig } from './build-docs'

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

const baseConfig = {
  docsPath: '../docs',
  manifestPath: '../docs/manifest.json',
  partialsPath: '../docs/_partials',
  typedocPath: '../typedoc',
  ignorePaths: ['/docs/_partials'],
  ignoreWarnings: {},
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
    createConfig({
      ...baseConfig,
      basePath: tempDir,
      validSdks: ['nextjs', 'react'],
    }),
  )

  expect(output).toBe('')
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
    createConfig({
      ...baseConfig,
      basePath: tempDir,
      validSdks: ['nextjs', 'react'],
    }),
  )

  expect(output).toContain('warning Frontmatter should have a "description" property')
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
      createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
      }),
    )

    expect(output).toContain(`warning <Include /> prop "src" must start with "_partials/"`)
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
      createConfig({
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
      createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
      }),
    )

    expect(output).not.toContain(`warning Hash "my-heading" not found in /docs/headings`)
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
      createConfig({
        ...baseConfig,
        basePath: tempDir,
        validSdks: ['react'],
      }),
    )

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
})

describe('configuration', () => {
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
        createConfig({
          ...baseConfig,
          basePath: tempDir,
          validSdks: ['react'],
          ignoreWarnings: {
            'docs/_partials/test-partial.mdx': ['link-doc-not-found'],
          },
        }),
      )

      // Link warning in partial should be suppressed
      expect(output).not.toContain('Doc /docs/non-existent not found')
      expect(output).toBe('')
    })
  })
})
