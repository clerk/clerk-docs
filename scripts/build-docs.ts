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
//   - Embeds partial content into markdown files
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
import { remark } from 'remark'
import remarkFrontmatter from 'remark-frontmatter'
import remarkMdx from 'remark-mdx'
import { Node } from 'unist'
import { filter as mdastFilter } from 'unist-util-filter'
import { visit as mdastVisit } from 'unist-util-visit'
import reporter from 'vfile-reporter'

import { createConfig, type BuildConfig } from './lib/config'
import { watchAndRebuild } from './lib/dev'
import { errorMessages, shouldIgnoreWarning } from './lib/error-messages'
import { ensureDirectory, readDocsFolder, writeDistFile, writeSDKFile } from './lib/io'
import { flattenTree, ManifestGroup, readManifest, traverseTree, traverseTreeItemsFirst } from './lib/manifest'
import { parseInMarkdownFile } from './lib/markdown'
import { readPartialsFolder, readPartialsMarkdown } from './lib/partials'
import { isValidSdk, VALID_SDKS, type SDK } from './lib/schemas'
import { createBlankStore, DocsMap, getMarkdownCache, Store } from './lib/store'
import { readTypedocsFolder, readTypedocsMarkdown, typedocTableSpecialCharacters } from './lib/typedoc'

import { documentHasIfComponents } from './lib/utils/documentHasIfComponents'
import { extractComponentPropValueFromNode } from './lib/utils/extractComponentPropValueFromNode'
import { extractSDKsFromIfProp } from './lib/utils/extractSDKsFromIfProp'
import { removeMdxSuffix } from './lib/utils/removeMdxSuffix'
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
} from './lib/redirects'

// Only invokes the main function if we run the script directly eg npm run build, bun run ./scripts/build-docs.ts
if (require.main === module) {
  main()
}

async function main() {
  const args = process.argv.slice(2)

  const config = createConfig({
    basePath: __dirname,
    docsPath: '../docs',
    baseDocsLink: '/docs/',
    manifestPath: '../docs/manifest.json',
    partialsPath: '../docs/_partials',
    distPath: '../dist',
    typedocPath: '../clerk-typedoc',
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
    ignoreLinks: [
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
      },
      typedoc: {
        'types/active-session-resource.mdx': ['link-hash-not-found'],
        'types/pending-session-resource.mdx': ['link-hash-not-found'],
      },
      partials: {},
    },
    validSdks: VALID_SDKS,
    manifestOptions: {
      wrapDefault: true,
      collapseDefault: false,
      hideTitleDefault: false,
    },
    cleanDist: false,
    flags: {
      watch: args.includes('--watch'),
      controlled: args.includes('--controlled'),
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

    watchAndRebuild(store, { ...config, cleanDist: true }, build)
  } else if (output !== '') {
    process.exit(1)
  }
}

export async function build(config: BuildConfig, store: Store = createBlankStore()) {
  // Apply currying to create functions pre-configured with config
  const ensureDir = ensureDirectory(config)
  const getManifest = readManifest(config)
  const getDocsFolder = readDocsFolder(config)
  const getPartialsFolder = readPartialsFolder(config)
  const getPartialsMarkdown = readPartialsMarkdown(config, store)
  const getTypedocsFolder = readTypedocsFolder(config)
  const getTypedocsMarkdown = readTypedocsMarkdown(config, store)
  const parseMarkdownFile = parseInMarkdownFile(config)
  const writeFile = writeDistFile(config)
  const writeSdkFile = writeSDKFile(config)
  const markdownCache = getMarkdownCache(store)

  await ensureDir(config.distPath)

  if (config.redirects) {
    const { staticRedirects, dynamicRedirects } = await readRedirects(config)

    const optimizedStaticRedirects = optimizeRedirects(staticRedirects)
    const transformedStaticRedirects = transformRedirectsToObject(optimizedStaticRedirects)

    await writeRedirects(config, transformedStaticRedirects, dynamicRedirects)
    console.info('✓ Wrote redirects to disk')
  }

  const userManifest = await getManifest()
  console.info('✓ Read Manifest')

  const docsFiles = await getDocsFolder()
  console.info('✓ Read Docs Folder')

  const cachedPartialsSize = store.partials.size
  const partials = await getPartialsMarkdown((await getPartialsFolder()).map((item) => item.path))
  console.info(`✓ Loaded in ${partials.length} partials (${cachedPartialsSize} cached)`)

  const cachedTypedocsSize = store.typedocs.size
  const typedocs = await getTypedocsMarkdown((await getTypedocsFolder()).map((item) => item.path))
  console.info(`✓ Read ${typedocs.length} Typedocs (${cachedTypedocsSize} cached)`)

  const docsMap: DocsMap = new Map()
  const docsInManifest = new Set<string>()

  // Grab all the docs links in the manifest
  await traverseTree({ items: userManifest }, async (item) => {
    if (!item.href?.startsWith(config.baseDocsLink)) return item
    if (item.target !== undefined) return item

    const ignore = config.ignoredLink(item.href)
    if (ignore === true) return item

    docsInManifest.add(item.href)

    return item
  })
  console.info('✓ Parsed in Manifest')

  const cachedDocsSize = store.markdown.size
  // Read in all the docs
  const docsArray = await Promise.all(
    docsFiles.map(async (file) => {
      const href = removeMdxSuffix(`${config.baseDocsLink}${file.path}`)
      const inManifest = docsInManifest.has(href)

      const markdownFile = await markdownCache(href, () =>
        parseMarkdownFile(href, partials, typedocs, inManifest, 'docs'),
      )

      docsMap.set(href, markdownFile)
      return markdownFile
    }),
  )
  console.info(`✓ Loaded in ${docsArray.length} docs (${cachedDocsSize} cached)`)

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

      const ignore = config.ignoredLink(item.href)
      if (ignore === true) return item // even thou we are not processing them, we still need to keep them

      const doc = docsMap.get(item.href)

      if (doc === undefined) {
        const filePath = `${item.href}.mdx`
        if (!shouldIgnoreWarning(config, filePath, 'docs', 'doc-not-found')) {
          throw new Error(errorMessages['doc-not-found'](item.title, item.href))
        }
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
          const filePath = `${item.href}.mdx`
          if (!shouldIgnoreWarning(config, filePath, 'docs', 'doc-sdk-filtered-by-parent')) {
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

  const sdkScopedManifest = await traverseTreeItemsFirst(
    { items: sdkScopedManifestFirstPass, sdk: undefined as undefined | SDK[] },
    async (item, tree) => item,
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

  if (config.cleanDist) {
    await fs.rm(config.distPath, { recursive: true })
    console.info('✓ Removed dist folder')
  }

  await writeFile(
    'manifest.json',
    JSON.stringify({
      navigation: await traverseTree(
        { items: sdkScopedManifest },
        async (item) => ({
          title: item.title,
          href: docsMap.get(item.href)?.sdk !== undefined ? scopeHrefToSDK(config)(item.href, ':sdk:') : item.href,
          tag: item.tag,
          wrap: item.wrap === config.manifestOptions.wrapDefault ? undefined : item.wrap,
          icon: item.icon,
          target: item.target,
          sdk: item.sdk,
        }),
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

  const flatSDKScopedManifest = flattenTree(sdkScopedManifest)

  const validatedPartials = await Promise.all(
    partials.map(async (partial) => {
      const partialPath = `${config.partialsRelativePath}/${partial.path}`

      try {
        let node: Node | null = null

        const vfile = await remark()
          .use(remarkFrontmatter)
          .use(remarkMdx)
          .use(validateAndEmbedLinks(config, docsMap, partialPath, 'partials'))
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
        }
      } catch (error) {
        console.error(`✗ Error validating partial: ${partial.path}`)
        throw error
      }
    }),
  )
  console.info(`✓ Validated all partials`)

  const validatedTypedocs = await Promise.all(
    typedocs.map(async (typedoc) => {
      const filePath = path.join(config.typedocRelativePath, typedoc.path)

      try {
        let node: Node | null = null

        const vfile = await remark()
          .use(remarkMdx)
          .use(validateAndEmbedLinks(config, docsMap, filePath, 'typedoc'))
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
        }
      } catch (error) {
        try {
          let node: Node | null = null

          const vfile = await remark()
            .use(validateAndEmbedLinks(config, docsMap, filePath, 'typedoc'))
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
          }
        } catch (error) {
          console.error(error)
          throw new Error(errorMessages['typedoc-parse-error'](typedoc.path))
        }
      }
    }),
  )
  console.info(`✓ Validated all typedocs`)

  const coreVFiles = await Promise.all(
    docsArray.map(async (doc) => {
      const filePath = `${doc.href}.mdx`

      const vfile = await remark()
        .use(remarkFrontmatter)
        .use(remarkMdx)
        .use(validateAndEmbedLinks(config, docsMap, filePath, 'docs', doc))
        .use(validateIfComponents(config, filePath, doc, flatSDKScopedManifest))
        .use(checkPartials(config, validatedPartials, filePath, { reportWarnings: false, embed: true }))
        .use(checkTypedoc(config, validatedTypedocs, filePath, { reportWarnings: false, embed: true }))
        .process(doc.vfile)

      const distFilePath = `${doc.href.replace(config.baseDocsLink, '')}.mdx`

      if (isValidSdk(config)(distFilePath.split('/')[0])) {
        if (!shouldIgnoreWarning(config, filePath, 'docs', 'sdk-path-conflict')) {
          throw new Error(errorMessages['sdk-path-conflict'](doc.href, distFilePath))
        }
      }

      if (doc.sdk !== undefined) {
        // This is a sdk specific doc, so we want to put a landing page here to redirect the user to a doc customized to their sdk.

        await writeFile(
          distFilePath,
          `---
template: wide
---
<SDKDocRedirectPage title="${doc.frontmatter.title}"${doc.frontmatter.description ? ` description="${doc.frontmatter.description}" ` : ' '}href="${scopeHrefToSDK(config)(doc.href, ':sdk:')}" sdks={${JSON.stringify(doc.sdk)}} />`,
        )

        return vfile
      }

      await writeFile(distFilePath, typedocTableSpecialCharacters.decode(String(vfile)))

      return vfile
    }),
  )

  console.info(`✓ Validated and wrote out all core docs`)

  const sdkSpecificVFiles = await Promise.all(
    config.validSdks.map(async (targetSdk) => {
      const vFiles = await Promise.all(
        docsArray.map(async (doc) => {
          if (doc.sdk === undefined) return null // skip core docs
          if (doc.sdk.includes(targetSdk) === false) return null // skip docs that are not for the target sdk

          const filePath = `${doc.href}.mdx`
          const vfile = await remark()
            .use(remarkFrontmatter)
            .use(remarkMdx)
            .use(validateAndEmbedLinks(config, docsMap, filePath, 'docs', doc))
            .use(checkPartials(config, partials, filePath, { reportWarnings: true, embed: true }))
            .use(checkTypedoc(config, typedocs, filePath, { reportWarnings: true, embed: true }))
            .use(filterOtherSDKsContentOut(config, filePath, targetSdk))
            .use(validateUniqueHeadings(config, filePath, 'docs'))
            .use(insertFrontmatter({ canonical: doc.sdk ? scopeHrefToSDK(config)(doc.href, ':sdk:') : doc.href }))
            .process({
              path: filePath,
              value: doc.fileContent,
            })

          await writeSdkFile(
            targetSdk,
            `${doc.href.replace(config.baseDocsLink, '')}.mdx`,
            typedocTableSpecialCharacters.decode(String(vfile)),
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

  const docsWithOnlyIfComponents = docsArray.filter((doc) => doc.sdk === undefined && documentHasIfComponents(doc.node))
  const extractSDKsFromIfComponent = extractSDKsFromIfProp(config)

  for (const doc of docsWithOnlyIfComponents) {
    const filePath = `${doc.href}.mdx`

    // Extract all SDK values from <If /> all components
    const availableSDKs = new Set<SDK>()

    mdastVisit(doc.node, (node) => {
      const sdkProp = extractComponentPropValueFromNode(config, node, undefined, 'If', 'sdk', true, 'docs', filePath)

      if (sdkProp === undefined) return

      const sdks = extractSDKsFromIfComponent(node, undefined, sdkProp, 'docs', filePath)

      if (sdks === undefined) return

      sdks.forEach((sdk) => availableSDKs.add(sdk))
    })

    for (const sdk of availableSDKs) {
      await remark()
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
              filePath,
            )
            if (!sdkProp) return true

            const ifSdks = extractSDKsFromIfComponent(node, undefined, sdkProp, 'docs', filePath)

            if (!ifSdks) return true

            return ifSdks.includes(sdk)
          })
        })
        .use(validateUniqueHeadings(config, filePath, 'docs'))
        .process({
          path: filePath,
          value: String(doc.vfile),
        })
    }
  }

  const flatSdkSpecificVFiles = sdkSpecificVFiles
    .flatMap(({ vFiles }) => vFiles)
    .filter((item): item is NonNullable<typeof item> => item !== null)

  const partialsVFiles = validatedPartials.map((partial) => partial.vfile)
  const typedocVFiles = validatedTypedocs.map((typedoc) => typedoc.vfile)

  return reporter([...coreVFiles, ...partialsVFiles, ...typedocVFiles, ...flatSdkSpecificVFiles], { quiet: true })
}
