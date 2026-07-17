# Upgrade to Clerk Core 3

Guide for upgrading from Clerk Core 2 to Core 3 across all SDKs.

## IMPORTANT: Use the Clerk Upgrade CLI

**The recommended way to upgrade is to run the Clerk upgrade tool.**

Detect the package manager from the lockfile and run the upgrade tool:

```bash
npx @clerk/upgrade       # package-lock.json or no lockfile
pnpm dlx @clerk/upgrade  # pnpm-lock.yaml
yarn dlx @clerk/upgrade  # yarn.lock
bunx @clerk/upgrade      # bun.lockb / bun.lock
```

The CLI performs AST-level transforms and catches re-exports, aliased imports, and monorepo files that manual scanning would miss. **Always run this before making manual changes.**

> **Astro:** The CLI fixes `.ts`/`.tsx` files but cannot transform `.astro` templates — update those manually.

The reference below covers changes the CLI may not fully automate.

---

## Component Replacements

`SignedIn`, `SignedOut`, and `Protect` are replaced by `Show`:

| Before                                      | After                                                |
| ------------------------------------------- | ---------------------------------------------------- |
| `<SignedIn>`                                | `<Show when="signed-in">`                            |
| `<SignedOut>`                               | `<Show when="signed-out">`                           |
| `<Protect role="admin">`                    | `<Show when={{ role: 'admin' }}>`                    |
| `<Protect permission="org:billing:manage">` | `<Show when={{ permission: 'org:billing:manage' }}>` |
| `<Protect condition={(has) => expr}>`       | `<Show when={(has) => expr}>`                        |

`Protect`'s `fallback` prop works the same on `Show`.

Import `Show` from the same package you previously imported `SignedIn`/`Protect` from (e.g. `@clerk/nextjs`, `@clerk/react`, `@clerk/astro/components`).

## Package & Import Renames

| Before                                                   | After                                                         |
| -------------------------------------------------------- | ------------------------------------------------------------- |
| `@clerk/clerk-react`                                     | `@clerk/react`                                                |
| `@clerk/clerk-expo`                                      | `@clerk/expo`                                                 |
| `import type { ... } from '@clerk/types'`                | `import type { ... } from '@clerk/shared/types'`              |
| `import { __experimental_createTheme } from '@clerk/ui'` | `import { createTheme } from '@clerk/ui/themes/experimental'` |

Update both imports and `package.json` dependencies.

## Appearance Prop

- `appearance.layout` → `appearance.options`
- `showOptionalFields` now defaults to `false`
- `colorRing` and `colorModalBackdrop` now render at **full opacity**. If you relied on the old 15% opacity behavior, use an explicit `rgba()` value (e.g. `rgba(99, 102, 241, 0.15)`).
- `experimental_` / `experimental__` prefixes → `__experimental_` (standardized across all experimental APIs)

## Removed Props

| Before                                                         | After                                                    |
| -------------------------------------------------------------- | -------------------------------------------------------- |
| `clerkJSUrl`, `clerkJSVersion`, `clerkUIUrl`, `clerkUIVersion` | prefix with `__internal_` (e.g. `__internal_clerkJSUrl`) |
| `clerkJSVariant`                                               | `prefetchUI={false}`                                     |
| `simple` theme export from `@clerk/ui`                         | `appearance={{ theme: 'simple' }}`                       |

## Removed Redirect Props

| Removed          | Replacement                 |
| ---------------- | --------------------------- |
| `afterSignInUrl` | `fallbackRedirectUrl`       |
| `afterSignUpUrl` | `signUpFallbackRedirectUrl` |
| `redirectUrl`    | `fallbackRedirectUrl`       |

For forced redirects (ignoring `redirect_url` query param), use `forceRedirectUrl` / `signUpForceRedirectUrl`.

## Other Deprecation Removals

| Before                                                                        | After                                                          |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `<OrganizationSwitcher afterSwitchOrganizationUrl="...">`                     | `afterSelectOrganizationUrl`                                   |
| `client.activeSessions`                                                       | `client.sessions`                                              |
| `strategy: 'saml'`                                                            | `strategy: 'enterprise_sso'`                                   |
| `user.samlAccounts`                                                           | `user.enterpriseAccounts`                                      |
| `verification.samlAccount`                                                    | `verification.enterpriseAccount`                               |
| `userSettings.saml`                                                           | `userSettings.enterpriseSSO`                                   |
| `hideSlug` prop                                                               | removed — manage via Dashboard                                 |
| `UserButton` `afterSignOutUrl` / `signOutUrl`                                 | `ClerkProvider afterSignOutUrl` or `SignOutButton redirectUrl` |
| `__unstable_manageBilling*` props                                             | removed                                                        |
| `verifySecret()` / `verifyAccessToken()` / `verifyToken()` (`@clerk/backend`) | `verify()`                                                     |

### setActive Callback

`beforeEmit` is replaced by `navigate`:

```typescript
// Before
await setActive({ session: id, beforeEmit: () => { ... } })

// After
await setActive({
  session: id,
  navigate: ({ session, decorateUrl }) => {
    const url = decorateUrl('/dashboard')
    if (url.startsWith('http')) window.location.href = url
    else router.push(url)
  },
})
```

### useCheckout

Return value restructured — properties are now nested under `checkout`:

```typescript
// Before
const { id, plan, status, start, confirm, paymentSource } = useCheckout({ planId, planPeriod })

// After
const { checkout, errors, fetchStatus } = useCheckout({ planId, planPeriod })
// Access: checkout.plan, checkout.status, checkout.start(), checkout.confirm()
```

## Version Requirements

- Node.js 20.9.0+
- Next.js 15.2.3+ (for `@clerk/nextjs`)
- Expo SDK 53+
- TanStack React Start 1.157.0+ (with matching `@tanstack/react-router` and `@tanstack/react-router-devtools`)

## Behavior Changes

- `ClerkAPIError.kind` changed from `'ClerkApiError'` → `'ClerkAPIError'`. Update any direct string comparisons.
- Satellite apps no longer auto-redirect on first visit. Set `satelliteAutoSync: true` in middleware and `ClerkProvider` to restore Core 2 behavior.

## Token & Auth Changes

- `getToken()` throws `ClerkOfflineError` when offline (previously returned `null`). Use try/catch with `ClerkOfflineError.is(error)`. Import from `@clerk/react/errors` (or SDK-specific `/errors` entry point). Still returns `null` when not signed in.
- `useAuth().getToken` no longer `undefined` during SSR — now a function that throws `clerk_runtime_not_browser`. Use try/catch instead of `if (getToken)`. No change needed if only called in `useEffect` or event handlers.
- `getToken()` uses proactive background refresh (stale-while-revalidate). Returns cached token immediately when within 15s of expiry, refreshes in background. No code changes required.
- New `needs_client_trust` sign-in status — handle in sign-in flow if passwords + Client Trust enabled. Check `signIn.status === 'needs_client_trust'` before `'complete'`.

---

## SDK-Specific Changes

### Next.js

- `ClerkProvider` must be **inside `<body>`**, not wrapping `<html>`. The CLI handles this automatically.

```tsx
// Before               →  After
<ClerkProvider>             <html lang="en">
  <html lang="en">           <body>
    <body>...</body>            <ClerkProvider>...</ClerkProvider>
  </html>                    </body>
</ClerkProvider>            </html>
```

- Passing `secretKey` to `clerkMiddleware()` now also requires a `CLERK_ENCRYPTION_KEY` env var.
- Minimum Next.js version: 15.2.3 (Next.js 13 and 14 are no longer supported)
- `auth.protect()` returns 401 (not 404) for unauthenticated server actions

### Expo

- Package: `@clerk/clerk-expo` → `@clerk/expo`
- `Clerk` export removed — use `useClerk()` hook
- Minimum Expo SDK: 53
- `useSignInWithApple` → `@clerk/expo/apple`, `useSignInWithGoogle` → `@clerk/expo/google`
- `publishableKey` prop now required in `ClerkProvider` (env vars inside `node_modules` not inlined in RN production builds)

### Astro

- `@clerk/astro` v2 → v3
- Components imported from `@clerk/astro/components`
- CLI does **not** auto-fix `.astro` files — apply `Show` replacements manually
- `as` prop removed from button components — use `asChild` with slotted element
- Runtime env vars (`process.env`) now take precedence over build-time (`import.meta.env`)

### Nuxt

- `getAuth()` removed — use `auth()`
- Default routing strategy: `hash` → `path`

### Express

- `enableHandshake` option removed from `clerkMiddleware` (had no effect)
- `req.auth` object-access removed — use `getAuth(req)`

### React Router

- `@clerk/react-router/api.server` → `@clerk/react-router/server`
- `rootAuthLoader` now requires `clerkMiddleware()` with `v8_middleware` future flag

## Internal API Renames

All `__unstable_*` methods are renamed to `__internal_*` (e.g. `__unstable__environment` → `__internal_environment`). This applies to: `environment`, `updateProps`, `setEnvironment`, `onBeforeRequest`, `onAfterResponse`, `onBeforeSetActive`, `onAfterSetActive`, `invokeMiddlewareOnAuthStateChange`.

Chrome Extension: `__unstable__createClerkClient` → `createClerkClient` (from `@clerk/chrome-extension/background`).

---

## AI Model Verification Steps

### Always Run the CLI First

**The CLI's codemods are more thorough than manual file scanning.** The CLI performs AST-level transformations and will catch usages that simple text search may miss (e.g., re-exported components, aliased imports, dynamically constructed props). **Always run `npx @clerk/upgrade` before attempting any manual changes.**

Do NOT try to manually scan and fix files as a substitute for the CLI. Manual grep-based scanning will miss:

- Files that re-export Clerk components through intermediate modules
- Aliased or renamed imports
- Dynamically referenced props or components
- Files in unexpected directories (e.g., shared packages in monorepos)

### Post-CLI Verification

After the CLI has run, verify any remaining issues it could not auto-fix:

1. **Node.js version:** Is Node.js 20.9.0+ being used?
2. **Components:** Are `SignedIn`, `SignedOut`, and `Protect` replaced with `Show`?
3. **Package names:** Are imports using `@clerk/react` and `@clerk/expo` (not `@clerk/clerk-react` or `@clerk/clerk-expo`)?
4. **Appearance prop:** Is `layout` replaced with `options`?
5. **Types:** Are type imports from `@clerk/shared/types` (not `@clerk/types`)?
6. **Redirect props:** Are legacy redirect props (`afterSignInUrl`, `afterSignUpUrl`, `redirectUrl`) replaced with `fallbackRedirectUrl` or `forceRedirectUrl`?
7. **Next.js `ClerkProvider`:** Is `ClerkProvider` positioned inside `<body>` (not wrapping `<html>`)?
8. **Astro files:** `.astro` template files are not handled by the CLI — check these manually.
9. **Removed props:** Are `clerkJSUrl`, `clerkJSVersion`, `clerkUIUrl`, `clerkUIVersion`, `clerkJSVariant` removed or prefixed?
10. **Token handling:** Is `getToken()` wrapped in try/catch for `ClerkOfflineError`? Is `useAuth().getToken` no longer checked for `undefined`?
11. **Version requirements:** Next.js 15.2.3+? Expo SDK 53+? TanStack React Start 1.157.0+?
12. **Express:** Is `req.auth` replaced with `getAuth(req)`?
13. **React Router:** Is `api.server` import path updated to `/server`?

If issues remain after running the CLI, use the reference sections above to manually fix them.
