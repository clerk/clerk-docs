// The ledger of search-ranking promises. Every entry is a ranking a shipped PR advertised (see
// `source`); the regression suite (search-regression.ts) replays them against a live index.
//
// Add an entry whenever a PR advertises a ranking outcome. Keep assertions LOOSE on purpose:
// assert "one of these URLs appears in the top N", never an exact ordering or a section anchor —
// ordinary content changes reshuffle sections, and a suite that cries wolf gets deleted.

export type RegressionCase = {
  // What the user types. `()<>` are escaped the same way Search.tsx escapes them.
  query: string
  // The active SDK to boost (`optionalFilters: [sdk:<boost>]`), mirroring the client for a user
  // whose SDK has no rename aliases.
  boost: string
  // PASS when at least one of these URL paths is among the top `topN` distinct results.
  urls: string[]
  topN: 1 | 3 | 5
  // Where this promise was made — a PR, ticket, or thread.
  source: string
}

export const REGRESSION_CASES: RegressionCase[] = [
  // --- Reference-name queries: the namesake reference page must be #1 (clerk/clerk#2661) ---
  {
    query: 'auth()',
    boost: 'nextjs',
    urls: ['/docs/reference/nextjs/app-router/auth'],
    topN: 1,
    source: 'clerk/clerk#2661',
  },
  {
    query: 'clerkMiddleware',
    boost: 'nextjs',
    urls: ['/docs/reference/nextjs/clerk-middleware'],
    topN: 1,
    source: 'clerk/clerk#2661',
  },
  {
    query: 'useUser',
    boost: 'react',
    urls: ['/docs/react/reference/hooks/use-user'],
    topN: 1,
    source: 'clerk/clerk#2661',
  },
  {
    query: 'currentUser',
    boost: 'nextjs',
    urls: ['/docs/reference/nextjs/app-router/current-user'],
    topN: 1,
    source: 'clerk/clerk#2661',
  },
  {
    query: 'UserButton',
    boost: 'nextjs',
    urls: ['/docs/nextjs/reference/components/user/user-button'],
    topN: 1,
    source: 'clerk/clerk#2661',
  },
  {
    query: 'OrganizationSwitcher',
    boost: 'nextjs',
    urls: ['/docs/nextjs/reference/components/organization/organization-switcher'],
    topN: 1,
    source: 'clerk/clerk#2661',
  },

  // --- Active-SDK boost: the reader's SDK wins, other SDKs demoted (clerk/clerk#2661) ---
  {
    query: 'sign in page',
    boost: 'nextjs',
    urls: [
      '/docs/nextjs/reference/components/authentication/sign-in',
      '/docs/nextjs/guides/development/custom-sign-in-or-up-page',
      '/docs/nextjs/getting-started/quickstart',
    ],
    topN: 3,
    source: 'clerk/clerk#2661',
  },
  {
    query: 'vue',
    boost: 'vue',
    urls: [
      '/docs/vue/reference/composables/use-user',
      '/docs/vue/getting-started/quickstart',
      '/docs/reference/vue/overview',
    ],
    topN: 3,
    source: 'clerk/clerk#2661 + clerk/clerk#2979 (no-regression guard)',
  },
  {
    query: 'quickstart',
    boost: 'expo',
    urls: ['/docs/expo/getting-started/quickstart'],
    topN: 3,
    source: 'clerk/clerk#2979 verification',
  },

  // --- Ranking reorder: title/heading matches beat body-content matches (clerk/clerk#2661) ---
  {
    query: 'protect a route',
    boost: 'nextjs',
    urls: ['/docs/nextjs/guides/secure/protect-content'],
    topN: 3,
    source: 'clerk/clerk#2661',
  },
  {
    query: 'webhooks',
    boost: 'nextjs',
    urls: [
      '/docs/guides/development/webhooks/overview',
      '/docs/guides/development/webhooks/syncing',
      '/docs/nextjs/guides/development/webhooks/billing',
    ],
    topN: 3,
    source: 'clerk/clerk#2661',
  },

  // --- Synonyms (clerk/clerk#2661) ---
  {
    query: 'magic link',
    boost: 'nextjs',
    urls: [
      '/docs/nextjs/guides/development/custom-flows/authentication/email-links',
      '/docs/guides/secure/best-practices/protect-email-links',
    ],
    topN: 3,
    source: 'clerk/clerk#2661',
  },
  {
    query: 'i18n',
    boost: 'nextjs',
    urls: ['/docs/guides/customizing-clerk/localization'],
    topN: 1,
    source: 'clerk/clerk#2661',
  },
  {
    query: 'login',
    boost: 'nextjs',
    urls: [
      '/docs/nextjs/reference/components/authentication/sign-in',
      '/docs/nextjs/guides/development/custom-sign-in-or-up-page',
      '/docs/nextjs/reference/objects/sign-in',
    ],
    topN: 3,
    source: 'clerk/clerk#2661',
  },
  {
    query: 'DKIM',
    boost: 'nextjs',
    urls: ['/docs/guides/development/troubleshooting/email-deliverability'],
    topN: 3,
    source: 'clerk/clerk#2661',
  },

  // --- Universal-page parity: exact-title universal pages beat body-content matches (clerk/clerk#2979) ---
  {
    query: 'how clerk works',
    boost: 'nextjs',
    urls: ['/docs/guides/how-clerk-works/overview'],
    topN: 1,
    source: 'clerk/clerk#2979',
  },
  { query: 'cli', boost: 'nextjs', urls: ['/docs/cli'], topN: 1, source: 'clerk/clerk#2979' },
  {
    query: 'clerk billing',
    boost: 'nextjs',
    urls: ['/docs/guides/billing/overview'],
    topN: 1,
    source: 'clerk/clerk#2979',
  },

  // --- Flagship synonyms: orgs and multi-tenancy vocabulary (clerk/clerk#2979) ---
  { query: 'org', boost: 'nextjs', urls: ['/docs/guides/organizations/overview'], topN: 1, source: 'clerk/clerk#2979' },
  {
    query: 'orgs',
    boost: 'nextjs',
    urls: ['/docs/guides/organizations/overview'],
    topN: 1,
    source: 'clerk/clerk#2979',
  },
  {
    query: 'organizations',
    boost: 'nextjs',
    urls: ['/docs/guides/organizations/overview'],
    topN: 1,
    source: 'clerk/clerk#2979',
  },
  {
    query: 'multi-tenant',
    boost: 'nextjs',
    urls: ['/docs/guides/how-clerk-works/multi-tenant-architecture'],
    topN: 1,
    source: 'clerk/clerk#2979',
  },
  {
    query: 'multi-tenancy',
    boost: 'nextjs',
    urls: ['/docs/guides/how-clerk-works/multi-tenant-architecture'],
    topN: 1,
    source: 'clerk/clerk#2979',
  },
  { query: 'b2b', boost: 'nextjs', urls: ['/docs/guides/organizations/overview'], topN: 1, source: 'clerk/clerk#2979' },
  {
    query: 'b2b saas',
    boost: 'nextjs',
    urls: ['/docs/nextjs/guides/billing/for-b2b'],
    topN: 1,
    source: 'clerk/clerk#2979',
  },

  // --- Mobile "native" vocabulary (DOCS-11910 follow-up thread) ---
  {
    query: 'native',
    boost: 'ios',
    urls: ['/docs/ios/getting-started/quickstart'],
    topN: 3,
    source: 'DOCS-11910 follow-up (Jeff, 2026-07-20)',
  },
]
