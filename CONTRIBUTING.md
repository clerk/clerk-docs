# Contributing to Clerk's documentation

Thanks for being willing to contribute to [Clerk's documentation](https://clerk.com/docs)! This document outlines how to effectively contribute updates and fixes to the documentation content located in this repository.

## Written in MDX

Clerk's documentation content is written in a variation of markdown called [MDX](https://mdxjs.com/). MDX allows us to embed React components in the content, unlocking rich, interactive documentation experiences. Clerk's documentation site also supports [GitHub Flavored Markdown](https://github.github.com/gfm/), adding support for things like tables and task lists.

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

These fields should be present on every documentation page.

### Headings

Headings should be nested by their rank. Headings with an equal or higher rank start a new section, headings with a lower rank start new subsections that are part of the higher ranked section. Please see the [Web Accessibility Initiative documentation](https://www.w3.org/WAI/tutorials/page-structure/headings/) for more information.

Headings should be written in sentence-casing, where only the first word of the heading is capitalized. E.g. "This is a heading".

### Code blocks

Syntax-highlighted code blocks are rendered wherever markdown code blocks are used. To add syntax highlighting, specify a language next to the backticks before the fenced code block.

````
​```typescript
function add(a: number, b: number) {
  a + b
}
​```
````

You can also specify a filename by passing the `filename` prop.

````
​```typescript filename="add.ts"
function add(a: number, b: number) {
  a + b
}
​```
````

If the code should run in a terminal, you can set the syntax highlighting to something like `sh` (shell) or `bash`. The file name should be set to `terminal`.

````
​```sh filename="terminal"
npm i @clerk/nextjs
​```
````

#### `<Steps />`

The `<Steps />` component is used to number a set of instructions with an outcome. It uses the highest heading available in the component to denote each step. Can be used with H3 headings.

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

![An example of a <Steps /> component](/public/images/styleguide/steps.png)

#### `<Callout />`

The `<Callout />` component draws attention to something learners should slow down and read.

> Callouts can be distracting when people are quickly skimming a page. So only use them if the information absolutely should not be missed!

The `<Callout />` component accepts an optional `type` property which accepts the following strings: `'Danger' | 'Info' | 'Success' | 'Warning';`.

```mdx
<Callout type="danger">Don't do this in production!</Callout>
```

The image below shows what this example looks like once rendered.

![An example of a <Callout /> component with the type set to danger.](/public/images/styleguide/callout.png)

#### `<CodeBlockTabs />`

The `<CodeBlockTabs />` component renders multiple variations of a code block. It accepts an `options` property, which is an array of strings. For each option provided, it renders a code block.

````mdx
<CodeBlockTabs options={["npm", "yarn", "pnpm"]}>

```sh filename="terminal"
npm i @clerk/nextjs
```

```sh filename="terminal"
yarn add @clerk/nextjs
```

```sh filename="terminal"
pnpm add @clerk/nextjs
```

</CodeBlockTabs>
````

The image below shows what this example looks like once rendered.

![An example of a <CodeBlockTabs /> component with three tabs options for 'npm', 'yarn', and 'pnpm'. Each tab shows a code example of how to install the @clerk/nextjs package.](/public/images/styleguide/codeblocktabs.png)

The `<CodeBlockTabs />` component also accepts an optional `type` property, which is used to sync the active tab across multiple instances by passing each instance the same exact `string` to the `type` property.

For example, in the example below, if the user were to choose `"yarn"` as the tab they want to see, both `<CodeBlockTabs />` components would change their active tab to `"yarn"` because both components were passed `"installer"` as their `type`.

````mdx
<CodeBlockTabs type="installer" options={["npm", "yarn", "pnpm"]}>

```sh filename="terminal"
npm i @clerk/nextjs
```

```sh filename="terminal"
yarn add @clerk/nextjs
```

```sh filename="terminal"
pnpm add @clerk/nextjs
```

</CodeBlockTabs>

You can also install the install the Clerk React package by running the following command in your terminal:

<CodeBlockTabs type="installer" options={["npm", "yarn", "pnpm"]}>

```sh filename="terminal"
npm i @clerk/clerk-react
```

```sh filename="terminal"
yarn add @clerk/clerk-react
```

```sh filename="terminal"
pnpm add @clerk/clerk-react
```

</CodeBlockTabs>
````

The video below shows what this example looks like once rendered. Notice that changing the tab of one `<CodeBlockTabs />` instance changes the tab of the other, because both instances have matching `type` values.

![An example of two <CodeBlockTabs /> elements where both were passed the same the value of "installer" to their 'type' prop, causing their active tabs to be synced.](/public/images/styleguide/codeblocktabs-synced.mov)

#### `<Tabs />`

The `<Tabs />` component structures content in a tabular format. It accepts an `items` property, which is an array of strings. For each option provided, it renders a `<Tab />` component, as shown in the example below.

```mdx
<Tabs items={["React", "JavaScript"]}>
  <Tab>

    # React

    Here is some example text about React.

  </Tab>

  <Tab>

    # JavaScript

    Here is some example text about JavaScript.

  </Tab>
</Tabs>
```

The video below shows what this example looks like once rendered.

![An example of a <Tabs /> component. There are two tab options: 'react' and 'javascript'.](/public/images/styleguide/tabs.mov)

The `<Tabs />` component also accepts an optional `type` property, which is used to sync the active tab across multiple instances by passing each instance the same exact `string` to the `type` property.

For example, in the example below, if the user were to choose "JavaScript" as the tab they want to see, both `<Tabs />` components would change their active tab to "JavaScript" because both components were passed `"framework"` as their `type`.

```mdx
<Tabs type="framework" items={["React", "JavaScript"]}>
  <Tab>

    # React

    Here is some example text about React.

  </Tab>

  <Tab>

    # JavaScript

    Here is some example text about JavaScript.

  </Tab>
</Tabs>

<Tabs type="framework" items={["React", "JavaScript"]}>
  <Tab>

    # React

    Here is another example about React.

  </Tab>
  <Tab>

    # JavaScript

    Here is another example about JavaScript.

  </Tab>
</Tabs>
```

The video below shows what this example would like once rendered. Notice that changing the tab of one `<Tabs />` instance changes the tab of the other, because both have matching `type` values.

![An example of two <Tabs /> elements where both were passed the same the value of "installer" to their 'type' prop, causing their active tabs to be synced.](/public/images/styleguide/tabs-synced.mov)

#### Sync `<CodeBlockTabs />` and `<Tabs />`

The `type` property can be used on both `<CodeBlockTabs />` and `<Tabs />` to sync instances of these components together.

For example, in the example below, if the user were working with Next.js Pages Router and chose the "Pages Router" as the tab they want to see, both the `<Tabs />` and the `<CodeBlockTabs />` components would change their active tab to "Pages Router" because both components were passed `"router"` as their `type`.

````mdx
<Tabs type="router" items={["App Router", "Pages Router"]}>
<Tab>
The App Router information is here.
</Tab>

<Tab>
The Pages Router information is here.
</Tab>
</Tabs>

<CodeBlockTabs type="router" options={["App Router", "Pages Router"]}>

```tsx filename="/app/sign-in/[[...sign-in]]/page.tsx"
import { SignIn } from '@clerk/nextjs'

export default function Page() {
  return <SignIn />
}
```

```tsx filename="/pages/sign-in/[[...index]].tsx"
import { SignIn } from '@clerk/nextjs'

const SignInPage = () => <SignIn />

export default SignInPage
```

</CodeBlockTabs>
````

The video below shows what this example would like once rendered. Notice that changing the active tab of the `<Tabs />` component also changes the active tab of the `<CodeBlockTabs />` component, and vice versa. This is because both instances were passed the same `type` value of `"router"`.

![An example of a <Tabs /> and <CodeBlockTabs /> element where both were passed the same the value of "router" to their 'type' prop, causing their active tabs to be synced.](/public/images/styleguide/codeblocktabs-and-tabs-synced.mov)

### Tables

Tables can be formatted using markdown, like so:

```
| Heading1 | Heading2 |
| --- | --- |
| Cell1A | Cell2A |
| Cell1B | Cell2B |
| `code1` | `code2` |
| [Link1](https://link1.com) | [Link2](https://link2.com) |
```

The image below shows what this example would look like once rendered.

![An example of a markdown table.](/public/images/styleguide/markdown-table.png)

#### `<Tables />`

If you have more complex content that you need inside a table, such as embedding JSX elements, you can use the `<Tables />` component. While you _can_ embed JSX elements in a markdown table, embedding JSX elements in a JSX component is the _better_ option for formatting and readability purposes.

For example, one of these cells has content that would best formatted in an unordered list. Thus, a `<Tables />` component is used instead of a markdown table.

```
<Tables
  headings={["Name", "Type", "Description"]}
  rows={[
    {
      cells: [
        <code>cell1A</code>,
        <code>cell2A</code>,
        <>This is cell3A which would be filled under the description heading.</>,
      ]
    },
    {
      cells: [
        <code>cell2A</code>,
        <code>cell2B</code>,
        <>This is cell3B, and it renders components:
          <ul>
            <li>listitem1 inside cell3B</li>
            <li>listitem2 inside cell3B</li>
            <li>listitem3 inside cell3B</li>
          </ul>
        </>,
      ],
    },
  ]}
/>
```

The image below shows what this example would look like once rendered.

![An example of a <Table /> component.](/public/images/styleguide/table.png)

#### `<InjectKeys />`

The `<InjectKeys />` component is used to inject the user's current Clerk instance's publishable and secret keys. It should wrap around a code block, which will render an eye icon for users to click on in order to reveal their secret keys.

````mdx
Add the following code to your `.env.local` file to set your public and secret keys.

**Pro tip!** If you are signed into your Clerk Dashboard, your secret key should become visible by clicking on the eye icon. Otherwise, you can find your keys in the Clerk Dashboard on the [API Keys](https://dashboard.clerk.com/last-active?path=api-keys) page.

<InjectKeys>

```sh filename=".env.local"
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY={{pub_key}}
CLERK_SECRET_KEY={{secret}}
```

</InjectKeys>
````

The video below shows what this example looks like once rendered. Notice the eye icon on the code block that once clicked on, reveals the user's secret key.

![Clicking on the eye icon on a code block that is wrapped in <InjectKeys /> will show the user their secret key.](/public/images/styleguide/inject-keys.mov)

#### `<TutorialHero />`

The `<TutorialHero />` component is used at the beginning of a tutorial-type content page. It accepts the following properties:

| Property                      | Type                              | Description                                                                            |
| ----------------------------- | --------------------------------- | -------------------------------------------------------------------------------------- |
| `framework`                   | string                            | Denotes the framework or platform the tutorial is for.                                 |
| `beforeYouStart`              | { title: string; link: string }[] | Links to things that learners should complete before the tutorial.                     |
| `exampleRepo` (optional)      | { title: string; link: string }[] | Links to example repositories.                                                         |
| `exampleRepoTitle` (optional) | string                            | The title for the example repository/repositories. Defaults to `'Example repository'`. |

```mdx
<TutorialHero
  framework="react"
  beforeYouStart={[
    {
      title: "Set up a Clerk application",
      link: "https://clerk.com/docs/quickstarts/setup-clerk"
    },
    {
      title: "Create a react application",
      link: "https://react.dev/learn"
    }
  ]}
  exampleRepo={[
    {
      title: "React JS app",
      link: "https://github.com/clerk/clerk-react-starter"
    }
  ]}
>

- Install `@clerk/clerk-react`
- Set up your environment variables
- Wrap your React app in `<ClerkProvider/>`
- Limit access to authenticated users
- Embed the `<UserButton/>`

</TutorialHero>
```

### Images and static assets

Images and static assets should be placed in the `public/` folder. To reference an image or asset in content, prefix the path with `/docs`. For example, if an image exists at `public/images/logo.png`, to render it on a page you would use the following: `![Logo](/docs/images/logo.png)`.

When rendering images, make sure that you provide appropriate alternate text. Reference [this decision tree](https://www.w3.org/WAI/tutorials/images/decision-tree/) for help picking a suitable value.

> **Note**
> Is the image you're adding optimized? If not, consider running it through an optimizer, like [Squoosh](https://squoosh.app/).

## Help wanted!

Looking to contribute? Please check out [the open issues](https://github.com/clerk/clerk-docs/issues) for opportunities to help out. Thanks for taking the time to help make Clerk's docs better!
