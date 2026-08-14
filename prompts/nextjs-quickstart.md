# Add Clerk Authentication to Next.js

Set up Clerk authentication in this Next.js project with the Clerk CLI.

```bash
npx -y clerk@latest init
```

## Why the CLI

`clerk init` needs no Clerk account. It detects agent environments and runs in agent mode — non-interactive, so nothing blocks waiting on the user and no keys pass through the conversation. Signed out, it runs keyless: it provisions a claimable app, writes dev keys to `.env.local`, and wires up the SDK, provider, middleware, and auth routes. Signing in later claims that app.

Keyless apps stay configurable from the CLI — `clerk enable orgs` and `clerk config patch` work before claiming; billing and some auth settings need claiming first.

In agent mode it also installs Clerk agent skills globally into `~/.agents/skills/`, linked into supported agent tools.

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

Only sign in if the user wants to use an existing Clerk account or app:

```bash
npx -y clerk@latest auth login
```

Pause while the user completes the login flow. Do not list apps or ask which app to use.

## Step 3: Initialize Clerk

If this is an existing Next.js project, run:

```bash
clerk init
```

`clerk init` is the default setup action, signed in or not. It detects the framework and package manager and applies the Next.js setup described above. Do not pass `--framework` or `--pm` for existing projects unless the user explicitly wants to override detection or the CLI asks for those values.

If the directory is empty, ask the user which package manager they want to use. If they have no preference, use npm. Then scaffold a fresh Next.js app:

```bash
clerk init --framework next --pm <package-manager>
```

If the directory has a leftover lockfile, match the package manager to it (`pnpm-lock.yaml` → `pnpm`, `yarn.lock` → `yarn`, `bun.lock`/`bun.lockb` → `bun`, `package-lock.json` → `npm`) instead of asking.

Do not add `--app` or list apps unless the user wants to link a specific existing application: `clerk init --app <application_id>` (find IDs with `clerk apps list --json`, then ask which to use).

## Step 4: Fall back to manual setup when init is incomplete

Only do this if `clerk init` has already run and failed — do not start here.

If `clerk init` reports an error or does not finish the setup, finish manually: install `@clerk/nextjs`, create a middleware file that calls `clerkMiddleware()` from `@clerk/nextjs/server` (see Critical rules for the filename), and wrap the app with `<ClerkProvider>` as shown in Step 5.

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

After `clerk init` completes, run:

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

- Setup is `clerk init` (`npx -y clerk@latest init`), signed in or not. Do not install `@clerk/nextjs` or hand-write setup unless it has run and failed
- `clerk init` writes `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` to `.env.local`. Do not ask the user to copy keys
- Name the middleware file by the `next` version in `package.json`: `proxy.ts` on Next.js 16+, `middleware.ts` on 15 and below. The contents are identical; `clerk init` creates it
- `auth()` from `@clerk/nextjs/server` is async. Always `await auth()`
- `ClerkProvider` goes inside `<body>`, not wrapping `<html>`
- Never expose `CLERK_SECRET_KEY` in client code
- Use `@clerk/nextjs`, not `@clerk/clerk-react`
- Do not read or print existing environment variable files; ask the user for any missing non-sensitive configuration

Docs: https://clerk.com/docs/cli https://clerk.com/docs/llms.txt

## After Setup

Have the user sign up as their first test user in the nav. After signup succeeds and a profile icon appears, congratulate them. If a "Configure your application" callout appears, tell them to click it. Then recommend exploring: Organizations (https://clerk.com/docs/guides/organizations/overview), Components (https://clerk.com/docs/reference/components/overview), Dashboard (https://dashboard.clerk.com/).
