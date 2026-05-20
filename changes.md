# Auth nav restructure — changes log

## Summary

Restructured the "Authentication flows" section of the main docs nav into a flatter, goal-oriented "Authentication" section. The core problem was that enterprise auth (and other methods) were buried 4 levels deep under "Authentication flows → Authentication strategies → Enterprise connections", and the section names were too abstract to give developers confidence they were in the right place.

---

## manifest.json

**What changed:** Replaced the "Authentication flows" top-level section (which contained a nested "Authentication strategies" sub-section) with a flat "Authentication" section.

**Before:**

```
Authentication flows
└── Authentication strategies
    ├── Sign-up and sign-in options
    ├── Sign in with Apple          ← standalone, now under Social login
    ├── Sign in with Google         ← standalone, now under Social login
    ├── Social connections
    ├── Enterprise connections
    ├── Web3
    └── OAuth                       ← see note below
├── Add custom sign-in-or-up page   ← now in Customize sub-section
├── Add custom sign-up page         ← now in Customize sub-section
├── Add custom onboarding           ← now in Customize sub-section
├── Enable biometric sign-in        ← removed (Expo-only page, belongs in SDK section)
├── Customizing redirect URLs       ← now in Customize sub-section
└── Tasks after sign-up/sign-in     ← now in Customize sub-section
```

**After:**

```
Authentication
├── Overview                        ← new page
├── Sign-in options                 ← was "Sign-up and sign-in options" (slimmed down)
├── Multi-factor authentication     ← new page (content moved from sign-in options)
├── Social login                    ← was "Social connections"
│   ├── Overview
│   ├── Account linking
│   ├── Custom provider
│   ├── Sign in with Apple (iOS)    ← moved from top-level standalone
│   ├── Sign in with Google (Android) ← moved from top-level standalone
│   └── All providers (26 providers, unchanged)
├── Enterprise connections          ← same content, now 2 levels deep instead of 4
│   ├── Overview
│   ├── Authentication flows
│   ├── Account linking
│   ├── Just-in-Time account provisioning
│   ├── Directory Sync (SCIM)
│   ├── Custom attribute mapping (Beta)
│   ├── SAML providers (Azure, Google, Okta, Custom)
│   ├── OIDC providers (Custom)
│   └── EASIE providers (Microsoft, Google)
├── Web3 wallets                    ← was "Web3"
│   └── Base, Coinbase Wallet, Metamask, OKX Wallet, Solana
└── Customize
    ├── Custom sign-in-or-up page
    ├── Custom sign-up page
    ├── Custom onboarding
    ├── Redirect URLs
    └── Tasks after sign-up/sign-in
```

**Note — OAuth section:** The "OAuth" section has been removed from the Authentication nav and moved to "Securing your app". See below for details.

**Note — "Enable biometric sign-in for returning users":** Removed from this section. The page (`/docs/guides/development/local-credentials`) is an Expo-specific guide for the `useLocalCredentials()` hook — it is not a general authentication method. It remains accessible at its URL and appears in the Mobile Navigation (navigation[2]).

---

## NEW: docs/guides/configure/auth-strategies/overview.mdx

**What it is:** New page serving as the entry point for the Authentication section.

**Content:**

- Brief intro to Clerk's authentication options
- Links to all sub-sections (sign-in options, MFA, social login, enterprise connections, web3 wallets)
- SSO connections explainer (moved from sign-up-sign-in-options.mdx)
- Web3 authentication overview (moved from sign-up-sign-in-options.mdx)
- Restrict changes section (moved from sign-up-sign-in-options.mdx — kept here per product decision)
- Restrictions section (moved from sign-up-sign-in-options.mdx — kept here per product decision)

---

## NEW: docs/guides/configure/auth-strategies/multi-factor-authentication.mdx

**What it is:** New standalone page for MFA configuration.

**Content:** Extracted verbatim from the "Multi-factor authentication" section of `sign-up-sign-in-options.mdx`. No content removed — includes MFA strategies, configuration steps, the Duo authenticator callout, the custom flow link, and the "Reset a user's MFA" sub-section.

---

## MODIFIED: docs/guides/configure/auth-strategies/sign-up-sign-in-options.mdx

**What changed:** Slimmed down significantly. Now covers only the standard sign-in options.

**Content kept (unchanged):**

- Email (OTP, magic link, same-device requirement)
- Phone + SMS allowlist
- Username
- Password
- Passkeys (including limitations and domain restrictions)
- User model

**Content moved out:**

- Intro paragraph → overview.mdx
- "User & authentication" section header → replaced with a shorter intro sentence
- SSO connections section → overview.mdx
- Web3 authentication section → overview.mdx
- Multi-factor authentication section → multi-factor-authentication.mdx
- Restrict changes section → overview.mdx
- Restrictions section → overview.mdx

**Title/description:** Updated frontmatter from "Sign-up and sign-in options" to "Sign-in options" to match the new nav label and narrower scope.

**Nav href:** Unchanged — still points to `/docs/guides/configure/auth-strategies/sign-up-sign-in-options`. The file has not been renamed to avoid breaking existing links. Can be renamed in a future cleanup pass.

---

## Things not changed (round 1)

- All enterprise connections pages — content and file paths unchanged
- All social connections pages — content and file paths unchanged (except overview.mdx, see round 2)
- All web3 pages — content and file paths unchanged
- All customize/custom-flow pages — content and file paths unchanged
- sign-in-with-apple.mdx and sign-in-with-google.mdx — unchanged, just moved in the nav to sit under Social login
- Mobile Navigation (navigation[2]) — untouched
- API reference navigation (navigation[1]) — untouched

---

## Round 2: Split "Use OAuth for SSO" and move OAuth section

### Problem

The original "OAuth" section in Authentication contained a page called "Use OAuth for Single Sign-On (SSO)" that covered two unrelated things:

1. Letting users sign in to your Clerk app via social providers (already covered by Social login)
2. Configuring Clerk as an OAuth IdP so users can sign in to third-party apps with their Clerk credentials

The whole OAuth section also didn't belong in Authentication — these pages are about Clerk acting as an OAuth authorization server, not about user sign-in methods.

---

### MODIFIED: docs/guides/configure/auth-strategies/oauth/single-sign-on.mdx

**What changed:** Stripped Option 1 ("Sign in with [Other App]") from the page — that content is already fully covered by the Social login section. The page is now focused entirely on Clerk as an OAuth IdP.

**Title changed:** "Use OAuth for Single Sign-On (SSO)" → "Use Clerk as an OAuth provider"

**Description changed:** Updated to reflect the narrower, Clerk-as-IdP scope.

**Content removed:** The "Option 1: Sign in with [Other App]" section (one paragraph + a link to social connections). No substantive content lost — it was a pointer, not a guide.

**Content kept (unchanged):** Everything about configuring Clerk as an OAuth IdP — "What you can build", "How it works", "Configure Clerk as an IdP", the full setup steps, user info endpoint, OIDC flow, ID token claims, token introspection.

**Cross-reference added in:** `social-connections/overview.mdx` — a TIP callout pointing developers to this page if they want the reverse direction.

---

### MODIFIED: docs/guides/configure/auth-strategies/social-connections/overview.mdx

**What changed:** Added a TIP callout after the opening NOTE, pointing developers to "Use Clerk as an OAuth provider" if they're looking for the reverse direction (Clerk as IdP, not as OAuth client).

---

### manifest.json — OAuth section moved to Securing your app

**Removed from:** Authentication section (was listed as "OAuth" under Authentication strategies)

**Added to:** Securing your app, as a new "OAuth provider" sub-section inserted after "Machine authentication"

```
Securing your app
├── ...
├── Machine authentication
│   └── Overview, M2M tokens, API keys, Token formats
├── OAuth provider                          ← NEW
│   ├── What are OAuth & OIDC
│   ├── How Clerk implements OAuth
│   ├── Use Clerk as an OAuth provider      ← was "Use OAuth for SSO"
│   ├── Use OAuth for scoped access
│   └── Verify OAuth tokens
├── Web security
└── ...
```

The file paths for all OAuth pages are unchanged — only the nav location changed.

---

## Round 3: Enterprise connections refinement + nav label renames

### MODIFIED: docs/guides/configure/auth-strategies/enterprise-connections/overview.mdx

**What changed:** Merged the full content of `authentication-flows.mdx` into this page. The separate "Authentication flows" nav item has been removed.

**Content added:**

- New "### Authentication flows" sub-section under SAML, covering SP-initiated flow, IdP-initiated flow, risks, and Clerk's security measures (verbatim from authentication-flows.mdx)
- One-line note under OIDC about OIDC authentication flows pointing to easie.dev (was in authentication-flows.mdx)

**Content updated:**

- Intro sentence: removed the link to the now-removed authentication-flows page
- FAQ "Does Clerk support IdP-initiated SSO?" answer: updated to link to the new in-page section anchor instead of the separate page
- Fixed a minor typo in the description frontmatter ("such such as" → "such as")
- MFA link updated to point to the new standalone MFA page (`/docs/guides/configure/auth-strategies/multi-factor-authentication`)

**File kept on disk:** `authentication-flows.mdx` is still present at its original path. It is no longer linked from the nav or the overview. Can be deleted in a future cleanup pass once redirects are confirmed.

---

### manifest.json — Enterprise connections restructured

**Before:**

```
Enterprise connections
├── Overview
├── Authentication flows          ← removed (merged into Overview)
├── Account linking
├── Just-in-Time account provisioning  ← was top-level
├── Directory Sync (SCIM)
├── Custom attribute mapping (Beta)
├── SAML providers
│   ├── Azure
│   ├── Google
│   ├── Okta
│   └── Custom provider
├── OIDC providers                ← was a sub-section with one item
│   └── Custom provider
└── EASIE providers
    ├── Microsoft
    └── Google
```

**After:**

```
Enterprise connections
├── Overview                      ← now includes authentication flows content
├── Account linking
├── Directory Sync (SCIM)
├── Custom attribute mapping (Beta)
├── SAML providers
│   ├── Azure
│   ├── Google
│   ├── Okta
│   ├── Custom provider
│   └── Just-in-Time provisioning ← moved here (SAML-only feature)
├── OIDC: Custom provider         ← collapsed to direct link
└── EASIE providers
    ├── Microsoft
    └── Google
```

---

### manifest.json — Top-level nav label renames

- `Authentication` → `Authenticate users`
- `Customize` (sub-section within Authenticate users) → `Customize flows`
- `Web3 wallets` → `Web3`
- `SAML providers` → `SAML`
- `OIDC: Custom provider` → `OIDC`
- `EASIE providers` → `EASIE`

No file paths or page content changed — nav labels only.
