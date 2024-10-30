# Contributing to Clerk's documentation

Thanks for being willing to contribute to [Clerk's documentation](https://clerk.com/docs)! This document outlines how to effectively contribute to the documentation content located in this repository. Check out the [style guide](./styleguides/styleguide.md) for more information on our guidelines for writing content.

## Written in MDX

Clerk's documentation content is written in a variation of markdown called [MDX](https://mdxjs.com/). MDX allows us to embed React components in the content, unlocking rich, interactive documentation experiences. Clerk's documentation site also supports [GitHub Flavored Markdown](https://github.github.com/gfm/), adding support for things like tables and task lists.

Clerk's documentation uses [`mdx-annotations`](https://www.npmjs.com/package/mdx-annotations) which provides a consistent way to apply props to markdown elements. This is utilized for various features such as [controlling image quality](#images-and-static-assets) and [defining code block line highlights](#highlighting).

MDX files ([including any code blocks](#prettier-integration)) are formatted using [a custom Prettier plugin](https://github.com/clerk/clerk-docs/blob/main/prettier-mdx.mjs). It is recommended to enable "format on save" (or similar) in your code editor, but the formatter can also be run manually on all files using `npm run format`.

## Project setup

1.  Fork and clone the repo
2.  Run `npm install` to install dependencies
3.  Create a branch for your PR with `git checkout -b pr/your-branch-name`

> Tip: Keep your `main` branch pointing at the original repository and make pull
> requests from branches on your fork. To do this, run:
>
>     git remote add upstream https://github.com/clerk/clerk-docs.git
>     git fetch upstream
>     git branch --set-upstream-to=upstream/main main
>
> This will add the original repository as a "remote" called "upstream," Then
> fetch the git information from that remote, then set your local `main` branch
> to use the upstream main branch whenever you run `git pull`. Then you can make
> all of your pull request branches based on this `main` branch. Whenever you
> want to update your version of `main`, do a regular `git pull`.

## Creating an issue

If you have found a contribution you would like to make, but it is rather large, it is recommended to open an [issue](https://github.com/clerk/clerk-docs/issues) first. Doing so not only helps keep track of what you plan to work on, but also facilitates discussions with maintainers, who can provide valuable feedback and ideas even before you begin implementing changes.

Modifications such as correcting misspelled words, addressing grammatical or punctuation errors, or making similar minor adjustments probably don't require the creation of an issue. In such cases, you are welcome to proceed by creating a pull request.

The structure of the issue should be:

- **Title**: Summarize the problem you want to solve in one sentence, using an active voice. E.g. "Fix broken "Home" link on sidenav"
- **Description ("Leave a comment")**: Discuss what your finding is, why it needs a solution, and where you found it/how it can be reproduced. Links, screenshots, and videos can be helpful tools!

## Creating a Pull Request

When you're ready to submit your contribution, you're going to create a [pull request](https://github.com/clerk/clerk-docs/pulls), also referred to as a PR.

If this is your first time, or you need a refresher on how to create a PR, you can check out this video:

[How to Contribute to an Open Source Project on GitHub](https://egghead.io/courses/how-to-contribute-to-an-open-source-project-on-github)

The structure of the PR should be:

- **Title**: Summarize the change you made, using an active voice. E.g. "Fix broken "Home" link on sidenav"
  - If there is an issue that this PR is meant to resolve, the titles will probably be the same.
- **Description ("Leave a comment")**: Describe what the concern was and summarize how you solved it.

## Preview your changes

When you open a pull request, a member of the Clerk team can add the `deploy-preview` label to your pull request, which will trigger a preview deployment with your changes.

### Previewing changes locally (for Clerk employees)

Clerk employees can run the application and preview their documentation changes locally. To do this, follow the [instructions in the `clerk` README](https://github.com/clerk/clerk/tree/main?tab=readme-ov-file#running-the-app-locally).

## Validating your changes

Before committing your changes, run our linting checks to validate the changes you are making are correct. Currently we:

- **Check for broken links.** If your change contains URLs that are not authored inside this repository (e.g. marketing pages or other docs) the linter will fail. You'll need to add your URLs to the `EXCLUDE_LIST` inside [`check-links.mjs`](./scripts/check-links.mjs).

To run all linting steps:

```shell
npm run lint
```

## Getting your contributions reviewed

Once you open up a pull request with your changes, a member of the Clerk team will review your pull request and approve it, or leave addressable feedback. We do our best to review all contributions in a timely manner, but please be patient if someone does not take a look at it right away.

Once your pull request is approved, a member of the Clerk team will merge it and make sure it gets deployed! 🚀

## Deployment

The content rendered on https://clerk.com/docs is pulled from the `main` branch in this repository. If your PR is merged to the `main` branch, a workflow is triggered that updates the production pages. Changes should be reflected on https://clerk.com/docs within a matter of seconds.

## Repository structure

The documentation content is located in the [`/docs` directory](./docs/). Each MDX file located in this directory will be rendered under https://clerk.com/docs at its path relative to the root `/docs` directory, without the file extension.

For example, the file at `/docs/quickstarts/setup-clerk.mdx` can be found at https://clerk.com/docs/quickstarts/setup-clerk.

### Navigation manifest

The navigation element rendered on https://clerk.com/docs is powered by the manifest file at [`/docs/manifest.json`](./docs/manifest.json). Making changes to this data structure will update the rendered navigation.

[Manifest JSON schema →](./docs/manifest.schema.json)

<details>
<summary>Equivalent TypeScript types and descriptions</summary>

```typescript
export type Nav = Array<NavGroup>

/**
 * Nav groups are separated by horizontal rules
 */
type NavGroup = Array<NavItem>

/**
 * A nav item is either a link, or a sub-list with nested `items`
 */
type NavItem = LinkItem | SubNavItem

/**
 * A link to an internal or external page
 */
type LinkItem = {
  /**
   * The visible item text. May contain backticks (`) to render `<code>`
   *
   * @example 'Next.js Quickstart'
   * @example '`<SignIn>` and `<SignUp>`'
   */
  title: string
  /**
   * The item link. Internal links should be relative
   *
   * @example '/docs/quickstarts/nextjs'
   * @example 'https://example.com'
   */
  href: string
  /**
   * Muted text to display next to the item text
   *
   * @example 'Community'
   * @example 'Beta'
   */
  tag?: string
  /**
   * Icon to display next to the item text
   *
   * @example 'globe'
   * @see [Available icons]{@link https://github.com/clerk/clerk/blob/main/src/app/(website)/docs/icons.tsx}
   */
  icon?: string
  /**
   * Whether to enable text wrapping for the item text
   *
   * @default true
   */
  wrap?: boolean
  /**
   * Set to "_blank" to open link in a new tab
   */
  target?: '_blank'
}
type SubNavItem = {
  /**
   * The visible item text. May contain backticks (`) to render `<code>`
   *
   * @example 'Next.js Quickstart'
   * @example '`<SignIn>` and `<SignUp>`'
   */
  title: string
  /**
   * The nested sub-items
   */
  items: Nav
  /**
   * Muted text to display next to the item text
   *
   * @example 'Community'
   * @example 'Beta'
   */
  tag?: string
  /**
   * Icon to display next to the item text
   *
   * @example 'globe'
   * @see [Available icons]{@link https://github.com/clerk/clerk/blob/main/src/app/(website)/docs/icons.tsx}
   */
  icon?: string
  /**
   * Whether to enable text wrapping for the item text
   *
   * @default true
   */
  wrap?: boolean
  /**
   * Whether to collapse the sub-nav
   *
   * @default false
   */
  collapse?: boolean
}
```

</details>

<details>
<summary>Visual representation of the manifest TypeScript types</summary>

![](/public/images/styleguide/manifest.png)

</details>

## Editing content

As mentioned above, all of the documentation content is located in the **`/docs`** directory. If you are having trouble finding the file associated with a specific page on the live documentation site, try clicking the "Edit this page on GitHub" link.

### File metadata

Each file has a few required frontmatter fields, which are defined like so:

```mdx
---
title: Page title
description: Some brief, but effective description of the page's content.
---
```

- **`title`** - The title of the page. Used to populate the HTML `<title>` tag and the h1 of the page. Supports markdown e.g. ``title: '`<SignUp>`'``
- **`description`** - The description of the page. Used to populate a page's `<meta name="description">` tag

These fields should be present on every documentation page.

### Headings

Headings should be nested by their rank. Headings with an equal or higher rank start a new section, headings with a lower rank start new subsections that are part of the higher ranked section. Please see the [Web Accessibility Initiative documentation](https://www.w3.org/WAI/tutorials/page-structure/headings/) for more information.

Headings should be written in **sentence-casing**, where only the first word of the heading is capitalized. E.g. "This is a heading".

h1's are not necessary and are considered tech-debt, as the `title` property in the [frontmatter](#file-metadata) will set the h1.

`h2` and `h3` headings are automatically included in the table of contents. You can control this behaviour by using the `toc` prop:

```mdx
{/* Replace the text for this heading in the table of contents */}

## Lorem ipsum {{ toc: 'Hello world' }}

{/* Exclude heading from table of contents */}

## Lorem ipsum {{ toc: false }}
```

Headings are automatically assigned an `id` attribute which is a slugified version of the text content. You can optionally override this by providing an `id` prop:

```mdx
{/* Replace the generated ID (`lorem-ipsum`) with `lipsum` */}

## Lorem ipsum {{ id: 'lipsum' }}
```

### Code blocks

Syntax-highlighted code blocks are rendered wherever markdown code blocks are used. To add syntax highlighting, specify a language next to the backticks before the fenced code block.

````
​```typescript
function add(a: number, b: number) {
  return a + b
}
​```
````

You can also specify a filename by passing the `filename` prop.

````
​```typescript {{ filename: 'add.ts' }}
function add(a: number, b: number) {
  return a + b
}
​```
````

If the code should run in a terminal, you can set the syntax highlighting to something like `sh` (shell) or `bash`. The file name should be set to `terminal`.

````
​```sh {{ filename: 'terminal' }}
npm i @clerk/nextjs
​```
````

#### Highlighting

You can highlight specific lines in a code block using the `mark` prop. For example to highlight line `2` and lines `5-7`:

````mdx
```tsx {{ mark: [2, [5, 7]] }}
export function Page() {
  return null
}

export function Layout() {
  return null
}
```
````

![](/.github/media/code-block-mark.png)

The `ins` (insert) and `del` (delete) props work in the same way as the `mark` prop but apply "diff" style highlighting with prepended `+` and `-` signs.

<details>
<summary><code>ins</code> and <code>del</code> example</summary>

````mdx
```tsx {{ ins: [2], del: [[5, 7]] }}
export function Page() {
  return null
}

export function Layout() {
  return null
}
```
````

![](/.github/media/code-block-diff.png)

</details>

<details>
<summary>TypeScript type for code block props</summary>

```tsx
type LineNumber = number
type Mark = LineNumber | [start: LineNumber, end: LineNumber]

interface CodeBlockProps {
  filename?: string
  mark?: Array<Mark>
  ins?: Array<Mark>
  del?: Array<Mark>
}
```

</details>

#### Code block shortcodes

You can use the following shortcodes within a code block to inject information from the user's current Clerk instance:

- `{{pub_key}}` – Publishable key
- `{{secret}}` – Secret key
- `{{fapi_url}}` – Frontend API URL

````mdx
```sh {{ filename: '.env.local' }}
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY={{pub_key}}
CLERK_SECRET_KEY={{secret}}
```
````

The video below shows what this example looks like once rendered. Notice the eye icon on the code block that once clicked on, reveals the user's secret key.

https://github.com/clerk/clerk-docs/assets/2615508/c1f3fc23-5581-481c-a89c-10c6a04b8536

#### Prettier integration

Code within code blocks is automatically formatted by Prettier when the containing MDX file is formatted. Formatting errors may occur due to invalid syntax and these will cause the "Lint" GitHub action to fail and prevent pull requests from being merged. This is a deliberate tool to help prevent syntax errors from finding their way into code examples.

Formatting can be disabled for a code block by setting the `prettier` prop to `false`, but this should only be used when absolutely necessary:

````mdx
```tsx {{ prettier: false }}
// ...
```
````

["prettier-ignore" comments](https://prettier.io/docs/en/ignore.html) are also supported to ignore _parts_ of a code block. This is preferred over the `prettier` prop where possible:

````mdx
```tsx
console.log('not ignored')

// prettier-ignore
console.log('ignored')
```
````

> [!NOTE]
> "prettier-ignore" comments are removed when a code block is rendered on the docs site.

### `<Steps />`

The `<Steps />` component is used to number a set of instructions with an outcome. It uses the highest heading available in the component to denote each step. Can be used with `h3` headings.

```mdx
<Steps>

### Step 1

Do these actions to complete Step 1.

### Another step

#### A heading inside a step

Do these actions to complete Step 2.

</Steps>
```

The image below shows what this example looks like once rendered.

![An example of a <Steps /> component](/.github/media/steps.png)

### Callouts

A callout draws attention to something learners should slow down and read.

> [!NOTE]
> Callouts can be distracting when people are quickly skimming a page. So only use them if the information absolutely should not be missed!

Callout syntax is based on [GitHub's markdown "alerts"](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax#alerts). To add a callout, use a special blockquote line specifying the callout type, followed by the callout information in a standard blockquote. Five types of callouts are available:

```mdx
> [!NOTE]
> Useful information that users should know, even when skimming content.

> [!TIP]
> Helpful advice for doing things better or more easily.

> [!IMPORTANT]
> Key information users need to know to achieve their goal.

> [!WARNING]
> Urgent info that needs immediate user attention to avoid problems.

> [!CAUTION]
> Advises about risks or negative outcomes of certain actions.
```

The image below shows what this example looks like once rendered.

![An example of each callout type: NOTE, TIP, IMPORTANT, WARNING, CAUTION](/.github/media/callouts.png)

### `<CodeBlockTabs />`

The `<CodeBlockTabs />` component renders multiple variations of a code block. It accepts an `options` property, which is an array of strings. For each option provided, it renders a code block.

````mdx
<CodeBlockTabs options={['npm', 'yarn', 'pnpm']}>

```sh {{ filename: 'terminal' }}
npm i @clerk/nextjs
```

```sh {{ filename: 'terminal' }}
yarn add @clerk/nextjs
```

```sh {{ filename: 'terminal' }}
pnpm add @clerk/nextjs
```

</CodeBlockTabs>
````

The image below shows what this example looks like once rendered.

![An example of a <CodeBlockTabs /> component with three tabs options for 'npm', 'yarn', and 'pnpm'. Each tab shows a code example of how to install the @clerk/nextjs package.](/.github/media/code-block-tabs.png)

### `<Tabs />`

The `<Tabs />` component structures content in a tabular format. It accepts an `items` property, which is an array of strings. For each option provided, it renders a `<Tab />` component, as shown in the example below.

```mdx
<Tabs items={['React', 'JavaScript']}>
  <Tab>

    Here is some example text about React.

  </Tab>

  <Tab>

    Here is some example text about JavaScript.

  </Tab>
</Tabs>
```

The video below shows what this example looks like once rendered.

https://github.com/clerk/clerk-docs/assets/2615508/9b07ba1d-8bb0-498b-935f-432d2d047ab6

### `<TutorialHero />`

The `<TutorialHero />` component is used at the beginning of a tutorial-type content page. It accepts the following properties:

| Property                      | Type                                                                                                                           | Description                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `beforeYouStart`              | { title: string; link: string; icon: [string](<https://github.com/clerk/clerk/blob/main/src/app/(website)/docs/icons.tsx>) }[] | Links to things that learners should complete before the tutorial.                     |
| `exampleRepo` (optional)      | { title: string; link: string }[]                                                                                              | Links to example repositories.                                                         |
| `exampleRepoTitle` (optional) | string                                                                                                                         | The title for the example repository/repositories. Defaults to `'Example repository'`. |

```mdx
<TutorialHero
  beforeYouStart={[
    {
      title: 'Set up a Clerk application',
      link: '/docs/quickstarts/setup-clerk',
      icon: 'clerk',
    },
    {
      title: 'Create a Next.js application',
      link: 'https://nextjs.org/docs/getting-started/installation',
      icon: 'nextjs',
    }
  ]}
  exampleRepo={[
    {
      title: 'App router',
      link: 'https://github.com/clerk/clerk-nextjs-app-quickstart',
    }
  ]}
>

- Install `@clerk/nextjs`
- Set up your environment keys to test your app locally
- Add `<ClerkProvider />` to your application
- Use Clerk middleware to implement route-specific authentication
- Create a header with Clerk components for users to sign in and out

</TutorialHero>
```

### `<Cards>`

The `<Cards>` component can be used to display a grid of cards in various styles.

`Cards` uses Markdown list syntax with each card separated by three dashes `---`.

```mdx
<Cards>

- [title](href)
- description

---

- [title](href)
- description
- ![alt text](/image.png)

---

- [title](href)
- description
- {<svg viewBox="0 0 32 32">{/* icon */}</svg>}

</Cards>
```

#### Properties

| Property  | Type                                        | Description                                                              |
| --------- | ------------------------------------------- | ------------------------------------------------------------------------ |
| `variant` | `'default'  \| 'plain' \| 'cta' \| 'image'` | The visual style of the cards, default: `'default'` (see examples below) |
| `cols`    | `2 \| 3 \| 4`                               | The number of columns in the card grid, default: `2`                     |
| `level`   | `2 \| 3 \| 4`                               | The level to use for the card headings, default: `3`                     |

#### Examples

<details>
<summary><code>default</code> variant</summary>

![](/.github/media/cards-default.png)

```mdx
<Cards>

- [Quickstarts & Tutorials](/docs/quickstarts/overview)
- Explore our end-to-end tutorials and getting started guides for different application stacks using Clerk.

---

- [UI Components](/docs/components/overview)
- Clerk's prebuilt UI components give you a beautiful, fully-functional user management experience in minutes.

</Cards>
```

</details>

<details>
<summary><code>default</code> variant with icons</summary>

![](/.github/media/cards-default-icons.png)

```mdx
<Cards>

- [Quickstarts & Tutorials](/docs/quickstarts/overview)
- Explore our end-to-end tutorials and getting started guides for different application stacks using Clerk.
- {<svg viewBox="0 0 32 32">{/*  */}</svg>}

---

- [UI Components](/docs/components/overview)
- Clerk's prebuilt UI components give you a beautiful, fully-functional user management experience in minutes.
- {<svg viewBox="0 0 32 32">{/*  */}</svg>}

</Cards>
```

</details>

<details>
<summary><code>plain</code> variant with icons</summary>

![](/.github/media/cards-plain-icons.png)

```mdx
<Cards variant="plain">

- [Quickstarts & Tutorials](/docs/quickstarts/overview)
- Explore our end-to-end tutorials and getting started guides for different application stacks using Clerk.
- {<svg viewBox="0 0 32 32">{/*  */}</svg>}

---

- [UI Components](/docs/components/overview)
- Clerk's prebuilt UI components give you a beautiful, fully-functional user management experience in minutes.
- {<svg viewBox="0 0 32 32">{/*  */}</svg>}

</Cards>
```

</details>

<details>
<summary><code>image</code> variant</summary>

![](/.github/media/cards-image.png)

```mdx
<Cards variant="image">

- [What is Clerk authentication?](/docs/authentication/overview)
- Clerk offers multiple authentication strategies to identify legitimate users of your application, and to allow them to make authenticated requests to your backend.
- ![](/what-is-clerk.png)

---

- [What is the “User” object?](/docs/users/overview)
- The User object contains all account information that describes a user of your app in Clerk. Users can authenticate and manage their accounts, update their personal and contact info, or set up security features for their accounts.
- ![](/user-object.png)

</Cards>
```

</details>

<details>
<summary><code>cta</code> variant</summary>

![](/.github/media/cards-cta.png)

```mdx
<Cards variant="cta">

- [Join our Discord](/discord 'Join Discord')
- Join our official Discord server to chat with us directly and become a part of the Clerk community.
- {<svg viewBox="0 0 32 32">{/*  */}</svg>}

---

- [Need help?](/support 'Get help')
- Contact us through Discord, Twitter, or email to receive answers to your questions and learn more about Clerk.
- {<svg viewBox="0 0 32 32">{/*  */}</svg>}

</Cards>
```

</details>

### `<Properties>`

The `<Properties>` component can be used to display a list of properties.

`Properties` uses Markdown list syntax with each property separated by three dashes `---`.

```mdx
<Properties>

- `name`

description

---

- `name`
- `type`

description

description continued…

</Properties>
```

> [!NOTE]
> Typically `name` and `type` would make use of inline code (`` ` ``) but this not required

<details>
<summary>Example</summary>

![](/.github/media/properties.png)

```mdx
<Properties>

- `path`
- `string`

The root path the sign-in flow is mounted at. Default: `/sign-in`

---

- `fallback`
- `React.ReactNode`

Fallback markup to render while Clerk is loading. Default: `null`

</Properties>
```

</details>

### `<Include />`

The `<Include />` component can be used to inject the contents of another MDX file:

```mdx
{/* Render `docs/_partials/oauth-instructions.mdx` */}

<Include src="_partials/oauth-instructions" />
```

### Images and static assets

Images and static assets should be placed in the `public/` folder. To reference an image or asset in content, prefix the path with `/docs`. For example, if an image exists at `public/images/logo.png`, to render it on a page you would use the following: `![Logo](/docs/images/logo.png)`.

Use the `dark` prop to specify a different image to use in dark mode:

```mdx
![Logo](/docs/images/logo.png){{ dark: '/docs/images/logo-dark.png' }}
```

You may also optionally provide the following [`next/image`](https://nextjs.org/docs/pages/api-reference/components/image) props: [`quality`](https://nextjs.org/docs/pages/api-reference/components/image#quality), [`priority`](https://nextjs.org/docs/pages/api-reference/components/image#priority)

```mdx
![Image](/docs/images/my-image.png){{ quality: 90, priority: true }}
```

When rendering images, make sure that you provide appropriate alternate text. Reference [this decision tree](https://www.w3.org/WAI/tutorials/images/decision-tree/) for help picking a suitable value.

## Help wanted!

Looking to contribute? Please check out [the open issues](https://github.com/clerk/clerk-docs/issues) for opportunities to help out. Thanks for taking the time to help make Clerk's docs better!
