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

  In _production instances_, you must provide custom credentials, which involves generating your own **Client ID** and **Client Secret** using your Microsoft Entra ID account.

  To make the setup process easier, it's recommended to keep two browser tabs open: one for your [Clerk Dashboard](https://dashboard.clerk.com/last-active?path=user-authentication/sso-connections) and one for your [Microsoft Azure portal](https://portal.azure.com).
  ```

- Use `<Steps />` to lay out the steps
- The `Test your OAuth` section should be included in the `<Steps />` and formatted as follows:

  ```mdx
  ### Test your OAuth

  The simplest way to test your OAuth is to visit your Clerk application's [Account Portal](/docs/customization/account-portal/overview), which is available for all Clerk applications out-of-the-box.

  1. In the Clerk Dashboard, navigate to the [**Account Portal**](https://dashboard.clerk.com/last-active?path=account-portal) page.
  1. Next to the **Sign-in** URL, select **Visit**. The URL should resemble:

  - **For development** – `https://your-domain.accounts.dev/sign-in`
  - **For production** – `https://accounts.your-domain.com/sign-in`

  1. Sign in with your <INSERT_PROVIDER> account.
  ```

## No screenshots: writing copy that references the UI

Screenshots should be used little to none in the docs. The instructions should be explicit and include all necessary details without the need for a visual reference. The instructions should be laid out as numbered lists to make the content more palatable to readers. Links should be added on their first reference.

### Do

```mdx
1. In the Clerk Dashboard, navigate to the [**SSO Connections**](https://dashboard.clerk.com/last-active?path=user-authentication/sso-connections) page.
1. Select **Add connection** and select **For all users**.
1. In the **Choose provider** dropdown, select **Microsoft**.
1. Select **Add connection**.
```

### Don't

In this example, the instructions are not explicit, as it tells the reader to select **Microsoft** but doesn't specify where to find it.

```mdx
1. In the Clerk Dashboard, navigate to the [**SSO Connections**](https://dashboard.clerk.com/last-active?path=user-authentication/sso-connections) page.
1. Select **Add connection**.
1. Select **For all users**.
1. Select **Microsoft**.
```

## Bold proper nouns

Bold proper nouns found in the UI, such as titles, headings, product names, etc.

An exception to this rule is the Clerk Dashboard, which doesn't need to be bolded to enforce consistency across the docs.

### Do

```mdx
In the **Azure services** section, select **Microsoft Entra ID**.
```

### Don't

```mdx
In the Azure services section, select Microsoft Entra ID.
```

## Writing about redirects

If the step ends with a redirect, include the redirect instructions in the step.

### Do

1. Select **New application**. You'll be redirected to the **Browse Microsoft Entra Gallery** page.
1. Select **Create your own application**.

### Don't

1. Select **New application**.
1. In the **Browse Microsoft Entra Gallery** page, select **Create your own application**.

## Component naming

The proper names for the components are:

- Panel = drawer
- Modal = popup
- Dropdown

## Use conjunctions

Use conjunctions in the copy to make it more natural.

### Do

"You'll"

### Don't

"You will"

## Avoid using "button"

### Do

```mdx
1. Select **New client secret**.
```

### Don't

```mdx
1. Select the **New client secret** button.
```

## Avoid using "click"

### Do

```mdx
1. Select **New client secret**.
```

### Don't

```mdx
1. Click **New client secret**.
```

## Avoid using "appears"

### Do

```mdx
In the panel that opens
```

### Don't

```mdx
In the panel that appears
```

## Application vs. app

Use "application" for the first instance where it's used, and then use "app" for the rest of the guide.

## Redirected to vs. taken to

Use "redirected to" instead of "taken to".

### Do

```mdx
On this same page, under **Client credentials**, select **Add a certificate or secret** to generate a Client Secret. You'll be redirected to the **Certificate & secrets** page.
```

### Don't

```mdx
On this same page, under **Client credentials**, select **Add a certificate or secret** to generate a Client Secret. You'll be taken to the **Certificate & secrets** page.
```

## Page vs. Tab

Assume users are opening windows versus browser tabs. Use active voice, e.g. "keep" instead of "leave".

### Do

```mdx
Keep the page open.
```

### Don't

```mdx
Leave the page open.
```

```mdx
Leave the tab open.
```

## Complete vs. Fill out

### Do

```mdx
Complete the form as follows
```

### Don't

```mdx
Fill out the form as follows
```
