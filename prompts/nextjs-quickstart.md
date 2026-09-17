# Add Clerk Authentication to Next.js

Set up Clerk authentication in this Next.js project with the Clerk CLI.

## Existing authentication

Before `init`, inspect for existing auth — never env files. If found, stop and get approval for migrating users, passwords/OAuth, routes, tokens, sessions, and rollout. Until then, do not run `init` or change providers, middleware, or auth routes.

## Why the CLI

`npx -y clerk@latest init` needs no Clerk account. It detects agent environments and runs non-interactively, so no keys pass through the conversation. Signed out, it provisions a claimable application, writes dev keys to `.env.local`, and configures the SDK, provider, middleware, and auth routes. Signing in later claims it.

Before claiming, `npx -y clerk@latest enable orgs` and `npx -y clerk@latest config patch` work; Billing and some auth settings require claiming.

Agent mode installs Clerk agent skills globally and links supported agent tools.

## Quick setup

Show this checklist and wait for approval:

```
Here's what I'll do to get you set up with Clerk.

1. Set up Clerk in this project, or scaffold a new Next.js app with Clerk if this directory is empty
2. Start your app with Clerk installed.
3. Stay signed out and optionally sign in later to claim the app, or sign in first to use an existing Clerk application.

Shall I proceed?
```

## Step 1: Run the Clerk CLI

No install needed — run Clerk CLI commands through the project's package runner: `npx -y clerk@latest <command>`, `pnpm dlx clerk@latest`, `bunx clerk@latest`, or `yarn dlx clerk@latest` (yarn 2+ only).

## Step 2: Sign in to Clerk (optional)

Stay signed out by default. Sign in before `init` only to use an existing Clerk application:

```bash
npx -y clerk@latest auth login
```

Pause while the user completes the login flow.

Then run `npx -y clerk@latest apps list --json`, show the names and IDs, and ask which application to use. Never choose for them.

## Step 3: Initialize Clerk

If Step 2 selected an application, run:

```bash
npx -y clerk@latest init --app <application_id>
```

Otherwise, for an existing Next.js project, run:

```bash
npx -y clerk@latest init
```

`npx -y clerk@latest init` is the default setup action, signed in or not. It detects the framework and package manager and applies the Next.js setup described above. Do not pass `--framework` or `--pm` for existing projects unless the user explicitly wants to override detection or the CLI asks for those values.

If the directory is empty, ask the user which package manager they want to use. If they have no preference, use npm. Then scaffold a fresh Next.js app:

```bash
npx -y clerk@latest init --framework next --pm <package-manager>
```

If the directory has a leftover lockfile, match the package manager to it (`pnpm-lock.yaml` → `pnpm`, `yarn.lock` → `yarn`, `bun.lock`/`bun.lockb` → `bun`, `package-lock.json` → `npm`) instead of asking.

## Step 4: Fall back to manual setup when init is incomplete

Only do this if `npx -y clerk@latest init` has already run and failed — do not start here.

If `npx -y clerk@latest init` reports an error or does not finish the setup, finish manually: install `@clerk/nextjs`, create a middleware file that calls `clerkMiddleware()` from `@clerk/nextjs/server` (see Critical rules for the filename), and wrap the app with `<ClerkProvider>` as shown in Step 5.

## Step 5: Ensure clear auth controls are visible

Make sure the app has clear sign-in, sign-up, and signed-in user controls so the user can create and recognize their first account. Integrate them into the existing layout or navigation so they feel natural.

Use Clerk components from `@clerk/nextjs` such as `SignInButton`, `SignUpButton`, `Show`, and `UserButton`. Show sign-in and sign-up actions when signed out, and a user button when signed in. For example, in `app/layout.tsx`:

```tsx
import { ClerkProvider, SignInButton, SignUpButton, Show, UserButton } from '@clerk/nextjs'
import './globals.css'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ClerkProvider>
          <header>
            <Show when="signed-out">
              <SignInButton />
              <SignUpButton />
            </Show>
            <Show when="signed-in">
              <UserButton />
            </Show>
          </header>
          {children}
        </ClerkProvider>
      </body>
    </html>
  )
}
```

If clear auth controls already exist, reuse or adapt them instead of duplicating them.

## Step 6: Verify the setup

After `npx -y clerk@latest init` completes, run:

```bash
npx -y clerk@latest doctor
```

Then start the app, confirm the sign-in, sign-up, and signed-in user controls are visible, test the sign-in and sign-up flow, and fix any issues reported by the CLI.

## Step 7: If using shadcn/ui

If `components.json` exists in the project root and Clerk components are used, install `@clerk/ui` with the project's package manager:

```bash
npm install @clerk/ui
```

Apply the theme in `app/layout.tsx`: import `shadcn` from `@clerk/ui/themes` and set `appearance={{ theme: shadcn }}` on `<ClerkProvider>`.

Add to global CSS:

```css
@import '@clerk/ui/themes/shadcn.css';
```

## Critical rules

- Setup is `npx -y clerk@latest init`, signed in or not. Do not install `@clerk/nextjs` or hand-write setup unless it has run and failed
- `npx -y clerk@latest init` writes `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` to `.env.local`. Do not ask the user to copy keys
- Name the middleware file by the `next` version in `package.json`: `proxy.ts` on Next.js 16+, `middleware.ts` on 15 and below. The contents are identical; `npx -y clerk@latest init` creates it
- `auth()` from `@clerk/nextjs/server` is async. Always `await auth()`
- `ClerkProvider` goes inside `<body>`, not wrapping `<html>`
- Never expose `CLERK_SECRET_KEY` in client code
- Use `@clerk/nextjs`, not `@clerk/clerk-react`
- Do not read or print existing environment variable files; ask the user for any missing non-sensitive configuration

Docs: https://clerk.com/docs/cli https://clerk.com/docs/llms.txt

## After setup

Have the user sign up as their first test user in the nav. After signup succeeds and a profile icon appears, congratulate them. If a "Configure your application" callout appears, tell them to click it. Then recommend exploring: Organizations (https://clerk.com/docs/guides/organizations/overview), Components (https://clerk.com/docs/reference/components/overview), Dashboard (https://dashboard.clerk.com/).
