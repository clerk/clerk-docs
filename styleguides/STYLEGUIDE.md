# Clerk Docs Styleguide

These are the guidelines we use to write our docs.

## Content (grammar/structure)

### Alphabetize

Try to keep things in alphabetic order, except our most popular SDKs are prioritized first: Next.js, React, Expo, TanStack React Start, React Router, and Express. For example, our SDK selector prioritizes these SDKs in this order, and then alphabetizes the rest. Another example is that whenever there is a `<Tabs items={[]}>` component, the `items` should follow this same rule.

### De-dupe reference links and tooltips

When mentioning a documented component, function, etc, multiple times on a page, link to the reference documentation on the **first mention** of that item. The exception to this rule is when the reference is mentioned under a different heading. In that case, link to the reference documentation again.

> ❌
> The [`currentUser()`](https://clerk.com/docs/references/nextjs/current-user) helper will return the [`User`](https://clerk.com/docs/references/javascript/user) object of the currently active user. The following example uses the [`currentUser()`](https://clerk.com/docs/references/nextjs/current-user) helper to access the [`User`](https://clerk.com/docs/references/javascript/user) object for the authenticated user.

> ✅
> The [`currentUser()`](https://clerk.com/docs/references/nextjs/current-user) helper will return the [`User`](https://clerk.com/docs/references/javascript/user) object of the currently active user. The following example uses the `currentUser()` helper to access the `User` object for the authenticated user.

This same rule applies to tooltips.

### Use sentence-case for titles

> ❌
> How to Set up Custom Pages

> ✅
> How to set up custom pages

### Use backticks for component references in MDX page titles

When writing titles that contain component references in MDX pages, wrap the component name in backticks and escape any angle brackets.

> ❌
> title: '<RedirectToOrganizationProfile />'
> title: <RedirectToOrganizationProfile />

> ✅
> title: '`<RedirectToOrganizationProfile />`'

### When referring to Next.js proper nouns, follow Next.js's capitalization conventions

"Middleware," "Server Actions," "Server Components," "Route Handlers" are capitalized in the Next.js docs and in Clerk's docs where referring to a Next.js project or code.

> ❌
> Add it to your app's middleware.

> ✅
> Add it to your app's Middleware.

### Capitalize Clerk feature proper nouns

Clerk's own product and feature names are proper nouns — capitalize them consistently. This follows the same reasoning as the Next.js convention above. Use judgment; this isn't an exhaustive list, but when a name refers to a specific Clerk feature, treat it as a proper noun.

Terms treated as proper nouns include: Agent Task, Billing, Feature, Membership Request, Organization, Organization ID (when it refers to a Clerk Organization's ID, e.g., `org_xxx`), Permission, Plan, Role, Role Set, and Subscription.

> ❌
> Create an agent task to test your authentication flows.

> ✅
> Create an Agent Task to test your authentication flows.

Keep lowercase:

- **Generic usage**, where the word doesn't refer to the Clerk feature. For example, "your organization's directory service" (the reader's company), "billing information" (payment details like invoices and payment methods), and Clerk's own pricing tiers ("the Hobby plan", "the application's Clerk plan").
- **Bold UI labels** that mirror Clerk Dashboard text exactly, even when the Dashboard uses lowercase. For example, **Create first organization automatically**.
- **Component-rendered text**, such as button labels and default values. For example, the `<OrganizationSwitcher />` component's "Create an organization" button and the "My organization" fallback name.
- **Code**, including inline code, code blocks, prop values, string literals, URL paths, and API field or parameter names.
- **`invitation(s)`, `membership(s)`, and `webhook(s)`**, which aren't treated as feature proper nouns, even in phrases like "Organization invitation", "Organization membership", and "webhook event". Note that "Membership Request" _is_ a proper noun, per the list above.
- **Compound adjectives** built on industry terms, like "role-based access control".

The docs build enforces the unambiguous collocations of these terms (e.g., "organization domains", "membership requests", "role sets", "agent tasks") as a hard failure — in prose, headings, link anchors, frontmatter titles and descriptions, and manifest nav titles, while honoring the exceptions above. Standalone words like "organization" or "billing" are deliberately not flagged, because generic usage is common — those remain judgment calls for authors and reviewers.

### Use "sign in" instead of "log in"

Use "sign in" and "sign out" rather than "log in" or "log out".

> ❌
> `<SignInButton />` creates a button that allows users to log into your Clerk application.

> ✅
> `<SignInButton />` creates a button that allows users to sign into your Clerk application.

### Write out abbreviations when introducing them

If you want to abbreviate a term in your article, write it out fully first, then put the abbreviation in parentheses. If you want to make an abbreviation plural treat them as regular words, e.g., APIs, IDEs or OSes.

> ❌
> An AST is a tree representation of code. AST's are a fundamental part of the way a compiler works.

> ✅
> An abstract syntax tree (AST) is a tree representation of code. ASTs are a fundamental part of the way a compiler works.

### Use a comma after "e.g." and "i.e."

Always follow `e.g.` and `i.e.` with a comma. Keep both periods; don't drop them or replace them with "eg"/"ie". This rule applies to prose and to comments within code examples, but not to code itself (identifiers, string values, etc.).

> ❌
> Pass a unique identifier, e.g. a user ID.

> ✅
> Pass a unique identifier, e.g., a user ID.

### Avoid "we/us/our/ours"

We refer to the reader with "you/your/yours." We objectively refer to Clerk as "Clerk," not "we/us/our/ours."

> ❌
> Our `<ClerkProvider>` provides active session and user context to our hooks and other components. Let's import it into our app by adding `import { ClerkProvider } from '@clerk/nextjs'` at the top of the file.

> ✅
> Clerk's `<ClerkProvider>` provides active session and user context to Clerk's hooks and other components. Import it into your app by adding `import { ClerkProvider } from '@clerk/nextjs'` at the top of your file.

### Use contractions

Use contractions in the copy to make the copy more colloquial.

> ❌
> "You will"

> ✅
> "You'll"

### Avoid gerunds (-ing words)

English gerunds ("-ing" words like "running") turn verbs into nouns ("run" becomes "running"). This makes the sentence sound passive ("They run" becomes "they are running") and makes it harder to translate. Use an active voice as much as possible and avoid these words.

> ❌
> Using a routing library with Clerk

> ✅
> How to use a routing library with Clerk

### Lead with location; end with action.

When learners are performing an order of operations, it helps for them to start with _where_ they need to be to perform the action.

> ❌
> Open your `.env file` in your Next.js project's folder.

> ✅
> In your Next.js project's root folder, open your `.env file`.

### Use an active voice vs. passive voice

Use active verbs that put the reader in the first person instead of passive verbs; "be" verbs that describe the learners actions as a state of being, like "is/was/to be".

> ❌
> The `proxy.ts` file should be created in the root folder of your application or inside `src/` if that is how you set up your app.

> ✅
> Create the `proxy.ts` file in the root folder of your application or inside the `src/` if that is how your app is set up.

> ❌
> User session and data

> ✅
> Read user session and data

### Bold proper nouns

Bold proper nouns found in the UI, such as titles, headings, product names, etc.

An exception to this rule is "the Clerk Dashboard", which doesn't need to be bolded because it's referenced often in the docs and we want to avoid too much visual noise.

> ❌

```mdx
In the Azure services section, select Microsoft Entra ID.
```

> ✅

```mdx
In the **Azure services** section, select **Microsoft Entra ID**.
```

### Component naming

The proper names for the components are:

- Dashboard: refers to a control panel or central hub where users can interact with multiple tools or view data
- Panel: drawer
- Modal: popup
- Dropdown

### Application vs. app

Use "application" for the first instance where it's used and then "app" for the rest of the guide.

### Redirected to vs. taken to

Use "redirected to" instead of "taken to."

> ❌

```mdx
On this same page, under **Client credentials**, select **Add a certificate or secret** to generate a Client Secret. You'll be taken to the **Certificate & secrets** page.
```

> ✅

```mdx
On this same page, under **Client credentials**, select **Add a certificate or secret** to generate a Client Secret. You'll be redirected to the **Certificate & secrets** page.
```

### Ensure vs. make sure

Use "ensure" instead of "make sure."

> ❌
> Make sure you have the correct permissions.

> ✅
> Ensure you have the correct permissions.

### Prebuilt vs. pre-built

Use "prebuilt" instead of "pre-built."

> ❌
> Clerk's pre-built components handle authentication and user management for you.

> ✅
> Clerk's prebuilt components handle authentication and user management for you.

### Sidenav vs. sidebar

Use "sidenav" instead of "sidebar."

> ❌
> In the left sidebar, select **Users**.

> ✅
> In the left sidenav, select **Users**.

### Syntax for code example explanations

Code examples should always have an explanation preceding them. Typically, they begin with something along the lines of "The following example demonstrates..."

> ❌ You might have already configured `<ConvexProvider>`. Ensure that `<ClerkProvider>` wraps `ConvexProviderWithClerk` and that `useAuth` is passed to `ConvexProviderWithClerk`.

> ✅ The following example demonstrates how to configure Clerk and Convex's providers. Clerk's `useAuth()` hook must be passed to `<ConvexProviderWithClerk>` and Clerk's `<ClerkProvider>` must be wrapped around it.

### List item punctuation

When list items are full sentences, end with a period.

> ❌
>
> - Click **Save**
> - The system sends you a confirmation email

> ✅
>
> - Click **Save**.
> - The system sends you a confirmation email.

When list items aren't full sentences, don't use a period.

> ❌
>
> - Name.
> - Email.
> - Password.

> ✅
>
> - Name
> - Email
> - Password

## Error pages

Error pages document a single error that a Clerk SDK or CLI prints, reached from a URL in the thrown message rather than the sidenav. Assume the reader arrived from their terminal, mid-problem, and has already lost time. The pattern is modeled on [Next.js's `errors/` directory](https://github.com/vercel/next.js/tree/canary/errors).

### Where error pages live and how they're reached

Error pages live at `docs/reference/<sdk>/errors/<slug>.mdx`. Clerk prints a stable `https://clerk.com/err/<slug>` URL in the error, and a redirect in `redirects/general.jsonc` (`permanent: false`) sends that URL to the page, so the docs path can change without breaking the printed link.

Leave error pages out of `manifest.json` — the reader reaches them from the error, not the sidenav. This is the one exception to the rule that every doc gets a manifest entry. Add the file to `ignoreWarnings.docs` in `scripts/build-docs.ts` so the `doc-not-in-manifest` warning stays quiet.

### Frontmatter

- `title` — the error's identifying text, matching what the reader pastes into a search bar. Drop the trailing `Learn more at <url>` sentence and anything templated, like a component name or file path. Don't rewrite it into SEO prose. The exact-string match is the point.
- `description` — required. It's the search snippet.

### Lead with the verbatim error

Open the page body with the error exactly as Clerk emits it, in a fenced code block:

````mdx
---
title: 'Clerk: `<SignedIn>` is not available in @clerk/nextjs Core 3'
description: Learn why SignedIn was removed in Core 3 and how to replace it with Show.
---

```text
Clerk: <SignedIn> is not available in @clerk/nextjs Core 3. Learn more at https://clerk.com/err/signedin-is-not-available-in-clerk-nextjs.
```
````

The title is the searchable summary; this block is the literal text, link and all. When one thrown message covers several distinct strings — one per component, say — give each its own page so each carries its own verbatim block, rather than making the title or body dynamic.

### Sections, in order

1. `## Why this occurred` — the state that produced the error. The heading omits "error" on purpose, so the same one serves errors, warnings, and messages.
2. `## Ways to fix this` — give each fix its own `### <fix name>` only when an error has more than one _alternative_ fix, meaning approaches the reader chooses between. Open each with who it's for ("Choose this when…") so they can pick without reading all of them. A single fix, or sequential steps, needs no `###` and no "Choose this when". Add `Trade-off` or `Gotchas` under a fix only when they exist.
3. `## Verify the fix` — optional. Include when the fix is silent or easy to get half-right.
4. `## Additional resources` — optional.

### Scale to the error

Most error pages are short — a reason and one fix. Reach for the full structure only when an error genuinely has several distinct fixes. Don't pad.

### Agent-oriented remediation (optional)

When an error is one AI agents commonly cause — outdated training data, a removed API — the agent that wrote the code won't read the page. Point the fix at the tools instead: an `<LLMPrompt>` block linking a prompt in `prompts/`, and an agent-first "Migrate with an agent (recommended)" fix that installs the [Clerk CLI](/docs/cli) and [Clerk Skills](/docs/guides/ai/skills). Use these only when the error is agent-caused. If the pattern proves out across more pages, promote it from optional to expected.

## Accessibility

### Do not assume proficiency

Avoid using language that assumes someone's level of proficiency. Something that is difficult for someone new to programming may not be difficult for a senior engineer. This language can inadvertently alienate or insult a learner. Avoid words like "just", "easy", "simple", "senior", "hard".

Use as little [jargon](https://dictionary.cambridge.org/dictionary/english/jargon) as necessary. Describe jargon in parentheses on first reference or link to a trusted definition.

> ❌
> It's _easy_ to authenticate your app with Clerk!

> ✅
> You can authenticate your app with Clerk in three steps.

> ❌
> Clerk works great with PWA as it supports offline mode.

> ✅
> Clerk supports offline mode, a feature that lets users use an app without being connected to data or wifi.

### Avoid "click"

"Click" is an outdated term that assumes the learner is using a mouse. But learners may be navigating by touchscreen, keyboard, or assistive technology. Often there are better words than "click", like "select" and "open".

> ❌
> Click the **Settings tab.**
>
> Click the **Google** social connection.

> ✅
> Open the **Settings tab.**
>
> Select the **Google** social connection.

### Avoid using "button"

> ❌ Select the **New client secret** button.

> ✅ Select **New client secret**.

### Use descriptive anchor text

Always anchor hyperlinks with relevant, keyword-rich anchor text. Do not use "here" or "this page" as anchor text for links. Vague anchor text gives no context out of the surrounding sentence, which is a problem for people scanning the page or navigating by screen reader.

> ❌ Read the complete documentation [here](/docs/guides/development/testing/test-organization-domains).

> ✅ Read the complete [Test Organization domains](/docs/guides/development/testing/test-organization-domains) documentation.

Keep call-to-action verbs like "Learn more" or "Read more" outside the link, and anchor only the descriptive keywords. The anchor text is what a screen reader announces in a list of links and what search engines read as a signal about the destination, so a leading "Learn more" adds noise and buries the keywords.

> ❌ [Learn more about multi-session applications](/docs/guides/secure/session-options#multi-session-applications).

> ✅ Learn more about [multi-session applications](/docs/guides/secure/session-options#multi-session-applications).

This is enforced by the docs build, which fails on vague anchor text ("here", "this page", "this guide", "this section", "this article", "this document", "this doc") and on anchors that lead with a call to action ("Learn more", "Read more", "See more", "Find out more", "Click here").

### Use consistent link targets

A link's destination decides whether it opens in a new tab, not the author. The site's link component opens external `http(s)` links in a new tab (with the external-link icon) and internal links in the same tab, so an explicit `{{ target: '_blank' }}` annotation is almost never needed. Unexpected new tabs disorient readers — especially those using screen readers — and a redundant annotation is noise.

The one exception is API reference links (`/docs/reference/frontend-api...`, `/docs/reference/backend-api...`, and `/docs/reference/platform-api...`): they're internal, so they never open in a new tab automatically, but they should — readers use them as a lookup while following a guide and shouldn't lose their place. Annotate them explicitly.

The build fails on violations of any of these three rules, in authored content and generated Typedoc reference content alike. Typedoc files are generated, so fix their links upstream in [clerk/javascript](https://github.com/clerk/javascript) rather than hand-editing them. Classify those links by their rendered destination, not their source URL: JSDoc uses absolute `https://clerk.com/docs/...` URLs, which Typedoc rewrites to internal `/docs/...` links — so an API reference link in JSDoc still needs the annotation even though its source URL starts with `https://`.

> ❌ Internal link forced into a new tab: See the [`Session`](/docs/reference/objects/session){{ target: '_blank' }} object.

> ✅ Internal links open in the same tab: See the [`Session`](/docs/reference/objects/session) object.

> ❌ API reference link left to open in the same tab: Use the [Backend API](/docs/reference/backend-api).

> ✅ API reference links are explicitly annotated: Use the [Backend API](/docs/reference/backend-api){{ target: '_blank' }}.

> ❌ Redundant annotation on an external link: Open the [Clerk Dashboard](https://dashboard.clerk.com){{ target: '_blank' }}.

> ✅ External links open in a new tab automatically: Open the [Clerk Dashboard](https://dashboard.clerk.com).

## Code

### Use monospace fonts for code, commands, file names, and URLs

> ❌
> Copy the environment variables to your .env file.

> ✅
> Copy the environment variables to your `.env` file.

> ❌
> In your browser, open http://localhost:3000/.

> ✅
> In your browser, open [`http://localhost:3000/`](http://localhost:3000/).

### Wrap component references in the appropriate tags

Component references should be wrapped in `< />` if they are self closing. Otherwise, they should be wrapped in `< >`.

> ❌
> Use the `<SignIn/>` component.

> ❌
> Use the "SignIn component".

> ❌
> Use the `SignIn` component.

> ❌
> Use the `<SignIn>` component.

The last case is incorrect because the `<SignIn />` component will never wrap children, and therefore, should have a self-closing tag.

> ✅
> Use the `<SignIn />` component.

### Specify syntax and filename for terminal commands

If the code should run in a terminal, set the code block's syntax highlighting and filename with `sh {{ filename: 'terminal' }}`.

> ❌

````
​```
npm i @clerk/nextjs
​```
````

> ✅

````
​```sh {{ filename: 'terminal' }}
npm i @clerk/nextjs
​```
````

### Use angle brackets for placeholders in shell commands

When a shell command contains a value the reader must substitute, write the placeholder as `<snake_case_name>` with a descriptive name. Don't use curly braces — they collide with literal JSON in the same command and read as OpenAPI path-template syntax — and don't use generic names like `<id>` when a specific one fits. Angle brackets also match the CLI's own `--help` output.

> ❌
> Run `npx clerk@latest api /domains/{domain_id} -X PATCH -d '{"proxy_url": "..."}'`.

> ✅
> Run `npx clerk@latest api /domains/<domain_id> -X PATCH -d '{"proxy_url": "..."}'`.

### Pass properties to components; parameters to functions

Be sure to use the correct term with components vs functions.

> ❌
> The `<SignUp />` component accepts the `signUpProps` parameter. The `buildUrlWithAuth()` function accepts the `to` property.

> ✅
> Pass the `signUpProps` property to `<SignUp />`. `buildUrlWithAuth()` accepts a `string` for the `to` parameter.

## Page navigation

### Provide users with clear instructions and a direct link when navigating the Clerk Dashboard

When instructing learners to perform an operation in the Clerk Dashboard, begin with "In the Clerk Dashboard" and end with a link to the page you're directing them to using this URL syntax: **`https://dashboard.clerk.com/~/PAGE`**

> ❌
> Go to **User & Authentication** in your dashboard.

> ✅
> In the Clerk Dashboard, navigate to the [**User & Authentication**](https://dashboard.clerk.com/~/user-authentication) page.

> ❌
> Find fallback redirects in the Redirect tab on the Account Portal in the Clerk Dashboard.

> ✅
> To specify the fallback redirects, in the Clerk Dashboard, go to the **[Account Portal](https://dashboard.clerk.com/~/account-portal)** page and open the **Redirects** tab.

### Avoid using "appears"

> ❌
> A modal will appear.

> ✅
> A modal will open.

### Address the top of the Clerk Dashboard

> ❌
> In the top navigation bar of the Clerk Dashboard, select [**Users**](https://dashboard.clerk.com/~/users).

> ✅
> At the top of the Clerk Dashboard, select [**Users**](https://dashboard.clerk.com/~/users).
