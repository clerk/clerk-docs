---
title: Integrate Convex with Clerk
description: Learn how to integrate Clerk into your Convex application.
---

<TutorialHero
  beforeYouStart={[
    {
      title: "Set up a Clerk application",
      link: "/docs/quickstarts/setup-clerk",
      icon: "clerk",
    },
    {
      title: "Create a React + Convex application",
      link: "https://docs.convex.dev/quickstart/react",
      icon: "react",
    },
  ]}
/>

Convex is the full-stack TypeScript development platform. With Convex you get to build a backend with a provided realtime database, file storage, text search, scheduling and more. Paired with Clerk's user authentication and management features, you can build a powerful application with minimal effort.

This tutorial assumes that you have already [set up a Clerk application](/docs/quickstarts/setup-clerk) and a [React + Convex application](https://docs.convex.dev/quickstart/react){{ target: '_blank' }}. This tutorial will also assume that you have not added Clerk to your application yet.

<Steps>
  ## Create a JWT template based on Convex

  In the Clerk Dashboard, navigate to the [**JWT templates**](https://dashboard.clerk.com/last-active?path=jwt-templates) page. Select the **New template** button to create a new template based on Convex.

  ![The JWT templates page in the Clerk Dashboard. The 'New template' button was clicked, and a pop up titled 'New JWT template' is shown. The 'Convex' template is hovered over](/docs/images/integrations/convex/jwt-templates.webp)

  Once the Convex template is created, you will be redirected to the template's page. You can now configure the template to your needs.

  ![The 'Create new template' page of the JWT templates page in the Clerk Dashboard](/docs/images/integrations/convex/create-template.webp)

  The Convex template will pre-populate the default audience (`aud`) claim required by Convex. You can include additional claims as necessary. [Shortcodes](/docs/backend-requests/jwt-templates#shortcodes) are available to make adding dynamic user values easy.

  ![The 'Create new template' page of the JWT templates page in the Clerk Dashboard. The page is scrolled down to the 'Claims' section](/docs/images/integrations/convex/template-shortcodes.webp)

  By default, Clerk will sign the JWT with a private key automatically generated for your application, which is what most developers use for Convex. If you so choose, you can customize this key.

  ## Configure Convex with the Clerk issuer domain

  The next step is to configure Convex with the issuer domain provided by Clerk. From your Clerk **JWT template** screen, find the **Issuer** input and click to **Copy** the URL.

  ![The 'Create new template' page of the JWT templates page in the Clerk Dashboard. There is a red box surrounding the 'Issuer' section](/docs/images/integrations/convex/template-issuer.webp)

  In your `convex` folder, add an `auth.config.js` file with the following configuration:

  ```ts {{ filename: 'convex/auth.config.js' }}
  export default {
    providers: [
      {
        domain: 'https://your-issuer-url.clerk.accounts.dev/',
        applicationID: 'convex',
      },
    ],
  }
  ```

  Replace the `domain` string with the **Issuer** URL you copied.

  ## Deploy your changes to Convex

  Run `npx convex dev` to automatically sync your configuration to your backend.

  ## Install `@clerk/clerk-react`

  Run the following command to install Clerk's React SDK:

  <CodeBlockTabs options={["npm", "yarn",  "pnpm" ]}>
    ```bash {{ filename: 'terminal' }}
    npm install @clerk/clerk-react
    ```

    ```bash {{ filename: 'terminal' }}
    yarn add @clerk/clerk-react
    ```

    ```bash {{ filename: 'terminal' }}
    pnpm add @clerk/clerk-react
    ```
  </CodeBlockTabs>

  ## Set environment variables

  In your React project's root folder, you may have an `.env` file alongside `package.json` and other configuration files. If you don't see it, create it.

  <SignedIn>
    Add your Clerk Publishable Key to your `.env` file. It can always be retrieved from the [**API keys**](https://dashboard.clerk.com/last-active?path=api-keys) page in the Clerk Dashboard.
  </SignedIn>

  <SignedOut>
    1. In the Clerk Dashboard, navigate to the [**API keys**](https://dashboard.clerk.com/last-active?path=api-keys) page.
    1. In the **Quick Copy** section, copy your Clerk Publishable Key.
    1. Paste your key into your `.env` file.

    The final result should resemble the following:
  </SignedOut>

  ```env {{ filename: '.env' }}
  VITE_CLERK_PUBLISHABLE_KEY={{pub_key}}
  ```

  ## Configure the Clerk and Convex providers

  Both Clerk and Convex have provider components that are required to provide authentication and client context.

  Clerk's provider component is `<ClerkProvider>`, which should wrap your entire app at the entry point to make authentication globally accessible. See the [reference docs](/docs/components/clerk-provider) for other configuration options.

  Convex offers a provider that is specifically for integrating with Clerk called [`<ConvexProviderWithClerk>`](https://docs.convex.dev/auth/clerk).

  The following example demonstrates how to configure Clerk and Convex's providers. Clerk's `useAuth()` hook must be passed to `<ConvexProviderWithClerk>` and Clerk's `<ClerkProvider>` must be wrapped around it.

  ```ts {{ filename: 'src/main.tsx' }}
  import React from 'react'
  import ReactDOM from 'react-dom/client'
  import App from './App'
  import './index.css'
  import { ClerkProvider, useAuth } from '@clerk/clerk-react'
  import { ConvexProviderWithClerk } from 'convex/react-clerk'
  import { ConvexReactClient } from 'convex/react'

  // Import your Publishable Key
  const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

  if (!PUBLISHABLE_KEY) {
    throw new Error('Missing Publishable Key')
  }

  const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string)

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ClerkProvider publishableKey={PUBLISHABLE_KEY}>
        <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
          <App />
        </ConvexProviderWithClerk>
      </ClerkProvider>
    </React.StrictMode>,
  )
  ```

  ## Access user identity in Convex queries and mutations

  You can access the user information from the JWT in Convex queries and mutations.
  Use the `ctx.auth.getUserIdentity()` which returns the parsed information from the JWT, or `null` if the client isn't authenticated.

  ```ts
  import type { UserIdentity } from 'convex/server'
  import { query } from './_generated/server'

  export default query(async (ctx) => {
    const user = await ctx.auth.getUserIdentity()

    if (user === null) {
      return null
    }

    return user.tokenIdentifier
  })
  ```

  You can customize the information in the JWT by navigating to the [**JWT templates**](https://dashboard.clerk.com/last-active?path=jwt-templates) page in the Clerk Dashboard. Previously, Convex explicitly listed fields derived from [OpenID standard claims](https://openid.net/specs/openid-connect-core-1_0.html#StandardClaims). Now, Convex allows keys to accept [custom claims](https://docs.convex.dev/api/interfaces/server.UserIdentity).

  ## Finished!

  You now have a fully functioning React and Convex application with Clerk authentication. Be aware that Convex may require usage of their custom hooks and methods rather than Clerk's, such as using Convex's `useConvexAuth()` hook instead of Clerk's `useAuth()` hook in some cases. For more information on how to use Convex with Clerk, see the [Convex docs](https://docs.convex.dev/auth/clerk).
</Steps>
