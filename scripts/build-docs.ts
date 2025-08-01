import yaml from 'yaml'
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
import { Node } from 'unist'
import { filter as mdastFilter } from 'unist-util-filter'
import { visit as mdastVisit } from 'unist-util-visit'
import reporter from 'vfile-reporter'
import { z } from 'zod'
import symlinkDir from 'symlink-dir'

import { generateApiErrorDocs } from './lib/api-errors'
import { createConfig, type BuildConfig } from './lib/config'
import { watchAndRebuild } from './lib/dev'
import { errorMessages, safeMessage, shouldIgnoreWarning } from './lib/error-messages'
import { getLastCommitDate } from './lib/getLastCommitDate'
import { ensureDirectory, readDocsFolder, writeDistFile, writeSDKFile } from './lib/io'
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

import { checkPartials } from './lib/plugins/checkPartials'
import { checkTypedoc } from './lib/plugins/checkTypedoc'
import { filterOtherSDKsContentOut } from './lib/plugins/filterOtherSDKsContentOut'
import { insertFrontmatter } from './lib/plugins/insertFrontmatter'
import { validateAndEmbedLinks } from './lib/plugins/validateAndEmbedLinks'
import { validateIfComponents } from './lib/plugins/validateIfComponents'
import { validateUniqueHeadings } from './lib/plugins/validateUniqueHeadings'
import {
  analyzeAndFixRedirects as optimizeRedirects,
  readRedirects,
  transformRedirectsToObject,
  writeRedirects,
  type Redirect,
} from './lib/redirects'
import { type Prompt, readPrompts, writePrompts, checkPrompts } from './lib/prompts'
import { removeMdxSuffix } from './lib/utils/removeMdxSuffix'
import { writeLLMs as generateLLMs, writeLLMsFull as generateLLMsFull, listOutputDocsFiles } from './lib/llms'
import { VFile } from 'vfile'
import { readTooltipsFolder, readTooltipsMarkdown, writeTooltips } from './lib/tooltips'
import { Flags, readSiteFlags, writeSiteFlags } from './lib/siteFlags'

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
    partialsPath: '../docs/_partials',
    distPath: '../dist',
    typedocPath: '../clerk-typedoc',
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
        'quickstarts/overview.mdx': ['doc-not-in-manifest'],
        'references/overview.mdx': ['doc-not-in-manifest'],
        'maintenance-mode.mdx': ['doc-not-in-manifest'],
        'deployments/staging-alternatives.mdx': ['doc-not-in-manifest'],
        'references/nextjs/usage-with-older-versions.mdx': ['doc-not-in-manifest'],
        'references/nextjs/errors/auth-was-called.mdx': ['doc-not-in-manifest'],
        'upgrade-guides/core-2/nextjs.mdx': ['doc-not-in-manifest'],
        'upgrade-guides/core-2/backend.mdx': ['doc-not-in-manifest'],
        'upgrade-guides/core-2/node.mdx': ['doc-not-in-manifest'],
        'upgrade-guides/core-2/expo.mdx': ['doc-not-in-manifest'],
        'upgrade-guides/core-2/fastify.mdx': ['doc-not-in-manifest'],
        'upgrade-guides/core-2/chrome-extension.mdx': ['doc-not-in-manifest'],
        'upgrade-guides/core-2/react.mdx': ['doc-not-in-manifest'],
        'upgrade-guides/core-2/remix.mdx': ['doc-not-in-manifest'],
        'upgrade-guides/core-2/javascript.mdx': ['doc-not-in-manifest'],
      },
      typedoc: {
        'types/active-session-resource.mdx': ['link-hash-not-found'],
        'types/pending-session-resource.mdx': ['link-hash-not-found'],
        'types/organization-custom-role-key.mdx': ['link-doc-not-found'],

        // temp migration ignores
        'backend/auth-object.mdx': ['link-doc-not-found'],
        'backend/authenticate-request-options.mdx': ['link-doc-not-found'],
        'backend/organization-membership-public-user-data.mdx': ['link-doc-not-found'],
        'backend/organization.mdx': ['link-doc-not-found'],
        'backend/public-organization-data-json.mdx': ['link-doc-not-found'],
        'backend/verify-token-options.mdx': ['link-doc-not-found'],
        'backend/verify-token.mdx': ['link-doc-not-found'],
        'backend/verify-webhook-options.mdx': ['link-doc-not-found'],
        'backend/verify-webhook.mdx': ['link-doc-not-found'],
        'clerk-react/clerk-provider-props.mdx': ['link-doc-not-found'],
        'nextjs/clerk-middleware-options.mdx': ['link-doc-not-found'],
      },
      partials: {},
      tooltips: {},
    },
    validSdks: VALID_SDKS,
    manifestOptions: {
      wrapDefault: true,
      collapseDefault: false,
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
  const writeTooltipsToDist = writeTooltips(config, store)

  abortSignal?.throwIfAborted()

  await ensureDirectory(config.distFinalPath)

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
  const docsArray = await Promise.all([
    ...docsFiles.map(async (file) => {
      const inManifest = docsInManifest.has(file.href)

      const markdownFile = await markdownCache(file.filePath, () =>
        parseMarkdownFile(file, partials, typedocs, prompts, inManifest, 'docs'),
      )

      docsMap.set(file.href, markdownFile)
      return markdownFile
    }),
    ...(apiErrorsFiles
      ? apiErrorsFiles.map(async (file) => {
          const inManifest = docsInManifest.has(file.href)

          const markdownFile = await markdownCache(file.filePath, () =>
            parseMarkdownFile(file, partials, typedocs, prompts, inManifest, 'docs'),
          )

          docsMap.set(file.href, markdownFile)

          return markdownFile
        })
      : []),
  ])
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

      if (docSDK !== undefined && parentSDK !== undefined) {
        if (docSDK.every((sdk) => parentSDK?.includes(sdk)) === false) {
          if (!shouldIgnoreWarning(config, `${item.href}.mdx`, 'docs', 'doc-sdk-filtered-by-parent')) {
            throw new Error(errorMessages['doc-sdk-filtered-by-parent'](item.title, docSDK, parentSDK))
          }
        }
      }

      return {
        ...item,
        sdk,
      }
    },
    async ({ items, ...details }, tree) => {
      // This takes all the children items, grabs the sdks out of them, and combines that in to a list
      const groupsItemsCombinedSDKs = (() => {
        const sdks = items?.flatMap((item) => item.flatMap((item) => item.sdk))

        if (sdks === undefined) return []

        return Array.from(new Set(sdks)).filter((sdk): sdk is SDK => sdk !== undefined)
      })()

      // This is the sdk of the group
      const groupSDK = details.sdk

      // This is the sdk of the parent group
      const parentSDK = tree.sdk

      // If there are no children items, then the we either use the group we are looking at sdks if its defined, or its parent group
      if (groupsItemsCombinedSDKs.length === 0) {
        return { ...details, sdk: groupSDK ?? parentSDK, items } as ManifestGroup
      }

      if (groupSDK !== undefined && groupSDK.length > 0) {
        return {
          ...details,
          sdk: groupSDK,
          items,
        } as ManifestGroup
      }

      return {
        ...details,
        // If there are children items, then we combine the sdks of the group and the children items sdks
        sdk: Array.from(new Set([...(groupSDK ?? []), ...groupsItemsCombinedSDKs])) ?? [],
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

      if (doc && doc.sdk === undefined && item.sdk !== undefined) {
        docsMap.set(item.href, { ...doc, sdk: item.sdk })
      }

      return item
    },
    async ({ items, ...details }, tree) => {
      // This takes all the children items, grabs the sdks out of them, and combines that in to a list
      const groupsItemsCombinedSDKs = (() => {
        const sdks = items?.flatMap((item) => item.flatMap((item) => item.sdk))

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

      // If all the children items have the same sdk as the group, then we don't need to set the sdk on the group
      if (groupsItemsCombinedSDKs.length === config.validSdks.length) {
        return { ...details, sdk: undefined, items } as ManifestGroup
      }

      if (groupSDK !== undefined && groupSDK.length > 0) {
        return {
          ...details,
          sdk: groupSDK,
          items,
        } as ManifestGroup
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
      const partialPath = `${config.partialsRelativePath}/${partial.path}`

      try {
        let node: Node | null = null
        const links: Set<string> = new Set()

        const vfile = await remark()
          .use(remarkFrontmatter)
          .use(remarkMdx)
          .use(
            validateAndEmbedLinks(config, docsMap, partialPath, 'partials', (linkInPartial) => {
              links.add(linkInPartial)
            }),
          )
          .use(() => (tree, vfile) => {
            node = tree
          })
          .process(partial.vfile)

        if (node === null) {
          throw new Error(errorMessages['partial-parse-error'](partial.path))
        }

        return {
          ...partial,
          node: node as Node,
          vfile,
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
            validateAndEmbedLinks(config, docsMap, tooltipPath, 'tooltips', (linkInTooltip) => {
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
            validateAndEmbedLinks(config, docsMap, filePath, 'typedoc', (linkInTypedoc) => {
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
              validateAndEmbedLinks(config, docsMap, filePath, 'typedoc', (linkInTypedoc) => {
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

          const injectSDK =
            doc?.frontmatter?.sdk !== undefined &&
            doc.frontmatter.sdk.length >= 1 &&
            !item.href.endsWith(`/${doc.frontmatter.sdk[0]}`) &&
            !item.href.includes(`/${doc.frontmatter.sdk[0]}/`)

          return {
            title: item.title,
            href: injectSDK ? scopeHref(item.href, ':sdk:') : item.href,
            tag: item.tag,
            wrap: item.wrap === config.manifestOptions.wrapDefault ? undefined : item.wrap,
            icon: item.icon,
            target: item.target,
            sdk: item.sdk,
          }
        },
        // @ts-expect-error - This traverseTree function might just be the death of me
        async (group) => ({
          title: group.title,
          collapse: group.collapse === config.manifestOptions.collapseDefault ? undefined : group.collapse,
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

      const vfile = await coreDocCache(doc.file.filePath, async () =>
        remark()
          .use(remarkFrontmatter)
          .use(remarkMdx)
          .use(
            validateAndEmbedLinks(
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
          .use(validateIfComponents(config, doc.file.filePath, doc, flatSDKScopedManifest))
          .use(
            insertFrontmatter({
              lastUpdated: (await getCommitDate(doc.file.fullFilePath))?.toISOString() ?? undefined,
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

      const allLinks = new Set([...foundLinks, ...partialsLinks, ...typedocsLinks])

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
      if (isValidSdk(config)(doc.file.filePathInDocsFolder.split('/')[0])) {
        if (!shouldIgnoreWarning(config, doc.file.filePath, 'docs', 'sdk-path-conflict')) {
          throw new Error(errorMessages['sdk-path-conflict'](doc.file.href, doc.file.filePathInDocsFolder))
        }
      }

      if (doc.sdk !== undefined) {
        // This is a sdk specific doc, so we want to put a landing page here to redirect the user to a doc customized to their sdk.

        await writeFile(
          doc.file.filePathInDocsFolder,
          `---
${yaml.stringify({
  template: 'wide',
  redirectPage: 'true',
  availableSdks: doc.sdk.join(','),
  notAvailableSdks: config.validSdks.filter((sdk) => !doc.sdk?.includes(sdk)).join(','),
})}---
<SDKDocRedirectPage title="${doc.frontmatter.title}"${doc.frontmatter.description ? ` description="${doc.frontmatter.description}" ` : ' '}href="${scopeHrefToSDK(config)(doc.file.href, ':sdk:')}" sdks={${JSON.stringify(doc.sdk)}} />`,
        )
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
          if (doc.sdk.includes(targetSdk) === false) return null // skip docs that are not for the target sdk

          const vfile = await scopedDocCache(targetSdk, doc.file.filePath, async () =>
            remark()
              .use(remarkFrontmatter)
              .use(remarkMdx)
              .use(validateAndEmbedLinks(config, docsMap, doc.file.filePath, 'docs', undefined, doc.file.href))
              .use(checkPartials(config, partials, doc.file, { reportWarnings: true, embed: true }))
              .use(checkTypedoc(config, typedocs, doc.file.filePath, { reportWarnings: true, embed: true }))
              .use(checkPrompts(config, prompts, doc.file, { reportWarnings: true, update: true }))
              .use(filterOtherSDKsContentOut(config, doc.file.filePath, targetSdk))
              .use(validateUniqueHeadings(config, doc.file.filePath, 'docs'))
              .use(
                insertFrontmatter({
                  sdkScoped: 'true',
                  canonical: doc.sdk ? scopeHrefToSDK(config)(doc.file.href, ':sdk:') : doc.file.href,
                  lastUpdated: (await getCommitDate(doc.file.fullFilePath))?.toISOString() ?? undefined,
                  availableSdks: doc.sdk?.join(','),
                  notAvailableSdks: config.validSdks.filter((sdk) => !doc.sdk?.includes(sdk)).join(','),
                  activeSdk: targetSdk,
                }),
              )
              .process({
                path: doc.file.filePath,
                value: doc.fileContent,
              }),
          )

          await writeSdkFile(
            targetSdk,
            doc.file.filePathInDocsFolder,
            typedocTableSpecialCharacters.decode(vfile.value as string),
          )

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
    // Extract all SDK values from <If /> all components
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
    .filter((filePath) => !filePath.startsWith(config.partialsRelativePath)) // Exclude partials
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

  if (config.tooltips) {
    await writeTooltipsToDist(validatedTooltips)
    console.info(`✓ Wrote ${validatedTooltips.length} tooltips to disk`)
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

  await fs.rm(config.distFinalPath, { recursive: true })

  abortSignal?.throwIfAborted()

  if (process.env.VERCEL === '1') {
    // In vercel ci the temp dir and the final dir will be on separate partitions so fs.rename() will fail
    await fs.cp(config.distTempPath, config.distFinalPath, { recursive: true })
    await fs.rm(config.distTempPath, { recursive: true })
  } else {
    await fs.rename(config.distTempPath, config.distFinalPath)
  }

  abortSignal?.throwIfAborted()

  if (config.publicPath) {
    if (config.flags.watch) {
      await symlinkDir(config.publicPath, path.join(config.distFinalPath, '_public'))
    } else {
      await fs.cp(config.publicPath, path.join(config.distFinalPath, '_public'), { recursive: true })
    }
  }

  abortSignal?.throwIfAborted()

  return warnings
}
