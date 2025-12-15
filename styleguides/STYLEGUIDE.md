# Clerk Docs Styleguide

These are the guidelines we use to write our docs.

## Content (grammar/structure)

### Alphabetize

Try to keep things in alphabetic order, except Next.js, React, and JavaScript are prioritized as these are our core SDKs. For example, our SDK selector prioritizes Next.js, React, and Javascript, and then alphabetizes the rest of the SDK's. Another example is that whenever there is a `<Tabs items={[]}>` component, the `items` should follow this same rule.

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

### Use "sign in" instead of "log in"

Use "sign in" and "sign out" rather than "log in" or "log out".

> ❌
> `<SignInButton />` creates a button that allows users to log into your Clerk application.

> ✅
> `<SignInButton />` creates a button that allows users to sign into your Clerk application.

### Write out abbreviations when introducing them

If you want to abbreviate a term in your article, write it out fully first, then put the abbreviation in parentheses. If you want to make an abbreviation plural treat them as regular words, e.g. APIs, IDEs or OSes.

> ❌
> An AST is a tree representation of code. AST's are a fundamental part of the way a compiler works.

> ✅
> An abstract syntax tree (AST) is a tree representation of code. ASTs are a fundamental part of the way a compiler works.

### Avoid "we/us/our/ours"

We refer to the reader with "you/your/yours." We objectively refer to Clerk as "Clerk," not "we/us/our/ours."

> ❌
> Our `<ClerkProvider>` provides active session and user context to our hooks and other components. Let's import it into our app by adding `import { ClerkProvider } from '@clerk/nextjs'` at the top of the file.

> ✅
> Clerk's `<ClerkProvider>` provides active session and user context to Clerk's hooks and other components. Import it into your app by adding `import { ClerkProvider } from '@clerk/nextjs'` at the top of your file.

### Use conjunctions

Use conjunctions in the copy to make the copy more colloquial.

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
