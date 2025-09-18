import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import {
  moveDocuments,
  globToDynamicPattern,
  globToSDKScopedPattern,
  isGlobPattern,
  mapSourceToDestination,
  hasSDKFrontmatter,
} from './move-doc'

// Helper function to create temporary files for testing
async function createTempFiles(files: Array<{ path: string; content: string }>) {
  const tempDir = await fs.mkdtemp(path.join(tmpdir(), 'move-doc-test-'))

  const readFile = async (filePath: string) => {
    const fullPath = path.join(tempDir, filePath)
    return await fs.readFile(fullPath, 'utf-8')
  }

  const writeFile = async (filePath: string, content: string) => {
    const fullPath = path.join(tempDir, filePath)
    await fs.mkdir(path.dirname(fullPath), { recursive: true })
    await fs.writeFile(fullPath, content)
  }

  const listFiles = async (dir: string = '') => {
    const fullDir = path.join(tempDir, dir)
    try {
      const entries = await fs.readdir(fullDir, { withFileTypes: true, recursive: true })
      return entries
        .filter((entry) => entry.isFile())
        .map((entry) => path.relative(tempDir, path.join(entry.path, entry.name)))
        .sort()
    } catch {
      return []
    }
  }

  const pathJoin = (...paths: string[]) => path.join(tempDir, ...paths)

  // Create all the files
  for (const file of files) {
    await writeFile(file.path, file.content)
  }

  return {
    tempDir,
    readFile,
    writeFile,
    listFiles,
    pathJoin,
    cleanup: async () => {
      await fs.rm(tempDir, { recursive: true, force: true })
    },
  }
}

describe('move-doc utility functions', () => {
  test('isGlobPattern should detect glob patterns', () => {
    expect(isGlobPattern('/docs/references/**')).toBe(true)
    expect(isGlobPattern('/docs/quickstarts/*')).toBe(true)
    expect(isGlobPattern('/docs/guides/[id]')).toBe(true)
    expect(isGlobPattern('/docs/guides/{a,b}')).toBe(true)
    expect(isGlobPattern('/docs/single-file')).toBe(false)
  })

  test('globToDynamicPattern should convert glob patterns correctly', () => {
    expect(globToDynamicPattern('/docs/references/**')).toBe('/docs/references/:path*')
    expect(globToDynamicPattern('/docs/quickstarts/*')).toBe('/docs/quickstarts/:path*')
    expect(globToDynamicPattern('/docs/guides/*/*')).toBe('/docs/guides/:path*/:path*')
  })

  test('globToSDKScopedPattern should inject SDK parameter', () => {
    expect(globToSDKScopedPattern('/docs/references/**')).toBe('/docs/:sdk/references/:path*')
    expect(globToSDKScopedPattern('/docs/quickstarts/*')).toBe('/docs/:sdk/quickstarts/:path*')
  })

  test('mapSourceToDestination should map files correctly', () => {
    const result = mapSourceToDestination(
      '/docs/references/authentication',
      '/docs/references/**',
      '/docs/reference/**',
    )
    expect(result).toBe('/docs/reference/authentication')
  })

  test('hasSDKFrontmatter should detect SDK in frontmatter', async () => {
    const { tempDir, cleanup } = await createTempFiles([
      {
        path: 'docs/with-sdk.mdx',
        content: `---
title: Test
sdk: react, nextjs
---
Content here`,
      },
      {
        path: 'docs/without-sdk.mdx',
        content: `---
title: Test
---
Content here`,
      },
    ])

    // Change working directory to temp dir for the test
    const originalCwd = process.cwd()
    process.chdir(tempDir)

    try {
      const withSDK = await hasSDKFrontmatter(['/docs/with-sdk'])
      const withoutSDK = await hasSDKFrontmatter(['/docs/without-sdk'])

      expect(withSDK).toBe(true)
      expect(withoutSDK).toBe(false)
    } finally {
      process.chdir(originalCwd)
      await cleanup()
    }
  })
})

describe('move-doc integration tests', () => {
  let tempSetup: Awaited<ReturnType<typeof createTempFiles>>

  beforeEach(async () => {
    tempSetup = await createTempFiles([
      // Create some test MDX files
      {
        path: 'docs/references/auth.mdx',
        content: `---
title: Authentication
description: How to authenticate users
---
# Authentication guide`,
      },
      {
        path: 'docs/references/users.mdx',
        content: `---
title: Users
sdk: react, nextjs
---
# Users guide`,
      },
      {
        path: 'docs/references/components/sign-in.mdx',
        content: `---
title: SignIn Component
sdk: react, nextjs
---
# SignIn component`,
      },
      // Create redirect files
      {
        path: 'redirects/static/docs.json',
        content: JSON.stringify(
          [
            {
              source: '/docs/old-auth-guide',
              destination: '/docs/references/auth',
              permanent: true,
            },
          ],
          null,
          2,
        ),
      },
      {
        path: 'redirects/dynamic/docs.jsonc',
        content: JSON.stringify(
          [
            {
              source: '/docs/old-references/:path*',
              destination: '/docs/references/:path*',
              permanent: true,
            },
          ],
          null,
          2,
        ),
      },
      // Create manifest file
      {
        path: 'docs/manifest.json',
        content: JSON.stringify(
          {
            navigation: [
              [
                {
                  title: 'Authentication',
                  href: '/docs/references/auth',
                },
              ],
            ],
          },
          null,
          2,
        ),
      },
    ])

    // Change to temp directory for tests
    process.chdir(tempSetup.tempDir)
  })

  afterEach(async () => {
    process.chdir('/') // Change back to root to avoid issues
    await tempSetup.cleanup()
  })

  test('should handle dry run for single file', async () => {
    const result = await moveDocuments('/docs/references/auth', '/docs/guide/authentication', {
      verbose: false,
      dryRun: true,
    })

    expect(result.success).toBe(true)
    expect(result.message).toContain('Dry run completed')
    expect(result.results[0].status).toBe('would-move')

    // File should not actually be moved
    expect(await tempSetup.listFiles()).toContain('docs/references/auth.mdx')
  })

  test('should handle dry run for glob pattern', async () => {
    const result = await moveDocuments('/docs/references/**', '/docs/reference/**', { verbose: false, dryRun: true })

    expect(result.success).toBe(true)
    expect(result.message).toContain('Dry run completed')
    expect(result.results.length).toBe(3) // auth.mdx, users.mdx, components/sign-in.mdx
    expect(result.results.every((r) => r.status === 'would-move')).toBe(true)
  })

  test('should move single file and update redirects', async () => {
    const result = await moveDocuments('/docs/references/auth', '/docs/guide/authentication', { verbose: false })

    expect(result.success).toBe(true)
    expect(result.results[0].status).toBe('success')

    // Check file was moved
    const files = await tempSetup.listFiles()
    expect(files).toContain('docs/guide/authentication.mdx')
    expect(files).not.toContain('docs/references/auth.mdx')

    // Check static redirect was added
    const staticRedirects = JSON.parse(await tempSetup.readFile('redirects/static/docs.json'))
    expect(staticRedirects).toContainEqual({
      source: '/docs/references/auth',
      destination: '/docs/guide/authentication',
      permanent: true,
    })

    // Check manifest was updated
    const manifest = JSON.parse(await tempSetup.readFile('docs/manifest.json'))
    expect(manifest.navigation[0][0].href).toBe('/docs/guide/authentication')
  })

  test('should handle glob pattern move with SDK detection', async () => {
    const result = await moveDocuments('/docs/references/**', '/docs/reference/**', { verbose: false })

    expect(result.success).toBe(true)
    expect(result.results.length).toBe(3)
    expect(result.results.every((r) => r.status === 'success')).toBe(true)

    // Check files were moved
    const files = await tempSetup.listFiles()
    expect(files).toContain('docs/reference/auth.mdx')
    expect(files).toContain('docs/reference/users.mdx')
    expect(files).toContain('docs/reference/components/sign-in.mdx')

    // Check dynamic redirects were added (both basic and SDK-scoped)
    const dynamicRedirects = JSON.parse(await tempSetup.readFile('redirects/dynamic/docs.jsonc'))

    // Should have basic redirect
    expect(dynamicRedirects).toContainEqual({
      source: '/docs/references/:path*',
      destination: '/docs/reference/:path*',
      permanent: true,
    })

    // Should have SDK-scoped redirect (since some files have SDK frontmatter)
    expect(dynamicRedirects).toContainEqual({
      source: '/docs/:sdk/references/:path*',
      destination: '/docs/:sdk/reference/:path*',
      permanent: true,
    })
  })

  test('should handle error when source file does not exist', async () => {
    const result = await moveDocuments('/docs/nonexistent', '/docs/new-location', { verbose: false })

    expect(result.success).toBe(false)
    expect(result.message).toContain('Source path does not exist')
    expect(result.results[0].status).toBe('failed')
  })

  test('should validate glob pattern requirements', async () => {
    await expect(moveDocuments('/docs/references/**', '/docs/single-destination', { verbose: false })).rejects.toThrow(
      'If source is a glob pattern, destination must also be a glob pattern',
    )
  })

  test('should skip redundant redirects', async () => {
    const result = await moveDocuments(
      '/docs/references/auth',
      '/docs/references/auth', // Same source and destination
      { verbose: false },
    )

    // Should succeed but not create redundant redirect
    expect(result.success).toBe(true)
    expect(result.message).toBe('Document move completed successfully')
    expect(result.results[0].status).toBe('success')
  })
})

describe('move-doc redirect functionality', () => {
  let tempSetup: Awaited<ReturnType<typeof createTempFiles>>

  beforeEach(async () => {
    tempSetup = await createTempFiles([
      {
        path: 'docs/manifest.json',
        content: JSON.stringify({
          navigation: [
            [
              { title: 'Authentication', href: '/docs/auth/overview' },
              { title: 'Users Guide', href: '/docs/users/management' },
              { title: 'API Reference', href: '/docs/api/endpoints' },
            ],
          ],
        }),
      },
      {
        path: 'docs/auth/overview.mdx',
        content: '---\ntitle: "Auth Overview"\n---\n# Authentication Overview',
      },
      {
        path: 'docs/users/management.mdx',
        content: '---\ntitle: "User Management"\nsdk: react, nextjs\n---\n# User Management',
      },
      {
        path: 'docs/api/endpoints.mdx',
        content: '---\ntitle: "API Endpoints"\n---\n# API Endpoints',
      },
      {
        path: 'docs/other-doc.mdx',
        content: '---\ntitle: "Other Doc"\n---\nLink to [auth](/docs/auth/overview)',
      },
      {
        path: 'redirects/static/docs.json',
        content: JSON.stringify([
          { source: '/docs/old-auth', destination: '/docs/auth/overview', permanent: true },
          { source: '/docs/legacy-users', destination: '/docs/users/management', permanent: true },
        ]),
      },
      {
        path: 'redirects/dynamic/docs.jsonc',
        content: JSON.stringify([{ source: '/docs/old-api/:path*', destination: '/docs/api/:path*', permanent: true }]),
      },
    ])

    // Change to temp directory for tests
    process.chdir(tempSetup.tempDir)
  })

  afterEach(async () => {
    // Change back to root to avoid issues
    process.chdir('/')
    await tempSetup.cleanup()
  })

  test('should create static redirect for single file move', async () => {
    const result = await moveDocuments('/docs/auth/overview', '/docs/authentication/guide', { verbose: false })

    expect(result.success).toBe(true)

    // Check static redirects were updated
    const staticRedirects = JSON.parse(await tempSetup.readFile('redirects/static/docs.json'))

    // Should have new redirect
    expect(staticRedirects).toContainEqual({
      source: '/docs/auth/overview',
      destination: '/docs/authentication/guide',
      permanent: true,
    })

    // Should preserve existing redirects
    expect(staticRedirects).toContainEqual({
      source: '/docs/old-auth',
      destination: '/docs/authentication/guide',
      permanent: true,
    })

    expect(staticRedirects).toContainEqual({
      source: '/docs/legacy-users',
      destination: '/docs/users/management',
      permanent: true,
    })
  })

  test('should create dynamic redirects for glob pattern move', async () => {
    const result = await moveDocuments('/docs/auth/**', '/docs/authentication/**', { verbose: false })

    expect(result.success).toBe(true)

    // Check dynamic redirects were added
    const dynamicRedirects = JSON.parse(await tempSetup.readFile('redirects/dynamic/docs.jsonc'))

    // Should have basic dynamic redirect
    expect(dynamicRedirects).toContainEqual({
      source: '/docs/auth/:path*',
      destination: '/docs/authentication/:path*',
      permanent: true,
    })

    // Should preserve existing dynamic redirects
    expect(dynamicRedirects).toContainEqual({
      source: '/docs/old-api/:path*',
      destination: '/docs/api/:path*',
      permanent: true,
    })
  })

  test('should create SDK-scoped dynamic redirects when files have SDK frontmatter', async () => {
    const result = await moveDocuments('/docs/users/**', '/docs/user-guide/**', { verbose: false })

    expect(result.success).toBe(true)

    // Check dynamic redirects were added
    const dynamicRedirects = JSON.parse(await tempSetup.readFile('redirects/dynamic/docs.jsonc'))

    // Should have basic dynamic redirect
    expect(dynamicRedirects).toContainEqual({
      source: '/docs/users/:path*',
      destination: '/docs/user-guide/:path*',
      permanent: true,
    })

    // Should have SDK-scoped dynamic redirect (since users/management.mdx has SDK frontmatter)
    expect(dynamicRedirects).toContainEqual({
      source: '/docs/:sdk/users/:path*',
      destination: '/docs/:sdk/user-guide/:path*',
      permanent: true,
    })
  })

  test('should update static redirect destinations when they conflict with new dynamic redirects', async () => {
    // First, add a static redirect that points to a path that will be moved by our dynamic redirect
    await tempSetup.writeFile(
      'redirects/static/docs.json',
      JSON.stringify([
        { source: '/docs/old-auth', destination: '/docs/auth/overview', permanent: true },
        { source: '/docs/legacy-users', destination: '/docs/users/management', permanent: true },
        { source: '/docs/another-old-auth', destination: '/docs/auth/guide', permanent: true }, // This should be updated
      ]),
    )

    const result = await moveDocuments('/docs/auth/**', '/docs/authentication/**', { verbose: false })

    expect(result.success).toBe(true)

    // Check that static redirects were updated appropriately
    const staticRedirects = JSON.parse(await tempSetup.readFile('redirects/static/docs.json'))

    // The static redirects should be updated to point to the specific mapped destinations
    // The improved implementation now maps to specific paths instead of using generic placeholders
    expect(staticRedirects).toContainEqual({
      source: '/docs/old-auth',
      destination: '/docs/authentication/overview',
      permanent: true,
    })

    expect(staticRedirects).toContainEqual({
      source: '/docs/another-old-auth',
      destination: '/docs/authentication/guide',
      permanent: true,
    })

    // Unrelated redirects should remain unchanged
    expect(staticRedirects).toContainEqual({
      source: '/docs/legacy-users',
      destination: '/docs/users/management',
      permanent: true,
    })
  })

  test('should not create redundant dynamic redirects', async () => {
    // Create some files in a different location to avoid conflicts
    await tempSetup.writeFile('docs/guides/auth.mdx', '---\ntitle: "Auth Guide"\n---\n# Auth Guide')
    await tempSetup.writeFile('docs/guides/users.mdx', '---\ntitle: "Users Guide"\n---\n# Users Guide')

    // First move that creates a dynamic redirect
    await moveDocuments('/docs/guides/**', '/docs/guide/**', { verbose: false })

    // Get initial dynamic redirects count
    const initialDynamicRedirects = JSON.parse(await tempSetup.readFile('redirects/dynamic/docs.jsonc'))
    const initialCount = initialDynamicRedirects.length

    // Create new source files to test redirect creation again
    await tempSetup.writeFile('docs/guides/new-auth.mdx', '---\ntitle: "New Auth"\n---\n# New Auth')

    // Try to create the same redirect pattern again (should not add duplicate)
    const result = await moveDocuments('/docs/guides/**', '/docs/guide/**', { verbose: false })

    expect(result.success).toBe(true)

    // Check that no duplicate redirects were created
    const finalDynamicRedirects = JSON.parse(await tempSetup.readFile('redirects/dynamic/docs.jsonc'))
    expect(finalDynamicRedirects.length).toBe(initialCount) // Should be same count

    // Should still have the redirect
    expect(finalDynamicRedirects).toContainEqual({
      source: '/docs/guides/:path*',
      destination: '/docs/guide/:path*',
      permanent: true,
    })
  })

  test('should not create redundant static redirects', async () => {
    // First move
    await moveDocuments('/docs/auth/overview', '/docs/authentication/guide', { verbose: false })

    // Get initial static redirects
    const initialStaticRedirects = JSON.parse(await tempSetup.readFile('redirects/static/docs.json'))
    const initialCount = initialStaticRedirects.length

    // Try the same move again (this should be skipped entirely due to file already moved)
    // Let's create the source file again to test redirect logic
    await tempSetup.writeFile('docs/auth/overview.mdx', '---\ntitle: "Auth Overview"\n---\n# Authentication Overview')

    const result = await moveDocuments('/docs/auth/overview', '/docs/authentication/guide', { verbose: false })

    expect(result.success).toBe(false) // Should fail because destination already exists

    // Check that no duplicate redirects were created
    const finalStaticRedirects = JSON.parse(await tempSetup.readFile('redirects/static/docs.json'))
    expect(finalStaticRedirects.length).toBe(initialCount) // Should be same count
  })

  test('should handle redirect chain optimization', async () => {
    // Set up a redirect chain: A -> B, then move B -> C, should result in A -> C
    await tempSetup.writeFile(
      'redirects/static/docs.json',
      JSON.stringify([{ source: '/docs/old-auth', destination: '/docs/auth/overview', permanent: true }]),
    )

    // Move the destination of the existing redirect
    const result = await moveDocuments('/docs/auth/overview', '/docs/new-auth/overview', { verbose: false })

    expect(result.success).toBe(true)

    // Check that the redirect chain was optimized
    const staticRedirects = JSON.parse(await tempSetup.readFile('redirects/static/docs.json'))

    // Should have updated the existing redirect to point to the new destination
    expect(staticRedirects).toContainEqual({
      source: '/docs/old-auth',
      destination: '/docs/new-auth/overview',
      permanent: true,
    })

    // Should also have the new redirect
    expect(staticRedirects).toContainEqual({
      source: '/docs/auth/overview',
      destination: '/docs/new-auth/overview',
      permanent: true,
    })
  })

  test('should skip creating redirects when source equals destination', async () => {
    const initialStaticRedirects = JSON.parse(await tempSetup.readFile('redirects/static/docs.json'))
    const initialCount = initialStaticRedirects.length

    const result = await moveDocuments('/docs/auth/overview', '/docs/auth/overview', { verbose: false })

    expect(result.success).toBe(true)

    // Should not have added any new redirects
    const finalStaticRedirects = JSON.parse(await tempSetup.readFile('redirects/static/docs.json'))
    expect(finalStaticRedirects.length).toBe(initialCount)
  })

  test('should handle complex glob patterns in dynamic redirects', async () => {
    // Create nested structure
    await tempSetup.writeFile('docs/api/v1/users.mdx', '---\ntitle: "Users API v1"\n---\n# Users API')
    await tempSetup.writeFile('docs/api/v1/auth.mdx', '---\ntitle: "Auth API v1"\n---\n# Auth API')
    await tempSetup.writeFile('docs/api/v2/users.mdx', '---\ntitle: "Users API v2"\n---\n# Users API v2')

    const result = await moveDocuments('/docs/api/**', '/docs/reference/api/**', { verbose: false })

    expect(result.success).toBe(true)

    // Check files were moved correctly
    const files = await tempSetup.listFiles()
    expect(files).toContain('docs/reference/api/v1/users.mdx')
    expect(files).toContain('docs/reference/api/v1/auth.mdx')
    expect(files).toContain('docs/reference/api/v2/users.mdx')
    expect(files).toContain('docs/reference/api/endpoints.mdx') // Original file

    // Check dynamic redirect was created
    const dynamicRedirects = JSON.parse(await tempSetup.readFile('redirects/dynamic/docs.jsonc'))
    expect(dynamicRedirects).toContainEqual({
      source: '/docs/api/:path*',
      destination: '/docs/reference/api/:path*',
      permanent: true,
    })
  })

  test('should update static redirect destinations when files are moved by dynamic redirect', async () => {
    // We are moving /docs/api/v2/users to /docs/v2/users
    // We will use a glob pattern to move all the docs in the api folder
    // The end state is that so if the user goes to
    // User goes to /docs/api/v1/users
    // They will then be redirect to /docs/v1/users by the dynamic redirect
    // And then be redirected to /docs/v2/users by the static redirect

    // So we start with a file in the v2 docs folder
    await tempSetup.writeFile('docs/api/v2/users.mdx', '---\ntitle: "Users API v1"\n---\n# Users API')

    // We have a static redirect that sends users to the new version
    await tempSetup.writeFile(
      'redirects/static/docs.json',
      JSON.stringify([{ source: '/docs/api/v1/users', destination: '/docs/api/v2/users', permanent: true }]),
    )

    // we then decide to drop the /api/ folder
    await moveDocuments('/docs/api/**', '/docs/**', { verbose: false })

    // We should have a dynamic redirect that sends users over to the shortened path
    expect(JSON.parse(await tempSetup.readFile('redirects/dynamic/docs.jsonc'))).toContainEqual({
      source: '/docs/api/:path*',
      destination: '/docs/:path*',
      permanent: true,
    })

    // And the existing static redirect should be updated to continue to point from v1 to v2
    expect(JSON.parse(await tempSetup.readFile('redirects/static/docs.json'))).toContainEqual({
      source: '/docs/v1/users',
      destination: '/docs/v2/users',
      permanent: true,
    })
  })

  test('should preserve hash fragments in redirects', async () => {
    // Test that redirects maintain hash fragments correctly
    await tempSetup.writeFile(
      'redirects/static/docs.json',
      JSON.stringify([
        { source: '/docs/old-auth#configuration', destination: '/docs/auth/overview#config', permanent: true },
        { source: '/docs/legacy-guide', destination: '/docs/auth/overview#getting-started', permanent: true },
      ]),
    )

    const result = await moveDocuments('/docs/auth/overview', '/docs/authentication/guide', { verbose: false })

    expect(result.success).toBe(true)

    // Check that hash fragments are preserved in redirect updates
    const staticRedirects = JSON.parse(await tempSetup.readFile('redirects/static/docs.json'))

    expect(staticRedirects).toContainEqual({
      source: '/docs/old-auth#configuration',
      destination: '/docs/authentication/guide#config',
      permanent: true,
    })

    expect(staticRedirects).toContainEqual({
      source: '/docs/legacy-guide',
      destination: '/docs/authentication/guide#getting-started',
      permanent: true,
    })
  })

  test('should handle nested glob patterns', async () => {
    // Create nested structure for testing
    await tempSetup.writeFile('docs/guides/react/auth.mdx', '---\ntitle: "React Auth"\nsdk: react\n---\n# React Auth')
    await tempSetup.writeFile(
      'docs/guides/nextjs/auth.mdx',
      '---\ntitle: "Next.js Auth"\nsdk: nextjs\n---\n# Next.js Auth',
    )
    await tempSetup.writeFile('docs/guides/vue/setup.mdx', '---\ntitle: "Vue Setup"\nsdk: vue\n---\n# Vue Setup')

    // Test nested pattern: /docs/guides/** -> /docs/reference/**
    const result = await moveDocuments('/docs/guides/**', '/docs/reference/**', { verbose: false })

    expect(result.success).toBe(true)
    expect(result.results.length).toBe(3)

    // Check files were moved to correct locations
    const files = await tempSetup.listFiles()
    expect(files).toContain('docs/reference/react/auth.mdx')
    expect(files).toContain('docs/reference/nextjs/auth.mdx')
    expect(files).toContain('docs/reference/vue/setup.mdx')

    // Check dynamic redirects were created
    const dynamicRedirects = JSON.parse(await tempSetup.readFile('redirects/dynamic/docs.jsonc'))
    expect(dynamicRedirects).toContainEqual({
      source: '/docs/guides/:path*',
      destination: '/docs/reference/:path*',
      permanent: true,
    })
  })

  test('should handle missing from manifest file gracefully', async () => {
    // Create minimal manifest to avoid issues
    await tempSetup.writeFile('docs/manifest.json', '{"navigation": []}')

    const result = await moveDocuments('/docs/auth/overview', '/docs/authentication/guide', { verbose: false })

    // Should still succeed even with empty manifest
    expect(result.success).toBe(true)

    // File should still be moved
    const finalFiles = await tempSetup.listFiles()
    expect(finalFiles).toContain('docs/authentication/guide.mdx')
    expect(finalFiles).not.toContain('docs/auth/overview.mdx')
  })
})
