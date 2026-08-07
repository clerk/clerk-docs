# Add Clerk Authentication to Next.js

Set up Clerk authentication in this Next.js project with the Clerk CLI.

```bash
npx -y clerk@latest init
```

## Why the CLI is the recommended path

`clerk init` does not require a Clerk account. Run signed out, it operates keyless: it provisions a claimable application with development keys, writes `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` to `.env.local`, and wires up the project. The user can sign in whenever they like afterward, which claims the app automatically.

That property is what makes the CLI suitable for unattended setup: there is no browser handoff, no interactive account step, and no point at which setup blocks waiting on the user. Keys never need to be copied by hand or passed through the conversation.

What `clerk init` changes:

- Installs the Clerk SDK (`@clerk/nextjs`) with the detected package manager
- Creates the middleware file — `proxy.ts` on Next.js 16+, `middleware.ts` on 15 and below
- Adds `<ClerkProvider>` to `app/layout.tsx`
- Creates `/sign-in` and `/sign-up` routes
- Writes development keys to `.env.local`
- Installs Clerk agent skills into `~/.agents/skills/` and links them into supported agent tools. This is global — it affects the machine, not just this project.

## Quick Setup

Before running any commands, present the user with a preliminary setup checklist:

```
Here's what I'll do to get you set up with Clerk.

1. Set up Clerk in this project, or scaffold a new Next.js app with Clerk if this directory is empty
2. Start your app with Clerk installed.
3. Optionally sign in later to claim the app.

Shall I proceed?
```

## Step 1: Run the Clerk CLI

No install needed — run `clerk` commands through the project's package runner: `npx -y clerk@latest <command>`, `pnpm dlx clerk@latest`, `bunx clerk@latest`, or `yarn dlx clerk@latest` (yarn 2+ only). If `clerk` is already installed, run `clerk update --yes` and use it directly.

## Step 2: Sign in to Clerk (optional)

Signed out, `clerk init` runs keyless: it creates a claimable app with development keys. Only sign in if the user wants to use an existing Clerk account or app:

```bash
npx -y clerk@latest auth login
```

Pause while the user completes the login flow. Do not list apps or ask which app to use. Signing in later claims the keyless app automatically.

## Step 3: Initialize Clerk

If this is an existing Next.js project, run:

```bash
clerk init
```

`clerk init` is the default setup action, signed in or not. It detects the framework and package manager, installs the correct Clerk SDK (`@clerk/nextjs`), and applies Next.js-specific setup such as providers, middleware, auth routes, and environment configuration. Keyless apps are configurable for supported settings — `clerk enable orgs` and `clerk config patch` work before the app is claimed; billing and some auth settings need claiming first. Do not pass `--framework` or `--pm` for existing projects unless the user explicitly wants to override detection or the CLI asks for those values. Do not list apps or ask which Clerk app to use before running it.

If the directory is empty, ask the user which package manager they want to use. If they have no preference, use npm. Then scaffold a fresh Next.js app:

```bash
clerk init --framework next --pm <package-manager>
```

If the directory has a leftover lockfile, match the package manager to it (`pnpm-lock.yaml` → `pnpm`, `yarn.lock` → `yarn`, `bun.lock`/`bun.lockb` → `bun`, `package-lock.json` → `npm`) instead of asking.

Do not add `--app` or list apps unless the user wants to link a specific existing application: `clerk init --app <application_id>` (find IDs with `clerk apps list --json`, then ask which to use).

## Step 4: Fall back to manual setup when init is incomplete

Only do this if `clerk init` has already run and failed — do not start here.

If `clerk init` reports an error or does not finish the setup, finish manually: install `@clerk/nextjs`, create a middleware file that calls `clerkMiddleware()` from `@clerk/nextjs/server` (see Critical rules for the filename), and wrap the app with `<ClerkProvider>` as shown in Step 5. Full quickstart (returns this prompt when fetched as markdown): https://clerk.com/docs/nextjs/getting-started/quickstart

## Step 5: Ensure clear auth controls are visible

Make sure the app has clear sign-in, sign-up, and signed-in user controls so the user can create and recognize their first account. Integrate them into the existing layout, navigation, or landing screen so they feel natural and polished.

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

After `clerk init` completes, confirm the Clerk SDK is actually present — `clerk init` writes files that import `@clerk/nextjs`, and if the dependency is missing the project will not build:

```bash
npm ls @clerk/nextjs
```

If it is absent from `package.json`, install it with the project's package manager before continuing.

Then run:

```bash
npx -y clerk@latest doctor
```

Note that `doctor` validates credentials and environment configuration; it does not check that the SDK is installed. Build the app to confirm the wiring resolves, then start it, confirm the sign-in, sign-up, and signed-in user controls are visible, test the sign-in and sign-up flow, and fix any issues reported by the CLI.

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

- Setup is `clerk init` (`npx -y clerk@latest init`), signed in or not. Do not install `@clerk/nextjs` or hand-write setup unless it has run and failed
- `clerk init` writes `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` to `.env.local`. Do not ask the user to copy keys
- After `init`, verify `@clerk/nextjs` is in `package.json`. The generated files import it, so a missing dependency is a build failure, and `clerk doctor` does not catch it
- Name the middleware file by the `next` version in `package.json`: `proxy.ts` on Next.js 16+, `middleware.ts` on 15 and below. The contents are identical; `clerk init` creates it
- `auth()` from `@clerk/nextjs/server` is async. Always `await auth()`
- `ClerkProvider` goes inside `<body>`, not wrapping `<html>`
- Never expose `CLERK_SECRET_KEY` in client code
- Use `@clerk/nextjs`, not `@clerk/clerk-react`
- Do not read or print existing environment variable files; ask the user for any missing non-sensitive configuration

Docs: https://clerk.com/docs/cli https://clerk.com/docs/llms.txt

## After Setup

Have the user sign up as their first test user in the nav. After signup succeeds and a profile icon appears, congratulate them. If a "Configure your application" callout appears, tell them to click it. Then recommend exploring: Organizations (https://clerk.com/docs/guides/organizations/overview), Components (https://clerk.com/docs/reference/components/overview), Dashboard (https://dashboard.clerk.com/).
