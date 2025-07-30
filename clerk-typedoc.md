# clerk-typedoc

This folder contains the auto-generated Typedoc documentation of [clerk/javascript](https://github.com/clerk/javascript).

> [!IMPORTANT] > **Do not manually edit `.mdx` files inside this folder.** The contents will only be updated through CI automation and the source of truth for the documents is `clerk/javascript`. Any manual changes will be overridden.

If you want to make a change to a document, follow the instructions to [setup your local environment](https://github.com/clerk/javascript/blob/main/docs/CONTRIBUTING.md#developing-locally) and how to author [Typedoc changes](https://github.com/clerk/javascript/blob/main/docs/CONTRIBUTING.md#authoring-typedoc-information).

Once you [open a PR in `clerk/javascript`](https://github.com/clerk/javascript/blob/main/docs/CONTRIBUTING.md#opening-a-pull-request), it will be merged and released. Afterwards, a GitHub action will create a PR in `clerk-docs` to update the contents of this folder.

The contents of this folder can embedded in `clerk-docs` files with the `<Typedoc />` component. For example, if you updated Typedoc comments for the `useAuth()` hook in `clerk/javascript`, you'll need to make sure that in `clerk-docs`, in the `/hooks/use-auth.mdx` file, there's a `<Typedoc />` component linked to the `./clerk-typedoc/clerk-react/use-auth.mdx` file, like:

```mdx
<Typedoc src="clerk-react/use-auth" />
```

Read more about this in the [`clerk-docs` CONTRIBUTING.md](https://github.com/clerk/clerk-docs/blob/main/CONTRIBUTING.md#typedoc-).

Then, to preview how the `<Typedoc />` component renders, you can check it locally after [setting up your local environment](https://github.com/clerk/javascript/blob/main/docs/CONTRIBUTING.md#developing-locally) or create a PR in `clerk-docs` which will provision a Vercel preview.
