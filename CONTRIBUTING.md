# Contributing to Clerk's documentation

Thanks for being willing to contribute to [Clerk's documentation](https://clerk.com/docs)! This document outlines how to effectively contribute updates and fixes to the documentation content located in this repository.

## Project setup

1.  Fork and clone the repo
2.  Run `npm install` to install dependencies
3.  Create a branch for your PR with `git checkout -b pr/your-branch-name`

> Tip: Keep your `main` branch pointing at the original repository and make pull
> requests from branches on your fork. To do this, run:
>
>     git remote add upstream https://github.com/clerkinc/clerk-docs.git
>     git fetch upstream
>     git branch --set-upstream-to=upstream/main main
>
> This will add the original repository as a "remote" called "upstream," Then
> fetch the git information from that remote, then set your local `main` branch
> to use the upstream main branch whenever you run `git pull`. Then you can make
> all of your pull request branches based on this `main` branch. Whenever you
> want to update your version of `main`, do a regular `git pull`.

## Written in MDX

Our documentation content is written in variation of markdown called [MDX](https://mdxjs.com/). MDX allows us to embed React components in the content, unlocking rich, interactive documentation experiences. Clerk's documentation site supports [GitHub Flavored Markdown](https://github.github.com/gfm/), adding support for things like tables and task lists.

## Previewing your changes

At this time, we do not currently have way to preview your changes. If you use VSCode, consider using [the built-in markdown preview](https://code.visualstudio.com/docs/languages/markdown#_markdown-preview) to see what the rendered content will look like. Note that this will not include our custom components or styles.

## Getting your contributions reviewed

Once you open up a pull request with your changes, a member of the Clerk team will review your pull request and approve it or leave addressable feedback. We do our best to review all contributions in a timely manner, but please be patient if someone does not take a look at it right away.

Once your pull request is approved, a member of the Clerk team will merge it and make sure it gets deployed! 🚀

## Deployment

The content rendered on https://clerk.com/docs is pulled from the `production` branch in this repository. In most cases, all changes merged to `main` are considered "production ready" and will be merged into the `production` branch within a reasonable amount of time.

## Repository structure

The documentation content is located in the [`/docs` directory](./docs/). Each MDX file located in this directory will be rendered under https://clerk.com/docs at its path relative to the root `/docs` directory, without the file extension.

For example, the file at `/docs/get-started/setup-clerk.mdx` can be found at https://clerk.com/docs/get-started/setup-clerk.

### Navigation manifest

The navigation element rendered on https://clerk.com/docs is powered by the manifest file at [`/docs/manifest.json`](./docs/manifest.json). Making changes to this data structure will update the rendered navigation.

#### Navigation constructs

The navigation is built from a small number of primitive constructs:

- **Link** (`["Title", "/path/to/page"]`) - Renders a link. The path should be a full path relative to the documentation root (`https://clerk.com/docs/`)
- **Separator** (`"---"`) - Renders a visual separator for grouping
- **Heading** (`"# Heading"`) - Renders a heading
- **Section** (`["Title", [elements]]`) - Renders a collapsible section
- **Page** (`[{ title: "Title", root: "/root/path" }, [elements]]`) - Indicates a new navigation page. When viewing a page under the provided `root`, The navigation data associated with the matching navigation page will be rendered
- **Text Config** (`{ title: "Tite", icon: "nextjs", tag: "coming soon" }`) - Can be used in place of a construct's title string to render additional elements

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

- **`title`** - The title of the page. Used to populate the HTML `<title>` tag
- **`description`** - The description of the page. Used to populate a page's `<meta name="description">` tag

These fields should be preset on every documentation page.

### Code blocks

Syntax-highlighted code blocks are rendered wherever markdown code blocks are used. To render a highlighted TypeScript snippet, you would do this:

```
​```typescript
function add(a: number, b: number) {
  a + b
}
​```
```

You can also specify a filename and pass a `copy` attribute to show a copy-to-clipboard button:

```
​```typescript filename="add.ts" copy
function add(a: number, b: number) {
  a + b
}
​```
```

#### <CodeBlockTabs />

If you need to render multiple variations of a code snippet, use `<CodeBlockTabs />`. The component accepts an `options` property, which is an array of strings. For each option provided, render a code block:

```mdx
<CodeBlockTabs options={["npm", "yarn", "pnpm"]}>

​```
npm i @clerk/nextjs
​```

​```
yarn add @clerk/nextjs
​```

​```
pnpm i @clerk/nextjs
​```

</CodeBlockTabs>
```

### `<Tabs />`

If you need to structure content in a tabular format, use the `<Tabs />` component. The component accepts an `options` property, which is an array of strings. For each option provided, render a `<Tab />` component:

```mdx
<Tabs options={["React", "JavaScript"]}>
<Tab>
# React

</Tab>
<Tab>
# JavaScript

</Tab>
</Tabs>
```

### Images and static assets

Images and static assets should be placed in the `public/` folder. To reference an image or asset in content, prefix the path with `/docs`. For example, if an image exists at `public/images/logo.png`, to render it on a page you would use the following: `![Logo](/docs/images/logo.png)`.

When rendering images, make sure that you provide appropriate alternate text. Reference [this decision tree](https://www.w3.org/WAI/tutorials/images/decision-tree/) for help picking a suitable value.

> **Note**
> Is the image you're adding optimized? If not, consider running it through an optimizer, like [Squoosh](https://squoosh.app/).


## Help wanted!

Looking to contribute? Please check out [the open issues](https://github.com/clerkinc/clerk-docs/issues) for opportunities to help out. Thanks for taking the time to help make Clerk's docs better!
