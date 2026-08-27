import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { createConfig } from './config'

const tempRoots: string[] = []

async function createTempRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'clerk-docs-config-test-'))
  tempRoots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

// Pushes a directory's mtime past the sweep's in-flight grace window.
async function ageDir(dir: string) {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000)
  await fs.utimes(dir, twoHoursAgo, twoHoursAgo)
}

function configOptions(root: string, flags?: { watch?: boolean }) {
  return {
    basePath: path.join(root, 'scripts'),
    validSdks: ['nextjs'] as const,
    dataPath: '../data',
    docsPath: '../docs',
    baseDocsLink: '/docs/',
    manifestPath: '../docs/manifest.json',
    partialsFolderName: '_partials',
    distPath: '../dist',
    typedocPath: '../clerk-typedoc',
    ignorePaths: [],
    ignoreLinks: [],
    manifestOptions: {
      wrapDefault: true,
      hideTitleDefault: false,
    },
    flags,
  }
}

describe('temp dist location', () => {
  test('non-watch builds keep the temp dist in the OS temp directory', async () => {
    const root = await createTempRoot()

    const config = await createConfig(configOptions(root))

    expect(config.distTempPath.startsWith(path.join(root, '.dev-dist'))).toBe(false)
    expect(config.distTempPath.startsWith(os.tmpdir())).toBe(true)

    await fs.rm(config.distTempPath, { recursive: true, force: true })
  })

  test('watch builds keep the temp dist inside the repo, next to dist', async () => {
    // dist is symlinked to the temp dist in watch mode, and `next build` (Turbopack)
    // rejects a dist symlink that resolves outside the project root — so the temp
    // dist must live inside the repo.
    const root = await createTempRoot()

    const config = await createConfig(configOptions(root, { watch: true }))

    const devDistParent = path.join(root, '.dev-dist')
    expect(path.dirname(config.distTempPath)).toBe(devDistParent)
    expect(await fs.stat(config.distTempPath).then((s) => s.isDirectory())).toBe(true)
  })

  test('watch startup sweeps temp dists left behind by previous sessions', async () => {
    const root = await createTempRoot()
    const stale = path.join(root, '.dev-dist', 'clerk-docs-dist-stale')
    await fs.mkdir(stale, { recursive: true })
    await ageDir(stale)

    const config = await createConfig(configOptions(root, { watch: true }))

    await expect(fs.stat(stale)).rejects.toThrow()
    expect(await fs.stat(config.distTempPath).then((s) => s.isDirectory())).toBe(true)
  })

  test('watch startup never sweeps a recently modified temp dist', async () => {
    // A recently modified entry may be another watcher's in-flight build — a second
    // dev session running in the same checkout must not delete it out from under it.
    const root = await createTempRoot()
    const inFlight = path.join(root, '.dev-dist', 'clerk-docs-dist-inflight')
    await fs.mkdir(inFlight, { recursive: true })

    await createConfig(configOptions(root, { watch: true }))

    expect(await fs.stat(inFlight).then((s) => s.isDirectory())).toBe(true)
  })

  test('watch startup never sweeps the temp dist that dist still points to', async () => {
    // The sweep runs before this session's first build has published a replacement,
    // and Next.js dev may be serving docs from the previous session's temp dist
    // through the dist symlink right up until then.
    const root = await createTempRoot()
    const live = path.join(root, '.dev-dist', 'clerk-docs-dist-live')
    const stale = path.join(root, '.dev-dist', 'clerk-docs-dist-stale')
    await fs.mkdir(live, { recursive: true })
    await fs.mkdir(stale, { recursive: true })
    await ageDir(live)
    await ageDir(stale)
    await fs.symlink(path.join('.dev-dist', 'clerk-docs-dist-live'), path.join(root, 'dist'))

    await createConfig(configOptions(root, { watch: true }))

    expect(await fs.stat(live).then((s) => s.isDirectory())).toBe(true)
    await expect(fs.stat(stale)).rejects.toThrow()
  })

  test('rebuilds in the same session do not sweep the live temp dist', async () => {
    const root = await createTempRoot()

    const config = await createConfig(configOptions(root, { watch: true }))
    const firstTempDist = config.distTempPath

    const rebuildConfig = await config.changeTempDist()

    expect(rebuildConfig.distTempPath).not.toBe(firstTempDist)
    expect(await fs.stat(firstTempDist).then((s) => s.isDirectory())).toBe(true)
    expect(await fs.stat(rebuildConfig.distTempPath).then((s) => s.isDirectory())).toBe(true)
  })
})
