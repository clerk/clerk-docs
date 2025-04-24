import watcher from '@parcel/watcher'
import type { BuildConfig } from './config'
import { invalidateFile, type Store } from './store'
import type { build } from '../build-docs'

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

      const output = await buildFunc(store, config)

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

  watcher.subscribe(config.docsPath, handleFileChange)
  watcher.subscribe(config.typedocPath, handleFileChange)
}
