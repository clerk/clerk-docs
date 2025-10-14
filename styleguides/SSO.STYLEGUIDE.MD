# Clerk SSO Styleguide

These are the guidelines we use to write our SSO guides.

## Structure of the guide

- The frontmatter should be formatted as follows:

  ```mdx
  ---
  title: Add <SSO_PROVIDER> as a <SSO_TYPE> connection
  description: Learn how to allow users to sign up and sign in to your Clerk app with their <SSO_PROVIDER> account using <SSO_TYPE>.
  ---
  ```

- Needs a `<TutorialHero />` component
- The introductory sentence should be formatted as follows:

  ```mdx
  Enabling <TYPE_OF_SSO> with <SSO_PROVIDER> allows your users to sign up and sign in to your Clerk application with their <SSO_PROVIDER> account.
  ```

- **Social connection guides only** The instructions for **development** versus **production** should be formatted as follows:

  ```mdx
  ## Configure for your development instance

  For _development instances_, Clerk uses preconfigured shared OAuth credentials and redirect URIs—no other configuration is needed.

  ## Configure for your production instance

  For _production instances_, you must provide custom credentials.

  To make the setup process easier, it's recommended to keep two browser tabs open: one for the [Clerk Dashboard](https://dashboard.clerk.com/~/user-authentication/sso-connections) and one for your [<SSO_PROVIDER>](SSO_PROVIDER_URL).
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
