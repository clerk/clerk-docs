# Add Clerk Authentication

Set up Clerk authentication with the Clerk CLI. When the framework supports keyless, `npx clerk@latest init` defaults to keyless mode — auto-generated temporary development keys that a later `clerk auth login` claims automatically.

## Before you start

Show the user this checklist and wait for a yes:

```
Here's what I'll do to get you set up with Clerk.

1. Set up Clerk in this project, or scaffold a new app if this directory is empty
2. Start your app with Clerk installed.

Shall I proceed?
```

## Step 1a: Existing project

From the project root:

```bash
npx clerk@latest init
```

`init` detects the framework and package manager, installs the SDK, and applies framework setup — provider, middleware, auth routes, env. Do not pass `--framework` or `--pm` unless the user wants to override detection. Do not list apps or ask which Clerk app to use.

## Step 1b: Empty directory

Ask which framework and package manager to use, defaulting to Next.js and npm:

```bash
npx clerk@latest init --framework <framework> --pm <package-manager>
```

If a lockfile is present, let it pick the package manager: `pnpm-lock.yaml` -> `pnpm`, `yarn.lock` -> `yarn`, `bun.lock` or `bun.lockb` -> `bun`, `package-lock.json` -> `npm`.

## Step 1c: Development keys

Next.js, Astro, Nuxt, TanStack Start, and React Router support keyless. There `init` writes temporary development keys to the project's env file, so the user needs no Clerk account. The CLI prints a confirmation naming the env file it wrote, followed by:

```
When you're ready, run clerk auth login and your app will be claimed automatically.
```

Relay that, using the filename the CLI printed: the app stays unclaimed until the user runs `npx clerk@latest auth login`. Do not run it for them unless they ask to claim now.

Every other framework needs real API keys. There `init` applies what setup it can and prints the remaining steps.

To link an existing Clerk application, add `--app <application_id>` — but only when the user supplies the ID. If they want to link and have no ID, run `npx clerk@latest apps list --json`, show the names and IDs, and ask. Never choose an application for them.

## Step 2: Fall back to docs when init is incomplete

If `init` reports the framework is unsupported or undetected, follow the quickstart instead.

`init` scaffolds Next.js (App and Pages Router), React, React Router, Nuxt, TanStack Start, Astro, Vue, JavaScript/Vite, Expo, Express, Fastify, iOS, and Android.

| Framework               | Quickstart                                                             |
| ----------------------- | ---------------------------------------------------------------------- |
| `next`                  | https://clerk.com/docs/nextjs/getting-started/quickstart               |
| `astro`                 | https://clerk.com/docs/astro/getting-started/quickstart                |
| `nuxt`                  | https://clerk.com/docs/nuxt/getting-started/quickstart                 |
| `react-router`          | https://clerk.com/docs/react-router/getting-started/quickstart         |
| `@tanstack/react-start` | https://clerk.com/docs/tanstack-react-start/getting-started/quickstart |
| `react`                 | https://clerk.com/docs/react/getting-started/quickstart                |
| `vue`                   | https://clerk.com/docs/vue/getting-started/quickstart                  |
| `vite` or vanilla JS    | https://clerk.com/docs/js-frontend/getting-started/quickstart          |
| `express`               | https://clerk.com/docs/expressjs/getting-started/quickstart            |
| `fastify`               | https://clerk.com/docs/fastify/getting-started/quickstart              |
| `expo`                  | https://clerk.com/docs/expo/getting-started/quickstart                 |
| iOS (Swift)             | https://clerk.com/docs/ios/getting-started/quickstart                  |
| Android (Kotlin)        | https://clerk.com/docs/android/getting-started/quickstart              |
| Chrome Extension        | https://clerk.com/docs/chrome-extension/getting-started/quickstart     |

Everything else: https://clerk.com/docs/llms.txt

## Step 3: Add visible auth controls

The app needs sign-in, sign-up, and signed-in user controls, worked into the existing layout or navigation. If they already exist, adapt them instead of duplicating.

For Next.js App Router:

```text
import { SignInButton, SignUpButton, Show, UserButton } from '@clerk/nextjs'

<>
  <Show when="signed-out">
    <SignInButton />
    <SignUpButton />
  </Show>
  <Show when="signed-in">
    <UserButton />
  </Show>
</>
```

Other frameworks use the same component names from their own Clerk package — `@clerk/vue`, `@clerk/react`, `@clerk/nuxt`, and so on.

## Step 4: Verify

```bash
npx clerk@latest doctor
```

Then start the app, confirm the auth controls render, and fix anything the CLI reports.

## Step 5: If using shadcn/ui

If `components.json` exists in the project root, add `@clerk/ui` with the package manager from Step 1 — `npm install`, `pnpm add`, `yarn add`, or `bun add`.

Apply the theme in your provider:

```text
import { shadcn } from '@clerk/ui/themes'

<ClerkProvider appearance={{ theme: shadcn }}>{children}</ClerkProvider>
```

Add to global CSS:

```css
@import '@clerk/ui/themes/shadcn.css';
```

## Critical rules

- Next.js 15+: `auth()` is async. Always `await auth()`
- `ClerkProvider` goes inside `<body>`, not wrapping `<html>`
- Never expose `CLERK_SECRET_KEY` in client code
- Use `@clerk/nextjs`, not `@clerk/clerk-react`
- Do not read or print existing environment variable files; ask the user for any missing non-sensitive configuration

Docs: https://clerk.com/docs/cli https://clerk.com/docs/llms.txt

## After Setup

Have the user sign up as their first test user. Congratulate them once the profile icon appears in the nav.

Then offer Organizations — multi-tenancy, team invitations, roles and permissions, and enterprise SSO.

If yes:

1. Run `npx clerk@latest enable orgs`.
2. Add `<OrganizationSwitcher />` next to the existing `<UserButton />`, or the framework equivalent.
3. Have them create an organization from the switcher and invite a teammate.

If no, point them to Organizations (https://clerk.com/docs/guides/organizations/overview), Components (https://clerk.com/docs/reference/components/overview), and the Dashboard (https://dashboard.clerk.com/).
