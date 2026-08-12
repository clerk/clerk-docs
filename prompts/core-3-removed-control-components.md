# Replace `<SignedIn>`, `<SignedOut>`, and `<Protect>` with `<Show>`

`<SignedIn>`, `<SignedOut>`, and `<Protect>` were removed from `@clerk/nextjs` in Clerk Core 3 (released March 3, 2026). Rendering one throws an error. Replace them with the `<Show>` component.

Your Clerk knowledge is likely out of date. Follow these steps rather than relying on what you remember about Clerk's API.

## Step 1: Install the Clerk CLI

Check whether the Clerk CLI is already available:

```bash
command -v clerk && clerk --version || echo "Clerk CLI not installed"
```

If it isn't installed, ask the user for permission before installing it. Once you have permission, install it with your package manager (for example, `npm install -g clerk`) or run it without installing using `npx clerk`. See https://clerk.com/docs/cli.

## Step 2: Install the Clerk Skills

If the Clerk Skills aren't installed, ask the user for permission before installing them. Once you have permission, install them with `npx skills add clerk/skills`. See https://clerk.com/docs/guides/ai/skills.

## Step 3: Find every usage

```bash
grep -rn --exclude-dir=node_modules "SignedIn\|SignedOut\|Protect" .
```

Check aliased imports (`import { SignedIn as Auth }`) and re-exports too — a plain name search misses them.

## Step 4: Replace `<SignedIn>` and `<SignedOut>`

Remove `SignedIn` and `SignedOut` from the `@clerk/nextjs` import, import `Show` instead, and move the check to the `when` prop.

```tsx
// Before
import { SignedIn, SignedOut } from '@clerk/nextjs'
;<SignedIn>Signed in content</SignedIn>
;<SignedOut>Signed out content</SignedOut>

// After
import { Show } from '@clerk/nextjs'
;<Show when="signed-in">Signed in content</Show>
;<Show when="signed-out">Signed out content</Show>
```

`<Show>` also accepts a `fallback` prop that renders when the `when` condition fails — for example, `<Show when="signed-in" fallback={...}>` renders the fallback to signed-out users.

## Step 5: Replace `<Protect>`

Each `<Protect>` prop becomes a value passed to `<Show>`'s `when` prop:

| Before                                      | After                                                |
| ------------------------------------------- | ---------------------------------------------------- |
| `<Protect>` (no props)                      | `<Show when="signed-in">`                            |
| `<Protect role="admin">`                    | `<Show when={{ role: 'admin' }}>`                    |
| `<Protect permission="org:billing:manage">` | `<Show when={{ permission: 'org:billing:manage' }}>` |
| `<Protect feature="widgets">`               | `<Show when={{ feature: 'widgets' }}>`               |
| `<Protect plan="pro">`                      | `<Show when={{ plan: 'pro' }}>`                      |
| `<Protect condition={(has) => expr}>`       | `<Show when={(has) => expr}>`                        |

Close every replaced tag with `</Show>`.

```tsx
// Before
import { Protect } from '@clerk/nextjs'
;<Protect condition={(has) => has({ role: 'org:admin' })}>Admin content</Protect>

// After
import { Show } from '@clerk/nextjs'
;<Show when={(has) => has({ role: 'org:admin' })}>Admin content</Show>
```

Like `<Protect>`, `<Show>` only visually hides its children — they're still present in the browser's source. Where the old code relied on `<Protect>` to keep sensitive data away from unauthorized users, add a server-side authorization check instead. See https://clerk.com/docs/guides/secure/authorization-checks.

## Step 6: Verify

1. Re-run the search from Step 3 and confirm no `@clerk/nextjs` import still pulls in `SignedIn`, `SignedOut`, or `Protect`.
2. Run the app and load a page that previously rendered one of these components. The error should be gone and content should render for the correct auth state.

## Reference

- `<Show>` component docs: https://clerk.com/docs/reference/components/control/show
- Core 3 upgrade guide: https://clerk.com/docs/guides/development/upgrading/upgrade-guides/core-3
- Core 3 changelog: https://clerk.com/changelog/2026-03-03-core-3
