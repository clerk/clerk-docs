import type { BuildConfig } from '../config'
import type { SDK } from '../schemas'
import { scopeHrefToSDK } from './scopeHrefToSDK'

export const getRoutableDocHref =
  (config: BuildConfig) =>
  (href: string, docSDKs: SDK[], targetSDK: SDK): string => {
    const hrefSegments = href.split('/')
    const hrefAlreadyContainsSdk = docSDKs.some((sdk) => hrefSegments.includes(sdk))
    const isSingleSdkDocument = docSDKs.length === 1

    if (hrefAlreadyContainsSdk || isSingleSdkDocument) {
      return href
    }

    return scopeHrefToSDK(config)(href, targetSDK)
  }
