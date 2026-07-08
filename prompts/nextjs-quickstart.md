# Add Clerk Authentication to Next.js

Set up Clerk authentication in this Next.js project with the Clerk CLI.

## Quick Setup

Before running any commands, present the user with a preliminary setup checklist:

```
Here's what I'll do to get you set up with Clerk.

1. Install or update the Clerk CLI
2. Sign in to Clerk (opens your browser)
3. Set up Clerk in this project, or scaffold a new Next.js app with Clerk if this directory is empty
4. Start your app with Clerk installed.

Shall I proceed?
```

## Step 1: Install or update the Clerk CLI

From the project root, check whether the Clerk CLI is already available:

```bash
command -v clerk && clerk --version || echo "Clerk CLI not installed"
```

If `clerk` is available, make sure it is up to date:

```bash
clerk update --yes
```

If `clerk` is not available, install the latest version using the user's preferred install method. If they do not have a preference, use npm:

```bash
npm install -g clerk
```

If the user prefers pnpm, yarn, bun, Homebrew, or curl, use the equivalent global install command.

## Step 2: Sign in to Clerk

Immediately after installing or updating the Clerk CLI, from the project root, run:

```bash
clerk auth login
```

`clerk auth login` is the first command to run after install or update. Do not list apps, ask which Clerk app to use, or run `clerk init` before authenticating. It is okay for an agent to run this command and pause while the user completes the Clerk login flow, then continue from the CLI output. If the user is already signed in, continue to initialization.

## Step 3: Initialize Clerk

If this is an existing Next.js project, run:

```bash
clerk init
```

`clerk init` is the default setup action after `clerk auth login`. It detects the framework and package manager, installs the correct Clerk SDK, and applies Next.js-specific setup such as providers, middleware, auth routes, and environment configuration. Do not pass `--framework` or `--pm` for existing projects unless the user explicitly wants to override detection or the CLI asks for those values. Do not list apps or ask which Clerk app to use before running it.

If the directory is empty, ask the user which package manager they want to use. If they have no preference, use npm. Then scaffold a fresh Next.js app:

```bash
clerk init --framework next --pm <package-manager>
```

If the directory has no project yet but contains a leftover lockfile or package manager config, use these signals to choose the package manager instead of asking:

- `pnpm-lock.yaml` → `pnpm`
- `yarn.lock` → `yarn`
- `bun.lock` or `bun.lockb` → `bun`
- `package-lock.json` → `npm`

Do not add `--app` by default. Only pass `--app <application_id>` when the user already provided an app ID or explicitly wants to link this project to a specific existing Clerk application:

```bash
clerk init --app <application_id>
```

Do not choose a Clerk application for the user. Only list available apps if the user explicitly wants to link to an existing Clerk application but has not provided an app ID, or if `clerk init` explicitly asks for an existing application ID:

```bash
clerk apps list --json
```

Show the user the app names and application IDs, then ask which app to use.

## Step 4: Fall back to manual setup when init is incomplete

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

After `clerk init` completes, run:

```bash
clerk doctor
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

- Name the middleware file by the `next` version in `package.json`: `proxy.ts` on Next.js 16+, `middleware.ts` on 15 and below. The contents are identical
- `auth()` from `@clerk/nextjs/server` is async. Always `await auth()`
- `ClerkProvider` goes inside `<body>`, not wrapping `<html>`
- Never expose `CLERK_SECRET_KEY` in client code
- Use `@clerk/nextjs`, not `@clerk/clerk-react`
- Do not read or print existing environment variable files; ask the user for any missing non-sensitive configuration

Docs: https://clerk.com/docs/cli https://clerk.com/docs/llms.txt

## After Setup

Have the user sign up as their first test user in the nav. After signup succeeds and a profile icon appears, congratulate them. If a "Configure your application" callout appears, tell them to click it. Then recommend exploring: Organizations (https://clerk.com/docs/guides/organizations/overview), Components (https://clerk.com/docs/reference/components/overview), Dashboard (https://dashboard.clerk.com/).
