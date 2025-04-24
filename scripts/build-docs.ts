// Things this script does

// Validates
// - The manifest
// - The markdown files contents (including required frontmatter fields)
// - Links (including hashes) between docs are valid and point to existing headings
// - The sdk filtering in the manifest
// - The sdk filtering in the frontmatter
// - The sdk filtering in the <If /> component
//   - Checks that the sdk is available in the manifest
//   - Checks that the sdk is available in the frontmatter
//   - Validates sdk values against the list of valid SDKs
// - URL encoding (prevents browser encoding issues)
// - File existence for both docs and partials
// - Path conflicts (prevents SDK name conflicts in paths)

// Transforms
// - Embeds the partials in the markdown files
// - Updates the links in the content if they point to the sdk specific docs
//   - Converts links to SDK-specific docs to use <SDKLink /> components
// - Copies over "core" docs to the dist folder
// - Generates "landing" pages for the sdk specific docs at the original url
// - Generates out the sdk specific docs to their respective folders
//   - Stripping filtered out content based on SDK
// - Removes .mdx from the end of docs markdown links
// - Adds canonical links in frontmatter for SDK-specific docs

import fs from 'node:fs/promises'
import path from 'node:path'
import { remark } from 'remark'
import remarkFrontmatter from 'remark-frontmatter'
import remarkMdx from 'remark-mdx'
import { Node } from 'unist'
import { filter as mdastFilter } from 'unist-util-filter'
import { map as mdastMap } from 'unist-util-map'
import { visit as mdastVisit } from 'unist-util-visit'
import type { VFile } from 'vfile'
import reporter from 'vfile-reporter'
import yaml from 'yaml'
import { SDKLink } from './lib/components/SDKLink'
import { createConfig, type BuildConfig } from './lib/config'
import { watchAndRebuild } from './lib/dev'
import { errorMessages, safeFail, safeMessage, shouldIgnoreWarning } from './lib/error-messages'
import { ensureDirectory, readDocsFolder, writeDistFile, writeSDKFile } from './lib/io'
import { flattenTree, ManifestGroup, readManifest, traverseTree, traverseTreeItemsFirst } from './lib/manifest'
import { parseInMarkdownFile } from './lib/markdown'
import { readPartialsFolder, readPartialsMarkdown } from './lib/partials'
import { isValidSdk, VALID_SDKS, type SDK } from './lib/schemas'
import { createBlankStore, DocsMap, Store } from './lib/store'
import { readTypedocsFolder, readTypedocsMarkdown } from './lib/typedoc'
import { documentHasIfComponents } from './lib/utils/documentHasIfComponents'
import { extractComponentPropValueFromNode } from './lib/utils/extractComponentPropValueFromNode'
import { extractSDKsFromIfProp } from './lib/utils/extractSDKsFromIfProp'
import { removeMdxSuffix } from './lib/utils/removeMdxSuffix'
import { scopeHrefToSDK } from './lib/utils/scopeHrefToSDK'
import { checkPartials } from './lib/validators/checkPartials'
import { checkTypedoc } from './lib/validators/checkTypedoc'
import { validateAndEmbedLinks } from './lib/validators/validateAndEmbedLinks'
import { validateUniqueHeadings } from './lib/validators/validateUniqueHeadings'

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

  const output = await build(store, config)

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

export async function build(store: Store, config: BuildConfig) {
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

  await ensureDir(config.distPath)

  const userManifest = await getManifest()
  console.info('✓ Read Manifest')

  const docsFiles = await getDocsFolder()
  console.info('✓ Read Docs Folder')

  const cachedPartialsSize = store.partialsFiles.size
  const partials = await getPartialsMarkdown((await getPartialsFolder()).map((item) => item.path))
  console.info(`✓ Loaded in ${partials.length} partials (${cachedPartialsSize} cached)`)

  const cachedTypedocsSize = store.typedocsFiles.size
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

  const cachedDocsSize = store.markdownFiles.size
  // Read in all the docs
  const docsArray = await Promise.all(
    docsFiles.map(async (file) => {
      const href = removeMdxSuffix(`${config.baseDocsLink}${file.path}`)

      const inManifest = docsInManifest.has(href)

      let markdownFile: Awaited<ReturnType<typeof parseMarkdownFile>>

      const cachedMarkdownFile = store.markdownFiles.get(href)

      if (cachedMarkdownFile) {
        markdownFile = structuredClone(cachedMarkdownFile)
      } else {
        markdownFile = await parseMarkdownFile(href, partials, typedocs, inManifest, 'docs')

        store.markdownFiles.set(href, structuredClone(markdownFile))
      }

      docsMap.set(href, markdownFile)

      return markdownFile
    }),
  )
  console.info(`✓ Loaded in ${docsArray.length} docs (${cachedDocsSize} cached)`)

  // Goes through and grabs the sdk scoping out of the manifest
  const sdkScopedManifestFirstPass = await traverseTree(
    { items: userManifest, sdk: undefined as undefined | SDK[] },
    async (item, tree) => {
      if (!item.href?.startsWith(config.baseDocsLink)) return item
      if (item.target !== undefined) return item

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

        if (sdks === undefined) return []

        const uniqueSDKs = Array.from(new Set(sdks)).filter((sdk): sdk is SDK => sdk !== undefined)
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
        async (item) => {
          return {
            title: item.title,
            href: docsMap.get(item.href)?.sdk !== undefined ? scopeHrefToSDK(config)(item.href, ':sdk:') : item.href,
            tag: item.tag,
            wrap: item.wrap === config.manifestOptions.wrapDefault ? undefined : item.wrap,
            icon: item.icon,
            target: item.target,
            sdk: item.sdk,
          }
        },
        // @ts-expect-error - This traverseTree function might just be the death of me
        async (group) => {
          return {
            title: group.title,
            collapse: group.collapse === config.manifestOptions.collapseDefault ? undefined : group.collapse,
            tag: group.tag,
            wrap: group.wrap === config.manifestOptions.wrapDefault ? undefined : group.wrap,
            icon: group.icon,
            hideTitle: group.hideTitle === config.manifestOptions.hideTitleDefault ? undefined : group.hideTitle,
            sdk: group.sdk,
            items: group.items,
          }
        },
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
        // Validate links between docs are valid and replace the links to sdk scoped pages with the sdk link component
        .use(() => (tree: Node, vfile: VFile) => {
          return mdastMap(tree, (node) => {
            if (node.type !== 'link') return node
            if (!('url' in node)) return node
            if (typeof node.url !== 'string') return node
            if (!node.url.startsWith(config.baseDocsLink) && !node.url.startsWith('#')) return node
            if (!('children' in node)) return node

            // we are overwriting the url with the mdx suffix removed
            node.url = removeMdxSuffix(node.url)

            let [url, hash] = (node.url as string).split('#')

            if (url === '') {
              // If the link is just a hash, then we need to link to the same doc
              url = doc.href
            }

            const ignore = config.ignoredLink(url)
            if (ignore === true) return node

            const linkedDoc = docsMap.get(url)

            if (linkedDoc === undefined) {
              safeMessage(config, vfile, filePath, 'docs', 'link-doc-not-found', [url], node.position)
              return node
            }

            if (hash !== undefined) {
              const hasHash = linkedDoc.headingsHashes.has(hash)

              if (hasHash === false) {
                safeMessage(config, vfile, filePath, 'docs', 'link-hash-not-found', [hash, url], node.position)
              }
            }

            if (linkedDoc.sdk !== undefined) {
              // we are going to swap it for the sdk link component to give the users a great experience

              const firstChild = node.children?.[0]
              const childIsCodeBlock = firstChild?.type === 'inlineCode'

              if (childIsCodeBlock) {
                firstChild.type = 'text'

                return SDKLink({
                  href: scopeHrefToSDK(config)(url, ':sdk:'),
                  sdks: linkedDoc.sdk,
                  code: true,
                })
              }

              return SDKLink({
                href: scopeHrefToSDK(config)(url, ':sdk:'),
                sdks: linkedDoc.sdk,
                code: false,
                children: node.children,
              })
            }

            return node
          })
        })
        // Validate the <If /> components
        .use(() => (tree, vfile) => {
          mdastVisit(tree, (node) => {
            const sdk = extractComponentPropValueFromNode(config, node, vfile, 'If', 'sdk', false, 'docs', filePath)

            if (sdk === undefined) return

            const sdksFilter = extractSDKsFromIfProp(config)(node, vfile, sdk, 'docs', filePath)

            if (sdksFilter === undefined) return

            const manifestItems = flatSDKScopedManifest.filter((item) => item.href === doc.href)

            const availableSDKs = manifestItems.flatMap((item) => item.sdk).filter(Boolean)

            // The doc doesn't exist in the manifest so we are skipping it
            if (manifestItems.length === 0) return

            sdksFilter.forEach((sdk) => {
              ;(() => {
                if (doc.sdk === undefined) return

                const available = doc.sdk.includes(sdk)

                if (available === false) {
                  safeFail(
                    config,
                    vfile,
                    filePath,
                    'docs',
                    'if-component-sdk-not-in-frontmatter',
                    [sdk, doc.sdk],
                    node.position,
                  )
                }
              })()
              ;(() => {
                // The doc is generic so we are skipping it
                if (availableSDKs.length === 0) return

                const available = availableSDKs.includes(sdk)

                if (available === false) {
                  safeFail(
                    config,
                    vfile,
                    filePath,
                    'docs',
                    'if-component-sdk-not-in-manifest',
                    [sdk, doc.href],
                    node.position,
                  )
                }
              })()
            })
          })
        })
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
          // It's possible we will want to / need to put some frontmatter here
          `---
template: wide
---
<SDKDocRedirectPage title="${doc.frontmatter.title}"${doc.frontmatter.description ? ` description="${doc.frontmatter.description}" ` : ' '}href="${scopeHrefToSDK(config)(doc.href, ':sdk:')}" sdks={${JSON.stringify(doc.sdk)}} />`,
        )

        return vfile
      }

      await writeFile(distFilePath, String(vfile))

      return vfile
    }),
  )

  console.info(`✓ Validated and wrote out all docs`)

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
            // filter out content that is only available to other sdk's
            .use(() => (tree, vfile) => {
              return mdastFilter(tree, (node) => {
                // We aren't passing the vfile here as the as the warning
                // should have already been reported above when we initially
                // parsed the file
                const sdk = extractComponentPropValueFromNode(
                  config,
                  node,
                  undefined,
                  'If',
                  'sdk',
                  true,
                  'docs',
                  filePath,
                )

                if (sdk === undefined) return true

                const sdksFilter = extractSDKsFromIfProp(config)(node, undefined, sdk, 'docs', filePath)

                if (sdksFilter === undefined) return true

                if (sdksFilter.includes(targetSdk)) {
                  return true
                }

                return false
              })
            })
            .use(validateUniqueHeadings(config, filePath, 'docs'))
            // scope urls so they point to the current sdk
            .use(() => (tree, vfile) => {
              return mdastMap(tree, (node) => {
                if (node.type !== 'link') return node
                if (!('url' in node)) {
                  safeFail(
                    config,
                    vfile,
                    filePath,
                    'docs',
                    'link-doc-not-found',
                    ['url property missing'],
                    node.position,
                  )
                  return node
                }
                if (typeof node.url !== 'string') {
                  safeFail(config, vfile, filePath, 'docs', 'link-doc-not-found', ['url not a string'], node.position)
                  return node
                }
                if (!node.url.startsWith(config.baseDocsLink)) {
                  return node
                }

                // we are overwriting the url with the mdx suffix removed
                node.url = removeMdxSuffix(node.url)

                const [url, hash] = (node.url as string).split('#')

                const ignore = config.ignoredLink(url)
                if (ignore === true) return node

                const doc = docsMap.get(url)

                if (doc === undefined) {
                  safeFail(config, vfile, filePath, 'docs', 'link-doc-not-found', [url], node.position)
                  return node
                }

                // we might need to do something here with doc

                return node
              })
            })
            // Insert the canonical link into the doc frontmatter
            .use(() => (tree, vfile) => {
              return mdastMap(tree, (node) => {
                if (node.type !== 'yaml') return node
                if (!('value' in node)) return node
                if (typeof node.value !== 'string') return node

                const frontmatter = yaml.parse(node.value)

                frontmatter.canonical = doc.sdk ? scopeHrefToSDK(config)(doc.href, ':sdk:') : doc.href

                node.value = yaml.stringify(frontmatter).split('\n').slice(0, -1).join('\n')

                return node
              })
            })
            .process({
              ...doc.vfile,
              messages: [], // reset the messages, otherwise they will be duplicated
            })

          await writeSdkFile(targetSdk, `${doc.href.replace(config.baseDocsLink, '')}.mdx`, String(vfile))

          return vfile
        }),
      )

      console.info(`✓ Wrote out ${vFiles.filter(Boolean).length} ${targetSdk} specific docs`)

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

    // For each SDK, check heading uniqueness after filtering
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
