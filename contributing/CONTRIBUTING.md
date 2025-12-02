# Contributing to Clerk's documentation

Thanks for being willing to contribute to [Clerk's documentation](https://clerk.com/docs)! This document outlines how to effectively contribute to the documentation content located in this repository. See the [style guide](./styleguides/STYLEGUIDE.md) for more information on our guidelines for writing content.

If you're contributing specifically to our hooks and components documentation, please refer to the [dedicated guide](./CONTRIBUTING-COMPONENTS-HOOKS.md).

<details open="open">
<summary><strong>Table of contents</strong></summary>

- [Contributing to Clerk's documentation](#contributing-to-clerks-documentation)
  - [Written in MDX](#written-in-mdx)
  - [Project setup](#project-setup)
  - [Creating an issue](#creating-an-issue)
  - [Creating a pull request](#creating-a-pull-request)
  - [Preview your changes](#preview-your-changes)
    - [Previewing changes locally (for Clerk employees)](#previewing-changes-locally-for-clerk-employees)
  - [Validating your changes](#validating-your-changes)
  - [Getting your contributions reviewed](#getting-your-contributions-reviewed)
  - [Deployment](#deployment)
  - [Repository structure](#repository-structure)
    - [Sidenav](#sidenav)
    - [Update the SDK selector](#update-the-sdk-selector)
      - [Add a new SDK](#add-a-new-sdk)
      - [Add an external SDK](#add-an-external-sdk)
      - [Update the 'key' of an SDK](#update-the-key-of-an-sdk)
  - [Editing content](#editing-content)
    - [File metadata](#file-metadata)
      - [Metadata](#metadata)
      - [Search](#search)
      - [SDK](#sdk)
    - [Headings](#headings)
    - [Code blocks](#code-blocks)
      - [Highlighting](#highlighting)
      - [Collapsing sections of code](#collapsing-sections-of-code)
      - [TypeScript type for code block props](#typescript-type-for-code-block-props)
      - [Code block shortcodes](#code-block-shortcodes)
      - [Prettier integration](#prettier-integration)
    - [`<Steps />`](#steps-)
    - [Callouts](#callouts)
    - [`<CodeBlockTabs />`](#codeblocktabs-)
    - [`<Tabs />`](#tabs-)
    - [Tooltips](#tooltips)
    - [`<TutorialHero />`](#tutorialhero-)
    - [`<Cards>`](#cards)
    - [`<Properties>`](#properties-1)
    - [`<Include />`](#include-)
    - [`<Typedoc />`](#typedoc-)
    - [`<If />`](#if-)
    - [`<Accordion />`](#accordion-)
    - [Images and static assets](#images-and-static-assets)
  - [Help wanted!](#help-wanted)

</details>

## Written in MDX

Clerk's documentation content is written in a variation of markdown called [MDX](https://mdxjs.com/). MDX allows us to embed React components in the content, unlocking rich, interactive documentation experiences. Clerk's documentation site also supports [GitHub Flavored Markdown](https://github.github.com/gfm/), adding support for things like tables and task lists.

Clerk's documentation uses [`mdx-annotations`](https://www.npmjs.com/package/mdx-annotations) which provides a consistent way to apply props to markdown elements. This is utilized for various features such as [controlling image quality](#images-and-static-assets) and [defining code block line highlights](#highlighting).

MDX files ([including any code blocks](#prettier-integration)) are formatted using [a custom Prettier plugin](https://github.com/clerk/clerk-docs/blob/main/prettier-mdx.mjs). It is recommended to enable "format on save" (or similar) in your code editor, but the formatter can also be run manually on all files using `npm run format`.

## Project setup

1.  Fork or clone the repo.
2.  Run `npm install` to install dependencies.
3.  Create a branch for your PR with `git checkout -b pr/your-branch-name`.

> Tip: If you forked the repo, keep your `main` branch pointing at the original repository
> and make pull requests from branches on your fork. To do this, run:
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

## Creating a pull request

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
- **Check that files are formatted with the prettier configuration settings.**
- **Check for changes to quickstarts.**

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

### Sidenav

The side navigation is powered by two things: the SDK selector and the manifest file at [`/docs/manifest.json`](./docs/manifest.json).

The SDK selector allows a user to choose the SDK of their choice, and depending on the option they select, the sidenav will update to show docs specific to that SDK. For example, if you were to choose "Next.js", you would see the sidenav update to show docs that are scoped to Next.js.

- The logic for the SDK selector lives in `clerk/clerk`, which is a private repository that is only available to Clerk employees. Therefore, to update the SDK selector, such as adding new items, you must be a Clerk employee. For instructions on how to do so, see [this section](#update-the-sdk-selector). If you aren't a Clerk employee but have suggestions or concerns, please [submit an issue](https://github.com/clerk/clerk-docs/issues).

The `manifest.json` is responsible for the structure of the sidenav, including setting the title and link for each sidenav item. Below is some helpful information on the typing and structure of the file.

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

  /**
   * Limit this page to only show when the user has one of the specified sdks active
   *
   * @example ['nextjs', 'react']
   */
  sdk?: string[]
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

  /**
   * Limit this group to only show when the user has one of the specified sdks active
   *
   * @example ['nextjs', 'react']
   */
  sdk?: string[]
}
```

</details>

<details>
<summary>Visual representation of the manifest TypeScript types</summary>

![](/public/images/styleguide/manifest.png)

</details>

### Update the SDK selector

> For Clerk employees only. [_(Why?)_](#sidenav)

To update the SDK selector, the files you need are in `clerk/clerk`:

- https://github.com/clerk/clerk/blob/main/src/app/(website)/docs/SDKSelector.tsx
  - This is the logic behind how the SDK selector works and sets an SDK as active for the Docs. It's unlikely you'll touch this file, unless you are changing the logic behind how the SDK selector works.
- https://github.com/clerk/clerk/blob/main/src/app/(website)/docs/SDK.tsx
  - This is the source of truth for the SDK selector. The `sdks` object includes the list of available SDKs and renders in the order it's formatted as; we like to have the most used SDKs at the top (Next.js, React, JavaScript), and then the rest are alphabetized.

#### Add a new SDK

If the SDK has docs that are internal, i.e. maintained in `clerk-docs`, then follow these instructions. If the SDK has docs that are external, e.g. Python located at `https://github.com/clerk/clerk-sdk-python/blob/main/README.md`, then see the [section on adding an external SDK](#add-an-external-sdk).

To add a new SDK, you'll need the SDK name (e.g. `Next.js`), key (e.g. `nextjs`), and 2 SVG icons: one in color and one in grayscale. These must be converted to JSX syntax, not HTML / standard SVG syntax. You will need these SVG's because we list the Clerk SDK's on [https://clerk.com/docs](https://clerk.com/docs), [https://clerk.com/docs/reference/overview](https://clerk.com/docs/reference/overview), and if there is a quickstart for it, [https://clerk.com/docs/quickstarts/overview](https://clerk.com/docs/quickstarts/overview).

In this repo (`clerk/clerk-docs`):

1. In the `manifest.schema.json`, add a reference name in the `icon` enum and add the SDK key to the `sdk` enum.
1. Add the color SVG to the partials icon folder `_partials/icons/`.
1. Add the SDK to `index.mdx`, `reference/overview.mdx`, and if there is a quickstart for it, `quickstarts/overview.mdx`.
1. In the `manifest.json`, find the `"title": "Clerk SDK",` object. It should be the first object in the `"navigation"` array. Add the SDK accordingly. For example, it could include files like a quickstart, a references section with an overview and some reference docs, or a guides section with some dedicated guides for that SDK.

Now, the sidenav is set up to render the items for the new SDK you've added, and to link to the routes/doc files that you defined. However, you've got to get the SDK selector working as well:

In the `clerk/clerk` repo:

1. In the `app/(website)/docs/icons.tsx` file, add the SVGs. The grayscale version goes in the `icons` object while the color version goes in the `iconsLarge` object. Use the same key for both.
1. In the `app/(website)/docs/SDK.tsx` file, update the `sdks` object to include your new SDK. You should pass at least the following keys: `title`, `icon`, `route`, `category`.

#### Add an external SDK

If the SDK has docs that are external, e.g. Python located at `https://github.com/clerk/clerk-sdk-python/blob/main/README.md`, then follow these instructions. If the SDK has docs that are internal, i.e. maintained in `clerk-docs`, then see the [section on adding a new SDK](#add-a-new-sdk).

To add a new SDK, you'll need the SDK name (e.g. `Python`), key (e.g. `python`), and 2 SVG icons: one in color and one in grayscale. These must be converted to JSX syntax, not HTML / standard SVG syntax. You will need these SVG's because we list the Clerk SDK's on [https://clerk.com/docs](https://clerk.com/docs) and [https://clerk.com/docs/reference/overview](https://clerk.com/docs/reference/overview).

In this repo (`clerk/clerk-docs`):

1. In the `manifest.schema.json`, add a reference name in the `icon` enum and add the SDK key to the `sdk` enum.
1. Add the color SVG to the partials icon folder `_partials/icons/`.
1. Add the SDK to `index.mdx` and `reference/overview.mdx`.

Now, the sidenav is set up to render the items for the new SDK you've added, and to link to the routes/doc files that you defined. However, you've got to get the SDK selector working as well:

In the `clerk/clerk` repo:

1. In the `app/(website)/docs/icons.tsx` file, add the SVGs. The grayscale version goes in the `icons` object while the color version goes in the `iconsLarge` object. Use the same key for both.
1. In the `app/(website)/docs/SDK.tsx` file, update the `sdks` object to include your new SDK. You should pass at least the following keys: `title`, `icon`, `external`, `category`.

#### Update the 'key' of an SDK

If you need to update the key of an SDK, because the logic is shared in `clerk-docs` and `clerk/clerk` repo's, both the old and the new keys must be kept as available. This is similar to deprecating an old key, and releasing a new key - you must still support the old key.

In the `clerk/clerk` repo:

1. In `clerk/src/app/(website)/docs/SDK.tsx`, change the necessary key in the `sdks` object.
1. In that same file, update the `sdkKeyMigrations` object by adding the old key as the key and the new key as the value. For example, if you were changing the `sdk` key to be `js` instead of `javascript`, you would do the following updates:

   ```diff
   const sdks = {
   -  'javascript': {
   +  'js': {
       ...
     }
   }


   const sdkKeyMigrations = {
   +  'javascript': 'js',
   }
   ```

Then, in this repo (`clerk-docs`):

1. In the `manifest.schema.json`, update the `sdk` enum to use the new key.
1. In the `manifest.json`, update the `sdk` arrays to use the new key.
1. Find all uses of the `<If />` component that uses the old key and update them to use the new key.

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

#### Metadata

The `metadata` frontmatter field can be used to define additional information about a documentation page, such as SEO metadata, social sharing tags, or indexing information. It allows you to control how the page appears in browsers, search engines, and social media previews. It has the following subfields:

| Name          | Type                      | Default | Description                                                                                                                                                  |
| ------------- | ------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `title`       | `string`                  | -       | Overrides the browser title and `<title>` meta tag.                                                                                                          |
| `description` | `string`                  | -       | Overrides the meta description shown in search results and link previews.                                                                                    |
| `authors`     | `Array<{ name: string }>` | `[]`    | Lists the authors of the page for structured data or article metadata.                                                                                       |
| `alternates`  | `object`                  | `{}`    | Defines canonical and alternate URLs for the page. See its properties below.                                                                                 |
| `openGraph`   | `object`                  | `{}`    | Configures [Open Graph](https://ogp.me/) data for social previews (Facebook, LinkedIn, etc). See its properties below.                                       |
| `twitter`     | `object`                  | `{}`    | Configures [X Cards](https://developer.x.com/en/docs/x-for-websites/cards/overview/abouts-cards) data for previews on X (Twitter). See its properties below. |
| `robots`      | `object`                  | `{}`    | Controls how crawlers index and follow the page. See its properties below.                                                                                   |

##### Examples

<details>
<summary>Set a custom browser title</summary>

```diff
  ---
  title: Example
+ metadata:
+   title: Example
  ---
```

</details>

<details>
<summary>Set SEO title and description</summary>

```diff
  ---
  title: Example
+ metadata:
+   title: Example
+   description: Example
  ---
```

</details>

</details>

<details>
<summary>Add page authors</summary>

```diff
  ---
  title: Example
+ metadata:
+   authors:
+     - name: Jane Doe
  ---
```

</details>

<details>
<summary>Define canonical or alternate URLs for your documentation page</summary>
<br />
<p><strong>This is set via the <code>alternates</code> field. It has the following subfields:</strong></p>

| Name        | Type     | Default | Description                                                              |
| ----------- | -------- | ------- | ------------------------------------------------------------------------ |
| `canonical` | `string` | -       | The canonical URL to avoid duplicate content across versions or domains. |

```diff
  ---
  title: Example
+ metadata:
+   alternates:
+     canonical: https://docs.example.com/
  ---
```

</details>

</details>

<details>
<summary>Configure Open Graph metadata for social media previews</summary>
<br />
<p><strong>This is set via the <code>openGraph</code> field. It has the following subfields:</strong></p>

| Name            | Type            | Default | Description                               |
| --------------- | --------------- | ------- | ----------------------------------------- |
| `title`         | `string`        | -       | Title displayed in social previews.       |
| `description`   | `string`        | -       | Description displayed in social previews. |
| `images`        | `Array<string>` | `[]`    | One or more image URLs for preview cards. |
| `publishedTime` | `string`        | -       | Publication timestamp.                    |
| `authors`       | `Array<string>` | `[]`    | Author names associated with the page.    |

```diff
  ---
  title: Example
+ metadata:
+   openGraph:
+     title: Clerk Organizations - invite users
+     description: Guide to sending and managing invitations within Clerk.
+     images:
+       - https://example.com/social-preview.png
  ---
```

</details>

<details>
<summary>Define X Cards metadata for the page</summary>
<br />
<p><strong>This is set via the <code>twitter</code> field. It has the following subfields:</strong></p>

| Name          | Type            | Default | Description                                  |
| ------------- | --------------- | ------- | -------------------------------------------- |
| `title`       | `string`        | -       | Title displayed in the Twitter card.         |
| `description` | `string`        | -       | Description displayed in the Twitter card.   |
| `images`      | `Array<string>` | `[]`    | Image URLs used in the Twitter card preview. |

```diff
  ---
  title: Example
+ metadata:
+   twitter:
+     title: Clerk Organizations - invite users
+     description: Guide to sending and managing invitations within Clerk.
+     images:
+       - https://example.com/social-preview.png
  ---
```

</details>

<details>
<summary>Control search engine indexing and crawler behavior.</summary>
<br />
<p><strong>This is set via the <code>robots</code> field. It has the following subfields:</strong></p>

| Name     | Type      | Default | Description                                          |
| -------- | --------- | ------- | ---------------------------------------------------- |
| `index`  | `boolean` | `true`  | Whether the page should appear in search results.    |
| `follow` | `boolean` | `true`  | Whether crawlers should follow links from this page. |

```diff
  ---
  title: Example
+ metadata:
+  robots:
+    index: false
+    follow: true
  ---
```

</details>

#### Search

The `search` frontmatter field can be used to control how a page is indexed by [Algolia Crawler](https://www.algolia.com/doc/tools/crawler/getting-started/overview/). It has the following subfields:

| Name       | Type            | Default | Description                                                                                                                                                                                                                                                                                |
| ---------- | --------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `exclude`  | `boolean`       | `false` | Whether to exclude the page from search entirely                                                                                                                                                                                                                                           |
| `rank`     | `number`        | `0`     | The value to use for `weight.pageRank` in the index. See [Custom Ranking](https://www.algolia.com/doc/guides/managing-results/must-do/custom-ranking/) and [Boost search results with `pageRank`](https://docsearch.algolia.com/docs/record-extractor/#boost-search-results-with-pagerank) |
| `keywords` | `Array<string>` | `[]`    | Additional [searchable](https://www.algolia.com/doc/guides/managing-results/must-do/searchable-attributes/) keywords to include when indexing the page. These are not visible to users.                                                                                                    |

You may also set `search` to a boolean value, which acts as an `exclude` value. See the first example below.

##### Examples

<details>
<summary>Exclude a page from search</summary>

```diff
  ---
  title: Example
+ search: false
  ---
```

</details>

<details>
<summary>Boost a page in search results</summary>

```diff
  ---
  title: Example
+ search:
+   rank: 1
  ---
```

</details>

<details>
<summary>Show a page in results when searching for "supercalifragilisticexpialidocious"</summary>

```diff
  ---
  title: Example
+ search:
+   keywords:
+     - supercalifragilisticexpialidocious
  ---
```

</details>

#### SDK

The `sdk` frontmatter field defines what SDKs a page supports and makes the page visible in the sidenav only when one of those SDKs is selected by the [SDK selector](#sidenav).

For example, if `nextjs` and `react` were passed to the `sdk` frontmatter field, like so:

```diff
  ---
  title: `'<ClerkProvider>'`
  description: Lorem ipsum...
+ sdk: nextjs, react
  ---
```

This does a couple things:

- URL's are generated for this page per specified SDK. In this case, for the `/docs/clerk-provider.mdx` file, `/docs/nextjs/clerk-provider` and `/docs/react/clerk-provider` will be generated. One for `nextjs` and one for `react`.
  - The base url `/docs/clerk-provider` will still exist, but will show a grid of the available variants.
- The page will only show up in the sidenav if the user has one of the specified SDKs "active", which means selected in the [SDK selector](#sidenav).
- Links to this page will be "smart" and direct the user towards the correct variant of the page based on which SDK is active.
- On the right side of the page, a selector will be shown, allowing the user to switch between the different versions of the page.

If you'd like to add support for a new SDK in a guide, but using the `<If />` component in the doc is getting too noisy, another option is to use the `.sdk.mdx` file extension. For example, say you had a `docs/setup-clerk.mdx` with `sdk: react, nextjs, expo` in the frontmatter, and you want to add Remix but it'd require changing almost the entire doc. In this case, you could create a `docs/setup-clerk.remix.mdx` file and write out a Remix-specific version of the guide. This will act the same way as above, creating a distinct variant of the guide as`/docs/remix/setup-clerk`.

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

You can also specify **deleted**, **inserted**, or **marked** lines by prepending them with a special character. This is available for any code block language except Markdown.

| Type     | Character |
| -------- | --------- |
| Deleted  | `-`       |
| Inserted | `+`       |
| Marked   | `=`       |

````mdx
```tsx
  export function App() {
-   return <Foo />
+   return <Bar />
  }
```
````

#### Collapsing sections of code

You can collapse sections of a code block by using the `fold` prop. The type for the `fold` prop is `Array<[start: number, end: number, label?: string]>`, where `start` and `end` define the inclusive range of lines to collapse, and `label` is a custom label for the expand button. By default the label will be `{n} lines collapsed`.

````mdx
```ts {{ fold: [[2, 4]] }}
export function Example() {
  useEffect(() => {
    // some long unimportant code here
  }, [])

  return null
}
```
````

<details>
<summary>Fold example</summary>

| Default                                                                                   | Expanded                                                                                   |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| <img width="1204" height="416" alt="" src="/.github/media/code-block-fold-default.png" /> | <img width="1204" height="478" alt="" src="/.github/media/code-block-fold-expanded.png" /> |

</details>

You can also truncate a code block by using the `collapsible` prop. This will reduce the height of the code block by default and display an "expand" button to reveal the full code block.

````mdx
```ts {{ collapsible: true }}
// ...
```
````

<details>
<summary>Collapsible example</summary>

![](/.github/media/code-block-collapsible.png)

</details>

#### TypeScript type for code block props

```tsx
type LineNumber = number
type Mark = LineNumber | [start: LineNumber, end: LineNumber]

interface CodeBlockProps {
  filename?: string
  mark?: Array<Mark>
  ins?: Array<Mark>
  del?: Array<Mark>
  collapsible?: boolean
  fold?: Array<[start: LineNumber, end: LineNumber, label?: string]>
}
```

#### Code block shortcodes

You can use the following shortcodes within a code block to inject information from the user's current Clerk instance:

- `{{pub_key}}` – Publishable Key
- `{{secret}}` – Secret Key
- `{{fapi_url}}` – Frontend API URL

````mdx
```sh {{ filename: '.env' }}
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY={{pub_key}}
CLERK_SECRET_KEY={{secret}}
```
````

The video below shows what this example looks like once rendered. Notice the eye icon on the code block that once clicked on, reveals the user's Secret Key.

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

The `<Steps />` component is used to number a set of instructions with an outcome. It uses the highest heading available in the component to denote each step. Can be used with `h2` and `h3` headings.

```mdx
<Steps>

## Step 1

Do these actions to complete Step 1.

## Another step

### A heading inside a step

Do these actions to complete Step 2.

</Steps>
```

The image below shows what this example looks like once rendered.

![An example of a <Steps /> component](/.github/media/steps.png)

### Callouts

A callout draws attention to something learners should slow down and read.

> [!NOTE]
> Callouts can be distracting when people are quickly skimming a page. So only use them if the information absolutely should not be missed!

Callout syntax is based on [GitHub's markdown "alerts"](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax#alerts). To add a callout, use a special blockquote line specifying the callout type, followed by the callout information in a standard blockquote. The following types of callouts are available:

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

> [!QUIZ]
> An opportunity for users to check their understanding.
```

The image below shows what this example looks like once rendered.

![An example of each callout type: NOTE, TIP, IMPORTANT, WARNING, CAUTION, QUIZ](/.github/media/callouts.png)

You can optionally specify an `id` attribute for a callout which allows for direct linking, e.g. `/docs/example#useful-info`:

```mdx
> [!NOTE useful-info]
> Useful information that users should know, even when skimming content.
```

You can create a collapsible section within a callout by using a thematic break (`---`). Content following the break is hidden by default and can be toggled by the user:

```mdx
> [!QUIZ]
> Why does handshake do a redirect? Why can’t it make a fetch request to FAPI and get a new token back that way? Not needing to redirect would be a better user experience.
>
> ---
>
> Occaecati esse ut iure in quam praesentium nesciunt nemo. Repellat aperiam eaque quia. Aperiam voluptatem consequuntur numquam tenetur. Quibusdam repellat modi qui dolor ducimus ut neque adipisci dolorem. Voluptates dolores nisi est fuga.
```

![An example of a collapsible section inside a quiz callout](/.github/media/callout-details.png)

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

#### npm commands

npm codeblocks will automatically generate the commands for `pnpm`, `yarn`, and `bun` within a `<CodeBlockTabs />`.

````mdx
```npm
npm i @clerk/nextjs
```
````

Example output:

````mdx
<CodeBlockTabs options={["npm", "pnpm", "yarn", "bun"]}>
    ```bash {{ filename: 'terminal' }}
    npm i @clerk/nextjs
    ```

    ```bash {{ filename: 'terminal' }}
    pnpm add @clerk/nextjs
    ```

    ```bash {{ filename: 'terminal' }}
    yarn add @clerk/nextjs
    ```

    ```bash {{ filename: 'terminal' }}
    bunx add @clerk/nextjs
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

### Tooltips

A tooltip is content that appears when the user hovers over a word or phrase in order to provide additional information. A common use case is for definitions.

Tooltips are defined in the `_tooltips` folder and written in MDX, but they do not support custom MDX components, like callouts or `<Tabs />` components. Try to keep the tooltip content as text.

The tooltip syntax is similar to a link, but with a `!` prefix, as shown in the following example:

```mdx
The ID of the [Active Organization](!active-organization) that the user belongs to.
```

Tooltips should follow the same styleguide as links - only add them on the first mention of a term and only in the highest heading section. So if a term is mentioned in an H2 section and again in its H3 section, it doesn't need to be added in the H3 section.

### `<TutorialHero />`

The `<TutorialHero />` component is used at the beginning of a tutorial-type content page. It accepts the following properties:

| Property                      | Type                                                                                                                           | Description                                                                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `beforeYouStart`              | { title: string; link: string; icon: [string](<https://github.com/clerk/clerk/blob/main/src/app/(website)/docs/icons.tsx>) }[] | Links to things that learners should complete before the tutorial.                                                                               |
| `exampleRepo` (optional)      | { title: string; link: string }[]                                                                                              | Links to example repositories.                                                                                                                   |
| `exampleRepoTitle` (optional) | string                                                                                                                         | The title for the example repository/repositories. Defaults to `'Example repository'` or `'Example repositories'`, but can be passed any string. |

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
    },
  ]}
  exampleRepo={[
    {
      title: 'Clerk + Next.js App Router Quickstart',
      link: 'https://github.com/clerk/clerk-nextjs-app-quickstart',
    },
  ]}
/>
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

- [UI Components](/docs/reference/components/overview)
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

- [UI Components](/docs/reference/components/overview)
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

- [UI Components](/docs/reference/components/overview)
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

- [What is Clerk authentication?](/docs/guides/configure/auth-strategies/sign-up-sign-in-options)
- Clerk offers multiple authentication strategies to identify legitimate users of your application, and to allow them to make authenticated requests to your backend.
- ![](/what-is-clerk.png)

---

- [What is the “User” object?](/docs/guides/users/managing)
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

The `<Include />` component can be used to inject the contents of another MDX file. We like to use this component to include partial files that are used in multiple pages. This way, you write the content once and only have to maintain it in one place.

There are two types of partials you can use:

1. **Global partials** - Located in `/docs/_partials/` and can be referenced from any document.
2. **Relative partials** - Located in `_partials/` folders within any subdirectory and are scoped to documents near them.

#### Global partials

Global partials are stored in `/docs/_partials/` and can be included from any document using a path starting with `_partials/`:

```mdx
{/* Render `docs/_partials/code-example.mdx` */}

<Include src="_partials/code-example" />
```

Global partials are best for:

- Content that is reused across many different sections of the documentation.
- Shared components, code examples, or explanations that apply broadly.
- Content that doesn't belong to a specific topic area.

#### Relative partials

Relative partials are stored in `_partials/` folders within subdirectories and can be included using relative paths (`./` or `../`). The path is resolved relative to the document's directory.

**Same directory:**

If you have a document at `docs/billing/for-b2c.mdx` and a partial at `docs/billing/_partials/pricing-table.mdx`:

```mdx
<Include src="./_partials/pricing-table" />
```

**Parent directory:**

If you have a document at `docs/billing/plans/premium.mdx` and a partial at `docs/billing/_partials/shared-content.mdx`:

```mdx
<Include src="../_partials/shared-content" />
```

Relative partials are best for:

- Content that is specific to a particular section or topic area (e.g., billing-specific instructions).
- Content that is only used by a few documents in the same directory structure.
- Organizing partials near the documents that use them for better maintainability.

### `<Typedoc />`

The `<Typedoc />` component is used to inject the contents of an MDX file from the `./clerk-typedoc` folder. The files inside that folder are not manually created and maintained; they are automatically created from the [`clerk/javascript`](https://github.com/clerk/javascript) repository. This has a couple of implications:

- If you want to edit the contents of a file that contains a `<Typedoc />` component, you'll have to open a pull request in `clerk/javascript` and change the source file's JSDoc comment. For information on how to author Typedoc comments, see [this section](https://github.com/clerk/javascript/blob/main/docs/CONTRIBUTING.md#authoring-typedoc-information).
- Once your PR in `clerk/javascript` has been merged and a release is published, a PR will be opened in `clerk-docs` to merge in the Typedoc changes.

For example, in the `/hooks/use-auth.mdx` file, if you want to render `./clerk-typedoc/clerk-react/use-auth.mdx`, you would embed the `<Typedoc />` component like this:

```mdx
<Typedoc src="clerk-react/use-auth" />
```

### `<If />`

The `<If />` component is used for conditional rendering. When the conditions are true, it displays its contents. When the conditions are false, it hides its contents. We commonly use this component to conditionally render content based on the **active SDK**. The **active SDK** is the SDK that is selected in the sidenav.

> [!IMPORTANT]
> This component cannot be used within code blocks.

| Props                   | Type                 | Comment                                                                                                                                                                                                                                  |
| ----------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `children`              | `React.ReactNode`    | The content that will be conditionally rendered.                                                                                                                                                                                         |
| `condition?` (optional) | `boolean`            | The condition that determines if the content is rendered.                                                                                                                                                                                |
| `sdk?` (optional)       | `string \| string[]` | Filter the content to only display based on the passed SDK(s). For example, if the `sdk` prop is set to `['nextjs', 'react']`, the content will only be rendered if the **active SDK** is Next.js or React.                              |
| `notSdk?` (optional)    | `string \| string[]` | Filter the content to only display based on the SDK(s) that were **NOT** passed. For example, if the `notSdk` prop is set to `['nextjs', 'react']`, the content will only be rendered if the **active SDK** is **NOT** Next.js or React. |

Available values for the `sdk` prop:

| SDK                    | Value                  |
| ---------------------- | ---------------------- |
| Next.js                | "nextjs"               |
| React                  | "react"                |
| Javascript             | "js-frontend"          |
| Chrome Extension       | "chrome-extension"     |
| Expo                   | "expo"                 |
| Android                | "android"              |
| iOS                    | "ios"                  |
| Express                | "expressjs"            |
| Fastify                | "fastify"              |
| React Router           | "react-router"         |
| Remix                  | "remix"                |
| Tanstack React Start   | "tanstack-react-start" |
| Go                     | "go"                   |
| Astro                  | "astro"                |
| Nuxt                   | "nuxt"                 |
| Vue                    | "vue"                  |
| Ruby / Rails / Sinatra | "ruby"                 |
| Python                 | "python"               |
| JS Backend SDK         | "js-backend"           |
| Community SDKs         | "community-sdk"        |

To update the value, or `key`, for an SDK, see the [section on updating the key of an SDK](#update-the-key-of-an-sdk).

#### Examples

<details>
<summary>Filtered to a single SDK</summary>

```mdx
<If sdk="nextjs">This content will only be rendered if the active SDK is Next.js</If>
```

</details>

<details>
<summary>Filtered to either the Astro or React active SDK</summary>

```mdx
<If sdk={['astro', 'react']}>This content will only be rendered if the active SDK is Astro or React</If>
```

</details>

<details>
<summary>Filter within a filter</summary>

```mdx
<If sdk={['nextjs', 'remix']}>
  This content will only be rendered if the active SDK is Next.js or Remix.
  <If sdk="nextjs">This content will only be rendered if the active SDK is Next.js</If>
</If>
```

</details>

<details>
<summary>Filter to all SDKs except the ones passed</summary>

```mdx
<If notSdk="nextjs">This content will only be rendered if the active SDK is **NOT** Next.js</If>
```

</details>

### `<Accordion />`

The `<Accordion />` component creates a vertically stacked set of interactive headings that each reveals a section of content. It has no props and accepts `<AccordionPanel />` children.

The `<AccordionPanel />` accepts a `title` and `children`.

| Prop       | Type              | Comment                                                   |
| ---------- | ----------------- | --------------------------------------------------------- |
| `children` | `React.ReactNode` | The content that will be rendered in the accordion panel. |
| `title`    | `string`          | The title of the accordion panel.                         |

```mdx
<Accordion>
  <AccordionPanel title="Can I use this?">It's available in v1.2.3 and above.</AccordionPanel>
  <AccordionPanel title="What if I still have questions?">Send and email to help@example.com.</AccordionPanel>
</Accordion>
```

The image below shows what this example looks like once rendered.

![An example of an <Accordion /> component](/.github/media/accordion.png)

### Images and static assets

Images and static assets should be placed in the `public/` folder. To reference an image or asset in content, prefix the path with `/docs`. For example, if an image exists at `public/images/logo.png`, to render it on a page you would use the following: `![Logo](/docs/images/logo.png)`.

When rendering images, make sure that you provide appropriate alternate text. Reference [this decision tree](https://www.w3.org/WAI/tutorials/images/decision-tree/) for help picking a suitable value.

Image captions can be added using [standard Markdown "title" syntax](https://www.markdownguide.org/basic-syntax/#images-1). For example, `![](/docs/images/sign-in.png 'Clerk SignIn component.')`

#### Image props

<details>
<summary><code>dark</code></summary>
Use the `dark` prop to specify a different image to use in dark mode:

```mdx
![Logo](/docs/images/logo.png){{ dark: '/docs/images/logo-dark.png' }}
```

</details>

<details>
<summary><code>priority</code></summary>
https://nextjs.org/docs/app/api-reference/components/image#priority

```mdx
![Image](/docs/images/my-image.png){{ priority: true }}
```

</details>

<details>
<summary><code>quality</code></summary>
https://nextjs.org/docs/app/api-reference/components/image#quality

```mdx
![Image](/docs/images/my-image.png){{ quality: 90 }}
```

</details>

<details>
<summary><code>width</code> and <code>height</code></summary>
The `width` and `height` props can now be used to specify the (max) display size of an image in pixels.

```mdx
![](/docs/images/my-image.png){{ width: 345 }}
```

| Without `width`                                                                        | With `width`                                                                        |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| <img width="1320" height="2736" alt="" src="/.github/media/image-width-without.png" /> | <img width="1320" height="1834" alt="" src="/.github/media/image-width-with.png" /> |

</details>

<details>
<summary><code>align</code></summary>

`align` can be set to `left`, `center`, or `right` to align an image horizontally. The default is `left`.

| `left`                                                                              | `center`                                                                              | `right`                                                                              |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| <img width="1320" height="1834" alt="" src="/.github/media/image-align-left.png" /> | <img width="1320" height="1834" alt="" src="/.github/media/image-align-center.png" /> | <img width="1320" height="1834" alt="" src="/.github/media/image-align-right.png" /> |

</details>

<details>
<summary><code>variant</code></summary>

The `variant` prop can be used to display an image in a different style. Possible values are `default` and `browser`.

| `default`                                                                                | `browser`                                                                                |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| <img width="1706" height="1328" alt="" src="/.github/media/image-variant-default.png" /> | <img width="1706" height="1328" alt="" src="/.github/media/image-variant-browser.png" /> |

When using the `browser` variant the caption is displayed in the menu bar.

</details>

#### `<Gallery>`

The `Gallery` component displays multiple images in a grid layout. On mobile the images are laid out horizontally in a scrollable container.

<details>
<summary>Example</summary>

```
<Gallery>
  ![Light Mode](./ios-user-profile-view.png)
  ![Dark Mode](./ios-user-profile-view-dark.png)
</Gallery>
```

| Desktop                                                                            | Mobile                                                                           |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| <img width="1266" height="1468" alt="" src="/.github/media/gallery-desktop.png" /> | <img width="720" height="1578" alt="" src="/.github/media/gallery-mobile.png" /> |

</details>

## Help wanted!

Looking to contribute? Please check out [the open issues](https://github.com/clerk/clerk-docs/issues) for opportunities to help out. Thanks for taking the time to help make Clerk's docs better!
