// if a link contains the :sdk: token, it will be replaced with the targetSDK

import type { BuildConfig } from '../config'
import type { SDK } from '../schemas'

export const scopeHrefToSDK = (config: BuildConfig) => (href: string, targetSDK: SDK | ':sdk:') => {
  // This is external so can't change it
  if (href.startsWith('/docs') === false) return href

  const hrefSegments = href.split('/')

  // This is a little hacky so we might change it
  // if the url already contains the sdk, we don't need to change it
  if (hrefSegments.includes(targetSDK)) {
    return href
  }

  // Add the sdk to the url
  return `${config.baseDocsLink}${targetSDK}/${hrefSegments.slice(2).join('/')}`
}
