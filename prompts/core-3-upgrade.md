# Upgrade to Clerk Core 3

**Purpose:** Guide upgrading a project from Clerk Core 2 to Core 3 across all SDKs.

---

## IMPORTANT: Use the Clerk Upgrade CLI

**The recommended way to upgrade is to run the Clerk upgrade tool.**

First, detect the user's package manager by checking for lock files in the project root:

- `pnpm-lock.yaml` → use `pnpm dlx @clerk/upgrade`
- `yarn.lock` → use `yarn dlx @clerk/upgrade`
- `bun.lockb` or `bun.lock` → use `bunx @clerk/upgrade`
- `package-lock.json` or no lock file → use `npx @clerk/upgrade`

Then run the appropriate command:

```bash
# Use the command matching the project's package manager
npx @clerk/upgrade      # npm
pnpm dlx @clerk/upgrade # pnpm
yarn dlx @clerk/upgrade # yarn
bunx @clerk/upgrade     # bun
```

This CLI will automatically scan the project, detect breaking changes, and apply fixes where possible. **Run this first before making any manual changes.**

**Astro users:** The CLI will fix `.ts`/`.tsx` files (React islands) but cannot transform `.astro` template files. You'll need to manually update those using the reference below.

The information below is provided as a reference for changes the CLI may not fully automate or for understanding what changed.

---

## 1. Upgrade Overview

Core 3 focuses on consistency and cleanup across Clerk's SDKs.

### Key Changes

- **Component consolidation:** `Protect`, `SignedIn`, and `SignedOut` are replaced by a single `Show` component
- **Package renaming:** `@clerk/clerk-react` → `@clerk/react`, `@clerk/clerk-expo` → `@clerk/expo`
- **Appearance updates:** `appearance.layout` → `appearance.options`, `showOptionalFields` defaults to `false`
- **Color variables:** `colorRing` and `colorModalBackdrop` now render at full opacity
- **Node.js requirement:** Node.js 20.9.0+ is required

---

## 2. Critical Migration Steps

### 2.1 – Component Replacements

Replace `SignedIn`, `SignedOut`, and `Protect` with `Show`:

```typescript
// ❌ OLD - Core 2
import { SignedIn, SignedOut, Protect } from '@clerk/nextjs';

<SignedIn>
  <Dashboard />
</SignedIn>

<SignedOut>
  <SignInPage />
</SignedOut>

<Protect role="admin" fallback={<p>Unauthorized</p>}>
  <AdminPanel />
</Protect>

<Protect permission="org:billing:manage">
  <BillingSettings />
</Protect>

<Protect condition={(has) => has({ role: 'admin' }) && isAllowed}>
  <AdminPanel />
</Protect>

// ✅ NEW - Core 3
import { Show } from '@clerk/nextjs';

<Show when="signed-in">
  <Dashboard />
</Show>

<Show when="signed-out">
  <SignInPage />
</Show>

<Show when={{ role: 'admin' }} fallback={<p>Unauthorized</p>}>
  <AdminPanel />
</Show>

<Show when={{ permission: 'org:billing:manage' }}>
  <BillingSettings />
</Show>

<Show when={(has) => has({ role: 'admin' }) && isAllowed}>
  <AdminPanel />
</Show>
```

### 2.2 – Package Renames

Update package names in imports and `package.json`:

```typescript
// ❌ OLD
import { ClerkProvider, useUser } from '@clerk/clerk-react'
import { ClerkProvider, useUser } from '@clerk/clerk-expo'

// ✅ NEW
import { ClerkProvider, useUser } from '@clerk/react'
import { ClerkProvider, useUser } from '@clerk/expo'
```

### 2.3 – Appearance Prop Changes

```typescript
// ❌ OLD
<ClerkProvider
  appearance={{
    layout: {
      socialButtonsPlacement: 'bottom',
    }
  }}
/>

// ✅ NEW
<ClerkProvider
  appearance={{
    options: {
      socialButtonsPlacement: 'bottom',
    }
  }}
/>
```

### 2.4 – Color Variable Opacity

If using `colorRing` or `colorModalBackdrop`, add explicit opacity:

```typescript
// ❌ OLD (rendered at 15% opacity automatically)
appearance={{
  variables: {
    colorRing: '#6366f1',
  }
}}

// ✅ NEW (now renders at full opacity, so add explicit opacity if needed)
appearance={{
  variables: {
    colorRing: 'rgba(99, 102, 241, 0.15)',
  }
}}
```

### 2.5 – Types Import Path

```typescript
// ❌ OLD (deprecated)
import type { ClerkResource, UserResource } from '@clerk/types'

// ✅ NEW
import type { ClerkResource, UserResource } from '@clerk/shared/types'
```

### 2.6 – createTheme Import Path

```typescript
// ❌ OLD
import { __experimental_createTheme } from '@clerk/ui'

// ✅ NEW
import { createTheme } from '@clerk/ui/themes/experimental'
```

---

## 3. Deprecation Removals

These deprecated APIs have been removed and must be updated:

### 3.1 – Redirect Props

```typescript
// ❌ OLD (removed)
<SignIn
  afterSignInUrl="/dashboard"
  afterSignUpUrl="/onboarding"
  redirectUrl="/home"
/>

// ✅ NEW
<SignIn
  fallbackRedirectUrl="/dashboard"
  signUpFallbackRedirectUrl="/onboarding"
/>

// For forced redirects (ignores redirect_url query param):
<SignIn
  forceRedirectUrl="/dashboard"
  signUpForceRedirectUrl="/onboarding"
/>
```

### 3.2 – OrganizationSwitcher Props

```typescript
// ❌ OLD
<OrganizationSwitcher afterSwitchOrganizationUrl="/org-dashboard" />

// ✅ NEW
<OrganizationSwitcher afterSelectOrganizationUrl="/org-dashboard" />
```

### 3.3 – Client.activeSessions

```typescript
// ❌ OLD
const sessions = client.activeSessions

// ✅ NEW
const sessions = client.sessions
```

### 3.4 – SAML to Enterprise SSO

```typescript
// ❌ OLD
strategy: 'saml'
user.samlAccounts
verification.samlAccount
userSettings.saml

// ✅ NEW
strategy: 'enterprise_sso'
user.enterpriseAccounts
verification.enterpriseAccount
userSettings.enterpriseSSO
```

### 3.5 – setActive Callback

```typescript
// ❌ OLD
await setActive({
  session: sessionId,
  beforeEmit: () => {
    // Called before session is set
  },
})

// ✅ NEW
await setActive({
  session: sessionId,
  navigate: ({ session, decorateUrl }) => {
    // Called with the session object
    // and the decorateUrl function must wrap
    // all destination url's
    const url = decorateUrl('/dashboard')
    if (url.startsWith('http')) {
      window.location.href = url
    } else {
      router.push(url)
    }
  },
})
```

### 3.6 – useCheckout Return Values

```typescript
// ❌ OLD
const { id, plan, status, start, confirm, paymentSource } = useCheckout({ planId: 'xxx', planPeriod: 'annual' })

// ✅ NEW
const { checkout, errors, fetchStatus } = useCheckout({ planId: 'xxx', planPeriod: 'annual' })
checkout.plan
checkout.status
checkout.start()
checkout.confirm()
```

---

## 4. SDK-Specific Changes

### 4.1 – Next.js

When passing `secretKey` as a runtime option to `clerkMiddleware()`, you must now also provide a `CLERK_ENCRYPTION_KEY` environment variable.

**`ClerkProvider` must be inside `<body>`:** In Core 3, `ClerkProvider` must be positioned inside `<body>` rather than wrapping `<html>`. The CLI codemod handles this automatically. This is required for Next.js 16 cache components support, but is recommended for all Next.js versions:

```typescript
// ❌ OLD
<ClerkProvider>
  <html lang="en">
    <body>{children}</body>
  </html>
</ClerkProvider>

// ✅ NEW
<html lang="en">
  <body>
    <ClerkProvider>
      {children}
    </ClerkProvider>
  </body>
</html>
```

### 4.2 – Expo

- Package renamed: `@clerk/clerk-expo` → `@clerk/expo`
- `Clerk` export removed, use `useClerk()` hook instead
- Minimum Expo SDK version: 53

### 4.3 – Astro

- Version: `@clerk/astro` v2 → v3
- Components are imported from `@clerk/astro/components`
- **The upgrade CLI does not auto-fix `.astro` template files.** It will fix `.ts`/`.tsx` files (React islands), but `.astro` files must be updated manually:

```astro
---
// ❌ OLD
import { SignedIn, SignedOut, Protect } from '@clerk/astro/components'
// ✅ NEW
import { Show } from '@clerk/astro/components'
---

<!-- ❌ OLD -->
<SignedIn><Dashboard /></SignedIn>
<SignedOut><SignInPage /></SignedOut>
<Protect role="admin"><AdminPanel /></Protect>

<!-- ✅ NEW -->
<Show when="signed-in"><Dashboard /></Show>
<Show when="signed-out"><SignInPage /></Show>
<Show when={{ role: 'admin' }}><AdminPanel /></Show>
```

### 4.4 – Nuxt

- `getAuth()` removed, use `auth()` instead
- Default routing strategy changed from `hash` to `path`

---

## 5. Internal API Renames

All `__unstable_*` methods renamed to `__internal_*`:

- `__unstable__environment` → `__internal_environment`
- `__unstable__updateProps` → `__internal_updateProps`
- `__unstable__setEnvironment` → `__internal_setEnvironment`
- `__unstable__onBeforeRequest` → `__internal_onBeforeRequest`
- `__unstable__onAfterResponse` → `__internal_onAfterResponse`
- `__unstable__onBeforeSetActive` → `__internal_onBeforeSetActive`
- `__unstable__onAfterSetActive` → `__internal_onAfterSetActive`
- `__unstable_invokeMiddlewareOnAuthStateChange` → `__internal_invokeMiddlewareOnAuthStateChange`

For Chrome Extension: `__unstable__createClerkClient` → `createClerkClient` (from `@clerk/chrome-extension/background`)

---

## 6. AI Model Verification Steps

### 6.1 – Always Run the CLI First

**The CLI's codemods are more thorough than manual file scanning.** The CLI performs AST-level transformations and will catch usages that simple text search may miss (e.g., re-exported components, aliased imports, dynamically constructed props). **Always run `npx @clerk/upgrade` before attempting any manual changes.**

Do NOT try to manually scan and fix files as a substitute for the CLI. Manual grep-based scanning will miss:

- Files that re-export Clerk components through intermediate modules
- Aliased or renamed imports
- Dynamically referenced props or components
- Files in unexpected directories (e.g., shared packages in monorepos)

### 6.2 – Post-CLI Verification

After the CLI has run, verify any remaining issues it could not auto-fix:

1. **Node.js version:** Is Node.js 20.9.0+ being used?
2. **Components:** Are `SignedIn`, `SignedOut`, and `Protect` replaced with `Show`?
3. **Package names:** Are imports using `@clerk/react` and `@clerk/expo` (not `@clerk/clerk-react` or `@clerk/clerk-expo`)?
4. **Appearance prop:** Is `layout` replaced with `options`?
5. **Types:** Are type imports from `@clerk/shared/types` (not `@clerk/types`)?
6. **Redirect props:** Are legacy redirect props (`afterSignInUrl`, `afterSignUpUrl`, `redirectUrl`) replaced with `fallbackRedirectUrl` or `forceRedirectUrl`?
7. **Next.js `ClerkProvider`:** Is `ClerkProvider` positioned inside `<body>` (not wrapping `<html>`)?
8. **Astro files:** `.astro` template files are not handled by the CLI — check these manually.

If issues remain after running the CLI, use the reference sections above to manually fix them.
