import type { Redirect } from './redirects'

export interface DocsLinkManifest {
  generatedAt: string
  sourceRevision: string
  routes: string[]
  redirects: {
    static: Record<string, string>
    dynamic: Redirect[]
  }
}

const trailingIndexRegex = /\/index$/

export function createDocsLinkManifest({
  routes,
  staticRedirects,
  dynamicRedirects,
  generatedAt,
  sourceRevision,
}: {
  routes: Iterable<string>
  staticRedirects: Record<string, string>
  dynamicRedirects: Redirect[]
  generatedAt: Date
  sourceRevision: string
}): DocsLinkManifest {
  return {
    generatedAt: generatedAt.toISOString(),
    sourceRevision,
    routes: Array.from(new Set(Array.from(routes, (route) => route.replace(trailingIndexRegex, '')))).sort(),
    redirects: {
      static: staticRedirects,
      dynamic: dynamicRedirects,
    },
  }
}
