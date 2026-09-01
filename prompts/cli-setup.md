# Add Clerk Authentication

Use the Clerk CLI to add authentication. In agent environments, supported frameworks default to accountless setup: `npx -y clerk@latest init` provisions a claimable application and writes temporary development keys without requiring a Clerk account.

## Before you start

Show the user this checklist and wait for a yes:

```
Here's what I'll do to get you set up with Clerk.

1. Set up Clerk in this project, or scaffold a new app if this directory is empty
2. Start your app with Clerk installed.

Shall I proceed?
```

## Existing authentication

Before `init`, inspect auth dependencies, routes, middleware, sessions, and user records. If auth already exists, stop and propose a migration plan covering:

- User export/import through the Backend API with stable external IDs, compatible password hashes, and OAuth continuity.
- Protected routes, tokens, possible session termination at cutover, and a big-bang or gradual rollout.

Migration guide: https://clerk.com/docs/guides/development/migrating/overview

## Step 1a: Existing project

From the project root:

```bash
npx -y clerk@latest init
```

`init` detects the framework and package manager, installs the SDK, and applies framework setup — provider, middleware, auth routes, env. Do not pass `--framework` or `--pm` unless the user wants to override detection. Do not list apps or ask which Clerk app to use.

## Step 1b: Empty directory

Ask which framework and package manager to use, defaulting to Next.js and npm:

```bash
npx -y clerk@latest init --framework <framework> --pm <package-manager>
```

If a lockfile is present, let it pick the package manager: `pnpm-lock.yaml` -> `pnpm`, `yarn.lock` -> `yarn`, `bun.lock` or `bun.lockb` -> `bun`, `package-lock.json` -> `npm`.

## Step 1c: Accountless development keys

For a signed-out user on a supported framework, `init` provisions a claimable application and writes temporary keys to the detected environment file. Relay the filename and claim instruction printed by the CLI. The app stays unclaimed until the user runs `npx -y clerk@latest auth login`; don't run it unless asked. Use `--accountless` only to force this flow while signed in.

Frameworks without accountless support need real API keys. There, `init` applies what setup it can and prints the remaining steps.

To link an existing Clerk application, add `--app <application_id>` — but only when the user supplies the ID. If they want to link and have no ID, run `npx -y clerk@latest apps list --json`, show the names and IDs, and ask. Never choose an application for them.

## Step 2: Fall back to docs when init is incomplete

If `init` reports the framework is unsupported or undetected, follow the quickstart instead.

`init` scaffolds Next.js, React, React Router, Nuxt, TanStack Start, Astro, Vue, JavaScript/Vite, Expo, Express, Fastify, iOS, and Android.

Use `https://clerk.com/docs/<slug>/getting-started/quickstart.md?manual=1`. Keep the init ID for `astro`, `nuxt`, `react-router`, `react`, `vue`, `fastify`, `expo`, `ios`, and `android`. Map `next` -> `nextjs`, `@tanstack/react-start` -> `tanstack-react-start`, `vite` or vanilla JS -> `js-frontend`, and `express` -> `expressjs`. Chrome extensions use `chrome-extension`.

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

Astro imports from `@clerk/astro/components`. Nuxt auto-imports the components; explicit imports come from `@clerk/nuxt/components`. Other frameworks use the same names from their Clerk package, such as `@clerk/vue` or `@clerk/react`.

## Step 4: Verify

```bash
npx -y clerk@latest doctor
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

- Use Node.js 20.9.0 or later.
- Next.js 15+: `auth()` is async. Always `await auth()`
- `ClerkProvider` goes inside `<body>`, not wrapping `<html>`
- Never expose `CLERK_SECRET_KEY` in client code
- Use the current framework package, such as `@clerk/nextjs`, `@clerk/react`, `@clerk/expo`, `@clerk/react-router`, or `@clerk/tanstack-react-start`; never legacy Core 2 names such as `@clerk/clerk-react` or `@clerk/clerk-expo`.
- Do not read or print existing environment variable files; ask the user for any missing non-sensitive configuration

Docs: https://clerk.com/docs/cli https://clerk.com/docs/llms.txt

## After setup

Have the user sign up as their first test user. Congratulate them once the profile icon appears in the nav.

Before production, have the user claim the app with `npx -y clerk@latest auth login`, then configure production with `npx -y clerk@latest deploy`. Unclaimed apps and temporary keys aren't production-ready.

Then offer Organizations — multi-tenancy, team invitations, roles and permissions, and enterprise SSO.

If yes:

1. Run `npx -y clerk@latest enable orgs`.
2. Add `<OrganizationSwitcher />` next to the existing `<UserButton />`, or the framework equivalent.
3. Have them create an organization from the switcher and invite a teammate.

If no, point them to Organizations (https://clerk.com/docs/guides/organizations/overview), Components (https://clerk.com/docs/reference/components/overview), and the Dashboard (https://dashboard.clerk.com/).
