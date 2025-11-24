// Things this script does

// Validates
// - The manifest structure and its contents
// - Markdown files and their required frontmatter fields:
//   - Ensures title is present (required)
//   - Warns if description is missing (optional)
//   - Validates SDK declarations in frontmatter
// - Validates internal doc links exist
// - Validates hash links point to headings
// - SDK filtering in three contexts:
//   1. Manifest: Ensures SDK scoping is properly defined and inherited
//   2. Frontmatter: Validates SDK declarations in document metadata
//   3. <If /> components: Ensures:
//      - Referenced SDKs exist in the manifest
//      - SDKs are available in the frontmatter
//      - SDK values match the list of valid SDKs
//      - Parent group SDK compatibility
// - Unique headings within documents
// - Typedoc content structure and references
// - Validates all embedded content (partials, typedocs) exists and is properly formatted

// Transforms
// - Content Integration:
//   - Embeds partial and tooltip content into markdown files
//   - Embeds typedoc content where referenced
//   - Handles special character encoding in typedoc tables
// - Link Processing:
//   - Updates links to SDK-specific docs to use <SDKLink /> components
//   - Removes .mdx extensions from doc links
// - SDK-Specific Processing:
//   - Generates SDK-specific versions of docs in their respective folders
//   - Creates "landing" pages for SDK-specific docs at original URLs
//   - Strips out content filtered by SDKs
// - Manifest Processing:
//   - Generates processed manifest.json with SDK scoping
//   - Applies inheritance rules for SDK scoping in the navigation tree

import fs from 'node:fs/promises'
import path from 'node:path'
import readdirp from 'readdirp'
import { remark } from 'remark'
import remarkFrontmatter from 'remark-frontmatter'
import remarkMdx from 'remark-mdx'
import symlinkDir from 'symlink-dir'
import { Node } from 'unist'
import { filter as mdastFilter } from 'unist-util-filter'
import { visit as mdastVisit } from 'unist-util-visit'
import reporter from 'vfile-reporter'
import yaml from 'yaml'
import { z } from 'zod'

import { generateApiErrorDocs } from './lib/api-errors'
import { createConfig, type BuildConfig } from './lib/config'
import { watchAndRebuild } from './lib/dev'
import { errorMessages, safeMessage, shouldIgnoreWarning } from './lib/error-messages'
import { getLastCommitDate } from './lib/getLastCommitDate'
import { readDocsFolder, writeDistFile, writeSDKFile } from './lib/io'
import { flattenTree, ManifestGroup, readManifest, traverseTree, traverseTreeItemsFirst } from './lib/manifest'
import { parseInMarkdownFile } from './lib/markdown'
import { readPartialsFolder, readPartialsMarkdown } from './lib/partials'
import { isValidSdk, VALID_SDKS, type SDK } from './lib/schemas'
import {
  createBlankStore,
  DocsMap,
  getCoreDocCache,
  getMarkdownCache,
  getScopedDocCache,
  markDocumentDirty,
  Store,
} from './lib/store'
import { readTypedocsFolder, readTypedocsMarkdown, typedocTableSpecialCharacters } from './lib/typedoc'

import { documentHasIfComponents } from './lib/utils/documentHasIfComponents'
import { extractComponentPropValueFromNode } from './lib/utils/extractComponentPropValueFromNode'
import { extractSDKsFromIfProp } from './lib/utils/extractSDKsFromIfProp'
import { scopeHrefToSDK } from './lib/utils/scopeHrefToSDK'

import { VFile } from 'vfile'
import { writeLLMs as generateLLMs, writeLLMsFull as generateLLMsFull, listOutputDocsFiles } from './lib/llms'
import { checkPartials } from './lib/plugins/checkPartials'
import { checkTypedoc } from './lib/plugins/checkTypedoc'
import { filterOtherSDKsContentOut } from './lib/plugins/filterOtherSDKsContentOut'
import { insertFrontmatter } from './lib/plugins/insertFrontmatter'
import { embedLinks } from './lib/plugins/embedLinks'
import { validateLinks } from './lib/plugins/validateLinks'
import { validateIfComponents } from './lib/plugins/validateIfComponents'
import { validateUniqueHeadings } from './lib/plugins/validateUniqueHeadings'
import { checkPrompts, readPrompts, writePrompts, type Prompt } from './lib/prompts'
import {
  analyzeAndFixRedirects as optimizeRedirects,
  readRedirects,
  transformRedirectsToObject,
  writeRedirects,
  type Redirect,
} from './lib/redirects'
import { checkTooltips } from './lib/plugins/checkTooltips'
import { readTooltipsFolder, readTooltipsMarkdown } from './lib/tooltips'
import { Flags, readSiteFlags, writeSiteFlags } from './lib/siteFlags'
import { removeMdxSuffix } from './lib/utils/removeMdxSuffix'
import { existsSync } from 'node:fs'

// Only invokes the main function if we run the script directly eg npm run build, bun run ./scripts/build-docs.ts
if (require.main === module) {
  main()
}

async function main() {
  const args = process.argv.slice(2)

  const config = await createConfig({
    basePath: __dirname,
    dataPath: '../data',
    docsPath: '../docs',
    baseDocsLink: '/docs/',
    manifestPath: '../docs/manifest.json',
    partialsFolderName: '_partials',
    distPath: '../dist',
    typedocPath: '../clerk-typedoc',
    localTypedocOverridePath: '../local-clerk-typedoc',
    publicPath: '../public',
    redirects: {
      static: {
        inputPath: '../redirects/static/docs.json',
        outputPath: '_redirects/static.json',
      },
      dynamic: {
        inputPath: '../redirects/dynamic/docs.jsonc',
        outputPath: '_redirects/dynamic.jsonc',
      },
    },
    prompts: {
      inputPath: '../prompts',
      outputPath: '_prompts',
    },
    tooltips: {
      inputPath: '../docs/_tooltips',
      outputPath: '_tooltips',
    },
    siteFlags: {
      inputPath: '../flags.json',
      outputPath: '_flags.json',
    },
    ignoreLinks: ['/docs/quickstart'],
    ignorePaths: [
      '/docs/core-1',
      '/docs/reference/backend-api',
      '/docs/reference/frontend-api',
      '/pricing',
      '/support',
      '/discord',
      '/contact',
      '/contact/sales',
      '/contact/support',
      '/blog',
      '/changelog/2024-04-19',
    ],
    ignoreWarnings: {
      docs: {
        'index.mdx': ['doc-not-in-manifest'],
        'guides/overview.mdx': ['doc-not-in-manifest'],
        'getting-started/quickstart/overview.mdx': ['doc-not-in-manifest'],
        'reference/overview.mdx': ['doc-not-in-manifest'],
        'maintenance-mode.mdx': ['doc-not-in-manifest'],
        'guides/development/deployment/staging-alternatives.mdx': ['doc-not-in-manifest'],
        'reference/nextjs/usage-with-older-versions.mdx': ['doc-not-in-manifest'],
        'reference/nextjs/errors/auth-was-called.mdx': ['doc-not-in-manifest'],
        'guides/dashboard/overview.mdx': ['doc-not-in-manifest'],
        'guides/development/upgrading/upgrade-guides/core-2/nextjs.mdx': ['doc-not-in-manifest'],
        'guides/development/upgrading/upgrade-guides/core-2/backend.mdx': ['doc-not-in-manifest'],
        'guides/development/upgrading/upgrade-guides/core-2/node.mdx': ['doc-not-in-manifest'],
        'guides/development/upgrading/upgrade-guides/core-2/expo.mdx': ['doc-not-in-manifest'],
        'guides/development/upgrading/upgrade-guides/core-2/fastify.mdx': ['doc-not-in-manifest'],
        'guides/development/upgrading/upgrade-guides/core-2/chrome-extension.mdx': ['doc-not-in-manifest'],
        'guides/development/upgrading/upgrade-guides/core-2/react.mdx': ['doc-not-in-manifest'],
        'guides/development/upgrading/upgrade-guides/core-2/remix.mdx': ['doc-not-in-manifest'],
        'guides/development/upgrading/upgrade-guides/core-2/javascript.mdx': ['doc-not-in-manifest'],
        'guides/development/ai-prompts.mdx': ['doc-not-in-manifest'],
        'guides/development/migrating/cognito.mdx': ['doc-not-in-manifest'],
        'guides/development/migrating/firebase.mdx': ['doc-not-in-manifest'],
        'guides/configure/auth-strategies/social-connections/apple.mdx': ['doc-not-in-manifest'],
        'guides/configure/auth-strategies/social-connections/atlassian.mdx': ['doc-not-in-manifest'],
        'guides/configure/auth-strategies/social-connections/bitbucket.mdx': ['doc-not-in-manifest'],
        'guides/configure/auth-strategies/social-connections/box.mdx': ['doc-not-in-manifest'],
        'guides/configure/auth-strategies/social-connections/coinbase.mdx': ['doc-not-in-manifest'],
        'guides/configure/auth-strategies/social-connections/discord.mdx': ['doc-not-in-manifest'],
        'guides/configure/auth-strategies/social-connections/dropbox.mdx': ['doc-not-in-manifest'],
        'guides/configure/auth-strategies/social-connections/facebook.mdx': ['doc-not-in-manifest'],
        'guides/configure/auth-strategies/social-connections/github.mdx': ['doc-not-in-manifest'],
        'guides/configure/auth-strategies/social-connections/gitlab.mdx': ['doc-not-in-manifest'],
        'guides/configure/auth-strategies/social-connections/google.mdx': ['doc-not-in-manifest'],
        'guides/configure/auth-strategies/social-connections/hubspot.mdx': ['doc-not-in-manifest'],
        'guides/configure/auth-strategies/social-connections/hugging-face.mdx': ['doc-not-in-manifest'],
        'guides/configure/auth-strategies/social-connections/line.mdx': ['doc-not-in-manifest'],
        'guides/configure/auth-strategies/social-connections/linear.mdx': ['doc-not-in-manifest'],
        'guides/configure/auth-strategies/social-connections/linkedin-oidc.mdx': ['doc-not-in-manifest'],
        'guides/configure/auth-strategies/social-connections/linkedin.mdx': ['doc-not-in-manifest'],
        'guides/configure/auth-strategies/social-connections/microsoft.mdx': ['doc-not-in-manifest'],
        'guides/configure/auth-strategies/social-connections/notion.mdx': ['doc-not-in-manifest'],
        'guides/configure/auth-strategies/social-connections/slack.mdx': ['doc-not-in-manifest'],
        'guides/configure/auth-strategies/social-connections/spotify.mdx': ['doc-not-in-manifest'],
        'guides/configure/auth-strategies/social-connections/tiktok.mdx': ['doc-not-in-manifest'],
        'guides/configure/auth-strategies/social-connections/twitch.mdx': ['doc-not-in-manifest'],
        'guides/configure/auth-strategies/social-connections/twitter.mdx': ['doc-not-in-manifest'],
        'guides/configure/auth-strategies/social-connections/x-twitter.mdx': ['doc-not-in-manifest'],
        'guides/configure/auth-strategies/social-connections/xero.mdx': ['doc-not-in-manifest'],
        'guides/development/upgrading/upgrading-from-v2-to-v3.mdx': ['doc-not-in-manifest'],
        'guides/organizations/create-orgs-for-users.mdx': ['doc-not-in-manifest'],
        'getting-started/quickstart/setup-clerk.mdx': ['doc-not-in-manifest'],
        'pinning.mdx': ['doc-not-in-manifest'],

        // temp migration ignores
        'guides/development/webhooks/inngest.mdx': ['doc-not-in-manifest'],
        'guides/development/webhooks/loops.mdx': ['doc-not-in-manifest'],
      },
      typedoc: {},
      partials: {},
      tooltips: {},
    },
    validSdks: VALID_SDKS,
    manifestOptions: {
      wrapDefault: true,
      hideTitleDefault: false,
    },
    llms: {
      overviewPath: '_llms/llms.txt',
      fullPath: '_llms/llms-full.txt',
    },
    flags: {
      watch: args.includes('--watch'),
      controlled: args.includes('--controlled'),
      skipApiErrors: args.includes('--skip-api-errors'),
      skipGit: args.includes('--skip-git'),
    },
  })

  const store = createBlankStore()

  const output = await build(config, store)

  if (config.flags.controlled) {
    console.info('---initial-build-complete---')
  }

  if (output !== '') {
    console.info(output)
  }

  if (config.flags.watch) {
    console.info(`Watching for changes...`)

    watchAndRebuild(store, config, build)
  } else if (output !== '') {
    process.exit(1)
  }
}

export async function build(config: BuildConfig, store: Store = createBlankStore(), abortSignal?: AbortSignal) {
  // Apply currying to create functions pre-configured with config
  const getManifest = readManifest(config)
  const getDocsFolder = readDocsFolder(config)
  const getPartialsFolder = readPartialsFolder(config)
  const getPartialsMarkdown = readPartialsMarkdown(config, store)
  const getTooltipsFolder = readTooltipsFolder(config)
  const getTooltipsMarkdown = readTooltipsMarkdown(config, store)
  const getTypedocsFolder = readTypedocsFolder(config)
  const getTypedocsMarkdown = readTypedocsMarkdown(config, store)
  const parseMarkdownFile = parseInMarkdownFile(config, store)
  const writeFile = writeDistFile(config, store)
  const writeSdkFile = writeSDKFile(config, store)
  const markdownCache = getMarkdownCache(store)
  const coreDocCache = getCoreDocCache(store)
  const scopedDocCache = getScopedDocCache(store)
  const getCommitDate = getLastCommitDate(config)
  const markDirty = markDocumentDirty(store)
  const scopeHref = scopeHrefToSDK(config)

  abortSignal?.throwIfAborted()

  let staticRedirects: Record<string, Redirect> | null = null
  let dynamicRedirects: Redirect[] | null = null

  if (config.redirects) {
    const redirects = await readRedirects(config)

    const optimizedStaticRedirects = optimizeRedirects(redirects.staticRedirects)
    const transformedStaticRedirects = transformRedirectsToObject(optimizedStaticRedirects)

    staticRedirects = transformedStaticRedirects
    dynamicRedirects = redirects.dynamicRedirects

    console.info('✓ Read, optimized and transformed redirects')
  }

  abortSignal?.throwIfAborted()

  let prompts: Prompt[] = []

  if (config.prompts) {
    prompts = await readPrompts(config)
    console.info(`✓ Read ${prompts.length} prompts`)
  }

  abortSignal?.throwIfAborted()

  let siteFlags: Flags = {}

  if (config.siteFlags) {
    siteFlags = await readSiteFlags(config)
    console.info(`✓ Read ${Object.keys(siteFlags).length} site flags`)
  }

  abortSignal?.throwIfAborted()

  const apiErrorsFiles = await generateApiErrorDocs(config)
  if (!config.flags.skipApiErrors) {
    console.info('✓ Generated API Error MDX files')
  }

  abortSignal?.throwIfAborted()

  const { manifest: userManifest, vfile: manifestVfile } = await getManifest()
  console.info('✓ Read Manifest')

  abortSignal?.throwIfAborted()

  const docsFiles = await getDocsFolder()
  console.info('✓ Read Docs Folder')

  abortSignal?.throwIfAborted()

  const cachedPartialsSize = store.partials.size
  const partials = await getPartialsMarkdown((await getPartialsFolder()).map((item) => item.path))
  console.info(`✓ Loaded in ${partials.length} partials (${cachedPartialsSize} cached)`)

  const cachedTooltipsSize = store.tooltips.size
  const tooltips = await getTooltipsMarkdown((await getTooltipsFolder()).map((item) => item.path))
  console.info(`✓ Loaded in ${tooltips.length} tooltips (${cachedTooltipsSize} cached)`)

  abortSignal?.throwIfAborted()

  const cachedTypedocsSize = store.typedocs.size
  const typedocs = await getTypedocsMarkdown((await getTypedocsFolder()).map((item) => item.path))
  console.info(`✓ Read ${typedocs.length} Typedocs (${cachedTypedocsSize} cached)`)

  abortSignal?.throwIfAborted()

  const docsMap: DocsMap = new Map()
  const docsInManifest = new Set<string>()

  // Grab all the docs links in the manifest
  await traverseTree({ items: userManifest }, async (item) => {
    if (!item.href?.startsWith(config.baseDocsLink)) return item
    if (item.target !== undefined) return item

    const ignore = config.ignoredPaths(item.href) || config.ignoredLinks(item.href)
    if (ignore === true) return item

    docsInManifest.add(item.href)

    return item
  })
  console.info('✓ Parsed in Manifest')

  abortSignal?.throwIfAborted()

  const cachedDocsSize = store.markdown.size
  // Read in all the docs
  const docsArray = (
    await Promise.all([
      ...docsFiles.map(async (file) => {
        // Check if this is an SDK variant file (e.g., api-doc.react.mdx)
        const sdkMatch = VALID_SDKS.find((sdk) => file.filePathInDocsFolder.endsWith(`.${sdk}.mdx`))

        // For SDK variant files, check if the base href is in manifest instead of the variant href
        let inManifest: boolean
        if (sdkMatch) {
          const baseHref = file.href.replace(`.${sdkMatch}`, '')
          inManifest = docsInManifest.has(baseHref)
        } else {
          inManifest = docsInManifest.has(file.href)
        }

        const markdownFile = await markdownCache(file.filePath, () =>
          parseMarkdownFile(file, partials, tooltips, typedocs, prompts, inManifest, 'docs'),
        )

        if (sdkMatch) {
          // This is an SDK variant file - store it with the special key format for distinct SDK variants lookup
          // e.g., /docs/api-doc.react.mdx becomes /docs/api-doc.react
          const baseHref = file.href.replace(`.${sdkMatch}`, '')
          const variantKey = `${baseHref}.${sdkMatch}`
          docsMap.set(variantKey, markdownFile)
        }
        docsMap.set(file.href, markdownFile)

        return markdownFile
      }),
      ...(apiErrorsFiles
        ? apiErrorsFiles.map(async (file) => {
            const inManifest = docsInManifest.has(file.href)

            const markdownFile = await markdownCache(file.filePath, () =>
              parseMarkdownFile(file, partials, tooltips, typedocs, prompts, inManifest, 'docs'),
            )

            docsMap.set(file.href, markdownFile)

            return markdownFile
          })
        : []),
    ])
  ).map((doc) => {
    if (doc.frontmatter.sdk === undefined) return doc

    const distinctSDKVariants = config.validSdks
      .map((sdk) => (docsMap.get(`${doc.file.href}.${sdk}`) ? sdk : undefined))
      .filter((doc) => doc !== undefined)

    const updatedMarkdownDocument = {
      ...doc,
      distinctSDKVariants,
    }

    docsMap.set(doc.file.href, updatedMarkdownDocument)

    return updatedMarkdownDocument
  })
  console.info(`✓ Loaded in ${docsArray.length} docs (${cachedDocsSize} cached)`)

  abortSignal?.throwIfAborted()

  // Goes through and grabs the sdk scoping out of the manifest
  const sdkScopedManifestFirstPass = await traverseTree(
    { items: userManifest, sdk: undefined as undefined | SDK[] },
    async (item, tree) => {
      if (!item.href?.startsWith(config.baseDocsLink)) {
        return {
          ...item,
          // Either use the sdk of the item, or the parent group if the item doesn't have a sdk
          sdk: item.sdk ?? tree.sdk,
        }
      }

      const ignore = config.ignoredPaths(item.href) || config.ignoredLinks(item.href)
      if (ignore === true) return item // even thou we are not processing them, we still need to keep them

      const doc = docsMap.get(item.href)

      if (doc === undefined) {
        safeMessage(config, manifestVfile, item.href, 'docs', 'doc-not-found', [item.title, item.href])
        return item
      }

      // This is the sdk of the doc
      const docSDK = doc.sdk

      // This is the sdk of the parent group
      const parentSDK = tree.sdk

      // either use the defined sdk of the doc, or the parent group
      const sdk = docSDK ?? parentSDK

      return {
        ...item,
        sdk,
        itemSDK: item.sdk,
      }
    },
    async ({ items, ...details }, tree) => {
      // This is the sdk of the group
      const groupSDK = details.sdk

      // This is the sdk of the parent group
      const parentSDK = tree.sdk

      if (groupSDK !== undefined && groupSDK.length > 0) {
        return {
          ...details,
          sdk: groupSDK,
          items,
        } as ManifestGroup
      }

      const sdk = Array.from(new Set([...(groupSDK ?? []), ...(parentSDK ?? [])])) ?? []

      return {
        ...details,
        sdk: sdk.length > 0 ? sdk : undefined,
        items,
      } as ManifestGroup
    },
    (item, error) => {
      console.error('↳', item.title)
      throw error
    },
  )

  abortSignal?.throwIfAborted()

  const sdkScopedManifest = await traverseTreeItemsFirst(
    { items: sdkScopedManifestFirstPass, sdk: undefined as undefined | SDK[] },
    async (item, tree) => {
      const doc = docsMap.get(item.href)

      // If the doc does not already have an sdk assigned, but the manifest item does, assign the sdk from the manifest to the doc in the docsMap.
      if (doc && doc.sdk === undefined && item.sdk !== undefined) {
        docsMap.set(item.href, { ...doc, sdk: item.sdk })
      }

      const updatedDoc = docsMap.get(item.href)

      if (updatedDoc?.sdk) {
        for (const sdk of [...(updatedDoc.sdk ?? []), ...(updatedDoc.distinctSDKVariants ?? [])]) {
          // For each SDK variant, add an entry to the docsMap with the SDK-specific href,
          // ensuring that links like /docs/react/doc-1 point to the correct doc variant.

          const existingDoc = docsMap.get(
            updatedDoc.distinctSDKVariants?.includes(sdk) ? `${item.href}.${sdk}` : item.href,
          )

          if (existingDoc === undefined) {
            throw new Error(`Existing doc not found for ${item.href}.${sdk}`)
          }

          docsMap.set(item.href.replace(config.baseDocsLink, `${config.baseDocsLink}${sdk}/`), {
            ...existingDoc,
            sdk: [sdk], // override this fake copy of the doc so links to it believe this is the correct sdk
          })
        }
      }

      return item
    },
    async ({ items, ...details }, tree) => {
      // This takes all the children items, grabs the sdks out of them, and combines that in to a list
      const groupsItemsCombinedSDKs = (() => {
        const sdks = items?.flatMap((item) =>
          item.flatMap((item) => {
            // For manifest items with hrefs, include distinctSDKVariants from the document
            if ('href' in item && item.href?.startsWith(config.baseDocsLink)) {
              const doc = docsMap.get(item.href)
              if (doc) {
                const sdks = [...(item.sdk ?? []), ...(doc.distinctSDKVariants ?? [])]
                return sdks.length > 0 ? sdks : undefined
              }
            }
            return item.sdk
          }),
        )

        // If the child sdks is undefined then its core so it supports all sdks
        const uniqueSDKs = Array.from(new Set(sdks.flatMap((sdk) => (sdk !== undefined ? sdk : config.validSdks))))

        return uniqueSDKs
      })()

      // This is the sdk of the group
      const groupSDK = details.sdk

      // This is the sdk of the parent group
      const parentSDK = tree.sdk

      // If there are no children items, then we either use the group we are looking at sdks if its defined, or its parent group
      if (groupsItemsCombinedSDKs.length === 0) {
        return { ...details, sdk: groupSDK ?? parentSDK, items } as ManifestGroup
      }

      // If the group has explicit SDK scoping in the manifest, that takes precedence
      if (groupSDK !== undefined && groupSDK.length > 0) {
        return {
          ...details,
          sdk: groupSDK,
          items,
        } as ManifestGroup
      }

      // If all the children items have the same sdk as the group, then we don't need to set the sdk on the group
      if (groupsItemsCombinedSDKs.length === config.validSdks.length) {
        return { ...details, sdk: undefined, items } as ManifestGroup
      }

      const combinedSDKs = Array.from(new Set([...(groupSDK ?? []), ...groupsItemsCombinedSDKs])) ?? []

      return {
        ...details,
        // If there are children items, then we combine the sdks of the group and the children items sdks
        sdk: combinedSDKs,
        items,
      } as ManifestGroup
    },
    (item, error) => {
      console.error('[DEBUG] Error processing item:', item.title)
      console.error(error)
      throw error
    },
  )
  console.info('✓ Applied manifest sdk scoping')

  abortSignal?.throwIfAborted()

  const flatSDKScopedManifest = flattenTree(sdkScopedManifest)

  abortSignal?.throwIfAborted()

  const validatedPartials = await Promise.all(
    partials.map(async (partial) => {
      try {
        let node: Node | null = null
        const links: Set<string> = new Set()

        const vfile = await remark()
          .use(remarkFrontmatter)
          .use(remarkMdx)
          .use(
            validateLinks(config, docsMap, partial.path, 'partials', (linkInPartial) => {
              links.add(linkInPartial)
            }),
          )
          .use(() => (tree) => {
            node = tree
          })
          .process({ path: partial.vfile.path, value: partial.content })

        if (node === null) {
          throw new Error(errorMessages['partial-parse-error'](partial.path))
        }

        return {
          ...partial,
          node: partial.node, // Use the embedded node (with nested includes)
          vfile, // Use the vfile from validation
          links,
        }
      } catch (error) {
        console.error(`✗ Error validating partial: ${partial.path}`)
        throw error
      }
    }),
  )
  console.info(`✓ Validated all partials`)

  abortSignal?.throwIfAborted()

  const validatedTooltips = await Promise.all(
    tooltips.map(async (tooltip) => {
      if (config.tooltips === null) {
        throw new Error('Tooltips are not enabled')
      }

      const tooltipPath = `${config.tooltips.inputPathRelative}/${tooltip.path}`

      try {
        let node: Node | null = null
        const links: Set<string> = new Set()

        const vfile = await remark()
          .use(remarkMdx)
          .use(
            validateLinks(config, docsMap, tooltipPath, 'tooltips', (linkInTooltip) => {
              links.add(linkInTooltip)
            }),
          )
          .use(() => (tree, vfile) => {
            node = tree
          })
          .process(tooltip.vfile)

        if (node === null) {
          throw new Error(errorMessages['tooltip-parse-error'](tooltip.path))
        }

        return {
          ...tooltip,
          vfile,
          node: node as Node,
          links,
        }
      } catch (error) {
        console.error(`✗ Error validating tooltip: ${tooltip.path}`)
        throw error
      }
    }),
  )
  console.info(`✓ Validated all tooltips`)

  abortSignal?.throwIfAborted()

  const validatedTypedocs = await Promise.all(
    typedocs.map(async (typedoc) => {
      const filePath = path.join(config.typedocRelativePath, typedoc.path)

      try {
        let node: Node | null = null
        const links: Set<string> = new Set()

        const vfile = await remark()
          .use(remarkMdx)
          .use(
            validateLinks(config, docsMap, filePath, 'typedoc', (linkInTypedoc) => {
              links.add(linkInTypedoc)
            }),
          )
          .use(() => (tree, vfile) => {
            node = tree
          })
          .process(typedoc.vfile)

        if (node === null) {
          throw new Error(errorMessages['typedoc-parse-error'](typedoc.path))
        }

        return {
          ...typedoc,
          vfile,
          node: node as Node,
          links,
        }
      } catch (error) {
        try {
          let node: Node | null = null
          const links: Set<string> = new Set()

          const vfile = await remark()
            .use(
              validateLinks(config, docsMap, filePath, 'typedoc', (linkInTypedoc) => {
                links.add(linkInTypedoc)
              }),
            )
            .use(() => (tree, vfile) => {
              node = tree
            })
            .process(typedoc.vfile)

          if (node === null) {
            throw new Error(errorMessages['typedoc-parse-error'](typedoc.path))
          }

          return {
            ...typedoc,
            vfile,
            node: node as Node,
            links,
          }
        } catch (error) {
          console.error(error)
          throw new Error(errorMessages['typedoc-parse-error'](typedoc.path))
        }
      }
    }),
  )
  console.info(`✓ Validated all typedocs`)

  abortSignal?.throwIfAborted()

  await writeFile(
    'manifest.json',
    JSON.stringify({
      flags: siteFlags,
      navigation: await traverseTree(
        { items: sdkScopedManifest },
        async (item) => {
          const doc = docsMap.get(item.href)

          const sdks = [...(doc?.frontmatter?.sdk ?? []), ...(doc?.distinctSDKVariants ?? [])]

          const injectSDK =
            sdks.length >= 1 &&
            !item.href.endsWith(`/${sdks[0]}`) &&
            !item.href.includes(`/${sdks[0]}/`) &&
            // Don't inject SDK scoping for documents that only support one SDK
            sdks.length > 1

          if (injectSDK) {
            return {
              title: item.title,
              href: scopeHref(item.href, ':sdk:'),
              tag: item.tag,
              wrap: item.wrap === config.manifestOptions.wrapDefault ? undefined : item.wrap,
              icon: item.icon,
              target: item.target,
              // @ts-expect-error - It exists, up on line 481
              sdk: item.itemSDK ?? sdks,
              shortcut: item.shortcut,
            }
          }

          return {
            title: item.title,
            // href: item.href,
            href: injectSDK ? scopeHref(item.href, ':sdk:') : item.href,
            tag: item.tag,
            wrap: item.wrap === config.manifestOptions.wrapDefault ? undefined : item.wrap,
            icon: item.icon,
            target: item.target,
            sdk: item.sdk,
            shortcut: item.shortcut,
          }
        },
        // @ts-expect-error - This traverseTree function might just be the death of me
        async (group) => ({
          title: group.title,
          collapse: group.collapse,
          tag: group.tag,
          wrap: group.wrap === config.manifestOptions.wrapDefault ? undefined : group.wrap,
          icon: group.icon,
          hideTitle: group.hideTitle === config.manifestOptions.hideTitleDefault ? undefined : group.hideTitle,
          sdk: group.sdk,
          items: group.items,
        }),
      ),
    }),
  )

  abortSignal?.throwIfAborted()

  const cachedCoreDocsSize = store.coreDocs.size
  const coreDocs = await Promise.all(
    docsArray.map(async (doc) => {
      const foundLinks: Set<string> = new Set()
      const foundPartials: Set<string> = new Set()
      const foundTypedocs: Set<string> = new Set()
      const foundTooltips: Set<string> = new Set()

      const sdks = [...(doc.sdk ?? []), ...(doc.distinctSDKVariants ?? [])]

      const vfile = await coreDocCache(doc.file.filePath, async () =>
        remark()
          .use(remarkFrontmatter)
          .use(remarkMdx)
          .use(
            validateLinks(
              config,
              docsMap,
              doc.file.filePath,
              'docs',
              (link) => {
                foundLinks.add(link)
              },
              doc.file.href,
            ),
          )
          .use(
            checkPartials(config, validatedPartials, doc.file, { reportWarnings: false, embed: true }, (partial) => {
              foundPartials.add(partial)
            }),
          )
          .use(
            checkTooltips(config, validatedTooltips, doc.file, { reportWarnings: false, embed: true }, (tooltip) => {
              foundTooltips.add(tooltip)
            }),
          )
          .use(
            checkTypedoc(
              config,
              validatedTypedocs,
              doc.file.filePath,
              { reportWarnings: false, embed: true },
              (typedoc) => {
                foundTypedocs.add(typedoc)
              },
            ),
          )
          .use(checkPrompts(config, prompts, doc.file, { reportWarnings: false, update: true }))
          .use(
            embedLinks(
              config,
              docsMap,
              sdks,
              (link) => {
                foundLinks.add(link)
              },
              doc.file.href,
              undefined, // No target SDK for core documents
            ),
          )
          .use(validateIfComponents(config, doc.file.filePath, doc, flatSDKScopedManifest))
          .use(
            insertFrontmatter({
              lastUpdated: (await getCommitDate(doc.file.fullFilePath))?.toISOString() ?? undefined,
              sdkScoped: 'false',
              canonical: doc.file.href.replace('/index', ''),
              sourceFile: `/docs/${doc.file.filePathInDocsFolder}`,
            }),
          )
          .process(doc.vfile),
      )

      const partialsLinks = validatedPartials
        .filter((partial) => foundPartials.has(`_partials/${partial.path}`))
        .reduce((acc, { links }) => new Set([...acc, ...links]), foundPartials)

      const typedocsLinks = validatedTypedocs
        .filter((typedoc) => foundTypedocs.has(typedoc.path))
        .reduce((acc, { links }) => new Set([...acc, ...links]), foundTypedocs)

      const tooltipsLinks = validatedTooltips
        .filter((tooltip) => foundTooltips.has(tooltip.path))
        .reduce((acc, { links }) => new Set([...acc, ...links]), foundTooltips)

      const allLinks = new Set([...foundLinks, ...partialsLinks, ...typedocsLinks, ...tooltipsLinks])

      allLinks.forEach((link) => {
        markDirty(doc.file.filePath, link)
      })

      return { ...doc, vfile }
    }),
  )
  console.info(`✓ Validated all core docs (${cachedCoreDocsSize} cached)`)

  abortSignal?.throwIfAborted()

  await Promise.all(
    coreDocs.map(async (doc) => {
      // Skip SDK variant files (e.g., file.react.mdx, file.nextjs.mdx) - they should not be written as standalone files
      if (VALID_SDKS.some((sdk) => doc.file.filePathInDocsFolder.endsWith(`.${sdk}.mdx`))) {
        return
      }

      if (isValidSdk(config)(doc.file.filePathInDocsFolder.split('/')[0])) {
        if (!shouldIgnoreWarning(config, doc.file.filePath, 'docs', 'sdk-path-conflict')) {
          throw new Error(errorMessages['sdk-path-conflict'](doc.file.href, doc.file.filePathInDocsFolder))
        }
      }

      if (doc.sdk !== undefined) {
        // Check if the href already contains an SDK name (e.g., /docs/references/react/guide contains 'react')
        const hrefSegments = doc.file.href.split('/')
        const sdks = [...(doc.sdk ?? []), ...(doc.distinctSDKVariants ?? [])]
        const hrefAlreadyContainsSdk = sdks.some((sdk) => hrefSegments.includes(sdk))

        // Check if this document only supports one SDK (regardless of how many SDKs are available overall)
        // If a document only supports one SDK, there's no choice to be made, so no redirect page needed
        const isSingleSdkDocument = sdks.length === 1

        // Only create a redirect page if:
        // 1. The href doesn't already contain the SDK name, AND
        // 2. It's not a single SDK scenario (where there's no choice to be made)
        const needsRedirectPage = !hrefAlreadyContainsSdk && !isSingleSdkDocument

        if (needsRedirectPage) {
          // This is a sdk specific doc with multiple options, so we want to put a landing page here to redirect the user to a doc customized to their sdk.

          // get the same canonical value as the doc
          const hrefSegments = doc.file.href.split('/')
          const hrefAlreadyContainsSdk = sdks.some((sdk) => hrefSegments.includes(sdk))
          const isSingleSdkDocument = sdks.length === 1

          const canonical =
            hrefAlreadyContainsSdk || isSingleSdkDocument
              ? doc.file.href
              : scopeHrefToSDK(config)(doc.file.href, ':sdk:')

          await writeFile(
            doc.file.filePathInDocsFolder,
            `---
${yaml.stringify({
  template: 'wide',
  redirectPage: 'true',
  availableSdks: sdks.join(','),
  notAvailableSdks: config.validSdks.filter((sdk) => !sdks?.includes(sdk)).join(','),
  search: { exclude: true },
  canonical: canonical.replace('/index', ''),
})}---
<SDKDocRedirectPage title="${doc.frontmatter.title}"${doc.frontmatter.description ? ` description="${doc.frontmatter.description}" ` : ' '}href="${scopeHrefToSDK(config)(doc.file.href, ':sdk:')}" sdks={${JSON.stringify(sdks)}} />`,
          )
        } else {
          // All SDK documents (single and multi) will be processed in the SDK-specific loop below
        }
      } else {
        await writeFile(doc.file.filePathInDocsFolder, typedocTableSpecialCharacters.decode(doc.vfile.value as string))
      }
    }),
  )

  console.info(`✓ Wrote out all core docs (${coreDocs.length} total)`)

  abortSignal?.throwIfAborted()

  const sdkSpecificVFiles = await Promise.all(
    config.validSdks.map(async (targetSdk) => {
      const vFiles = await Promise.all(
        docsArray.map(async (doc) => {
          if (doc.sdk === undefined) return null // skip core docs

          // skip docs that are not for the target sdk
          if (doc.sdk.includes(targetSdk) === false && doc.distinctSDKVariants?.includes(targetSdk) === false)
            return null

          // Don't write out files that end in .{sdk}.mdx
          if (doc.file.filePathInDocsFolder.endsWith(`.${targetSdk}.mdx`)) return null

          // if the doc has distinct version, we want to use those instead of the "generic" sdk scoped version
          const { fileContent, sourceFile } = (() => {
            if (doc.distinctSDKVariants?.includes(targetSdk)) {
              const distinctSDKVariant = docsMap.get(`${doc.file.href}.${targetSdk}`)

              if (distinctSDKVariant !== undefined) {
                return {
                  fileContent: distinctSDKVariant.fileContent,
                  sourceFile: `/docs/${distinctSDKVariant.file.filePathInDocsFolder}`,
                }
              }
            }
            return {
              fileContent: doc.fileContent,
              sourceFile: `/docs/${doc.file.filePathInDocsFolder}`,
            }
          })()
          const sdks = [...(doc.sdk ?? []), ...(doc.distinctSDKVariants ?? [])]

          const hrefSegments = doc.file.href.split('/')
          const hrefAlreadyContainsSdk = sdks.some((sdk) => hrefSegments.includes(sdk))
          const isSingleSdkDocument = sdks.length === 1

          const canonical =
            hrefAlreadyContainsSdk || isSingleSdkDocument
              ? doc.file.href
              : scopeHrefToSDK(config)(doc.file.href, ':sdk:')

          const vfile = await scopedDocCache(targetSdk, doc.file.filePath, async () =>
            remark()
              .use(remarkFrontmatter)
              .use(remarkMdx)
              .use(validateLinks(config, docsMap, doc.file.filePath, 'docs', undefined, doc.file.href))
              .use(checkPartials(config, partials, doc.file, { reportWarnings: true, embed: true }))
              .use(checkTooltips(config, tooltips, doc.file, { reportWarnings: true, embed: true }))
              .use(checkTypedoc(config, typedocs, doc.file.filePath, { reportWarnings: true, embed: true }))
              .use(checkPrompts(config, prompts, doc.file, { reportWarnings: true, update: true }))
              .use(embedLinks(config, docsMap, sdks, undefined, doc.file.href, targetSdk))
              .use(filterOtherSDKsContentOut(config, doc.file.filePath, targetSdk))
              .use(validateUniqueHeadings(config, doc.file.filePath, 'docs'))
              .use(
                insertFrontmatter({
                  sdkScoped: 'true',
                  canonical: canonical.replace('/index', ''),
                  lastUpdated: (await getCommitDate(doc.file.fullFilePath))?.toISOString() ?? undefined,
                  sdk: sdks.join(', '),
                  availableSdks: sdks?.join(','),
                  notAvailableSdks: config.validSdks.filter((sdk) => !sdks?.includes(sdk)).join(','),
                  activeSdk: targetSdk,
                  sourceFile: sourceFile,
                }),
              )
              .process({
                path: doc.file.filePath,
                value: fileContent,
              }),
          )

          // For single SDK documents or documents with SDK already in path, write to root path
          if (hrefAlreadyContainsSdk || isSingleSdkDocument) {
            await writeFile(doc.file.filePathInDocsFolder, typedocTableSpecialCharacters.decode(vfile.value as string))
          } else {
            await writeSdkFile(
              targetSdk,
              doc.file.filePathInDocsFolder,
              typedocTableSpecialCharacters.decode(vfile.value as string),
            )
          }

          return vfile
        }),
      )

      const numberOfSdkSpecificDocs = vFiles.filter(Boolean).length

      if (numberOfSdkSpecificDocs > 0) {
        console.info(`✓ Wrote out ${numberOfSdkSpecificDocs} ${targetSdk} specific docs`)
      }

      return { targetSdk, vFiles }
    }),
  )

  abortSignal?.throwIfAborted()

  const docsWithOnlyIfComponents = docsArray.filter((doc) => doc.sdk === undefined && documentHasIfComponents(doc.node))
  const extractSDKsFromIfComponent = extractSDKsFromIfProp(config)

  const headingValidationVFiles: VFile[] = []

  for (const doc of docsWithOnlyIfComponents) {
    // Extract all SDK values from <If /> components
    const availableSDKs = new Set<SDK>()

    mdastVisit(doc.node, (node) => {
      const sdkProp = extractComponentPropValueFromNode(
        config,
        node,
        undefined,
        'If',
        'sdk',
        true,
        'docs',
        doc.file.filePath,
        z.string(),
      )

      if (sdkProp === undefined) return

      const sdks = extractSDKsFromIfComponent(node, undefined, sdkProp, 'docs', doc.file.filePath)

      if (sdks === undefined) return

      sdks.forEach((sdk) => availableSDKs.add(sdk))
    })

    for (const sdk of availableSDKs) {
      const vfile = await remark()
        .use(remarkFrontmatter)
        .use(remarkMdx)
        .use(() => (inputTree) => {
          return mdastFilter(inputTree, (node) => {
            const sdkProp = extractComponentPropValueFromNode(
              config,
              node,
              undefined,
              'If',
              'sdk',
              false,
              'docs',
              doc.file.filePath,
              z.string(),
            )
            if (!sdkProp) return true

            const ifSdks = extractSDKsFromIfComponent(node, undefined, sdkProp, 'docs', doc.file.filePath)

            if (!ifSdks) return true

            return ifSdks.includes(sdk)
          })
        })
        .use(validateUniqueHeadings(config, doc.file.filePath, 'docs'))
        .process({
          path: doc.file.filePath,
          value: String(doc.vfile),
        })

      headingValidationVFiles.push(vfile)
    }
  }

  abortSignal?.throwIfAborted()

  // Write directory.json with a flat list of all markdown files in dist, excluding partials
  const mdxFiles = await readdirp.promise(config.distTempPath, {
    type: 'files',
    fileFilter: '*.mdx',
    alwaysStat: false,
  })
  const mdxFilePaths = mdxFiles
    .map((entry) => entry.path.replace(/\\/g, '/')) // Replace backslashes with forward slashes
    .filter((filePath) => !filePath.includes(config.partialsFolderName)) // Exclude partials
    .map((path) => ({
      path,
      url: `${config.baseDocsLink}${removeMdxSuffix(path)
        .replace(/^index$/, '') // remove root index
        .replace(/\/index$/, '')}`, // remove /index from the end,
    }))

  await writeFile('directory.json', JSON.stringify(mdxFilePaths))

  console.info('✓ Wrote out directory.json')

  abortSignal?.throwIfAborted()

  if (staticRedirects !== null && dynamicRedirects !== null) {
    await writeRedirects(config, staticRedirects, dynamicRedirects)
    console.info('✓ Wrote redirects to disk')
  }

  abortSignal?.throwIfAborted()

  if (prompts.length > 0) {
    await writePrompts(config, prompts)
    console.info(`✓ Wrote ${prompts.length} prompts to disk`)
  }

  abortSignal?.throwIfAborted()

  if (config.llms?.fullPath || config.llms?.overviewPath) {
    const outputtedDocsFiles = listOutputDocsFiles(config, store.writtenFiles, mdxFilePaths)

    if (config.llms?.fullPath) {
      const llmsFull = await generateLLMsFull(outputtedDocsFiles)
      await writeFile(config.llms.fullPath, llmsFull)
    }

    if (config.llms?.overviewPath) {
      const llms = await generateLLMs(outputtedDocsFiles)
      await writeFile(config.llms.overviewPath, llms)
    }
  }

  abortSignal?.throwIfAborted()

  if (config.siteFlags) {
    await writeSiteFlags(config, siteFlags)
    console.info(`✓ Wrote ${Object.keys(siteFlags).length} site flags to disk`)
  }

  abortSignal?.throwIfAborted()

  const flatSdkSpecificVFiles = sdkSpecificVFiles
    .flatMap(({ vFiles }) => vFiles)
    .filter((item): item is NonNullable<typeof item> => item !== null)

  const coreVFiles = coreDocs.map((doc) => doc.vfile)
  const partialsVFiles = validatedPartials.map((partial) => partial.vfile)
  const tooltipsVFiles = validatedTooltips.map((tooltip) => tooltip.vfile)
  const typedocVFiles = validatedTypedocs.map((typedoc) => typedoc.vfile)

  const warnings = reporter(
    [
      ...coreVFiles,
      ...partialsVFiles,
      ...tooltipsVFiles,
      ...typedocVFiles,
      ...flatSdkSpecificVFiles,
      manifestVfile,
      ...headingValidationVFiles,
    ],
    {
      quiet: true,
    },
  )

  abortSignal?.throwIfAborted()

  if (config.flags.watch) {
    // While in dev, we just want to symlink the new dist to the dist folder
    // This removes the issue that fs.cp can't replace a folder
    // We don't need to worry about the public folder because in dev clerk/clerk just looks in the original public folder
    await symlinkDir(config.distTempPath, config.distFinalPath, { overwrite: true })

    // Sometimes this symlink will move the current dist folder to .ignored_dist
    if (existsSync(`.ignored_dist`)) {
      console.info('✓ Removing .ignored_dist folder')
      await fs.rm(`.ignored_dist`, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  } else if (process.env.VERCEL === '1') {
    // In vercel ci the temp dir and the final dir will be on separate partitions so fs.rename() will fail
    await fs.cp(config.distTempPath, config.distFinalPath, { recursive: true })
    if (config.publicPath) {
      await fs.cp(config.publicPath, path.join(config.distFinalPath, '_public'), { recursive: true })
    }
    // We don't need to worry about temp folders as the ci runner will be destroyed after this anyways
  } else {
    // During a standard build
    // If the dist folder already exists, remove it
    if (existsSync(config.distFinalPath)) {
      await fs.rm(config.distFinalPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
    // Copy over our new dist folder from temp
    await fs.cp(config.distTempPath, config.distFinalPath, { recursive: true })
    // Remove the temp dist folder
    await fs.rm(config.distTempPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    // Copy over the public folder
    if (config.publicPath) {
      await fs.cp(config.publicPath, path.join(config.distFinalPath, '_public'), { recursive: true })
    }
  }

  abortSignal?.throwIfAborted()

  return warnings
}
