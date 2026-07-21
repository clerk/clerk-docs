// for development mode, this function watches the markdown,
// invalidates the cache and kicks off a rebuild of the docs

import watcher from '@parcel/watcher'
import path from 'path'
import type { build } from '../build-docs'
import type { BuildConfig } from './config'
import { invalidateFile, type Store } from './store'
import chokidar from 'chokidar'
import fs from 'node:fs/promises'

export const watchAndRebuild = (store: Store, config: BuildConfig, buildFunc: typeof build) => {
  const invalidate = invalidateFile(store, config)

  let abortController: AbortController | null = null

  const handleParcelWatcherChange: watcher.SubscribeCallback = async (error, events) => {
    if (error !== null) {
      console.error(error)
      return
    }

    handleFilesChanged(events.map((event) => event.path))
  }

  const pendingFileChanges = new Set<string>()
  let timeout: NodeJS.Timeout | null = null

  const handleChokidarWatcherChange = (_event: string, path: string) => {
    pendingFileChanges.add(path)

    if (timeout === null) {
      timeout = setTimeout(() => {
        timeout = null

        const paths = Array.from(pendingFileChanges)
        pendingFileChanges.clear()

        handleFilesChanged(paths)
      }, 250)
    }
  }

  let lastTempDistPath: string = config.distTempPath

  const handleFilesChanged = async (paths: string[]) => {
    if (abortController !== null) {
      console.log('aborting current build')
      abortController.abort()
    }

    abortController = new AbortController()

    paths.forEach((path) => {
      invalidate(path)
    })

    let newConfig: BuildConfig | undefined
    let isLive = false

    try {
      const now = performance.now()

      // This duplicates the config, re-creating the temp dist folder used so the new run doesn't collide with the old one
      newConfig = await config.changeTempDist()

      const output = await buildFunc(newConfig, store, abortController.signal)

      // The build has symlinked dist at this folder, so it is live from here on and must not be
      // cleaned up by the catch below, whatever else fails.
      const previousTempDistPath = lastTempDistPath
      lastTempDistPath = newConfig.distTempPath
      isLive = true

      // `force` because this folder may already be gone — the OS clears /var/folders out from
      // under long-running dev sessions. Without it a successful rebuild reports as a failure
      // and skips the completion signal below.
      await fs.rm(previousTempDistPath, { recursive: true, force: true }) // clean up the old temp dist folder

      abortController = null

      if (config.flags.controlled) {
        console.info('---rebuild-complete---')
      }

      const after = performance.now()

      console.info(`Rebuilt docs in ${after - now} milliseconds`)

      if (output !== '') {
        console.info(output)
      }
    } catch (error) {
      console.error(error)

      // A rebuild that never went live still owns the temp folder it created. Aborts are routine
      // here — every save that lands while a build is in flight cancels it — so without this each
      // one leaks a folder under /var/folders for the life of the session.
      if (newConfig !== undefined && !isLive) {
        const abandonedPath = newConfig.distTempPath

        // Unless the build got far enough to point dist at it, in which case deleting it would
        // leave dist dangling.
        const distTarget = await fs.readlink(config.distFinalPath).catch(() => null)

        if (distTarget === null || path.resolve(path.dirname(config.distFinalPath), distTarget) !== abandonedPath) {
          await fs.rm(abandonedPath, { recursive: true, force: true }).catch(() => {})
        }
      }

      return
    }
  }

  watcher.subscribe(config.dataPath, (err, events) => {
    handleFilesChanged(['/docs/errors/backend-api.mdx', '/docs/errors/frontend-api.mdx'])
  })

  if (config.redirects) {
    const staticDir = path.dirname(config.redirects.static.inputPath)
    const dynamicDir = path.dirname(config.redirects.dynamic.inputPath)

    if (staticDir === dynamicDir) {
      watcher.subscribe(staticDir, handleParcelWatcherChange)
    } else {
      watcher.subscribe(staticDir, handleParcelWatcherChange)
      watcher.subscribe(dynamicDir, handleParcelWatcherChange)
    }
  }

  watcher.subscribe(config.docsPath, handleParcelWatcherChange)

  chokidar
    .watch(config.typedocPath, {
      followSymlinks: true, // This here is the whole reason for bringing in chokidar, parcel gives us the original file location but we want the symlink location. So we don't need to handle differences between linking to the generated docs and downloading them from github.
      ignoreInitial: true,
      awaitWriteFinish: true,
    })
    .on('all', handleChokidarWatcherChange)

  if (config.publicPath) {
    watcher.subscribe(config.publicPath, handleParcelWatcherChange)
  }

  if (config.siteFlags?.inputPath) {
    chokidar
      .watch(config.siteFlags.inputPath, {
        ignoreInitial: true,
        awaitWriteFinish: true,
      })
      .on('all', handleChokidarWatcherChange)
  }
}
