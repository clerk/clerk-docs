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

    try {
      const now = performance.now()

      // This duplicates the config, re-creating the temp dist folder used so the new run doesn't collide with the old one
      const newConfig = await config.changeTempDist()

      const output = await buildFunc(newConfig, store, abortController.signal)

      await fs.rm(lastTempDistPath, { recursive: true }) // clean up the old temp dist folder

      lastTempDistPath = newConfig.distTempPath
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
