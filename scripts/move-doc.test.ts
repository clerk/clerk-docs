import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { moveDocuments, isGlobPattern, isExcludedFromGlob, mapSourceToDestination } from './move-doc'

const DELETE_DOC_SCRIPT_PATH = fileURLToPath(new URL('./delete-doc.mjs', import.meta.url))

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

  // Manual walk instead of fs.readdir({ recursive: true }) because
  // Dirent.path (needed to reconstruct full paths) was deprecated and
  // returns unreliable values.
  const listFiles = async (dir: string = '') => {
    const fullDir = path.join(tempDir, dir)
    const collectedFiles: string[] = []

    const walk = async (currentDir: string) => {
      const entries = await fs.readdir(currentDir, { withFileTypes: true })

      for (const entry of entries) {
        const entryPath = path.join(currentDir, entry.name)

        if (entry.isDirectory()) {
          await walk(entryPath)
          continue
        }

        if (entry.isFile()) {
          collectedFiles.push(path.relative(tempDir, entryPath))
        }
      }
    }

    try {
      await walk(fullDir)
      return collectedFiles.sort()
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

  test('isExcludedFromGlob should exclude node_modules and .git path segments', () => {
    // Node passes directories while walking; Bun passes matched file paths
    expect(isExcludedFromGlob('node_modules')).toBe(true)
    expect(isExcludedFromGlob('docs/node_modules/example.mdx')).toBe(true)
    expect(isExcludedFromGlob('.git')).toBe(true)
    expect(isExcludedFromGlob('docs\\node_modules\\example.mdx')).toBe(true)
    expect(isExcludedFromGlob('docs/guides/example.mdx')).toBe(false)
    // segments must match exactly — .github is not .git
    expect(isExcludedFromGlob('docs/.github/example.mdx')).toBe(false)
  })

  test('mapSourceToDestination should map files correctly', () => {
    const result = mapSourceToDestination(
      '/docs/references/authentication',
      '/docs/references/**',
      '/docs/reference/**',
    )
    expect(result).toBe('/docs/reference/authentication')
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
              source: '/docs/old-references{/*path}',
              destination: '/docs/references{/*path}',
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
    })

    // Check manifest was updated
    const manifest = JSON.parse(await tempSetup.readFile('docs/manifest.json'))
    expect(manifest.navigation[0][0].href).toBe('/docs/guide/authentication')
  })

  test('should add a static redirect per file for a glob move', async () => {
    const dynamicBefore = await tempSetup.readFile('redirects/dynamic/docs.jsonc')
    const result = await moveDocuments('/docs/references/**', '/docs/reference/**', { verbose: false })

    expect(result.success).toBe(true)
    expect(result.results.length).toBe(3)
    expect(result.results.every((r) => r.status === 'success')).toBe(true)

    // Check files were moved
    const files = await tempSetup.listFiles()
    expect(files).toContain('docs/reference/auth.mdx')
    expect(files).toContain('docs/reference/users.mdx')
    expect(files).toContain('docs/reference/components/sign-in.mdx')

    // Each moved file gets its own static redirect, including SDK-scoped pages
    const staticRedirects = JSON.parse(await tempSetup.readFile('redirects/static/docs.json'))
    expect(staticRedirects).toEqual(
      expect.arrayContaining([
        { source: '/docs/references/auth', destination: '/docs/reference/auth' },
        { source: '/docs/references/users', destination: '/docs/reference/users' },
        { source: '/docs/references/components/sign-in', destination: '/docs/reference/components/sign-in' },
      ]),
    )

    // Existing redirects that pointed at a moved file follow it
    expect(staticRedirects).toContainEqual({ source: '/docs/old-auth-guide', destination: '/docs/reference/auth' })

    // Dynamic redirects are left alone
    expect(await tempSetup.readFile('redirects/dynamic/docs.jsonc')).toBe(dynamicBefore)
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
          { source: '/docs/old-auth', destination: '/docs/auth/overview' },
          { source: '/docs/legacy-users', destination: '/docs/users/management' },
        ]),
      },
      {
        path: 'redirects/dynamic/docs.jsonc',
        content: JSON.stringify([
          { source: '/docs/old-api{/*path}', destination: '/docs/api{/*path}', permanent: true },
        ]),
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
    })

    // Should preserve existing redirects
    expect(staticRedirects).toContainEqual({
      source: '/docs/old-auth',
      destination: '/docs/authentication/guide',
    })

    expect(staticRedirects).toContainEqual({
      source: '/docs/legacy-users',
      destination: '/docs/users/management',
    })
  })

  test('should create static redirects, not dynamic ones, for a glob move', async () => {
    const dynamicBefore = await tempSetup.readFile('redirects/dynamic/docs.jsonc')
    const result = await moveDocuments('/docs/auth/**', '/docs/authentication/**', { verbose: false })

    expect(result.success).toBe(true)

    const staticRedirects = JSON.parse(await tempSetup.readFile('redirects/static/docs.json'))
    expect(staticRedirects).toContainEqual({
      source: '/docs/auth/overview',
      destination: '/docs/authentication/overview',
    })

    // The existing dynamic redirects file is untouched
    expect(await tempSetup.readFile('redirects/dynamic/docs.jsonc')).toBe(dynamicBefore)
  })
  test('should repoint static redirects at files moved by a glob move', async () => {
    await tempSetup.writeFile(
      'redirects/static/docs.json',
      JSON.stringify([
        { source: '/docs/old-auth', destination: '/docs/auth/overview' },
        { source: '/docs/legacy-users', destination: '/docs/users/management' },
      ]),
    )

    const result = await moveDocuments('/docs/auth/**', '/docs/authentication/**', { verbose: false })

    expect(result.success).toBe(true)

    const staticRedirects = JSON.parse(await tempSetup.readFile('redirects/static/docs.json'))

    // Redirects into a moved file now point at its new location
    expect(staticRedirects).toContainEqual({
      source: '/docs/old-auth',
      destination: '/docs/authentication/overview',
    })

    // Unrelated redirects should remain unchanged
    expect(staticRedirects).toContainEqual({
      source: '/docs/legacy-users',
      destination: '/docs/users/management',
    })
  })
  test('should not duplicate static redirects when a glob move repeats', async () => {
    await tempSetup.writeFile('docs/guides/auth.mdx', '---\ntitle: "Auth Guide"\n---\n# Auth Guide')
    await tempSetup.writeFile('docs/guides/users.mdx', '---\ntitle: "Users Guide"\n---\n# Users Guide')

    await moveDocuments('/docs/guides/**', '/docs/guide/**', { verbose: false })

    // A later file under the same prefix moves the same way
    await tempSetup.writeFile('docs/guides/new-auth.mdx', '---\ntitle: "New Auth"\n---\n# New Auth')
    const result = await moveDocuments('/docs/guides/**', '/docs/guide/**', { verbose: false })

    expect(result.success).toBe(true)

    const staticRedirects: Array<{ source: string }> = JSON.parse(
      await tempSetup.readFile('redirects/static/docs.json'),
    )
    const sources = staticRedirects.map((redirect) => redirect.source)
    expect(sources).toEqual(
      expect.arrayContaining(['/docs/guides/auth', '/docs/guides/users', '/docs/guides/new-auth']),
    )
    expect(new Set(sources).size).toBe(sources.length)
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
      JSON.stringify([{ source: '/docs/old-auth', destination: '/docs/auth/overview' }]),
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
    })

    // Should also have the new redirect
    expect(staticRedirects).toContainEqual({
      source: '/docs/auth/overview',
      destination: '/docs/new-auth/overview',
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

  test('should add static redirects for nested files in a glob move', async () => {
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

    const staticRedirects = JSON.parse(await tempSetup.readFile('redirects/static/docs.json'))
    expect(staticRedirects).toEqual(
      expect.arrayContaining([
        { source: '/docs/api/v1/users', destination: '/docs/reference/api/v1/users' },
        { source: '/docs/api/v1/auth', destination: '/docs/reference/api/v1/auth' },
        { source: '/docs/api/v2/users', destination: '/docs/reference/api/v2/users' },
        { source: '/docs/api/endpoints', destination: '/docs/reference/api/endpoints' },
      ]),
    )
  })
  test('should collapse an existing redirect chain when a glob move moves its destination', async () => {
    // /docs/api/v1/users already redirects to /docs/api/v2/users
    await tempSetup.writeFile('docs/api/v2/users.mdx', '---\ntitle: "Users API v2"\n---\n# Users API')
    await tempSetup.writeFile(
      'redirects/static/docs.json',
      JSON.stringify([{ source: '/docs/api/v1/users', destination: '/docs/api/v2/users' }]),
    )

    // Drop the /api/ folder
    await moveDocuments('/docs/api/**', '/docs/**', { verbose: false })

    // Both the moved page and the old redirect into it land on the new location in one hop
    const staticRedirects = JSON.parse(await tempSetup.readFile('redirects/static/docs.json'))
    expect(staticRedirects).toContainEqual({ source: '/docs/api/v2/users', destination: '/docs/v2/users' })
    expect(staticRedirects).toContainEqual({ source: '/docs/api/v1/users', destination: '/docs/v2/users' })
  })
  test('should preserve hash fragments in redirects', async () => {
    // Test that redirects maintain hash fragments correctly
    await tempSetup.writeFile(
      'redirects/static/docs.json',
      JSON.stringify([
        { source: '/docs/old-auth#configuration', destination: '/docs/auth/overview#config' },
        { source: '/docs/legacy-guide', destination: '/docs/auth/overview#getting-started' },
      ]),
    )

    const result = await moveDocuments('/docs/auth/overview', '/docs/authentication/guide', { verbose: false })

    expect(result.success).toBe(true)

    // Check that hash fragments are preserved in redirect updates
    const staticRedirects = JSON.parse(await tempSetup.readFile('redirects/static/docs.json'))

    expect(staticRedirects).toContainEqual({
      source: '/docs/old-auth#configuration',
      destination: '/docs/authentication/guide#config',
    })

    expect(staticRedirects).toContainEqual({
      source: '/docs/legacy-guide',
      destination: '/docs/authentication/guide#getting-started',
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

    const staticRedirects = JSON.parse(await tempSetup.readFile('redirects/static/docs.json'))
    expect(staticRedirects).toEqual(
      expect.arrayContaining([
        { source: '/docs/guides/react/auth', destination: '/docs/reference/react/auth' },
        { source: '/docs/guides/nextjs/auth', destination: '/docs/reference/nextjs/auth' },
        { source: '/docs/guides/vue/setup', destination: '/docs/reference/vue/setup' },
      ]),
    )
  })

  test('should refuse a move whose static redirect a dynamic rule would shadow', async () => {
    await tempSetup.writeFile(
      'redirects/dynamic/docs.jsonc',
      JSON.stringify([{ source: '/docs/auth{/*path}', destination: '/docs/authentication{/*path}', permanent: true }]),
    )
    const staticBefore = await tempSetup.readFile('redirects/static/docs.json')

    const single = await moveDocuments('/docs/auth/overview', '/docs/guide/auth', { verbose: false })
    expect(single.success).toBe(false)
    expect(single.message).toContain('/docs/auth/overview (matched by /docs/auth{/*path})')

    const glob = await moveDocuments('/docs/auth/**', '/docs/guide/**', { verbose: false })
    expect(glob.success).toBe(false)
    expect(glob.message).toContain('/docs/auth/overview (matched by /docs/auth{/*path})')

    // Nothing moved and no redirects written
    expect(await tempSetup.listFiles()).toContain('docs/auth/overview.mdx')
    expect(await tempSetup.readFile('redirects/static/docs.json')).toBe(staticBefore)
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

describe('move-doc manifest file discovery (all-manifest awareness)', () => {
  let tempSetup: Awaited<ReturnType<typeof createTempFiles>>

  beforeEach(async () => {
    tempSetup = await createTempFiles([
      {
        path: 'docs/old-path.mdx',
        content: '---\ntitle: "Old Page"\n---\n# Old Page',
      },
      {
        path: 'redirects/static/docs.json',
        content: JSON.stringify([]),
      },
      {
        path: 'redirects/dynamic/docs.jsonc',
        content: JSON.stringify([]),
      },
      // New-format single-level manifest (post format-flip shape)
      {
        path: 'docs/manifest.json',
        content: JSON.stringify(
          {
            navigationType: 'sectioned',
            navigation: [{ title: 'Old Page', href: '/docs/old-path' }],
          },
          null,
          2,
        ),
      },
      // Per-SDK manifest that must be updated alongside the main manifest
      {
        path: 'docs/manifest.ios.json',
        content: JSON.stringify(
          {
            navigationType: 'flat',
            navigation: [{ title: 'Old Page (iOS)', href: '/docs/old-path' }],
          },
          null,
          2,
        ),
      },
      // Schema document — must never be parsed/rewritten as a manifest
      {
        path: 'docs/manifest.schema.json',
        content: JSON.stringify({ $schema: 'https://json-schema.org/draft/2020-12/schema', title: 'not real' }),
      },
    ])

    process.chdir(tempSetup.tempDir)
  })

  afterEach(async () => {
    process.chdir('/')
    await tempSetup.cleanup()
  })

  test('should update the href in both manifest.json and manifest.ios.json', async () => {
    const result = await moveDocuments('/docs/old-path', '/docs/new-path', { verbose: false })

    expect(result.success).toBe(true)

    const mainManifest = JSON.parse(await tempSetup.readFile('docs/manifest.json'))
    expect(mainManifest.navigation[0].href).toBe('/docs/new-path')

    const iosManifest = JSON.parse(await tempSetup.readFile('docs/manifest.ios.json'))
    expect(iosManifest.navigation[0].href).toBe('/docs/new-path')
  })

  test('should leave manifest.schema.json byte-identical', async () => {
    const before = await tempSetup.readFile('docs/manifest.schema.json')

    const result = await moveDocuments('/docs/old-path', '/docs/new-path', { verbose: false })
    expect(result.success).toBe(true)

    const after = await tempSetup.readFile('docs/manifest.schema.json')
    expect(after).toBe(before)
  })
})

describe('delete-doc.mjs manifest file discovery (all-manifest awareness)', () => {
  let tempSetup: Awaited<ReturnType<typeof createTempFiles>>

  beforeEach(async () => {
    tempSetup = await createTempFiles([
      {
        path: 'docs/to-delete.mdx',
        content: '---\ntitle: "To Delete"\n---\n# To delete',
      },
      {
        path: 'redirects/static/docs.json',
        content: JSON.stringify([]),
      },
      {
        path: 'docs/manifest.json',
        content: JSON.stringify(
          {
            navigationType: 'sectioned',
            navigation: [{ title: 'To Delete', href: '/docs/to-delete' }],
          },
          null,
          2,
        ),
      },
      {
        path: 'docs/manifest.ios.json',
        content: JSON.stringify(
          {
            navigationType: 'flat',
            navigation: [{ title: 'To Delete (iOS)', href: '/docs/to-delete' }],
          },
          null,
          2,
        ),
      },
      {
        // delete-doc.mjs reads the sdk enum from this file to decide which manifest.<sdk>.json
        // files are real — the fixture needs the enum, not just a schema-shaped stub
        path: 'docs/manifest.schema.json',
        content: JSON.stringify({
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          $defs: { sdk: { enum: ['ios', 'android'] } },
        }),
      },
      {
        // A backup of the real manifest: matches a loose manifest.*.json pattern AND carries a
        // navigation array, so only slug-strict matching keeps delete-doc's hands off it
        path: 'docs/manifest.backup.json',
        content: JSON.stringify(
          {
            navigationType: 'sectioned',
            navigation: [{ title: 'To Delete', href: '/docs/to-delete' }],
          },
          null,
          2,
        ),
      },
    ])
  })

  afterEach(async () => {
    await tempSetup.cleanup()
  })

  test('should remove the doc from both manifest.json and manifest.ios.json, leaving manifest.schema.json untouched', async () => {
    const schemaBefore = await tempSetup.readFile('docs/manifest.schema.json')

    const result = spawnSync('node', [DELETE_DOC_SCRIPT_PATH, '/docs/to-delete'], {
      cwd: tempSetup.tempDir,
      encoding: 'utf-8',
    })

    expect(result.status).toBe(0)

    const mainManifest = JSON.parse(await tempSetup.readFile('docs/manifest.json'))
    expect(mainManifest.navigation).not.toContainEqual(expect.objectContaining({ href: '/docs/to-delete' }))

    const iosManifest = JSON.parse(await tempSetup.readFile('docs/manifest.ios.json'))
    expect(iosManifest.navigation).not.toContainEqual(expect.objectContaining({ href: '/docs/to-delete' }))

    const schemaAfter = await tempSetup.readFile('docs/manifest.schema.json')
    expect(schemaAfter).toBe(schemaBefore)
  })

  test('leaves a manifest.backup.json untouched even though it contains a navigation array', async () => {
    const backupBefore = await tempSetup.readFile('docs/manifest.backup.json')

    const result = spawnSync('node', [DELETE_DOC_SCRIPT_PATH, '/docs/to-delete'], {
      cwd: tempSetup.tempDir,
      encoding: 'utf-8',
    })

    expect(result.status).toBe(0)

    const backupAfter = await tempSetup.readFile('docs/manifest.backup.json')
    expect(backupAfter).toBe(backupBefore)
  })

  test('fails loudly when the schema has no sdk enum instead of guessing at manifest files', async () => {
    await tempSetup.writeFile(
      'docs/manifest.schema.json',
      JSON.stringify({ $schema: 'https://json-schema.org/draft/2020-12/schema', title: 'no enum here' }),
    )

    const result = spawnSync('node', [DELETE_DOC_SCRIPT_PATH, '/docs/to-delete'], {
      cwd: tempSetup.tempDir,
      encoding: 'utf-8',
    })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Could not read the sdk enum')
  })
})
