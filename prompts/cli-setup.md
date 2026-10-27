
# Set up Clerk

Use the [Clerk CLI](https://clerk.com/docs/cli) to add authentication. In agent environments, supported frameworks default to accountless setup: `npx -y clerk@latest init` provisions a claimable application and writes temporary development keys without requiring a Clerk account.

## Before you start

Show the user this checklist and wait for a yes:

```
Here's what I'll do to get you set up with Clerk.

1. Set up Clerk in this project, or scaffold a new app if this directory is empty.
2. Install Clerk's agent skills for the coding agents on this machine, if they aren't installed yet.
3. Start your app with Clerk installed.

Shall I proceed?
```

## Existing authentication

Before `init`, inspect auth dependencies, routes, middleware, sessions, and user records — never environment files. If a different auth provider exists, stop and get approval for a migration plan covering:

- Backend API user import, stable external IDs, compatible password hashes, and OAuth continuity.
- Protected routes, tokens, session cutover, and rollout strategy.

Do not modify or remove existing auth without approval.

See the [migration guide](https://clerk.com/docs/guides/development/migrating/overview).

## Existing Clerk projects

For a native iOS or macOS app, follow the [iOS setup prompt](https://clerk.com/docs/ios/getting-started/quickstart.md) instead. It reuses the linked application and keeps existing configuration.

If the project already uses Clerk, skip `init` in Steps 1a and 1b: a signed-out agent run could create another application and replace the project's Clerk keys. If Clerk already works and the user asked for setup, report that no setup is needed. If the user reports missing keys, restore them through the existing-application branch below. If inspection finds missing provider, middleware, or auth routes, add only those pieces from the matching quickstart in Step 2. Never create a replacement application.

Inspect its Clerk package versions before changing anything and use the version table in the [clerk skill](https://clerk.com/.well-known/skills/clerk/SKILL.md) to identify its SDK generation. Preserve that generation unless the user asks to upgrade it, and apply these differences in every step below for Core 2 projects:

- React and Expo use `@clerk/clerk-react` and `@clerk/clerk-expo` instead of `@clerk/react` and `@clerk/expo`.
- Control components are `<SignedIn>` and `<SignedOut>` instead of `<Show>`.
- Next.js `ClerkProvider` can wrap `<html>` instead of going inside `<body>`.
- The minimum Node.js version is 18.17.0 instead of 20.9.0.
- Themes come from `@clerk/themes` and `@clerk/themes/shadcn.css` instead of `@clerk/ui`.

## Use an existing Clerk application (optional)

Follow this branch when the user asks to use an existing Clerk application or an existing Clerk project needs its keys restored. Have them authenticate from their host terminal before targeting account-level resources:

```bash
npx -y clerk@latest auth login
```

If they supplied an application ID, keep it for `init` or `link` as appropriate. Otherwise, list the applications:

```bash
npx -y clerk@latest apps list --json
```

Show the names and IDs and ask which application to use. Never choose an application for them. For a new Clerk integration, pass the selected ID as `--app <application_id>` to `init`. For a project already using Clerk, do not run `init`. If it is not already linked to the selected application, link it:

```bash
npx -y clerk@latest link --app <application_id>
```

For missing development keys, pull them:

```bash
npx -y clerk@latest env pull
```

Only when the user needs production keys, use `npx -y clerk@latest env pull --instance prod` instead. Do not replace working keys or switch applications without the user's confirmation.

## Step 1a: Existing project without Clerk

For a native iOS or macOS app in Xcode, follow the [iOS setup prompt](https://clerk.com/docs/ios/getting-started/quickstart.md) instead of the remaining steps.

For a project that does not already use Clerk, run from the project root:

```bash
npx -y clerk@latest init
```

`init` detects the framework and package manager, installs the SDK, and configures the provider, middleware, auth routes, and environment. It also installs Clerk's agent skills globally. If the user declined them, or they're already available to you, such as when you loaded this as the `clerk-setup` skill, add `--no-skills` to skip that step. Don't pass `--framework` or `--pm` unless asked. Add `--app <application_id>` only when the user selected an application in the optional branch above.

## Step 1b: Empty directory

For a native iOS or macOS app, follow the [iOS setup prompt](https://clerk.com/docs/ios/getting-started/quickstart.md) instead of the remaining steps. It covers creating the Xcode project.

Ask which framework and package manager to use, defaulting to Next.js and npm:

```bash
npx -y clerk@latest init --framework <framework> --pm <package-manager>
```

`init` creates the app in a new subdirectory, such as `my-clerk-next-app`, not in the current directory. Run the remaining steps from that subdirectory. As in Step 1a, add `--no-skills` if Clerk's skills are already available to you or the user declined them.

`init` can create Next.js, React Router, Astro, Nuxt, TanStack Start, React, Vue, JavaScript/Vite, and Expo apps. For Express, Fastify, or Android, create the project with that platform's own tooling first, then follow Step 1a.

## Step 1c: Accountless development keys

For a signed-out user on a framework with accountless support (Next.js, React Router, Astro, Nuxt, or TanStack Start), `init` provisions a claimable application and writes temporary keys to the detected environment file. Relay the filename and claim instruction printed by the CLI. The app stays unclaimed until the user runs `npx -y clerk@latest auth login`; don't run it unless asked. Use `--accountless` only to force this flow while signed in.

Frameworks without accountless support need real API keys. There, `init` applies what setup it can and prints the remaining steps.

## Step 2: Fall back to docs when init is incomplete

If `init` reports the framework is unsupported or undetected, follow the quickstart instead. If it finishes but prints remaining steps, follow those, and use the matching quickstart for anything they don't cover.

For an existing Clerk project with missing integration files, use that quickstart to add only the missing pieces without running `init`.

`init` configures Next.js, React, React Router, Nuxt, TanStack Start, Astro, Vue, JavaScript/Vite, Expo, Express, and Fastify projects, and existing iOS and macOS Xcode projects (see the [iOS setup prompt](https://clerk.com/docs/ios/getting-started/quickstart.md)). For Android, it only prints setup steps, so follow the quickstart.

Use the matching direct quickstart:

- [Next.js](https://clerk.com/docs/nextjs/getting-started/quickstart.md?manual=1)
- [React](https://clerk.com/docs/react/getting-started/quickstart.md?manual=1)
- [React Router](https://clerk.com/docs/react-router/getting-started/quickstart.md?manual=1)
- [Nuxt](https://clerk.com/docs/nuxt/getting-started/quickstart.md?manual=1)
- [TanStack Start](https://clerk.com/docs/tanstack-react-start/getting-started/quickstart.md?manual=1)
- [Astro](https://clerk.com/docs/astro/getting-started/quickstart.md?manual=1)
- [Vue](https://clerk.com/docs/vue/getting-started/quickstart.md?manual=1)
- [JavaScript or Vite](https://clerk.com/docs/js-frontend/getting-started/quickstart.md?manual=1)
- [Expo](https://clerk.com/docs/expo/getting-started/quickstart.md?manual=1)
- [Express](https://clerk.com/docs/expressjs/getting-started/quickstart.md?manual=1)
- [Fastify](https://clerk.com/docs/fastify/getting-started/quickstart.md?manual=1)
- [iOS](https://clerk.com/docs/ios/getting-started/quickstart.md?manual=1)
- [Android](https://clerk.com/docs/android/getting-started/quickstart.md?manual=1)
- [Chrome extension](https://clerk.com/docs/chrome-extension/getting-started/quickstart.md?manual=1)

For everything else, use [Clerk's llms.txt](https://clerk.com/llms.txt).

## Step 3: Add visible auth controls

Skip this step for backend-only projects, such as Express or Fastify APIs. For Expo, iOS, and Android, use the native components from the matching quickstart instead.

A web app needs sign-in, sign-up, and signed-in user controls, worked into the existing layout or navigation. If they already exist, adapt them instead of duplicating.

For Next.js App Router, when `<Show>` renders in a Server Component, it reads the request, so wrap it in `<Suspense>`:

```text
import { SignInButton, SignUpButton, Show, UserButton } from '@clerk/nextjs'
import { Suspense } from 'react'

<Suspense>
  <Show when="signed-out">
    <SignInButton />
    <SignUpButton />
  </Show>
  <Show when="signed-in">
    <UserButton />
  </Show>
</Suspense>
```

Astro imports from `@clerk/astro/components`. Nuxt auto-imports the components; explicit imports come from `@clerk/nuxt/components`. Other frameworks use the same names from their Clerk package, such as `@clerk/vue` or `@clerk/react`.

## Step 4: Verify

```bash
npx -y clerk@latest doctor
```

Then start the app, confirm the auth controls render, and fix anything the CLI reports.

Bot protection can block sign-ups in browsers you automate. If you test a new accountless app in one, run `npx -y clerk@latest users create --email <unique>+clerk_test@example.com --password <random-16-char-alphanumeric> --yes`, then sign in. If asked for a verification code, enter 424242. Tell the user you created this test user. For an existing app, ask the user before creating users. To test sign-up, use [`@clerk/testing`](https://clerk.com/docs/guides/development/testing/playwright/overview.md).

## Step 5: If using shadcn/ui

If `components.json` exists in the project root, add `@clerk/ui` with the project's package manager. Match the lockfile: `pnpm-lock.yaml` → `pnpm add`, `yarn.lock` → `yarn add`, `bun.lock` or `bun.lockb` → `bun add`, `package-lock.json` → `npm install`.

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

- Use Node.js 20.9.0 or later for current Clerk SDKs.
- Next.js 15+: `auth()` is async. Always `await auth()`.
- Next.js: when `next.config` sets `cacheComponents: true` (the `create-next-app` default), `next build` fails on request data read outside `<Suspense>`. Wrap `<Show>` rendered in a Server Component, and any Server Component that calls `auth()` or `currentUser()`, in `<Suspense>`, as close to the auth-dependent UI as possible. Wrap catch-all `<SignIn />`, `<SignUp />`, `<UserProfile />`, and `<OrganizationProfile />` pages in `<Suspense>` too, including the sign-in and sign-up pages the Clerk CLI creates. See [Read auth data inside Suspense](https://clerk.com/docs/guides/development/rendering-modes.md#read-auth-data-inside-suspense) and [Prebuilt components on catch-all routes](https://clerk.com/docs/guides/development/rendering-modes.md#prebuilt-components-on-catch-all-routes).
- For current Next.js SDKs, `ClerkProvider` goes inside `<body>`, not around `<html>`.
- Never expose `CLERK_SECRET_KEY` in client code.
- For fresh setups, use the current framework package, such as `@clerk/nextjs`, `@clerk/react`, `@clerk/expo`, `@clerk/react-router`, or `@clerk/tanstack-react-start`.
- Do not read or print existing environment variable files; ask the user for any missing non-sensitive configuration.

## After setup

Have the user sign up as their first test user. Congratulate them once the profile icon appears in the nav.

Ask how users should sign up and sign in: email, phone, username, and social providers. The app must be claimed before changing these settings.

If `init` created the app in this session and no SDK claim file exists, use the `init` claim steps below. Otherwise, if `.clerk/keyless.json` (`init`) or `.clerk/.tmp/keyless.json` (SDK) exists, ask which app the project should use before anyone signs in or links it.

If both claim files exist, stop before `auth login`, `open`, or `link`: `open` prefers the `init` claim, even if the user chose the SDK app. Have the user identify which claim belongs to the app whose keys the project uses, move the other file out of the project, and keep it private. Never read the claim files or keys. Continue only after the user confirms that the remaining file and the project's keys belong to the chosen app.

- **`init` claim:** If this is the chosen app, have the user run `npx -y clerk@latest auth login`. On older CLIs, signing in from this folder claims the `init` app and replaces the project's keys; a signed-out `npx -y clerk@latest link` can start that sign-in. If the user chose another app, have them sign in from another folder first.
- **SDK claim:** Have the user run `npx -y clerk@latest open` in their own terminal to open the claim page, then `npx -y clerk@latest link`. Signing in cannot claim an SDK-created app.

Once the app is claimed, review settings with `npx -y clerk@latest config pull` and change them with `npx -y clerk@latest config patch` (supports `--dry-run`), or use the Clerk Dashboard. See [sign-up and sign-in options](https://clerk.com/docs/guides/configure/auth-strategies/sign-up-sign-in-options.md).

Before production, claim the app as described above and run `npx -y clerk@latest deploy`. If `deploy` says the project isn't linked, follow its instructions. Unclaimed apps and temporary keys aren't production-ready.

Then offer Organizations — multi-tenancy, team invitations, roles and permissions, and enterprise SSO.

If yes:

1. Run `npx -y clerk@latest enable orgs`.
2. Add `<OrganizationSwitcher />` next to the existing `<UserButton />`, or the framework equivalent.
3. Have them create an organization from the switcher and invite a teammate.

If no, point them to [Organizations](https://clerk.com/docs/guides/organizations/overview), [Components](https://clerk.com/docs/reference/components/overview), and the [Clerk Dashboard](https://dashboard.clerk.com/).
