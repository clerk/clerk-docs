import type { BuildConfig } from '../config'
import type { SDK } from '../schemas'
import { scopeHrefToSDK } from './scopeHrefToSDK'

/**
 * Returns the routable href for a document, accounting for SDK scoping.
 *
 * Single-SDK documents and documents whose href already contains an SDK segment
 * are returned as-is (their base href is the only routable path). Multi-SDK
 * documents get an SDK-scoped prefix (e.g. `/docs/react/getting-started`).
 */
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
