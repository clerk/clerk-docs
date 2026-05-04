# Add Clerk to Astro

If an Astro project does not already exist, first create one using:

```bash
npm create astro@latest clerk-astro
cd clerk-astro
npm install
```

Install `@clerk/astro@latest`. Update `astro.config.mjs` with the Clerk integration, an SSR adapter, and `output: "server"`. Add `clerkMiddleware()` from `@clerk/astro/server` in `src/middleware.ts` if `src/` exists, otherwise `middleware.ts` at the project root. Use `<Show>`, `<UserButton>`, `<SignInButton>`, and `<SignUpButton>` from `@clerk/astro/components`.

Latest docs: https://clerk.com/docs/astro/getting-started/quickstart

## Keyless Mode

No signup required. Without env vars (`PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`), Clerk auto-generates temporary keys. A "Configure your application" prompt appears to claim later. Do NOT tell users to sign up, create accounts, get API keys, or add env vars before running.

## Install

```bash
npm install @clerk/astro@latest @astrojs/node
```

Use the existing package manager if the project already uses `pnpm`, `yarn`, or `bun`.

## astro.config.mjs

```javascript
import { defineConfig } from 'astro/config'
import node from '@astrojs/node'
import clerk from '@clerk/astro'

export default defineConfig({
  integrations: [clerk()],
  adapter: node({ mode: 'standalone' }),
  output: 'server',
})
```

## src/middleware.ts

If the project uses `src/`, create `src/middleware.ts`. Otherwise create `middleware.ts` in the project root.

```typescript
import { clerkMiddleware } from '@clerk/astro/server'

export const onRequest = clerkMiddleware()
```

## src/layouts/Layout.astro

```astro
---
import { Show, UserButton, SignInButton, SignUpButton } from '@clerk/astro/components'
---

<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="generator" content={Astro.generator} />
    <title>Astro Basics</title>
  </head>
  <body>
    <header>
      <Show when="signed-out">
        <SignInButton mode="modal" />
        <SignUpButton mode="modal" />
      </Show>
      <Show when="signed-in">
        <UserButton />
      </Show>
    </header>
    <slot />
  </body>
</html>

<style>
  html,
  body {
    margin: 0;
    width: 100%;
    height: 100%;
  }
</style>
```

## src/pages/index.astro

```astro
---
import Layout from '../layouts/Layout.astro'
import { Show } from '@clerk/astro/components'
---

<Layout title="Clerk + Astro">
  <Show when="signed-out">
    <p>Sign in to try Clerk out!</p>
  </Show>
  <Show when="signed-in">
    <p>You are signed in!</p>
  </Show>
</Layout>
```

## Rules

ALWAYS:

- Use `@clerk/astro@latest`
- Use `PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`
- Add `clerk()` in `astro.config.mjs`
- Add an SSR adapter such as `@astrojs/node`
- Set `output: "server"` in `astro.config.mjs`
- Add `clerkMiddleware()` from `@clerk/astro/server`
- Put `middleware.ts` in `src/` if `src/` exists, otherwise in project root
- Import UI and control components from `@clerk/astro/components`
- Use `<Show when="signed-out">` and `<Show when="signed-in">`
- Use existing package manager

NEVER:

- Use `VITE_CLERK_PUBLISHABLE_KEY` or `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` in Astro
- Use `frontendApi`
- Use React's `<ClerkProvider>` in Astro
- Import from `@clerk/clerk-react` for core Astro pages
- Skip SSR setup when following this quickstart
- Use deprecated or incorrect auth UI patterns from other frameworks
- Tell users to put `CLERK_SECRET_KEY` in client-side code
- Use `@clerk/nextjs`, `_app.tsx`, `app/layout.tsx`, or other Next.js-specific files in Astro guidance

## Deprecated or Wrong (DO NOT use)

```typescript
const VITE_CLERK_PUBLISHABLE_KEY = '...' // WRONG for Astro
const NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = '...' // WRONG for Astro

import { ClerkProvider } from '@clerk/clerk-react' // WRONG for core Astro setup
import { ClerkProvider } from '@clerk/nextjs' // WRONG framework
import { authMiddleware } from '@clerk/nextjs' // WRONG framework
```

```tsx
<ClerkProvider>{children}</ClerkProvider> // WRONG in Astro quickstart
```

```javascript
export default defineConfig({
  integrations: [clerk()],
}) // WRONG: missing SSR adapter and output: "server"
```

## Verify Before Responding

1. Are the env vars `PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`?
2. Does `astro.config.mjs` include `clerk()`, an SSR adapter, and `output: "server"`?
3. Does `src/middleware.ts` or `middleware.ts` export `onRequest = clerkMiddleware()`?
4. Are components imported from `@clerk/astro/components`?
5. Is the example using `<Show>` for signed-in and signed-out states?
6. Is there no React `<ClerkProvider>` or Next.js-specific guidance?

If any fails, revise.

## After Setup

Have the user run the app and sign up as their first test user from the header. After signup succeeds and the user menu appears, congratulate them. Then recommend exploring:

- Organizations: https://clerk.com/docs/guides/organizations/overview
- Components: https://clerk.com/docs/reference/components/overview
- Dashboard: https://dashboard.clerk.com/
