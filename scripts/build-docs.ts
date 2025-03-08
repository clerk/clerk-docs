// Things this build script does

// - [x] Validates the manifest
// - [x] Validates the markdown files contents (including frontmatter)
// - [x] Validates links (including hashes) between docs are valid
// - [x] Validates the sdk filtering in the manifest
// - [x] Validates the sdk filtering in the frontmatter
// - [x] Validates the sdk filtering in the <If /> component
//   - [x] Checks that the sdk is available in the manifest
//   - [x] Checks that the sdk is available in the frontmatter

// - [x] Embeds the includes in the markdown files
// - [x] Updates the links in the content if they point to the sdk specific docs
// - [x] Copies over "core" docs to the dist folder
// - [x] Generates "landing" pages for the sdk specific docs at the original url
// - [x] Generates a manifest that is specific to each SDK
// - [x] Duplicates out the sdk specific docs to their respective folders
//   - [x] stripping filtered out content
// - [x] Removes .mdx from the end of docs markdown links

import fs from 'node:fs/promises'
import path from 'node:path'
import remarkMdx from 'remark-mdx'
import { remark } from 'remark'
import { visit as mdastVisit } from 'unist-util-visit'
import { filter as mdastFilter } from 'unist-util-filter'
import { map as mdastMap } from 'unist-util-map'
import { u as mdastBuilder } from 'unist-builder'
import remarkFrontmatter from 'remark-frontmatter'
import yaml from 'yaml'
import { slugifyWithCounter } from '@sindresorhus/slugify'
import { toString } from 'mdast-util-to-string'
import reporter from 'vfile-reporter'
import readdirp from 'readdirp'
import { z } from 'zod'
import { fromError } from 'zod-validation-error'
import { Node } from 'unist'
import chok from 'chokidar'

const VALID_SDKS = [
  'nextjs',
  'react',
  'javascript-frontend',
  'chrome-extension',
  'expo',
  'ios',
  'nodejs',
  'expressjs',
  'fastify',
  'react-router',
  'remix',
  'tanstack-start',
  'go',
  'astro',
  'nuxt',
  'vue',
  'ruby',
  'python',
  'javascript-backend',
  'sdk-development',
  'community-sdk',
] as const

type SDK = (typeof VALID_SDKS)[number]

const sdk = z.enum(VALID_SDKS)

const icon = z.enum([
  'apple',
  'application-2',
  'arrow-up-circle',
  'astro',
  'angular',
  'block',
  'bolt',
  'book',
  'box',
  'c-sharp',
  'chart',
  'checkmark-circle',
  'chrome',
  'clerk',
  'code-bracket',
  'cog-6-teeth',
  'door',
  'elysia',
  'expressjs',
  'globe',
  'go',
  'home',
  'hono',
  'javascript',
  'koa',
  'link',
  'linkedin',
  'lock',
  'nextjs',
  'nodejs',
  'plug',
  'plus-circle',
  'python',
  'react',
  'redwood',
  'remix',
  'react-router',
  'rocket',
  'route',
  'ruby',
  'rust',
  'speedometer',
  'stacked-rectangle',
  'solid',
  'svelte',
  'tanstack',
  'user-circle',
  'user-dotted-circle',
  'vue',
  'x',
  'expo',
  'nuxt',
  'fastify',
])

type Icon = z.infer<typeof icon>

const tag = z.enum(['(Beta)', '(Community)'])

type Tag = z.infer<typeof tag>

type ManifestItem = {
  title: string
  href: string
  tag?: Tag
  wrap?: boolean
  icon?: Icon
  target?: '_blank'
  sdk?: SDK[]
}

type ManifestGroup = {
  title: string
  items: Manifest
  collapse?: boolean
  tag?: Tag
  wrap?: boolean
  icon?: Icon
  hideTitle?: boolean
  sdk?: SDK[]
}

type Manifest = (ManifestItem | ManifestGroup)[][]

// Create manifest schema based on config
const createManifestSchema = (config: BuildConfig) => {
  const manifestItem: z.ZodType<ManifestItem> = z
    .object({
      title: z.string(),
      href: z.string(),
      tag: tag.optional(),
      wrap: z.boolean().default(config.manifestOptions.wrapDefault),
      icon: icon.optional(),
      target: z.enum(['_blank']).optional(),
      sdk: z.array(sdk).optional(),
    })
    .strict()

  const manifestGroup: z.ZodType<ManifestGroup> = z
    .object({
      title: z.string(),
      items: z.lazy(() => manifestSchema),
      collapse: z.boolean().default(config.manifestOptions.collapseDefault),
      tag: tag.optional(),
      wrap: z.boolean().default(config.manifestOptions.wrapDefault),
      icon: icon.optional(),
      hideTitle: z.boolean().default(config.manifestOptions.hideTitleDefault),
      sdk: z.array(sdk).optional(),
    })
    .strict()

  const manifestSchema: z.ZodType<Manifest> = z.array(z.array(z.union([manifestItem, manifestGroup])))

  return {
    manifestItem,
    manifestGroup,
    manifestSchema,
  }
}

const pleaseReport = '(this is a bug with the build script, please report)'

const isValidSdk =
  (config: BuildConfig) =>
  (sdk: string): sdk is SDK => {
    return config.validSdks.includes(sdk as SDK)
  }

const isValidSdks =
  (config: BuildConfig) =>
  (sdks: string[]): sdks is SDK[] => {
    return sdks.every(isValidSdk(config))
  }

const readManifest = (config: BuildConfig) => async (): Promise<Manifest> => {
  const { manifestSchema } = createManifestSchema(config)
  const unsafe_manifest = await fs.readFile(config.manifestFilePath, { encoding: 'utf-8' })

  const manifest = await manifestSchema.safeParseAsync(JSON.parse(unsafe_manifest).navigation)

  if (manifest.success === true) {
    return manifest.data
  }

  throw new Error(`Failed to parse manifest: ${fromError(manifest.error)}`)
}

const readMarkdownFile = (config: BuildConfig) => async (docPath: string) => {
  const filePath = path.join(config.basePath, docPath)

  try {
    const fileContent = await fs.readFile(filePath, { encoding: 'utf-8' })
    return [null, fileContent] as const
  } catch (error) {
    return [new Error(`file ${filePath} doesn't exist`, { cause: error }), null] as const
  }
}

const readDocsFolder = (config: BuildConfig) => async () => {
  return readdirp.promise(config.docsPath, {
    type: 'files',
    fileFilter: (entry) =>
      config.ignorePaths.some((ignoreItem) => `/docs/${entry.path}`.startsWith(ignoreItem)) === false &&
      entry.path.endsWith('.mdx'),
  })
}

const readPartialsFolder = (config: BuildConfig) => async () => {
  return readdirp.promise(path.join(config.docsPath, config.partialsRelativePath), {
    type: 'files',
    fileFilter: '*.mdx',
  })
}

const readPartialsMarkdown = (config: BuildConfig) => async (paths: string[]) => {
  const readFile = readMarkdownFile(config)

  return Promise.all(
    paths.map(async (markdownPath) => {
      const fullPath = path.join(config.docsRelativePath, config.partialsRelativePath, markdownPath)

      const [error, content] = await readFile(fullPath)

      if (error) {
        throw new Error(`Failed to read in ${fullPath} from partials file`, { cause: error })
      }

      return {
        path: markdownPath,
        content,
      }
    }),
  )
}

const markdownProcessor = remark().use(remarkFrontmatter).use(remarkMdx).freeze()

type VFile = Awaited<ReturnType<typeof markdownProcessor.process>>

const ensureDirectory =
  (config: BuildConfig) =>
  async (dirPath: string): Promise<void> => {
    try {
      await fs.access(dirPath)
    } catch {
      await fs.mkdir(dirPath, { recursive: true })
    }
  }

const writeDistFile = (config: BuildConfig) => async (filePath: string, contents: string) => {
  const ensureDir = ensureDirectory(config)
  const fullPath = path.join(config.distPath, filePath)
  await ensureDir(path.dirname(fullPath))
  await fs.writeFile(fullPath, contents, { encoding: 'utf-8' })
}

const writeSDKFile = (config: BuildConfig) => async (sdk: SDK, filePath: string, contents: string) => {
  const writeFile = writeDistFile(config)
  await writeFile(path.join(sdk, filePath), contents)
}

const removeMdxSuffix = (filePath: string) => {
  if (filePath.endsWith('.mdx')) {
    return filePath.slice(0, -4)
  }
  return filePath
}

type BlankTree<Item extends object, Group extends { items: BlankTree<Item, Group> }> = Array<Array<Item | Group>>

const traverseTree = async <
  Tree extends { items: BlankTree<any, any> },
  InItem extends Extract<Tree['items'][number][number], { href: string }>,
  InGroup extends Extract<Tree['items'][number][number], { items: BlankTree<InItem, InGroup> }>,
  OutItem extends { href: string },
  OutGroup extends { items: BlankTree<OutItem, OutGroup> },
  OutTree extends BlankTree<OutItem, OutGroup>,
>(
  tree: Tree,
  itemCallback: (item: InItem, tree: Tree) => Promise<OutItem | null> = async (item) => item,
  groupCallback: (group: InGroup, tree: Tree) => Promise<OutGroup | null> = async (group) => group,
  errorCallback?: (item: InItem | InGroup, error: Error) => void | Promise<void>,
): Promise<OutTree> => {
  const result = await Promise.all(
    tree.items.map(async (group) => {
      return await Promise.all(
        group.map(async (item) => {
          try {
            if ('href' in item) {
              return await itemCallback(item, tree)
            }

            if ('items' in item && Array.isArray(item.items)) {
              const newGroup = await groupCallback(item, tree)

              if (newGroup === null) return null

              // @ts-expect-error - OutGroup should always contain "items" property, so this is safe
              const newItems = (await traverseTree(newGroup, itemCallback, groupCallback, errorCallback)).map((group) =>
                group.filter((item): item is NonNullable<typeof item> => item !== null),
              )

              return {
                ...newGroup,
                items: newItems,
              }
            }

            return item as OutItem
          } catch (error) {
            if (error instanceof Error && errorCallback !== undefined) {
              errorCallback(item, error)
            } else {
              throw error
            }
          }
        }),
      )
    }),
  )

  return result.map((group) =>
    group.filter((item): item is NonNullable<typeof item> => item !== null),
  ) as unknown as OutTree
}

function flattenTree<
  Tree extends BlankTree<any, any>,
  InItem extends Extract<Tree[number][number], { href: string }>,
  InGroup extends Extract<Tree[number][number], { items: BlankTree<InItem, InGroup> }>,
>(tree: Tree): InItem[] {
  const result: InItem[] = []

  for (const group of tree) {
    for (const itemOrGroup of group) {
      if ('href' in itemOrGroup) {
        // It's an item
        result.push(itemOrGroup)
      } else if ('items' in itemOrGroup && Array.isArray(itemOrGroup.items)) {
        // It's a group with its own sub-tree, flatten it
        result.push(...flattenTree(itemOrGroup.items))
      }
    }
  }

  return result
}

const scopeHrefToSDK = (href: string, targetSDK: SDK | ':sdk:') => {
  // This is external so can't change it
  if (href.startsWith('/docs') === false) return href

  const hrefSegments = href.split('/')

  // This is a little hacky so we might change it
  // if the url already contains the sdk, we don't need to change it
  if (hrefSegments.includes(targetSDK)) {
    return href
  }

  // Add the sdk to the url
  return `/docs/${targetSDK}/${hrefSegments.slice(2).join('/')}`
}

const extractComponentPropValueFromNode = (
  node: Node,
  vfile: VFile | undefined,
  componentName: string,
  propName: string,
): string | undefined => {
  // Check if it's an MDX component
  if (node.type !== 'mdxJsxFlowElement' && node.type !== 'mdxJsxTextElement') {
    return undefined
  }

  // Check if it's the correct component
  if (!('name' in node)) return undefined
  if (node.name !== componentName) return undefined

  // Check for attributes
  if (!('attributes' in node)) {
    vfile?.message(`<${componentName} /> component has no props`, node.position)
    return undefined
  }

  if (!Array.isArray(node.attributes)) {
    vfile?.message(`<${componentName} /> node attributes is not an array ${pleaseReport}`, node.position)
    return undefined
  }

  // Find the requested prop
  const propAttribute = node.attributes.find((attribute) => attribute.name === propName)

  if (propAttribute === undefined) {
    vfile?.message(`<${componentName} /> component has no "${propName}" attribute`, node.position)
    return undefined
  }

  const value = propAttribute.value

  if (value === undefined) {
    vfile?.message(`<${componentName} /> attribute "${propName}" has no value ${pleaseReport}`, node.position)
    return undefined
  }

  // Handle both string values and object values (like JSX expressions)
  if (typeof value === 'string') {
    return value
  } else if (typeof value === 'object' && 'value' in value) {
    return value.value
  }

  vfile?.message(`<${componentName} /> attribute "${propName}" has an unsupported value type`, node.position)
  return undefined
}

const extractSDKsFromIfProp = (config: BuildConfig) => (node: Node, vfile: VFile | undefined, sdkProp: string) => {
  const isValidItem = isValidSdk(config)
  const isValidItems = isValidSdks(config)

  if (sdkProp.includes('", "') || sdkProp.includes("', '") || sdkProp.includes('["') || sdkProp.includes('"]')) {
    const sdks = JSON.parse(sdkProp.replaceAll("'", '"'))
    if (isValidItems(sdks)) {
      return sdks
    } else {
      const invalidSDKs = sdks.filter((sdk) => !isValidItem(sdk))
      vfile?.message(`sdks "${invalidSDKs.join('", "')}" in <If /> are not valid SDKs`, node.position)
    }
  } else {
    if (isValidItem(sdkProp)) {
      return [sdkProp]
    } else {
      vfile?.message(`sdk "${sdkProp}" in <If /> is not a valid SDK`, node.position)
    }
  }
}

const parseInMarkdownFile =
  (config: BuildConfig) => async (href: string, partials: { path: string; content: string }[], inManifest: boolean) => {
    const readFile = readMarkdownFile(config)
    const [error, fileContent] = await readFile(`${href}.mdx`)

    if (error !== null) {
      throw new Error(`Attempting to read in ${href}.mdx failed, with error message: ${error.message}`, {
        cause: error,
      })
    }

    type Frontmatter = {
      title: string
      description?: string
      sdk?: SDK[]
    }

    let frontmatter: Frontmatter | undefined = undefined

    const slugify = slugifyWithCounter()
    const headingsHashs: Array<string> = []

    const vfile = await markdownProcessor()
      .use(() => (tree, vfile) => {
        if (inManifest === false) {
          vfile.message(
            'This guide is not in the manifest.json, but will still be publicly accessible and other guides can link to it',
          )
        }

        if (href !== encodeURI(href)) {
          vfile.fail(`Href "${href}" contains characters that will be encoded by the browser, please remove them`)
        }
      })
      .use(() => (tree, vfile) => {
        mdastVisit(
          tree,
          (node) => node.type === 'yaml' && 'value' in node,
          (node) => {
            if (!('value' in node)) return
            if (typeof node.value !== 'string') return

            const frontmatterYaml: Record<'title' | 'description' | 'sdk', string | undefined> = yaml.parse(node.value)

            const frontmatterSDKs = frontmatterYaml.sdk?.split(', ')

            if (frontmatterSDKs !== undefined && isValidSdks(config)(frontmatterSDKs) === false) {
              const invalidSDKs = frontmatterSDKs.filter((sdk) => isValidSdk(config)(sdk) === false)
              vfile.fail(
                `Invalid SDK ${JSON.stringify(invalidSDKs)}, the valid SDKs are ${JSON.stringify(config.validSdks)}`,
                node.position,
              )
              return
            }

            if (frontmatterYaml.title === undefined) {
              vfile.fail(`Frontmatter must have a "title" property`, node.position)
              return
            }

            frontmatter = {
              title: frontmatterYaml.title,
              description: frontmatterYaml.description,
              sdk: frontmatterSDKs,
            }
          },
        )

        if (frontmatter === undefined) {
          vfile.fail(`Frontmatter parsing failed for ${href}`)
          return
        }
      })
      // Validate and embed the <Include />
      .use(() => (tree, vfile) => {
        return mdastMap(tree, (node) => {
          const partialSrc = extractComponentPropValueFromNode(node, vfile, 'Include', 'src')

          if (partialSrc === undefined) {
            return node
          }

          if (partialSrc.startsWith('_partials/') === false) {
            vfile.message(`<Include /> prop "src" must start with "_partials/"`, node.position)
            return node
          }

          const partial = partials.find(
            (partial) => `_partials/${partial.path}` === `${removeMdxSuffix(partialSrc)}.mdx`,
          )

          if (partial === undefined) {
            vfile.message(`Partial /docs/${removeMdxSuffix(partialSrc)}.mdx not found`, node.position)
            return node
          }

          let partialNode: Node | null = null

          const partialContentVFile = markdownProcessor()
            .use(() => (tree, vfile) => {
              mdastVisit(
                tree,
                (node) =>
                  (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') &&
                  'name' in node &&
                  node.name === 'Include',
                () => {
                  vfile.fail(`Partials inside of partials is not yet supported, ${pleaseReport}`, node.position)
                },
              )

              partialNode = tree
            })
            .processSync({
              path: partial.path,
              value: partial.content,
            })

          const partialContentReport = reporter([partialContentVFile], { quiet: true })

          if (partialContentReport !== '') {
            console.error(partialContentReport)
          }

          if (partialNode === null) {
            vfile.fail(`Failed to parse the content of ${partial.path}`, node.position)
            return node
          }

          return Object.assign(node, partialNode)
        })
      })
      // extract out the headings to check hashes in links
      .use(() => (tree) => {
        mdastVisit(
          tree,
          (node) => node.type === 'heading',
          (node) => {
            // @ts-expect-error - If the heading has a id in it, this will pick it up
            // eg # test {{ id: 'my-heading' }}
            // This is for remapping the hash to the custom id
            const id = node?.children?.[1]?.data?.estree?.body?.[0]?.expression?.properties?.[0]?.value?.value as
              | string
              | undefined

            if (id !== undefined) {
              headingsHashs.push(id)
            } else {
              const slug = slugify(toString(node).trim())
              headingsHashs.push(slug)
            }
          },
        )
      })
      .process({
        path: `${href}.mdx`,
        value: fileContent,
      })

    if (frontmatter === undefined) {
      throw new Error(`Frontmatter parsing failed for ${href}`)
    }

    return {
      href,
      sdk: (frontmatter as Frontmatter).sdk,
      vfile,
      headingsHashs,
      frontmatter: frontmatter as Frontmatter,
    }
  }

export const createBlankStore = () => ({
  markdownFiles: new Map<string, Awaited<ReturnType<ReturnType<typeof parseInMarkdownFile>>>>(),
})

export const build = async (store: ReturnType<typeof createBlankStore>, config: BuildConfig) => {
  // Apply currying to create functions pre-configured with config
  const ensureDir = ensureDirectory(config)
  const getManifest = readManifest(config)
  const getDocsFolder = readDocsFolder(config)
  const getPartialsFolder = readPartialsFolder(config)
  const getPartialsMarkdown = readPartialsMarkdown(config)
  const parseMarkdownFile = parseInMarkdownFile(config)
  const writeFile = writeDistFile(config)
  const writeSdkFile = writeSDKFile(config)

  await ensureDir(config.distPath)

  const userManifest = await getManifest()
  console.info('✔️ Read Manifest')

  const docsFiles = await getDocsFolder()
  console.info('✔️ Read Docs Folder')

  const partials = await getPartialsMarkdown((await getPartialsFolder()).map((item) => item.path))
  console.info('✔️ Read Partials')

  const guides = new Map<string, Awaited<ReturnType<typeof parseMarkdownFile>>>()
  const guidesInManifest = new Set<string>()

  // Grab all the docs links in the manifest
  await traverseTree({ items: userManifest }, async (item) => {
    if (!item.href?.startsWith('/docs/')) return item
    if (item.target !== undefined) return item

    const ignore = config.ignorePaths.some((ignoreItem) => item.href.startsWith(ignoreItem))
    if (ignore === true) return item

    guidesInManifest.add(item.href)

    return item
  })
  console.info('✔️ Parsed in Manifest')

  // Read in all the guides
  const docs = (
    await Promise.all(
      docsFiles.map(async (file) => {
        const href = removeMdxSuffix(`/docs/${file.path}`)

        const alreadyLoaded = guides.get(href)

        if (alreadyLoaded) return null // already processed

        const inManifest = guidesInManifest.has(href)

        let markdownFile: Awaited<ReturnType<typeof parseMarkdownFile>>

        const cachedMarkdownFile = store.markdownFiles.get(href)

        if (cachedMarkdownFile) {
          markdownFile = structuredClone(cachedMarkdownFile)
        } else {
          markdownFile = await parseMarkdownFile(href, partials, inManifest)

          store.markdownFiles.set(href, structuredClone(markdownFile))
        }

        guides.set(href, markdownFile)

        return markdownFile
      }),
    )
  ).filter((item): item is NonNullable<typeof item> => item !== null)
  console.info(`✔️ Loaded in ${docs.length} guides`)

  // Goes through and grabs the sdk scoping out of the manifest
  const sdkScopedManifest = await traverseTree(
    { items: userManifest, sdk: undefined as undefined | SDK[] },
    async (item, tree) => {
      if (!item.href?.startsWith('/docs/')) return item
      if (item.target !== undefined) return item

      const ignore = config.ignorePaths.some((ignoreItem) => item.href.startsWith(ignoreItem))
      if (ignore === true) return item // even thou we are not processing them, we still need to keep them

      const guide = guides.get(item.href)

      if (guide === undefined) {
        throw new Error(`Guide "${item.title}" in manifest.json not found in the docs folder at ${item.href}.mdx`)
      }

      const sdk = guide.sdk ?? tree.sdk

      if (guide.sdk !== undefined && tree.sdk !== undefined) {
        if (guide.sdk.every((sdk) => tree.sdk?.includes(sdk)) === false) {
          throw new Error(
            `Guide "${item.title}" is attempting to use ${JSON.stringify(guide.sdk)} But its being filtered down to ${JSON.stringify(tree.sdk)} in the manifest.json`,
          )
        }
      }

      return {
        ...item,
        sdk,
      }
    },
    async (group, tree) => {
      const itemsSDKs = Array.from(new Set(group.items?.flatMap((item) => item.flatMap((item) => item.sdk)))).filter(
        (sdk): sdk is SDK => sdk !== undefined,
      )

      const { items, ...details } = group

      if (details.sdk !== undefined && tree.sdk !== undefined) {
        if (details.sdk.every((sdk) => tree.sdk?.includes(sdk)) === false) {
          throw new Error(
            `Group "${details.title}" is attempting to use ${JSON.stringify(details.sdk)} But its being filtered down to ${JSON.stringify(tree.sdk)} in the manifest.json`,
          )
        }
      }

      if (itemsSDKs.length === 0) return { ...details, sdk: details.sdk ?? tree.sdk, items } as ManifestGroup

      return {
        ...details,
        sdk: Array.from(new Set([...(details.sdk ?? []), ...itemsSDKs])) ?? [],
        items,
      } as ManifestGroup
    },
    (item, error) => {
      console.error('↳', item.title)
      throw error
    },
  )
  console.info('✔️ Applied manifest sdk scoping')

  const flatSDKScopedManifest = flattenTree(sdkScopedManifest)

  // It would definitely be preferable we didn't need to do this markdown processing twice
  // But because we need a full list / hashmap of all the existing docs, we can't
  // Unless maybe we do some kind of lazy loading of the docs, but this would add complexity
  const coreVFiles = await Promise.all(
    docs.map(async (doc) => {
      const vfile = await markdownProcessor()
        // Validate links between guides are valid
        .use(() => (tree: Node, vfile: VFile) => {
          return mdastMap(tree, (node) => {
            if (node.type !== 'link') return node
            if (!('url' in node)) return node
            if (typeof node.url !== 'string') return node
            if (!node.url.startsWith('/docs/')) return node
            if (!('children' in node)) return node

            node.url = removeMdxSuffix(node.url)

            const [url, hash] = (node.url as string).split('#')

            const ignore = config.ignorePaths.some((ignoreItem) => url.startsWith(ignoreItem))
            if (ignore === true) return node

            const guide = guides.get(url)

            if (guide === undefined) {
              vfile.message(`Guide ${url} not found`, node.position)
              return node
            }

            if (hash !== undefined) {
              const hasHash = guide.headingsHashs.includes(hash)

              if (hasHash === false) {
                vfile.message(`Hash "${hash}" not found in ${url}`, node.position)
              }
            }

            if (guide.sdk !== undefined) {
              // we are going to swap it for the sdk link component to give the users a great experience

              return mdastBuilder('mdxJsxTextElement', {
                name: 'SDKLink',
                attributes: [
                  mdastBuilder('mdxJsxAttribute', {
                    name: 'href',
                    value: scopeHrefToSDK(url, ':sdk:'),
                  }),
                  mdastBuilder('mdxJsxAttribute', {
                    name: 'sdks',
                    value: mdastBuilder('mdxJsxAttributeValueExpression', {
                      value: JSON.stringify(guide.sdk),
                    }),
                  }),
                ],
              })
            }

            return node
          })
        })
        // Validate the <If /> components
        .use(() => (tree, vfile) => {
          mdastVisit(tree, (node) => {
            const sdk = extractComponentPropValueFromNode(node, vfile, 'If', 'sdk')

            if (sdk === undefined) return

            const sdksFilter = extractSDKsFromIfProp(config)(node, vfile, sdk)

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
                  vfile.fail(
                    `<If /> component is attempting to filter to sdk "${sdk}" but it is not available in the guides frontmatter ["${doc.sdk.join('", "')}"], if this is a mistake please remove it from the <If /> otherwise update the frontmatter to include "${sdk}"`,
                    node.position,
                  )
                }
              })()
              ;(() => {
                // The doc is generic so we are skipping it
                if (availableSDKs.length === 0) return

                const available = availableSDKs.includes(sdk)

                if (available === false) {
                  vfile.fail(
                    `<If /> component is attempting to filter to sdk "${sdk}" but it is not available in the manifest.json for ${doc.href}, if this is a mistake please remove it from the <If /> otherwise update the manifest.json to include "${sdk}"`,
                    node.position,
                  )
                }
              })()
            })
          })
        })
        .process(doc.vfile)

      const distFilePath = `${doc.href.replace('/docs/', '')}.mdx`

      if (isValidSdk(config)(distFilePath.split('/')[0])) {
        throw new Error(
          `Attempting to write out a core doc to ${distFilePath} but the first part of the path is a valid SDK, this causes a file path conflict.`,
        )
      }

      if (doc.sdk !== undefined) {
        // This is a sdk specific guide, so we want to put a landing page here to redirect the user to a guide customised to their sdk.

        await writeFile(
          distFilePath,
          // It's possible we will want to / need to put some frontmatter here
          `<SDKDocRedirectPage title="${doc.frontmatter.title}" url="${doc.href}" sdk={${JSON.stringify(doc.sdk)}} />`,
        )

        return vfile
      }

      await writeFile(distFilePath, String(vfile))

      return vfile
    }),
  )

  console.info(`✔️ Wrote out ${docs.length} core docs`)

  const sdkSpecificVFiles = await Promise.all(
    config.validSdks.map(async (targetSdk) => {
      // Goes through and removes any items that are not scoped to the target sdk
      const navigation = await traverseTree(
        { items: sdkScopedManifest },
        async ({ sdk, ...item }) => {
          // This means its generic, not scoped to a specific sdk, so we keep it
          if (sdk === undefined)
            return {
              title: item.title,
              href: item.href,
              tag: item.tag,
              wrap: item.wrap === config.manifestOptions.wrapDefault ? undefined : item.wrap,
              icon: item.icon,
              target: item.target,
            } as const

          // This item is not scoped to the target sdk, so we remove it
          if (sdk.includes(targetSdk) === false) return null

          // This is a scoped item and its scoped to our target sdk
          return {
            title: item.title,
            href: scopeHrefToSDK(item.href, targetSdk),
            tag: item.tag,
            wrap: item.wrap === config.manifestOptions.wrapDefault ? undefined : item.wrap,
            icon: item.icon,
            target: item.target,
          } as const
        },
        // @ts-expect-error - This traverseTree function might just be the death of me
        async ({ sdk, ...group }) => {
          if (sdk === undefined)
            return {
              title: group.title,
              collapse: group.collapse === config.manifestOptions.collapseDefault ? undefined : group.collapse,
              tag: group.tag,
              wrap: group.wrap === config.manifestOptions.wrapDefault ? undefined : group.wrap,
              icon: group.icon,
              hideTitle: group.hideTitle === config.manifestOptions.hideTitleDefault ? undefined : group.hideTitle,
              items: group.items,
            }

          if (sdk.includes(targetSdk) === false) return null

          return {
            title: group.title,
            collapse: group.collapse === config.manifestOptions.collapseDefault ? undefined : group.collapse,
            tag: group.tag,
            wrap: group.wrap === config.manifestOptions.wrapDefault ? undefined : group.wrap,
            icon: group.icon,
            hideTitle: group.hideTitle === config.manifestOptions.hideTitleDefault ? undefined : group.hideTitle,
            items: group.items,
          }
        },
      )

      const vFiles = await Promise.all(
        docs.map(async (doc) => {
          if (doc.sdk === undefined) return null // skip core docs
          if (doc.sdk.includes(targetSdk) === false) return null // skip docs that are not for the target sdk

          const vfile = await markdownProcessor()
            // filter out content that is only available to other sdk's
            .use(() => (tree, vfile) => {
              return mdastFilter(tree, (node) => {
                // We aren't passing the vfile here as the as the warning
                // should have already been reported above when we initially
                // parsed the file

                const sdk = extractComponentPropValueFromNode(node, undefined, 'If', 'sdk')

                if (sdk === undefined) return true

                const sdksFilter = extractSDKsFromIfProp(config)(node, undefined, sdk)

                if (sdksFilter === undefined) return true

                if (sdksFilter.includes(targetSdk)) {
                  return true
                }

                return false
              })
            })
            // scope urls so they point to the current sdk
            .use(() => (tree, vfile) => {
              return mdastMap(tree, (node) => {
                if (node.type !== 'link') return node
                if (!('url' in node)) {
                  vfile.fail(`Link node does not have a url property ${pleaseReport}`, node.position)
                  return node
                }
                if (typeof node.url !== 'string') {
                  vfile.fail(`Link node url must be a string ${pleaseReport}`, node.position)
                  return node
                }
                if (!node.url.startsWith('/docs/')) {
                  return node
                }

                const guide = guides.get(node.url)

                if (guide === undefined) {
                }

                return node
              })
            })
            .process({
              ...doc.vfile,
              messages: [], // reset the messages, otherwise they will be duplicated
            })

          await writeSdkFile(targetSdk, `${doc.href.replace('/docs/', '')}.mdx`, String(vfile))

          return vfile
        }),
      )

      await writeSdkFile(targetSdk, 'manifest.json', JSON.stringify({ navigation }))

      return { targetSdk, vFiles }
    }),
  )

  sdkSpecificVFiles.forEach(({ targetSdk, vFiles }) =>
    console.info(`✔️ Wrote out ${vFiles.filter(Boolean).length} ${targetSdk} specific guides`),
  )

  const flatSdkSpecificVFiles = sdkSpecificVFiles.flatMap(({ vFiles }) => vFiles)

  const output = reporter(
    [
      ...coreVFiles.filter((item): item is NonNullable<typeof item> => item !== null),
      ...flatSdkSpecificVFiles.filter((item): item is NonNullable<typeof item> => item !== null),
    ],
    { quiet: true },
  )

  if (output !== '') {
    console.info(output)
  }

  return output
}

const watchAndRebuild = (store: ReturnType<typeof createBlankStore>, config: BuildConfig) => {
  const watcher = chok.watch([config.docsPath], {
    alwaysStat: true,
    ignored: (filePath, stats) => {
      if (stats === undefined) return false
      if (stats.isDirectory()) return false

      const relativePath = path.relative(config.docsPath, filePath)

      const isManifest = relativePath === 'manifest.json'
      const isMarkdown = relativePath.endsWith('.mdx')

      return !(isManifest || isMarkdown)
    },
    ignoreInitial: true,
  })

  watcher.on('all', async (event, filePath) => {
    console.info(`File ${filePath} changed`, { event })

    const href = removeMdxSuffix(`/${path.relative(config.basePath, filePath)}`)

    store.markdownFiles.delete(href)

    await build(store, config)
  })
}

type BuildConfigOptions = {
  basePath: string
  validSdks: readonly SDK[]
  docsPath: string
  manifestPath: string
  partialsPath: string
  distPath: string
  ignorePaths: string[]
  manifestOptions: {
    wrapDefault: boolean
    collapseDefault: boolean
    hideTitleDefault: boolean
  }
}

type BuildConfig = ReturnType<typeof createConfig>

export function createConfig(config: BuildConfigOptions) {
  const resolve = (relativePath: string) => {
    return path.isAbsolute(relativePath) ? relativePath : path.join(config.basePath, relativePath)
  }

  return {
    basePath: config.basePath,
    validSdks: config.validSdks,

    docsRelativePath: config.docsPath,
    docsPath: resolve(config.docsPath),

    manifestRelativePath: config.manifestPath,
    manifestFilePath: resolve(config.manifestPath),

    distRelativePath: config.distPath,
    distPath: resolve(config.distPath),

    partialsRelativePath: config.partialsPath,
    partialsPath: resolve(config.partialsPath),

    ignorePaths: config.ignorePaths,
    manifestOptions: config.manifestOptions ?? {
      wrapDefault: true,
      collapseDefault: false,
      hideTitleDefault: false,
    },
  }
}

const main = async () => {
  const config = createConfig({
    basePath: process.cwd(),
    docsPath: './docs',
    manifestPath: './docs/manifest.json',
    partialsPath: './_partials',
    distPath: './dist',
    ignorePaths: [
      '/docs/core-1',
      '/pricing',
      '/docs/reference/backend-api',
      '/docs/reference/frontend-api',
      '/support',
      '/discord',
      '/contact',
      '/contact/sales',
      '/contact/support',
      '/blog',
      '/changelog/2024-04-19',
      '/docs/_partials',
    ],
    validSdks: VALID_SDKS,
    manifestOptions: {
      wrapDefault: true,
      collapseDefault: false,
      hideTitleDefault: false,
    },
  })

  const store = createBlankStore()

  await build(store, config)

  const args = process.argv.slice(2)
  const watchFlag = args.includes('--watch')

  if (watchFlag) {
    console.info(`Watching for changes...`)

    watchAndRebuild(store, config)
  }
}

// Only invokes the main function if we run the script directly eg npm run build, bun run ./scripts/build-docs.ts
if (require.main === module) {
  main()
}
