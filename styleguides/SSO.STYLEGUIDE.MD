# Clerk SSO Styleguide

These are the guidelines we use to write our SSO guides.

## Structure of the guide

- The frontmatter should be formatted as follows:

  ```mdx
  ---
  title: Add <SSO_PROVIDER> as a <SSO_TYPE> connection
  description: Learn how to allow users to sign up and sign in to your Clerk application with their <SSO_PROVIDER> account using <SSO_TYPE>.
  ---
  ```

- Needs a `<TutorialHero />` component
- The introductory sentence should be formatted as follows:

  ```mdx
  Enabling <TYPE_OF_SSO> with [<SSO_PROVIDER>](SSO_PROVIDER_OAUTH_URL) allows your users to sign up and sign in to your Clerk app with their <SSO_PROVIDER> account.
  ```

- **Social connection guides only** The instructions for **development** versus **production** should be formatted as follows:

  ```mdx
  ## Configure for your development instance

  For _development instances_, Clerk uses preconfigured shared OAuth credentials and redirect URIs—no other configuration is needed.

  ## Configure for your production instance

  For _production instances_, you must provide custom credentials.

  Keep two browser tabs open during setup: one for the [Clerk Dashboard](https://dashboard.clerk.com/~/user-authentication/sso-connections) and one for your [<SSO_PROVIDER>](SSO_PROVIDER_URL).
  ```

- Use `<Steps />` to lay out the steps
- For the "Set the Client ID and Client Secret in the Clerk Dashboard" step, it can be formatted in one of two ways:

  1. With a partial. Use this method if the provider uses "Client ID" and "Client Secret" for their terminology.

     ```mdx
     ### Set the Client ID and Client Secret in the Clerk Dashboard

     <Include src="_partials/authentication/social-connections/set-client-id-secret" />
     ```

  1. With a full step. Use this method if the provider uses a different terminology, such as "Key" instead of "Client ID". Note how the title of the section and the copy of the first step depends on the terminology.

     ```mdx
     ### Set the Key and Client Secret in the Clerk Dashboard

     1. Navigate back to the Clerk Dashboard where the modal should still be open. Paste the **Key** and **Client Secret** values that you saved into the respective fields.
     1. Select **Add connection**.

     > [!NOTE]
     > If the modal or page is no longer open, navigate to the [**SSO connections**](https://dashboard.clerk.com/~/user-authentication/sso-connections) page in the Clerk Dashboard. Select the connection. Under **Use custom credentials**, paste the values into their respective fields.
     ```

- The `Test your connection` section should be included in the `<Steps />` and formatted as follows:

  ```mdx
  ### Test your connection

  <Include src="_partials/authentication/social-connections/test-your-connection" />
  ```

## No screenshots: writing copy that references the UI

Screenshots should be used little to none in the docs. The instructions should be explicit and include all necessary details without the need for a visual reference. The instructions should be laid out as numbered lists to make the content more palatable to readers. Links should be added on their first reference.

> ❌ In the example below, the instructions are not explicit, as it tells the reader to select **Microsoft** but doesn't specify where to find it.

```mdx
1. In the Clerk Dashboard, navigate to the [**SSO connections**](https://dashboard.clerk.com/~/user-authentication/sso-connections) page.
1. Select **Add connection**.
1. Select **For all users**.
1. Select **Microsoft**.
```

> ✅ In the example below, the instructions are explicit and include all necessary details without the need for a visual reference.

```mdx
1. In the Clerk Dashboard, navigate to the [**SSO connections**](https://dashboard.clerk.com/~/user-authentication/sso-connections) page.
1. Select **Add connection** and select **For all users**.
1. In the **Choose provider** dropdown, select **Microsoft**.
1. Select **Add connection**.
```

## Writing about redirects

If the step ends with a redirect, include the redirect instructions in the step.

> ❌

```mdx
1. Select **New application**.
1. In the **<SSO_PROVIDER_DASHBOARD>**, select **Create your own application**.
```

> ✅

```mdx
1. Select **New application**. You'll be redirected to the <SSO_PROVIDER_DASHBOARD>.
1. Select **Create your own application**.
```

## Page vs. tab

Assume users are opening windows versus browser tabs. Use active voice (e.g., "keep" vs. "leave).

> ❌ The first example is wrong because it uses "leave" instead of "keep" and "tab" instead of "page."

```mdx
Leave the tab open.
```

> ✅ This example is correct because it uses "keep" and "page".

```mdx
Keep the page open.
```

## Complete vs. fill out

> ❌

```mdx
Fill out the form as follows
```

> ✅

```mdx
Complete the form as follows
```

## Updating the social connection guide validation

`scripts/check-social-connection-guides.ts` validates active provider guides against the stable, mechanically
checkable conventions in this style guide. It discovers active providers from the **All providers** group in
`docs/manifest.json`; entries tagged `deprecated`, such as `twitter.mdx`, are intentionally skipped.

When the shared template changes:

1. Update this style guide and every active provider guide to the new convention.
2. Update the validator and its focused failure fixture in `scripts/check-social-connection-guides.test.ts` when the
   convention is objective enough to validate without false positives.
3. Keep the provider's OAuth/OIDC documentation URL current in `PROVIDERS`. If a provider cannot follow the shared
   convention, add the smallest possible override to that provider's entry and explain why. A title override must
   include the current manifest label so a navigation rename cannot silently change the validator's expectation.
   Custom credential steps must use an ordered list under their declared heading. Do not exempt an entire guide or rule
   when a protocol, display-name, or structural override is sufficient.
4. From `clerk-docs/`, run:

   ```sh
   pnpm lint:check-social-connection-guides
   pnpm exec vitest run scripts/check-social-connection-guides.test.ts
   ```

The validator covers shared frontmatter, `TutorialHero`, introduction, environment sections, `<Steps>`, credential and
test steps, heading depth, screenshots, and accessibility-language conventions. Contextual guidance—such as whether a
redirect instruction is explicit enough—still requires human review.

The validator checks structure and the exact strings this style guide gives as templates: titles, headings, required
partials, link text and URLs, and where each section sits. It doesn't judge the wording of provider-specific
instructions, such as whether a credential step names the right fields. Add a rule only when valid guides can't trip
it; anything that depends on reading the instruction belongs in review.

The validator parses YAML and MDX rather than searching the raw file. Quoted or folded frontmatter values are valid,
and examples or wording inside code blocks and MDX comments do not satisfy or violate guide rules. Custom credential
headings must be declared in `PROVIDERS` with whether they use the shared credential partial.
