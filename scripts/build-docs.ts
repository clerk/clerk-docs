// Things this build script does

// - [x] Validates the manifest
// - [x] Validates the markdown files contents (including frontmatter)
// - [x] Validates links (including hashes) between docs are valid
// - [x] Validates the sdk filtering in the manifest
// - [x] Validates the sdk filtering in the frontmatter
// - [x] Validates the sdk filtering in the <If /> component

// - [x] Embeds the includes in the markdown files
// - [x] Updates the links in the content if they point to the sdk specific docs
// - [x] Copies over "core" docs to the dist folder
// - [x] Generates "landing" pages for the sdk specific docs at the original url
// - [x] Generates a manifest that is specific to each SDK
// - [x] Duplicates out the sdk specific docs to their respective folders
//   - [x] stripping filtered out content

import fs from 'node:fs/promises'
import path from 'node:path'
import remarkMdx from 'remark-mdx'
import { remark } from 'remark'
import { visit as mdastVisit } from 'unist-util-visit'
import { filter as mdastFilter } from 'unist-util-filter'
import { map as mdastMap } from 'unist-util-map'
import { u as mdastBuilder } from 'unist-builder'
import remarkFrontmatter from 'remark-frontmatter'
import yaml from "yaml"
import { slugifyWithCounter } from '@sindresorhus/slugify'
import { toString } from 'mdast-util-to-string'
import reporter from 'vfile-reporter'
import readdirp from 'readdirp'
import { z } from "zod"
import { fromError } from 'zod-validation-error';
import { Node } from 'unist'

const BASE_PATH = process.cwd()
const DOCS_FOLDER_RELATIVE = './docs'
const DOCS_FOLDER = path.join(BASE_PATH, DOCS_FOLDER_RELATIVE)
const MANIFEST_FILE_PATH = path.join(DOCS_FOLDER, './manifest.json')
const PARTIALS_PATH = './_partials'
const DIST_PATH = path.join(BASE_PATH, './dist')
// const CLERK_PATH = path.join(BASE_PATH, "../clerk")
const IGNORE = [
  "/docs/core-1",
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
  "/docs/_partials"
]

const VALID_SDKS = [
  "nextjs",
  "react",
  "javascript-frontend",
  "chrome-extension",
  "expo",
  "ios",
  "nodejs",
  "expressjs",
  "fastify",
  "react-router",
  "remix",
  "tanstack-start",
  "go",
  "astro",
  "nuxt",
  "vue",
  "ruby",
  "python",
  "javascript-backend",
  "sdk-development",
  "community-sdk"
] as const

type SDK = typeof VALID_SDKS[number]

const sdk = z.enum(VALID_SDKS)

const icon = z.enum(["apple", "application-2", "arrow-up-circle", "astro", "angular", "block", "bolt", "book", "box", "c-sharp", "chart", "checkmark-circle", "chrome", "clerk", "code-bracket", "cog-6-teeth", "door", "elysia", "expressjs", "globe", "go", "home", "hono", "javascript", "koa", "link", "linkedin", "lock", "nextjs", "nodejs", "plug", "plus-circle", "python", "react", "redwood", "remix", "react-router", "rocket", "route", "ruby", "rust", "speedometer", "stacked-rectangle", "solid", "svelte", "tanstack", "user-circle", "user-dotted-circle", "vue", "x", "expo", "nuxt", "fastify"])

type Icon = z.infer<typeof icon>

const tag = z.enum(["(Beta)", "(Community)"])

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

const manifestItem: z.ZodType<ManifestItem> = z.object({
  title: z.string(),
  href: z.string(),
  tag: tag.optional(),
  wrap: z.boolean().default(true),
  icon: icon.optional(),
  target: z.enum(["_blank"]).optional(),
  sdk: z.array(sdk).optional()
}).strict()

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

const manifestGroup: z.ZodType<ManifestGroup> = z.object({
  title: z.string(),
  items: z.lazy(() => manifestSchema),
  collapse: z.boolean().default(false),
  tag: tag.optional(),
  wrap: z.boolean().default(true),
  icon: icon.optional(),
  hideTitle: z.boolean().default(false),
  sdk: z.array(sdk).optional()
}).strict()

type Manifest = (ManifestItem | ManifestGroup)[][]

const manifestSchema: z.ZodType<Manifest> = z.array(
  z.array(
    z.union([
      manifestItem,
      manifestGroup
    ])
  )
)

const pleaseReport = "(this is a bug with the build script, please report)"

const isValidSdk = (sdk: string): sdk is SDK => {
  return VALID_SDKS.includes(sdk as SDK)
}

const isValidSdks = (sdks: string[]): sdks is SDK[] => {
  return sdks.every(isValidSdk)
}

const readManifest = async (): Promise<Manifest> => {
  const unsafe_manifest = await fs.readFile(MANIFEST_FILE_PATH, { "encoding": "utf-8" })

  const manifest = await manifestSchema.safeParseAsync(JSON.parse(unsafe_manifest).navigation)

  if (manifest.success === true) {
    return manifest.data
  }

  throw new Error(`Failed to parse manifest: ${fromError(manifest.error)}`)
}

const readMarkdownFile = async (docPath: string) => {
  const filePath = path.join(BASE_PATH, docPath)

  try {
    const fileContent = await fs.readFile(filePath, { "encoding": "utf-8" })
    return [null, fileContent] as const
  } catch (error) {
    return [new Error(`file ${filePath} doesn't exist`, { cause: error }), null] as const
  }
}

const readDocsFolder = () => {
  return readdirp.promise(DOCS_FOLDER, {
    type: 'files',
    fileFilter: (entry) => IGNORE.some((ignoreItem) => `/docs/${entry.path}`.startsWith(ignoreItem)) === false && entry.path.endsWith('.mdx')
  })
}

const readPartialsFolder = () => {
  return readdirp.promise(path.join(DOCS_FOLDER, './_partials'), {
    type: 'files',
    fileFilter: '*.mdx',
  })
}

const readPartialsMarkdown = (paths: string[]) => {
  return Promise.all(paths.map(async (markdownPath) => {
    const fullPath = path.join(DOCS_FOLDER_RELATIVE, PARTIALS_PATH, markdownPath)

    const [error, content] = await readMarkdownFile(fullPath)

    if (error) {
      throw new Error(`Failed to read in ${fullPath} from partials file`, { cause: error })
    }

    return {
      path: markdownPath,
      content,
    }
  }))
}

const markdownProcessor = remark()
  .use(remarkFrontmatter)
  .use(remarkMdx)
  .freeze()

type VFile = Awaited<ReturnType<typeof markdownProcessor.process>>

const ensureDirectory = async (path: string): Promise<void> => {
  try {
    await fs.access(path)
  } catch {
    await fs.mkdir(path, { recursive: true })
  }
}

const writeDistFile = async (filePath: string, contents: string) => {
  const fullPath = path.join(DIST_PATH, filePath)
  await ensureDirectory(path.dirname(fullPath))
  await fs.writeFile(fullPath, contents, { "encoding": "utf-8" })
}

const writeSDKFile = async (sdk: SDK, filePath: string, contents: string) => {
  await writeDistFile(path.join(sdk, filePath), contents)
}

const removeMdxSuffix = (filePath: string) => {
  if (filePath.endsWith('.mdx')) {
    return filePath.slice(0, -4)
  }
  return filePath
}

type BlankTree<Item extends object, Group extends { items: BlankTree<Item, Group> }> = Array<Array<Item | Group>>;

const traverseTree = async <
  Tree extends BlankTree<any, any>,
  InItem extends Extract<Tree[number][number], { href: string }>,
  InGroup extends Extract<Tree[number][number], { items: BlankTree<InItem, InGroup> }>,
  OutItem extends { href: string },
  OutGroup extends { items: BlankTree<OutItem, OutGroup> },
  OutTree extends BlankTree<OutItem, OutGroup>
>(
  tree: Tree,
  itemCallback: (item: InItem) => Promise<OutItem | null> = async (item) => item,
  groupCallback: (group: InGroup) => Promise<OutGroup | null> = async (group) => group,
  errorCallback?: (item: InItem | InGroup, error: Error) => void | Promise<void>,
): Promise<OutTree> => {
  const result = await Promise.all(tree.map(async (group) => {
    return await Promise.all(group.map(async (item) => {
      try {
        if ('href' in item) {
          return await itemCallback(item);
        }

        if ('items' in item && Array.isArray(item.items)) {
          return await groupCallback({
            ...item,
            items: (await traverseTree(item.items, itemCallback, groupCallback, errorCallback)).map(group => group.filter((item): item is NonNullable<typeof item> => item !== null))
          });
        }

        return item as OutItem;
      } catch (error) {
        if (error instanceof Error && errorCallback !== undefined) {
          errorCallback(item, error);
        } else {
          throw error
        }
      }
    }));
  }));

  return result.map(group => group.filter((item): item is NonNullable<typeof item> => item !== null)) as unknown as OutTree;
};

const scopeHrefToSDK = (href: string, targetSDK: SDK) => {

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
  if (node.type !== "mdxJsxFlowElement") {
    return undefined;
  }

  // Check if it's the correct component
  if (!("name" in node)) return undefined;
  if (node.name !== componentName) return undefined;

  // Check for attributes
  if (!("attributes" in node)) {
    vfile?.message(
      `<${componentName} /> component has no props`,
      node.position
    );
    return undefined;
  }

  if (!Array.isArray(node.attributes)) {
    vfile?.message(
      `<${componentName} /> node attributes is not an array ${pleaseReport}`,
      node.position
    );
    return undefined;
  }

  // Find the requested prop
  const propAttribute = node.attributes.find(
    (attribute) => attribute.name === propName
  );

  if (propAttribute === undefined) {
    vfile?.message(
      `<${componentName} /> component has no "${propName}" attribute`,
      node.position
    );
    return undefined;
  }

  const value = propAttribute.value;

  if (value === undefined) {
    vfile?.message(
      `<${componentName} /> attribute "${propName}" has no value ${pleaseReport}`,
      node.position
    );
    return undefined;
  }

  // Handle both string values and object values (like JSX expressions)
  if (typeof value === "string") {
    return value;
  } else if (typeof value === "object" && "value" in value) {
    return value.value;
  }

  vfile?.message(
    `<${componentName} /> attribute "${propName}" has an unsupported value type`,
    node.position
  );
  return undefined;
}

const extractSDKsFromIfProp = (node: Node, vfile: VFile | undefined, sdkProp: string) => {
  if (sdkProp.includes('", "') || sdkProp.includes("', '")) {
    const sdks = JSON.parse(sdkProp.replaceAll("'", '"'))
    if (isValidSdks(sdks)) {
      return sdks
    } else {
      const invalidSDKs = sdks.filter(sdk => !isValidSdk(sdk))
      vfile?.message(`sdks "${invalidSDKs.join('", "')}" in <If /> are not valid SDKs`, node.position)
    }
  } else {
    if (isValidSdk(sdkProp)) {
      return [sdkProp]
    } else {
      vfile?.message(`sdk "${sdkProp}" in <If /> is not a valid SDK`, node.position)
    }
  }

}

const parseInMarkdownFile = async (href: string, partials: {
  path: string;
  content: string;
}[], inManifest: boolean) => {
  const [error, fileContent] = await readMarkdownFile(`${href}.mdx`)

  if (error !== null) {
    throw new Error(`Attempting to read in ${href}.mdx failed, with error message: ${error.message}`, { cause: error })
  }

  type Frontmatter = {
    title: string;
    description?: string;
    sdk?: SDK[]
  }

  let frontmatter: Frontmatter | undefined = undefined

  const slugify = slugifyWithCounter()
  const headingsHashs: Array<string> = []

  const vfile = await markdownProcessor()
    .use(() => (tree, vfile) => {
      if (inManifest === false) {
        vfile.message("This guide is not in the manifest.json, but will still be publicly accessible and other guides can link to it")
      }
    })
    .use(() => (tree, vfile) => {
      mdastVisit(tree,
        node => node.type === 'yaml' && "value" in node,
        node => {
          if (!("value" in node)) return;
          if (typeof node.value !== "string") return;

          const frontmatterYaml: Record<"title" | "description" | "sdk", string | undefined> = yaml.parse(node.value)

          const frontmatterSDKs = frontmatterYaml.sdk?.split(', ')

          if (frontmatterSDKs !== undefined && isValidSdks(frontmatterSDKs) === false) {
            const invalidSDKs = frontmatterSDKs.filter(sdk => isValidSdk(sdk) === false)
            vfile.fail(`Invalid SDK ${JSON.stringify(invalidSDKs)}, the valid SDKs are ${JSON.stringify(VALID_SDKS)}`, node.position)
            return;
          }

          if (frontmatterYaml.title === undefined) {
            vfile.fail(`Frontmatter must have a "title" property`, node.position)
            return;
          }

          frontmatter = {
            title: frontmatterYaml.title,
            description: frontmatterYaml.description,
            sdk: frontmatterSDKs
          }
        }
      )

      if (frontmatter === undefined) {
        vfile.fail(`Frontmatter parsing failed for ${href}`)
        return;
      }

    })
    // Validate and embed the <Include />
    .use(() => (tree, vfile) => {
      return mdastMap(tree,
        node => {

          const partialSrc = extractComponentPropValueFromNode(node, vfile, "Include", "src")

          if (partialSrc === undefined) {
            return node
          }

          if (partialSrc.startsWith('_partials/') === false) {
            vfile.message(`<Include /> prop "src" must start with "_partials/"`, node.position)
            return node
          }

          const partial = partials.find((partial) => `_partials/${partial.path}` === `${removeMdxSuffix(partialSrc)}.mdx`)

          if (partial === undefined) {
            vfile.message(`Partial /docs/${removeMdxSuffix(partialSrc)}.mdx not found`, node.position)
            return node
          }

          let partialNode: Node | null = null

          const partialContentVFile = markdownProcessor()
            .use(() => (tree, vfile) => {
              mdastVisit(tree,
                node => node.type === "mdxJsxFlowElement" && "name" in node && node.name === "Include",
                () => {
                  vfile.fail(`Partials inside of partials is not yet supported, ${pleaseReport}`, node.position)
                }
              )

              partialNode = tree
            })
            .processSync({
              path: partial.path,
              value: partial.content
            })

          const partialContentReport = reporter([partialContentVFile], { quiet: true })

          if (partialContentReport !== "") {
            console.error(partialContentReport)
          }

          if (partialNode === null) {
            vfile.fail(`Failed to parse the content of ${partial.path}`, node.position)
            return node
          }

          return Object.assign(node, partialNode)

        }
      )
    })
    // extract out the headings to check hashes in links
    .use(() => (tree) => {
      mdastVisit(tree,
        node => node.type === "heading",
        node => {
          const slug = slugify(toString(node).trim())
          headingsHashs.push(slug)
        }
      )
    })
    // Validate the <If /> components
    .use(() => (tree, vfile) => {

      mdastVisit(tree,
        (node) => {
          const sdk = extractComponentPropValueFromNode(node, vfile, "If", "sdk")

          if (sdk === undefined) return;

          const sdksFilter = extractSDKsFromIfProp(node, vfile, sdk)

          if (sdksFilter === undefined) return
          if (frontmatter?.sdk === undefined) return;

          sdksFilter.forEach(sdk => {
            if (frontmatter?.sdk === undefined) return;

            const available = frontmatter.sdk.includes(sdk)

            if (available === false) {
              vfile.fail(`<If /> component is attempting to filter to sdk "${sdk}" but it is not available in the guides frontmatter ["${frontmatter.sdk.join('", "')}"], if this is a mistake please remove it from the <If /> otherwise update the frontmatter to include "${sdk}"`, node.position)
            }

          })
        }
      )
    })
    .process({
      path: `${href}.mdx`,
      value: fileContent
    })

  if (frontmatter === undefined) {
    throw new Error(`Frontmatter parsing failed for ${href}`)
  }

  return {
    href,
    sdk: (frontmatter as Frontmatter).sdk,
    vfile,
    headingsHashs,
    frontmatter: frontmatter as Frontmatter
  }
}

const main = async () => {
  await ensureDirectory(DIST_PATH)

  const userManifest = await readManifest()
  console.info('✔️ Read Manifest')

  const docsFiles = await readDocsFolder()
  console.info('✔️ Read Docs Folder')

  const partials = await readPartialsMarkdown((await readPartialsFolder()).map(item => item.path))
  console.info('✔️ Read Partials')

  const guides = new Map<string, Awaited<ReturnType<typeof parseInMarkdownFile>>>()
  const guidesInManifest = new Set<string>()

  // Grab all the docs links in the manifest
  await traverseTree(userManifest,
    async (item) => {
      if (!item.href?.startsWith('/docs/')) return item
      if (item.target !== undefined) return item

      const ignore = IGNORE.some((ignoreItem) => item.href.startsWith(ignoreItem))
      if (ignore === true) return item

      guidesInManifest.add(item.href)

      return item
    }
  )
  console.info('✔️ Parsed in Manifest')

  // Read in all the guides
  const docs = (await Promise.all(docsFiles.map(async (file) => {
    const href = removeMdxSuffix(`/docs/${file.path}`)

    const alreadyLoaded = guides.get(href)

    if (alreadyLoaded) return null // already processed

    const inManifest = guidesInManifest.has(href)

    // we aren't awaiting here so we can move on while IO processes
    const markdownFile = await parseInMarkdownFile(href, partials, inManifest)

    guides.set(href, markdownFile)

    return markdownFile
  }))).filter((item): item is NonNullable<typeof item> => item !== null)
  console.info('✔️ Loaded in guides')

  // Goes through and grabs the sdk scoping out of the manifest
  const sdkScopedManifest = await traverseTree(userManifest,
    async (item) => {

      if (!item.href?.startsWith('/docs/')) return item
      if (item.target !== undefined) return item

      const ignore = IGNORE.some((ignoreItem) => item.href.startsWith(ignoreItem))
      if (ignore === true) return item // even thou we are not processing them, we still need to keep them

      const guide = guides.get(item.href)

      if (guide === undefined) {
        throw new Error(`Guide "${item.title}" in manifest.json not found in the docs folder at ${item.href}.mdx`)
      }

      return {
        ...item,
        sdk: guide.sdk
      }
    },
    async (group) => {
      const itemsSDKs = Array.from(new Set(group.items?.flatMap((item) => item.flatMap((item) => item.sdk)))).filter((sdk): sdk is SDK => sdk !== undefined)

      const { items, ...details } = group

      if (itemsSDKs.length === 0) return { ...details, items }

      return {
        ...details,
        sdk: Array.from(new Set([...details.sdk ?? [], ...itemsSDKs])) ?? [],
        items
      }
    },
    (item, error) => {
      console.error('↳', item.title)
      throw error
    }
  )
  console.info('✔️ Applied manifest sdk scoping')

  // It would definitely be preferable we didn't need to do this markdown processing twice
  // But because we need a full list / hashmap of all the existing docs, we can't
  // Unless maybe we do some kind of lazy loading of the docs, but this would add complexity
  const coreVFiles = docs.map(async (doc) => {
    const vfile = await markdownProcessor()
      // Validate links between guides are valid
      .use(() => (tree: Node, vfile: VFile) => {
        return mdastMap(tree,
          node => {

            if (node.type !== "link") return node
            if (!("url" in node)) return node
            if (typeof node.url !== "string") return node
            if (!node.url.startsWith("/docs/")) return node
            if (!("children" in node)) return node

            node.url = removeMdxSuffix(node.url)

            const [url, hash] = (node.url as string).split("#")

            const ignore = IGNORE.some((ignoreItem) => url.startsWith(ignoreItem))
            if (ignore === true) return node;

            const guide = guides.get(url)

            if (guide === undefined) {
              vfile.message(`Guide ${url} not found`, node.position)
              return node;
            }

            if (hash !== undefined) {
              const hasHash = guide.headingsHashs.includes(hash)

              if (hasHash === false) {
                vfile.message(`Hash "${hash}" not found in ${url}`, node.position)
              }
            }

            if (guide.sdk !== undefined) {
              // we are going to swap it for the sdk link component to give the users a great experience

              return mdastBuilder('mdxJsxFlowElement', {
                name: 'SDKLink',
                attributes: [
                  mdastBuilder('mdxJsxAttribute', {
                    name: 'href',
                    value: url
                  }),
                  mdastBuilder('mdxJsxAttribute', {
                    name: 'sdks',
                    // value: `['${guide.sdk.join("', '")}']`
                    value: mdastBuilder('mdxJsxAttributeValueExpression', {
                      // value: `["${guide.sdk.join('", "')}"]`
                      value: JSON.stringify(guide.sdk)
                    })
                  })
                ]
              })
            }

            return node;
          }
        )
      })
      .process(doc.vfile)

    const distFilePath = `${doc.href.replace("/docs/", "")}.mdx`

    if (isValidSdk(distFilePath.split('/')[0])) {
      throw new Error(`Attempting to write out a core doc to ${distFilePath} but the first part of the path is a valid SDK, this causes a file path conflict.`)
    }

    if (doc.sdk !== undefined) {
      // This is a sdk specific guide, so we want to put a landing page here to redirect the user to a guide customised to their sdk.

      await writeDistFile(
        distFilePath,
        // It's possible we will want to / need to put some frontmatter here
        `<SDKDocRedirectPage title="${doc.frontmatter.title}" url="${doc.href}" sdk={${JSON.stringify(doc.sdk)}} />`
      )

      return vfile
    }

    await writeDistFile(distFilePath, String(vfile))

    return vfile
  })

  Promise.all(coreVFiles).then(() => console.info('✔️ Wrote out core docs'))

  const sdkSpecificVFiles = Promise.all(VALID_SDKS.map(async (targetSdk) => {

    // Goes through and removes any items that are not scoped to the target sdk
    const navigation = await traverseTree(sdkScopedManifest,
      async ({ sdk, ...item }) => {

        // This means its generic, not scoped to a specific sdk, so we keep it
        if (sdk === undefined) return {
          title: item.title,
          href: item.href,
          tag: item.tag,
          wrap: item.wrap,
          icon: item.icon,
          target: item.target
        } as const

        // This item is not scoped to the target sdk, so we remove it
        if (sdk.includes(targetSdk) === false) return null

        // This is a scoped item and its scoped to our target sdk
        return {
          title: item.title,
          href: scopeHrefToSDK(item.href, targetSdk),
          tag: item.tag,
          wrap: item.wrap,
          icon: item.icon,
          target: item.target
        } as const
      },
      // @ts-expect-error - This traverseTree function might just be the death of me
      async ({ sdk, ...group }) => {

        if (sdk === undefined) return group

        if (sdk.includes(targetSdk) === false) return null

        return group
      }
    )

    const vFiles = await Promise.all(docs.map(async (doc) => {
      if (doc.sdk === undefined) return null; // skip core docs
      if (doc.sdk.includes(targetSdk) === false) return null; // skip docs that are not for the target sdk

      const vfile = await markdownProcessor()
        // filter out content that is only available to other sdk's
        .use(() => (tree, vfile) => {
          return mdastFilter(tree,
            node => {

              // We aren't passing the vfile here as the as the warning
              // should have already been reported above when we initially
              // parsed the file

              const sdk = extractComponentPropValueFromNode(node, undefined, "If", "sdk")

              if (sdk === undefined) return true

              const sdksFilter = extractSDKsFromIfProp(node, undefined, sdk)

              if (sdksFilter === undefined) return true

              if (sdksFilter.includes(targetSdk)) {
                return true
              }

              return false

            }
          )
        })
        // scope urls so they point to the current sdk
        .use(() => (tree, vfile) => {
          return mdastMap(tree,
            node => {
              if (node.type !== "link") return node
              if (!("url" in node)) {
                vfile.fail(`Link node does not have a url property ${pleaseReport}`, node.position)
                return node
              }
              if (typeof node.url !== "string") {
                vfile.fail(`Link node url must be a string ${pleaseReport}`, node.position)
                return node
              }
              if (!node.url.startsWith("/docs/")) {
                return node
              }

              const guide = guides.get(node.url)

              if (guide === undefined) { }

              return node
            }
          )
        })
        .process({
          ...doc.vfile, messages: [] // reset the messages, otherwise they will be duplicated
        })

      await writeSDKFile(targetSdk, `${doc.href.replace("/docs/", "")}.mdx`, String(vfile))

      return vfile
    }))

    await writeSDKFile(targetSdk, 'manifest.json', JSON.stringify({ navigation }))

    return vFiles
  }))

  const [awaitedCoreVFiles, awaitedSdkSpecificVFiles] = await Promise.all([Promise.all(coreVFiles), sdkSpecificVFiles])

  const flatSdkSpecificVFiles = awaitedSdkSpecificVFiles.flat()

  const output = reporter([
    ...awaitedCoreVFiles.filter((item): item is NonNullable<typeof item> => item !== null),
    ...flatSdkSpecificVFiles.filter((item): item is NonNullable<typeof item> => item !== null)
  ],
    { quiet: true })

  if (output !== "") {
    console.info(output)
  }

}

main()