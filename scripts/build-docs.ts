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
import { fromError, type ValidationError } from 'zod-validation-error'
import { Node, Position } from 'unist'
import watcher from '@parcel/watcher'
import { existsSync } from 'node:fs'

const errorMessages = {
  // Manifest errors
  'manifest-parse-error': (error: ValidationError | Error): string => `Failed to parse manifest: ${error}`,

  // Component errors
  'component-no-props': (componentName: string): string => `<${componentName} /> component has no props`,
  'component-attributes-not-array': (componentName: string): string =>
    `<${componentName} /> node attributes is not an array (this is a bug with the build script, please report)`,
  'component-missing-attribute': (componentName: string, propName: string): string =>
    `<${componentName} /> component has no "${propName}" attribute`,
  'component-attribute-no-value': (componentName: string, propName: string): string =>
    `<${componentName} /> attribute "${propName}" has no value (this is a bug with the build script, please report)`,
  'component-attribute-unsupported-type': (componentName: string, propName: string): string =>
    `<${componentName} /> attribute "${propName}" has an unsupported value type`,

  // SDK errors
  'invalid-sdks-in-if': (invalidSDKs: string[]): string =>
    `sdks "${invalidSDKs.join('", "')}" in <If /> are not valid SDKs`,
  'invalid-sdk-in-if': (sdk: string): string => `sdk "${sdk}" in <If /> is not a valid SDK`,
  'invalid-sdk-in-frontmatter': (invalidSDKs: string[], validSdks: SDK[]): string =>
    `Invalid SDK ${JSON.stringify(invalidSDKs)}, the valid SDKs are ${JSON.stringify(validSdks)}`,
  'if-component-sdk-not-in-frontmatter': (sdk: SDK, docSdk: SDK[]): string =>
    `<If /> component is attempting to filter to sdk "${sdk}" but it is not available in the docs frontmatter ["${docSdk.join('", "')}"], if this is a mistake please remove it from the <If /> otherwise update the frontmatter to include "${sdk}"`,
  'if-component-sdk-not-in-manifest': (sdk: SDK, href: string): string =>
    `<If /> component is attempting to filter to sdk "${sdk}" but it is not available in the manifest.json for ${href}, if this is a mistake please remove it from the <If /> otherwise update the manifest.json to include "${sdk}"`,
  'doc-sdk-filtered-by-parent': (title: string, docSDK: SDK[], parentSDK: SDK[]): string =>
    `Doc "${title}" is attempting to use ${JSON.stringify(docSDK)} But its being filtered down to ${JSON.stringify(parentSDK)} in the manifest.json`,
  'group-sdk-filtered-by-parent': (title: string, groupSDK: SDK[], parentSDK: SDK[]): string =>
    `Group "${title}" is attempting to use ${JSON.stringify(groupSDK)} But its being filtered down to ${JSON.stringify(parentSDK)} in the manifest.json`,

  // Document structure errors
  'doc-not-in-manifest': (): string =>
    'This doc is not in the manifest.json, but will still be publicly accessible and other docs can link to it',
  'invalid-href-encoding': (href: string): string =>
    `Href "${href}" contains characters that will be encoded by the browser, please remove them`,
  'frontmatter-missing-title': (): string => 'Frontmatter must have a "title" property',
  'frontmatter-missing-description': (): string => 'Frontmatter should have a "description" property',
  'frontmatter-parse-failed': (href: string): string => `Frontmatter parsing failed for ${href}`,
  'doc-not-found': (title: string, href: string): string =>
    `Doc "${title}" in manifest.json not found in the docs folder at ${href}.mdx`,
  'doc-parse-failed': (href: string): string => `Doc "${href}" failed to parse`,
  'sdk-path-conflict': (href: string, path: string): string =>
    `Doc "${href}" is attempting to write out a doc to ${path} but the first part of the path is a valid SDK, this causes a file path conflict.`,
  'duplicate-heading-id': (href: string, id: string): string =>
    `Doc "${href}" contains a duplicate heading id "${id}", please ensure all heading ids are unique`,

  // Include component errors
  'include-src-not-partials': (): string => `<Include /> prop "src" must start with "_partials/"`,
  'partial-not-found': (src: string): string => `Partial /docs/${src}.mdx not found`,
  'partials-inside-partials': (): string =>
    'Partials inside of partials is not yet supported (this is a bug with the build script, please report)',

  // Link validation errors
  'link-doc-not-found': (url: string): string => `Doc ${url} not found`,
  'link-hash-not-found': (hash: string, url: string): string => `Hash "${hash}" not found in ${url}`,

  // File reading errors
  'file-read-error': (filePath: string): string => `file ${filePath} doesn't exist`,
  'partial-read-error': (path: string): string => `Failed to read in ${path} from partials file`,
  'markdown-read-error': (href: string): string => `Attempting to read in ${href}.mdx failed`,
  'partial-parse-error': (path: string): string => `Failed to parse the content of ${path}`,

  // Typedoc errors
  'typedoc-folder-not-found': (path: string): string =>
    `Typedoc folder ${path} not found, run "npm run typedoc:download"`,
  'typedoc-read-error': (filePath: string): string => `Failed to read in ${filePath} from typedoc file`,
  'typedoc-parse-error': (filePath: string): string => `Failed to parse ${filePath} from typedoc file`,
  'typedoc-not-found': (filePath: string): string => `Typedoc ${filePath} not found`,
} as const

type WarningCode = keyof typeof errorMessages

// Helper function to check if a warning should be ignored
const shouldIgnoreWarning = (config: BuildConfig, filePath: string, warningCode: WarningCode): boolean => {
  if (!config.ignoreWarnings) {
    return false
  }

  const ignoreList = config.ignoreWarnings[filePath]
  if (!ignoreList) {
    return false
  }

  return ignoreList.includes(warningCode)
}

const safeMessage = <TCode extends WarningCode, TArgs extends Parameters<(typeof errorMessages)[TCode]>>(
  config: BuildConfig,
  vfile: VFile,
  filePath: string,
  warningCode: TCode,
  args: TArgs,
  position?: Position,
) => {
  if (!shouldIgnoreWarning(config, filePath, warningCode)) {
    // @ts-expect-error - TypeScript has trouble with spreading args into the function
    const message = errorMessages[warningCode](...args)
    vfile.message(message, position)
  }
}

const safeFail = <TCode extends WarningCode, TArgs extends Parameters<(typeof errorMessages)[TCode]>>(
  config: BuildConfig,
  vfile: VFile,
  filePath: string,
  warningCode: TCode,
  args: TArgs,
  position?: Position,
) => {
  if (!shouldIgnoreWarning(config, filePath, warningCode)) {
    // @ts-expect-error - TypeScript has trouble with spreading args into the function
    const message = errorMessages[warningCode](...args)
    vfile.fail(message, position)
  }
}

const VALID_SDKS = [
  'nextjs',
  'react',
  'js-frontend',
  'chrome-extension',
  'expo',
  'ios',
  'nodejs',
  'expressjs',
  'fastify',
  'react-router',
  'remix',
  'tanstack-react-start',
  'go',
  'astro',
  'nuxt',
  'vue',
  'ruby',
  'python',
  'js-backend',
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

const parseJSON = (json: string) => {
  try {
    const output = JSON.parse(json)

    return [null, output as unknown] as const
  } catch (error) {
    return [new Error(`Failed to parse JSON`, { cause: error }), null] as const
  }
}

const readManifest = (config: BuildConfig) => async (): Promise<Manifest> => {
  const { manifestSchema } = createManifestSchema(config)
  const unsafe_manifest = await fs.readFile(config.manifestFilePath, { encoding: 'utf-8' })

  const [error, json] = parseJSON(unsafe_manifest)

  if (error) {
    throw new Error(errorMessages['manifest-parse-error'](error))
  }

  const manifest = await z.object({ navigation: manifestSchema }).safeParseAsync(json)

  if (manifest.success === true) {
    return manifest.data.navigation
  }

  throw new Error(errorMessages['manifest-parse-error'](fromError(manifest.error)))
}

const readMarkdownFile = (config: BuildConfig) => async (docPath: string) => {
  const filePath = path.join(config.docsPath, docPath)

  try {
    const fileContent = await fs.readFile(filePath, { encoding: 'utf-8' })
    return [null, fileContent] as const
  } catch (error) {
    return [new Error(errorMessages['file-read-error'](filePath), { cause: error }), null] as const
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
  return readdirp.promise(config.partialsPath, {
    type: 'files',
    fileFilter: '*.mdx',
  })
}

const readPartial = (config: BuildConfig) => async (filePath: string) => {
  const readFile = readMarkdownFile(config)

  const fullPath = path.join(config.docsRelativePath, config.partialsRelativePath, filePath)

  const [error, content] = await readFile(fullPath)

  if (error) {
    throw new Error(errorMessages['partial-read-error'](fullPath), { cause: error })
  }

  let partialNode: Node | null = null

  const partialContentVFile = await markdownProcessor()
    .use(() => (tree) => {
      partialNode = tree
    })
    .use(() => (tree, vfile) => {
      mdastVisit(
        tree,
        (node) =>
          (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') &&
          'name' in node &&
          node.name === 'Include',
        (node) => {
          safeFail(config, vfile, fullPath, 'partials-inside-partials', [], node.position)
        },
      )
    })
    // Process links in partials and remove the .mdx suffix
    .use(() => (tree, vfile) => {
      return mdastMap(tree, (node) => {
        if (node.type !== 'link') return node
        if (!('url' in node)) return node
        if (typeof node.url !== 'string') return node
        if (!node.url.startsWith('/docs/')) return node
        if (!('children' in node)) return node

        // We are overwriting the url with the mdx suffix removed
        node.url = removeMdxSuffix(node.url)

        return node
      })
    })
    .process({
      path: `docs/_partials/${filePath}`,
      value: content,
    })

  const partialContentReport = reporter([partialContentVFile], { quiet: true })

  if (partialContentReport !== '') {
    console.error(partialContentReport)
    process.exit(1)
  }

  if (partialNode === null) {
    throw new Error(errorMessages['partial-parse-error'](filePath))
  }

  return {
    path: filePath,
    content,
    vfile: partialContentVFile,
    node: partialNode as Node,
  }
}

const readPartialsMarkdown =
  (config: BuildConfig, store: ReturnType<typeof createBlankStore>) => async (paths: string[]) => {
    const read = readPartial(config)

    return Promise.all(
      paths.map(async (markdownPath) => {
        const cachedValue = store.partialsFiles.get(markdownPath)

        if (cachedValue !== undefined) {
          return cachedValue
        }

        const partial = await read(markdownPath)

        store.partialsFiles.set(markdownPath, partial)

        return partial
      }),
    )
  }
  
const readTypedocsFolder = (config: BuildConfig) => async () => {
  return readdirp.promise(config.typedocPath, {
    type: 'files',
    fileFilter: '*.mdx',
  })
}

const readTypedocsMarkdown = (config: BuildConfig) => async (paths: string[]) => {
  const readFile = readMarkdownFile(config)

  return Promise.all(
    paths.map(async (filePath) => {
      const typedocPath = path.join(config.typedocRelativePath, filePath)

      const [error, content] = await readFile(typedocPath)

      if (error) {
        throw new Error(errorMessages['typedoc-read-error'](typedocPath), { cause: error })
      }

      let node: Node | null = null

      const vfile = await remark()
        .use(() => (tree) => {
          node = tree
        })
        .process({
          path: typedocPath,
          value: content,
        })

      if (node === null) {
        throw new Error(errorMessages['typedoc-parse-error'](typedocPath))
      }

      return {
        path: `${removeMdxSuffix(filePath)}.mdx`,
        content,
        vfile,
        node: node as Node,
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
  if (filePath.includes('#')) {
    const [url, hash] = filePath.split('#')

    if (url.endsWith('.mdx')) {
      return url.slice(0, -4) + `#${hash}`
    }

    return url + `#${hash}`
  }

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

const traverseTreeItemsFirst = async <
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
              const newItems = (await traverseTreeItemsFirst(item, itemCallback, groupCallback, errorCallback)).map(
                (group) => group.filter((item): item is NonNullable<typeof item> => item !== null),
              )

              const newGroup = await groupCallback({ ...item, items: newItems }, tree)

              return newGroup
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

const findComponent = (node: Node, componentName: string) => {
  // Check if it's an MDX component
  if (node.type !== 'mdxJsxFlowElement' && node.type !== 'mdxJsxTextElement') {
    return undefined
  }

  // Check if it's the correct component
  if (!('name' in node)) return undefined
  if (node.name !== componentName) return undefined

  return node
}

const extractComponentPropValueFromNode = (
  config: BuildConfig,
  node: Node,
  vfile: VFile | undefined,
  componentName: string,
  propName: string,
  required = true,
  filePath: string,
): string | undefined => {
  const component = findComponent(node, componentName)

  if (component === undefined) return undefined

  // Check for attributes
  if (!('attributes' in component)) {
    if (vfile) {
      safeMessage(config, vfile, filePath, 'component-no-props', [componentName], component.position)
    }
    return undefined
  }

  if (!Array.isArray(component.attributes)) {
    if (vfile) {
      safeMessage(config, vfile, filePath, 'component-attributes-not-array', [componentName], component.position)
    }
    return undefined
  }

  // Find the requested prop
  const propAttribute = component.attributes.find((attribute) => attribute.name === propName)

  if (propAttribute === undefined) {
    if (required === true && vfile) {
      safeMessage(config, vfile, filePath, 'component-missing-attribute', [componentName, propName], component.position)
    }
    return undefined
  }

  const value = propAttribute.value

  if (value === undefined) {
    if (required === true && vfile) {
      safeMessage(
        config,
        vfile,
        filePath,
        'component-attribute-no-value',
        [componentName, propName],
        component.position,
      )
    }
    return undefined
  }

  // Handle both string values and object values (like JSX expressions)
  if (typeof value === 'string') {
    return value
  } else if (typeof value === 'object' && 'value' in value) {
    return value.value
  }

  if (vfile) {
    safeMessage(
      config,
      vfile,
      filePath,
      'component-attribute-unsupported-type',
      [componentName, propName],
      component.position,
    )
  }
  return undefined
}

const extractSDKsFromIfProp =
  (config: BuildConfig) => (node: Node, vfile: VFile | undefined, sdkProp: string, filePath: string) => {
    const isValidItem = isValidSdk(config)
    const isValidItems = isValidSdks(config)

    if (sdkProp.includes('", "') || sdkProp.includes("', '") || sdkProp.includes('["') || sdkProp.includes('"]')) {
      const sdks = JSON.parse(sdkProp.replaceAll("'", '"')) as string[]
      if (isValidItems(sdks)) {
        return sdks
      } else {
        const invalidSDKs = sdks.filter((sdk) => !isValidItem(sdk))
        if (vfile) {
          safeMessage(config, vfile, filePath, 'invalid-sdks-in-if', [invalidSDKs], node.position)
        }
      }
    } else {
      if (isValidItem(sdkProp)) {
        return [sdkProp]
      } else {
        if (vfile) {
          safeMessage(config, vfile, filePath, 'invalid-sdk-in-if', [sdkProp], node.position)
        }
      }
    }
  }

const extractHeadingFromHeadingNode = (node: Node) => {
  // eg # test {{ id: 'my-heading' }}
  // This is for remapping the hash to the custom id
  const id =
    ('children' in node &&
      Array.isArray(node.children) &&
      (node?.children
        ?.find(
          (child: unknown) =>
            typeof child === 'object' && child !== null && 'type' in child && child?.type === 'mdxTextExpression',
        )
        ?.data?.estree?.body?.find(
          (child: unknown) =>
            typeof child === 'object' && child !== null && 'type' in child && child?.type === 'ExpressionStatement',
        )
        ?.expression?.properties?.find(
          (prop: unknown) =>
            typeof prop === 'object' &&
            prop !== null &&
            'key' in prop &&
            typeof prop.key === 'object' &&
            prop.key !== null &&
            'name' in prop.key &&
            prop.key.name === 'id',
        )?.value?.value as string | undefined)) ||
    undefined

  return id
}

const documentHasIfComponents = (tree: Node) => {
  let found = false

  mdastVisit(tree, (node) => {
    const ifSrc = findComponent(node, 'If')

    if (ifSrc !== undefined) {
      found = true
    }
  })

  return found
}

const parseInMarkdownFile =
  (config: BuildConfig) =>
  async (
    href: string,
    partials: { path: string; content: string; node: Node }[],
    typedocs: { path: string; content: string; node: Node }[],
    inManifest: boolean,
  ) => {
    const readFile = readMarkdownFile(config)
    const validateSDKs = isValidSdks(config)
    const [error, fileContent] = await readFile(`${href}.mdx`.replace('/docs/', ''))

    if (error !== null) {
      throw new Error(errorMessages['markdown-read-error'](href), {
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
    const headingsHashes = new Set<string>()
    const filePath = `${href}.mdx`
    let node: Node | undefined = undefined

    const vfile = await markdownProcessor()
      .use(() => (tree, vfile) => {
        node = tree

        if (inManifest === false) {
          safeMessage(config, vfile, filePath, 'doc-not-in-manifest', [])
        }

        if (href !== encodeURI(href)) {
          safeFail(config, vfile, filePath, 'invalid-href-encoding', [href])
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

            if (frontmatterSDKs !== undefined && validateSDKs(frontmatterSDKs) === false) {
              const invalidSDKs = frontmatterSDKs.filter((sdk) => isValidSdk(config)(sdk) === false)
              safeFail(
                config,
                vfile,
                filePath,
                'invalid-sdk-in-frontmatter',
                [invalidSDKs, config.validSdks as SDK[]],
                node.position,
              )
              return
            }

            if (frontmatterYaml.title === undefined) {
              safeFail(config, vfile, filePath, 'frontmatter-missing-title', [], node.position)
              return
            }

            if (frontmatterYaml.description === undefined) {
              safeMessage(config, vfile, filePath, 'frontmatter-missing-description', [], node.position)
            }

            frontmatter = {
              title: frontmatterYaml.title,
              description: frontmatterYaml.description,
              sdk: frontmatterSDKs,
            }
          },
        )

        if (frontmatter === undefined) {
          safeFail(config, vfile, filePath, 'frontmatter-parse-failed', [href])
          return
        }
      })
      // Validate the <Include />
      .use(() => (tree, vfile) => {
        return mdastVisit(tree, (node) => {
          const partialSrc = extractComponentPropValueFromNode(config, node, vfile, 'Include', 'src', true, filePath)

          if (partialSrc === undefined) return

          if (partialSrc.startsWith('_partials/') === false) {
            safeMessage(config, vfile, filePath, 'include-src-not-partials', [], node.position)
            return
          }

          const partial = partials.find(
            (partial) => `_partials/${partial.path}` === `${removeMdxSuffix(partialSrc)}.mdx`,
          )

          if (partial === undefined) {
            safeMessage(config, vfile, filePath, 'partial-not-found', [removeMdxSuffix(partialSrc)], node.position)
            return
          }
        })
      })
      // Validate the <Typedoc />
      .use(() => (tree, vfile) => {
        return mdastVisit(tree, (node) => {
          const typedocSrc = extractComponentPropValueFromNode(config, node, vfile, 'Typedoc', 'src', true, filePath)

          if (typedocSrc === undefined) return

          const typedocFolderExists = existsSync(config.typedocPath)

          if (typedocFolderExists === false) {
            throw new Error(errorMessages['typedoc-folder-not-found'](config.typedocPath))
          }

          const typedoc = typedocs.find((typedoc) => typedoc.path === `${removeMdxSuffix(typedocSrc)}.mdx`)

          if (typedoc === undefined) {
            safeMessage(
              config,
              vfile,
              filePath,
              'typedoc-not-found',
              [`${removeMdxSuffix(typedocSrc)}.mdx`],
              node.position,
            )
            return
          }

          return
        })
      })
      .process({
        path: `${href.substring(1)}.mdx`,
        value: fileContent,
      })

    // This needs to be done separately as some further validation expects the partials to not be embedded
    // but we need to embed it to get all the headings to check
    await markdownProcessor()
      // Embed the partial
      .use(() => (tree, vfile) => {
        return mdastMap(tree, (node) => {
          const partialSrc = extractComponentPropValueFromNode(config, node, vfile, 'Include', 'src', true, filePath)

          if (partialSrc === undefined) return node

          if (partialSrc.startsWith('_partials/') === false) {
            safeMessage(config, vfile, filePath, 'include-src-not-partials', [], node.position)
            return node
          }

          const partial = partials.find(
            (partial) => `_partials/${partial.path}` === `${removeMdxSuffix(partialSrc)}.mdx`,
          )

          if (partial === undefined) {
            safeMessage(config, vfile, filePath, 'partial-not-found', [removeMdxSuffix(partialSrc)], node.position)
            return node
          }

          return Object.assign(node, partial.node)
        })
      })
      // Embed the typedoc
      .use(() => (tree, vfile) => {
        return mdastMap(tree, (node) => {
          const typedocSrc = extractComponentPropValueFromNode(config, node, vfile, 'Typedoc', 'src', true, filePath)

          if (typedocSrc === undefined) return node

          const typedoc = typedocs.find((typedoc) => typedoc.path === `${removeMdxSuffix(typedocSrc)}.mdx`)

          if (typedoc === undefined) {
            safeMessage(
              config,
              vfile,
              filePath,
              'typedoc-not-found',
              [`${removeMdxSuffix(typedocSrc)}.mdx`],
              node.position,
            )
            return node
          }

          return Object.assign(node, typedoc.node)
        })
      })
      // extract out the headings to check hashes in links
      .use(() => (tree, vfile) => {
        const documentContainsIfComponent = documentHasIfComponents(tree)

        mdastVisit(
          tree,
          (node) => node.type === 'heading',
          (node) => {
            const id = extractHeadingFromHeadingNode(node)

            if (id !== undefined) {
              if (documentContainsIfComponent === false && headingsHashes.has(id)) {
                safeFail(config, vfile, filePath, 'duplicate-heading-id', [href, id])
              }

              headingsHashes.add(id)
            } else {
              const slug = slugify(toString(node).trim())

              if (documentContainsIfComponent === false && headingsHashes.has(slug)) {
                safeFail(config, vfile, filePath, 'duplicate-heading-id', [href, slug])
              }

              headingsHashes.add(slug)
            }
          },
        )
      })
      .process({
        path: `${href.substring(1)}.mdx`,
        value: fileContent,
      })

    if (node === undefined) {
      throw new Error(errorMessages['doc-parse-failed'](href))
    }

    if (frontmatter === undefined) {
      throw new Error(errorMessages['frontmatter-parse-failed'](href))
    }

    return {
      href,
      sdk: (frontmatter as Frontmatter).sdk,
      vfile,
      headingsHashes,
      frontmatter: frontmatter as Frontmatter,
      node: node as Node,
    }
  }

export const createBlankStore = () => ({
  markdownFiles: new Map<string, Awaited<ReturnType<ReturnType<typeof parseInMarkdownFile>>>>(),
  partialsFiles: new Map<string, Awaited<ReturnType<ReturnType<typeof readPartial>>>>(),
})

export const build = async (store: ReturnType<typeof createBlankStore>, config: BuildConfig) => {
  // Apply currying to create functions pre-configured with config
  const ensureDir = ensureDirectory(config)
  const getManifest = readManifest(config)
  const getDocsFolder = readDocsFolder(config)
  const getPartialsFolder = readPartialsFolder(config)
  const getPartialsMarkdown = readPartialsMarkdown(config, store)
  const getTypedocsFolder = readTypedocsFolder(config)
  const getTypedocsMarkdown = readTypedocsMarkdown(config)
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

  const typedocs = await getTypedocsMarkdown((await getTypedocsFolder()).map((item) => item.path))
  console.info(`✔️ Read ${typedocs.length} Typedocs`)

  const docsMap = new Map<string, Awaited<ReturnType<typeof parseMarkdownFile>>>()
  const docsInManifest = new Set<string>()

  // Grab all the docs links in the manifest
  await traverseTree({ items: userManifest }, async (item) => {
    if (!item.href?.startsWith('/docs/')) return item
    if (item.target !== undefined) return item

    const ignore = config.ignorePaths.some((ignoreItem) => item.href.startsWith(ignoreItem))
    if (ignore === true) return item

    docsInManifest.add(item.href)

    return item
  })
  console.info('✓ Parsed in Manifest')

  const cachedDocsSize = store.markdownFiles.size
  // Read in all the docs
  const docsArray = await Promise.all(
    docsFiles.map(async (file) => {
      const href = removeMdxSuffix(`/docs/${file.path}`)

      const inManifest = docsInManifest.has(href)

      let markdownFile: Awaited<ReturnType<typeof parseMarkdownFile>>

      const cachedMarkdownFile = store.markdownFiles.get(href)

      if (cachedMarkdownFile) {
        markdownFile = structuredClone(cachedMarkdownFile)
      } else {
        markdownFile = await parseMarkdownFile(href, partials, typedocs, inManifest)

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
      if (!item.href?.startsWith('/docs/')) return item
      if (item.target !== undefined) return item

      const ignore = config.ignorePaths.some((ignoreItem) => item.href.startsWith(ignoreItem))
      if (ignore === true) return item // even thou we are not processing them, we still need to keep them

      const doc = docsMap.get(item.href)

      if (doc === undefined) {
        const filePath = `${item.href}.mdx`
        if (!shouldIgnoreWarning(config, filePath, 'doc-not-found')) {
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
          if (!shouldIgnoreWarning(config, filePath, 'doc-sdk-filtered-by-parent')) {
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

      if (groupSDK !== undefined && parentSDK !== undefined) {
        if (groupSDK.every((sdk) => parentSDK?.includes(sdk)) === false) {
          const filePath = `/docs/groups/${details.title}.mdx`
          if (!shouldIgnoreWarning(config, filePath, 'group-sdk-filtered-by-parent')) {
            throw new Error(errorMessages['group-sdk-filtered-by-parent'](details.title, groupSDK, parentSDK))
          }
        }
      }

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
            href: docsMap.get(item.href)?.sdk !== undefined ? scopeHrefToSDK(item.href, ':sdk:') : item.href,
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
      const partialPath = `/docs/_partials/${partial.path}`

      let node: Node | null = null

      const vfile = await markdownProcessor()
        // validate links in partials to docs are valid and replace the links to sdk scoped pages with the sdk link component
        .use(() => (tree, vfile) => {
          return mdastMap(tree, (node) => {
            if (node.type !== 'link') return node
            if (!('url' in node)) return node
            if (typeof node.url !== 'string') return node
            if (!node.url.startsWith('/docs/')) return node
            if (!('children' in node)) return node

            // we are overwriting the url with the mdx suffix removed
            node.url = removeMdxSuffix(node.url)

            const [url, hash] = (node.url as string).split('#')

            const ignore = config.ignorePaths.some((ignoreItem) => url.startsWith(ignoreItem))
            if (ignore === true) return node

            const doc = docsMap.get(url)

            if (doc === undefined) {
              safeMessage(config, vfile, partialPath, 'link-doc-not-found', [url], node.position)
              return node
            }

            if (hash !== undefined) {
              const hasHash = doc.headingsHashes.has(hash)

              if (hasHash === false) {
                safeMessage(config, vfile, partialPath, 'link-hash-not-found', [hash, url], node.position)
              }
            }

            if (doc.sdk !== undefined) {
              // we are going to swap it for the sdk link component to give the users a great experience

              const firstChild = node.children?.[0]
              const childIsCodeBlock = firstChild?.type === 'inlineCode'

              if (childIsCodeBlock) {
                firstChild.type = 'text'

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
                        value: JSON.stringify(doc.sdk),
                      }),
                    }),
                    mdastBuilder('mdxJsxAttribute', {
                      name: 'code',
                      value: mdastBuilder('mdxJsxAttributeValueExpression', {
                        value: childIsCodeBlock,
                      }),
                    }),
                  ],
                })
              }

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
                      value: JSON.stringify(doc.sdk),
                    }),
                  }),
                ],
                children: node.children,
              })
            }

            return node
          })
        })
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
    }),
  )
  console.info(`✓ Validated all partials`)

  const validatedTypedocs = await Promise.all(
    typedocs.map(async (typedoc) => {
      const filePath = path.join(config.typedocRelativePath, typedoc.path)

      let node: Node | null = null

      const vfile = await markdownProcessor()
        // Validate links between docs are valid and replace the links to sdk scoped pages with the sdk link component
        .use(() => (tree: Node, vfile: VFile) => {
          return mdastMap(tree, (node) => {
            if (node.type !== 'link') return node
            if (!('url' in node)) return node
            if (typeof node.url !== 'string') return node
            if (!node.url.startsWith('/docs/')) return node
            if (!('children' in node)) return node

            // we are overwriting the url with the mdx suffix removed
            node.url = removeMdxSuffix(node.url)

            const [url, hash] = (node.url as string).split('#')

            const ignore = config.ignorePaths.some((ignoreItem) => url.startsWith(ignoreItem))
            if (ignore === true) return node

            const doc = docsMap.get(url)

            if (doc === undefined) {
              safeMessage(config, vfile, filePath, 'link-doc-not-found', [url], node.position)
              return node
            }

            if (hash !== undefined) {
              const hasHash = doc.headingsHashes.has(hash)

              if (hasHash === false) {
                safeMessage(config, vfile, filePath, 'link-hash-not-found', [hash, url], node.position)
              }
            }

            if (doc.sdk !== undefined) {
              // we are going to swap it for the sdk link component to give the users a great experience

              const firstChild = node.children?.[0]
              const childIsCodeBlock = firstChild?.type === 'inlineCode'

              if (childIsCodeBlock) {
                firstChild.type = 'text'

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
                        value: JSON.stringify(doc.sdk),
                      }),
                    }),
                    mdastBuilder('mdxJsxAttribute', {
                      name: 'code',
                      value: mdastBuilder('mdxJsxAttributeValueExpression', {
                        value: childIsCodeBlock,
                      }),
                    }),
                  ],
                })
              }

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
                      value: JSON.stringify(doc.sdk),
                    }),
                  }),
                ],
                children: node.children,
              })
            }

            return node
          })
        })
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
    })
  )
  console.info(`✔️ Validated all typedocs`)

  const coreVFiles = await Promise.all(
    docsArray.map(async (doc) => {
      const filePath = `${doc.href}.mdx`

      const vfile = await markdownProcessor()
        // Validate links between docs are valid and replace the links to sdk scoped pages with the sdk link component
        .use(() => (tree: Node, vfile: VFile) => {
          return mdastMap(tree, (node) => {
            if (node.type !== 'link') return node
            if (!('url' in node)) return node
            if (typeof node.url !== 'string') return node
            if (!node.url.startsWith('/docs/') && !node.url.startsWith('#')) return node
            if (!('children' in node)) return node

            // we are overwriting the url with the mdx suffix removed
            node.url = removeMdxSuffix(node.url)

            let [url, hash] = (node.url as string).split('#')

            if (url === '') {
              // If the link is just a hash, then we need to link to the same doc
              url = doc.href
            }

            const ignore = config.ignorePaths.some((ignoreItem) => url.startsWith(ignoreItem))
            if (ignore === true) return node

            const linkedDoc = docsMap.get(url)

            if (linkedDoc === undefined) {
              safeMessage(config, vfile, filePath, 'link-doc-not-found', [url], node.position)
              return node
            }

            if (hash !== undefined) {
              const hasHash = linkedDoc.headingsHashes.has(hash)

              if (hasHash === false) {
                safeMessage(config, vfile, filePath, 'link-hash-not-found', [hash, url], node.position)
              }
            }

            if (linkedDoc.sdk !== undefined) {
              // we are going to swap it for the sdk link component to give the users a great experience

              const firstChild = node.children?.[0]
              const childIsCodeBlock = firstChild?.type === 'inlineCode'

              if (childIsCodeBlock) {
                firstChild.type = 'text'

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
                        value: JSON.stringify(linkedDoc.sdk),
                      }),
                    }),
                    mdastBuilder('mdxJsxAttribute', {
                      name: 'code',
                      value: mdastBuilder('mdxJsxAttributeValueExpression', {
                        value: childIsCodeBlock,
                      }),
                    }),
                  ],
                })
              }

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
                      value: JSON.stringify(linkedDoc.sdk),
                    }),
                  }),
                ],
                children: node.children,
              })
            }

            return node
          })
        })
        // Validate the <If /> components
        .use(() => (tree, vfile) => {
          mdastVisit(tree, (node) => {
            const sdk = extractComponentPropValueFromNode(config, node, vfile, 'If', 'sdk', false, filePath)

            if (sdk === undefined) return

            const sdksFilter = extractSDKsFromIfProp(config)(node, vfile, sdk, filePath)

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
                  safeFail(config, vfile, filePath, 'if-component-sdk-not-in-manifest', [sdk, doc.href], node.position)
                }
              })()
            })
          })
        })
        // embed the partials into the doc
        .use(() => (tree, vfile) => {
          return mdastMap(tree, (node) => {
            const partialSrc = extractComponentPropValueFromNode(config, node, vfile, 'Include', 'src', true, filePath)

            if (partialSrc === undefined) return node

            const partial = validatedPartials.find(
              (partial) => `_partials/${partial.path}` === `${removeMdxSuffix(partialSrc)}.mdx`,
            )

            if (partial === undefined) return node // a warning will have already been reported

            return Object.assign(node, partial.node)
          })
        })
        .process(doc.vfile)

      const distFilePath = `${doc.href.replace('/docs/', '')}.mdx`

      if (isValidSdk(config)(distFilePath.split('/')[0])) {
        if (!shouldIgnoreWarning(config, filePath, 'sdk-path-conflict')) {
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
<SDKDocRedirectPage title="${doc.frontmatter.title}"${doc.frontmatter.description ? ` description="${doc.frontmatter.description}" ` : ' '}href="${scopeHrefToSDK(doc.href, ':sdk:')}" sdks={${JSON.stringify(doc.sdk)}} />`,
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
          const vfile = await markdownProcessor()
            // filter out content that is only available to other sdk's
            .use(() => (tree, vfile) => {
              return mdastFilter(tree, (node) => {
                // We aren't passing the vfile here as the as the warning
                // should have already been reported above when we initially
                // parsed the file
                const sdk = extractComponentPropValueFromNode(config, node, undefined, 'If', 'sdk', true, filePath)

                if (sdk === undefined) return true

                const sdksFilter = extractSDKsFromIfProp(config)(node, undefined, sdk, filePath)

                if (sdksFilter === undefined) return true

                if (sdksFilter.includes(targetSdk)) {
                  return true
                }

                return false
              })
            })
            // Validate unique heading ids
            .use(() => (tree, vfile) => {
              const headingsHashes = new Set<string>()
              const slugify = slugifyWithCounter()

              mdastVisit(
                tree,
                (node) => node.type === 'heading',
                (node) => {
                  const id = extractHeadingFromHeadingNode(node)

                  if (id !== undefined) {
                    if (headingsHashes.has(id)) {
                      safeFail(config, vfile, filePath, 'duplicate-heading-id', [filePath, id])
                    }

                    headingsHashes.add(id)
                  } else {
                    const slug = slugify(toString(node).trim())

                    if (headingsHashes.has(slug)) {
                      safeFail(config, vfile, filePath, 'duplicate-heading-id', [filePath, slug])
                    }

                    headingsHashes.add(slug)
                  }
                },
              )
            })
            // scope urls so they point to the current sdk
            .use(() => (tree, vfile) => {
              return mdastMap(tree, (node) => {
                if (node.type !== 'link') return node
                if (!('url' in node)) {
                  safeFail(config, vfile, filePath, 'link-doc-not-found', ['url property missing'], node.position)
                  return node
                }
                if (typeof node.url !== 'string') {
                  safeFail(config, vfile, filePath, 'link-doc-not-found', ['url not a string'], node.position)
                  return node
                }
                if (!node.url.startsWith('/docs/')) {
                  return node
                }

                // we are overwriting the url with the mdx suffix removed
                node.url = removeMdxSuffix(node.url)

                const [url, hash] = (node.url as string).split('#')

                const ignore = config.ignorePaths.some((ignoreItem) => url.startsWith(ignoreItem))
                if (ignore === true) return node

                const doc = docsMap.get(url)

                if (doc === undefined) {
                  safeFail(config, vfile, filePath, 'link-doc-not-found', [url], node.position)
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

                frontmatter.canonical = doc.sdk ? scopeHrefToSDK(doc.href, ':sdk:') : doc.href

                node.value = yaml.stringify(frontmatter).split('\n').slice(0, -1).join('\n')

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
      const sdkProp = extractComponentPropValueFromNode(config, node, undefined, 'If', 'sdk', true, filePath)

      if (sdkProp === undefined) return

      const sdks = extractSDKsFromIfComponent(node, undefined, sdkProp, filePath)

      if (sdks === undefined) return

      sdks.forEach((sdk) => availableSDKs.add(sdk))
    })

    // For each SDK, check heading uniqueness after filtering
    for (const sdk of availableSDKs) {
      const vfile = await markdownProcessor()
        .use(() => (inputTree) => {
          return mdastFilter(inputTree, (node) => {
            const sdkProp = extractComponentPropValueFromNode(config, node, undefined, 'If', 'sdk', false, filePath)
            if (!sdkProp) return true

            const ifSdks = extractSDKsFromIfComponent(node, undefined, sdkProp, filePath)
            if (!ifSdks) return true

            return ifSdks.includes(sdk)
          })
        })
        .use(() => (inputTree, vfile) => {
          const headingsHashes = new Set<string>()
          const slugify = slugifyWithCounter()

          mdastVisit(
            inputTree,
            (node) => node.type === 'heading',
            (node) => {
              const id = extractHeadingFromHeadingNode(node)

              if (id !== undefined) {
                if (headingsHashes.has(id)) {
                  safeFail(config, vfile, filePath, 'duplicate-heading-id', [filePath, id])
                }

                headingsHashes.add(id)
              } else {
                const slug = slugify(toString(node).trim())

                if (headingsHashes.has(slug)) {
                  safeFail(config, vfile, filePath, 'duplicate-heading-id', [filePath, slug])
                }

                headingsHashes.add(slug)
              }
            },
          )
        })
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

export const invalidateFile =
  (store: ReturnType<typeof createBlankStore>, config: BuildConfig) => (filePath: string) => {
    store.markdownFiles.delete(removeMdxSuffix(`/docs/${path.relative(config.docsPath, filePath)}`))
    store.partialsFiles.delete(path.relative(config.partialsPath, filePath))
  }

const watchAndRebuild = (store: ReturnType<typeof createBlankStore>, config: BuildConfig) => {
  const invalidate = invalidateFile(store, config)

  watcher.subscribe(config.docsPath, async (error, events) => {
    if (error !== null) {
      console.error(error)
      return
    }

    events.forEach((event) => {
      invalidate(event.path)
    })

    try {
      const now = performance.now()

      const output = await build(store, config)

      if (config.flags.controlled) {
        console.info('---rebuild-complete---')
      }

      const after = performance.now()

      console.info(`Rebuilt docs in ${after - now} milliseconds`)

      if (output !== '') {
        console.info(output)
      }
    } catch (error) {
      console.error(error)

      return
    }
  })
}

type BuildConfigOptions = {
  basePath: string
  validSdks: readonly SDK[]
  docsPath: string
  manifestPath: string
  partialsPath: string
  distPath: string
  typedocPath: string
  ignorePaths: string[]
  ignoreWarnings?: Record<string, string[]>
  manifestOptions: {
    wrapDefault: boolean
    collapseDefault: boolean
    hideTitleDefault: boolean
  }
  cleanDist: boolean
  flags?: {
    watch?: boolean
    controlled?: boolean
  }
}

type BuildConfig = ReturnType<typeof createConfig>

// Takes the basePath and resolves the relative paths to be absolute paths
export function createConfig(config: BuildConfigOptions) {
  const resolve = (relativePath: string) => {
    return path.isAbsolute(relativePath) ? relativePath : path.join(config.basePath, relativePath)
  }

  return {
    basePath: config.basePath,
    validSdks: config.validSdks,

    manifestRelativePath: config.manifestPath,
    manifestFilePath: resolve(config.manifestPath),

    partialsRelativePath: config.partialsPath,
    partialsPath: resolve(config.partialsPath),

    docsRelativePath: config.docsPath,
    docsPath: resolve(config.docsPath),

    distRelativePath: config.distPath,
    distPath: resolve(config.distPath),

    typedocRelativePath: config.typedocPath,
    typedocPath: resolve(config.typedocPath),

    ignorePaths: config.ignorePaths,
    ignoreWarnings: config.ignoreWarnings || {},
    manifestOptions: config.manifestOptions ?? {
      wrapDefault: true,
      collapseDefault: false,
      hideTitleDefault: false,
    },
    cleanDist: config.cleanDist,
    flags: {
      watch: config.flags?.watch ?? false,
      controlled: config.flags?.controlled ?? false,
    },
  }
}

const main = async () => {
  const args = process.argv.slice(2)

  const config = createConfig({
    basePath: __dirname,
    docsPath: '../docs',
    manifestPath: '../docs/manifest.json',
    partialsPath: '../docs/_partials',
    distPath: '../dist',
    typedocPath: '../clerk-typedoc',
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
    ignoreWarnings: {
      '/docs/index.mdx': ['doc-not-in-manifest'],
      '/docs/guides/overview.mdx': ['doc-not-in-manifest'],
      '/docs/quickstarts/overview.mdx': ['doc-not-in-manifest'],
      '/docs/references/overview.mdx': ['doc-not-in-manifest'],
      '/docs/maintenance-mode.mdx': ['doc-not-in-manifest'],
      '/docs/deployments/staging-alternatives.mdx': ['doc-not-in-manifest'],
      '/docs/references/nextjs/usage-with-older-versions.mdx': ['doc-not-in-manifest'],

      // Typedoc warnings
      '../clerk-typedoc/types/active-session-resource.mdx': ['link-hash-not-found'],
      '../clerk-typedoc/types/pending-session-resource.mdx': ['link-hash-not-found'],
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

    watchAndRebuild(store, { ...config, cleanDist: true })
  } else if (output !== '') {
    process.exit(1)
  }
}

// Only invokes the main function if we run the script directly eg npm run build, bun run ./scripts/build-docs.ts
if (require.main === module) {
  main()
}
