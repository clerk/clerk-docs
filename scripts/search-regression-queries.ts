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

  // --- Title-tier keywords: curated `search.keywords` rank with page titles (DOCS-11955) ---
  // "native api" must not lose to the "Frontend API errors" page's lvl1 "api" hijack. topN 1 on
  // all four: the keyword + SDK boost makes first place the advertised contract.
  {
    query: 'native api',
    boost: 'ios',
    urls: ['/docs/ios/getting-started/quickstart'],
    topN: 1,
    source: 'DOCS-11955',
  },
  {
    query: 'native api',
    boost: 'expo',
    urls: ['/docs/expo/getting-started/quickstart'],
    topN: 1,
    source: 'DOCS-11955',
  },
  {
    query: 'native api',
    boost: 'android',
    urls: ['/docs/android/getting-started/quickstart'],
    topN: 1,
    source: 'DOCS-11955',
  },
  {
    query: 'native api',
    boost: 'chrome-extension',
    urls: ['/docs/chrome-extension/getting-started/quickstart'],
    topN: 1,
    source: 'DOCS-11955',
  },
  // Flip-side guard: the multi-word keyword's lone "api" word must not hijack plain "api" —
  // the reference pages stay on top (the quickstart may appear below them; that boost is fine).
  {
    query: 'api',
    boost: 'ios',
    urls: ['/docs/reference/api/overview', '/docs/reference/backend/types/backend-api-key'],
    topN: 3,
    source: 'DOCS-11955 (keyword individual-word guard)',
  },
  // Guard against title-tier keyword hijacks: broad keywords removed in DOCS-11955 must not
  // resurface and steal these queries from the pages readers actually want. Any password-reset
  // doc counts (legacy variants included) — the promise is that the session-tasks page's old
  // `reset-password` task-ID keyword stays gone, not which reset doc wins.
  {
    query: 'reset password',
    boost: 'nextjs',
    urls: [
      '/docs/nextjs/guides/development/custom-flows/authentication/forgot-password',
      '/docs/guides/development/custom-flows/authentication/forgot-password',
      '/docs/guides/development/custom-flows/authentication/legacy/forgot-password',
      '/docs/nextjs/guides/development/custom-flows/account-updates/update-password',
      '/docs/guides/development/custom-flows/account-updates/update-password',
      '/docs/guides/secure/password-protection-and-rules',
    ],
    topN: 3,
    source: 'DOCS-11955 (Sarah, keyword sweep)',
  },
  // The curated `waitlist` keyword + `search.rank: 1` finally beat the `Waitlist` type reference.
  // topN 1 on purpose: outranking the type reference is the promise, and top-3 could pass with
  // the reference still above the guide.
  {
    query: 'waitlist',
    boost: 'nextjs',
    urls: ['/docs/guides/secure/restricting-access'],
    topN: 1,
    source: 'DOCS-11955',
  },

  // --- Error pages stay out of the index (DOCS-12093) ---
  // Before the exclusion, "signedin" put the error page for the *removed* `<SignedIn>` component
  // at #1, above the docs readers actually want. topN 1 on purpose: the promise is that the
  // error page no longer holds first place, and top-3 could pass with it back on top. Loose only
  // across which real page wins — any of these is a correct #1.
  {
    query: 'signedin',
    boost: 'nextjs',
    urls: [
      '/docs/nextjs/reference/types/signed-in-session-resource',
      '/docs/reference/types/signed-in-session-resource',
      '/docs/nextjs/reference/components/control/show',
    ],
    topN: 1,
    source: 'DOCS-12093',
  },

  // --- CIMD acronym, synonym derived from the client-id-metadata-document tooltip ---
  {
    query: 'cimd',
    boost: 'nextjs',
    urls: ['/docs/guides/configure/auth-strategies/oauth/client-id-metadata-documents'],
    topN: 3,
    source: 'clerk/clerk#2935',
  },
]
