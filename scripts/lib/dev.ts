// for development mode, this function watches the markdown,
// invalidates the cache and kicks off a rebuild of the docs

import watcher from '@parcel/watcher'
import path from 'path'
import type { build } from '../build-docs'
import type { BuildConfig } from './config'
import { invalidateFile, type Store } from './store'

export const watchAndRebuild = (store: Store, config: BuildConfig, buildFunc: typeof build) => {
  const invalidate = invalidateFile(store, config)

  const handleFileChange: watcher.SubscribeCallback = async (error, events) => {
    if (error !== null) {
      console.error(error)
      return
    }

    events.forEach((event) => {
      invalidate(event.path)
    })

    try {
      const now = performance.now()

      const output = await buildFunc(config, store)

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

  watcher.subscribe(config.dataPath, handleFileChange)

  if (config.redirects) {
    const staticDir = path.dirname(config.redirects.static.inputPath)
    const dynamicDir = path.dirname(config.redirects.dynamic.inputPath)

    if (staticDir === dynamicDir) {
      watcher.subscribe(staticDir, handleFileChange)
    } else {
      watcher.subscribe(staticDir, handleFileChange)
      watcher.subscribe(dynamicDir, handleFileChange)
    }
  }

  watcher.subscribe(config.docsPath, handleFileChange, {
    // Ignore generated files
    ignore: [`${config.docsPath}/errors/backend-api.mdx`, `${config.docsPath}/errors/frontend-api.mdx`],
  })

  watcher.subscribe(config.typedocPath, handleFileChange)

  if (config.publicPath) {
    watcher.subscribe(config.publicPath, handleFileChange)
  }
}
