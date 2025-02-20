// Things this build script does
// - [x] Validates the Manifest
// - [x] Copies all "core" docs to the dist folder
//  - [x] Compile partials in to docs
// - [x] Duplicates out the sdk specific docs to their respective folders
//  - [x] stripping filtered out content
// - [x] Checks that links (including hashes) between docs are valid
// - [x] Generates a manifest that is specific to each SDK
// - [x] Checks sdk key in frontmatter to ensure its valid
// - [x] Pares the markdown files, ensures they are valid
// - [ ] Updates the links in the content to point to the sdk specific docs
// - [x] Checks that filters used in <If /> are available sdks defined by the frontmatter sdk (if the frontmatter sdk is set)

import fs from 'node:fs/promises'
import path from 'node:path'
import remarkMdx from 'remark-mdx'
import { remark } from 'remark'
import { visit as mdastVisit } from 'unist-util-visit'
import { filter as mdastFilter } from 'unist-util-filter'
import { map as mdastMap } from 'unist-util-map'
import remarkFrontmatter from 'remark-frontmatter'
import yaml from "yaml"
import { slugifyWithCounter } from '@sindresorhus/slugify'
import { toString } from 'mdast-util-to-string'
import reporter from 'vfile-reporter'
import readdirp from 'readdirp'
import { z } from "zod"
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

const isValidSdk = (sdk: string): sdk is SDK => {
  return VALID_SDKS.includes(sdk as SDK)
}

const isValidSdks = (sdks: string[]): sdks is SDK[] => {
  return sdks.every(isValidSdk)
}

const readManifest = async (): Promise<Manifest> => {
  const manifest = await fs.readFile(MANIFEST_FILE_PATH, { "encoding": "utf-8" })
  return await manifestSchema.parseAsync(JSON.parse(manifest).navigation)
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

const parseFrontmatter = async <Keys extends string>(fileContent: string): Promise<Record<Keys, string | undefined> | undefined> => {
  let frontmatter: Record<Keys, string | undefined> | undefined = undefined

  await markdownProcessor()
    .use(() => (tree, vfile) => {
      mdastVisit(tree,
        node => node.type === 'yaml' && "value" in node,
        node => {
          if (!("value" in node)) return;
          if (typeof node.value !== "string") return;

          frontmatter = yaml.parse(node.value)
        }
      )
    })
    .process(fileContent)

  return frontmatter
}

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
  groupCallback: (group: InGroup) => Promise<OutGroup | null> = async (group) => group
): Promise<OutTree> => {
  const result = await Promise.all(tree.map(async (group) => {
    return await Promise.all(group.map(async (item) => {
      if ('href' in item) {
        return await itemCallback(item);
      }

      if ('items' in item && Array.isArray(item.items)) {
        return await groupCallback({
          ...item,
          items: (await traverseTree(item.items, itemCallback, groupCallback)).map(group => group.filter((item): item is NonNullable<typeof item> => item !== null))
        });
      }

      return item as OutItem;
    }));
  }));

  return result.map(group => group.filter((item): item is NonNullable<typeof item> => item !== null)) as unknown as OutTree;
};

function flattenTree<
  Tree extends BlankTree<any, any>,
  InItem extends Extract<Tree[number][number], { href: string }>,
  InGroup extends Extract<Tree[number][number], { items: BlankTree<InItem, InGroup> }>
>(tree: Tree): InItem[] {
  const result: InItem[] = [];

  for (const group of tree) {
    for (const itemOrGroup of group) {
      if ("href" in itemOrGroup) {
        // It's an item
        result.push(itemOrGroup);
      } else if ("items" in itemOrGroup && Array.isArray(itemOrGroup.items)) {
        // It's a group with its own sub-tree, flatten it
        result.push(...flattenTree(itemOrGroup.items));
      }
    }
  }

  return result;
}

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
  vfile: VFile,
  componentName: string,
  propName: string
): string | undefined => {
  // Check if it's an MDX component
  if (node.type !== "mdxJsxFlowElement") {
    return undefined;
  }

  // Check if it's the correct component
  if (!("name" in node) || node.name !== componentName) {
    return undefined;
  }

  // Validate node position for error reporting
  if (node.position === undefined) {
    vfile.message(
      `<${componentName} /> node has no position (this is a bug with the build script, please report)`,
      node.position
    );
    return undefined;
  }

  if (
    node.position.start.offset === undefined ||
    node.position.end.offset === undefined
  ) {
    vfile.message(
      `<${componentName} /> node has no position offsets (this is a bug with the build script, please report)`,
      node.position
    );
    return undefined;
  }

  // Check for attributes
  if (!("attributes" in node)) {
    vfile.message(
      `<${componentName} /> component has no props`,
      node.position
    );
    return undefined;
  }

  if (!Array.isArray(node.attributes)) {
    vfile.message(
      `<${componentName} /> node attributes is not an array (this is a bug with the build script, please report)`,
      node.position
    );
    return undefined;
  }

  // Find the requested prop
  const propAttribute = node.attributes.find(
    (attribute) => attribute.name === propName
  );

  if (propAttribute === undefined) {
    vfile.message(
      `<${componentName} /> component has no "${propName}" attribute`,
      node.position
    );
    return undefined;
  }

  const value = propAttribute.value;

  if (value === undefined) {
    vfile.message(
      `<${componentName} /> attribute "${propName}" has no value (this is a bug with the build script, please report)`,
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

  vfile.message(
    `<${componentName} /> attribute "${propName}" has an unsupported value type`,
    node.position
  );
  return undefined;
}

const extractSDKsFromIfProp = (node: Node, vfile: VFile, sdkProp: string) => {
  if (sdkProp.includes(', ')) {
    const sdks = sdkProp.split(', ')
    if (isValidSdks(sdks)) {
      return sdks
    } else {
      const invalidSDKs = sdks.filter(sdk => !isValidSdk(sdk))
      vfile.message(`sdks "${invalidSDKs.join('", "')}" in <If /> are not valid SDKs`, node.position)
    }
  } else {
    if (isValidSdk(sdkProp)) {
      return [sdkProp]
    } else {
      vfile.message(`sdk "${sdkProp}" in <If /> is not a valid SDK`, node.position)
    }
  }

}

const parseInMarkdownFile = async (item: ManifestItem, partials: {
  path: string;
  content: string;
}[]) => {

  const [error, fileContent] = await readMarkdownFile(`${item.href}.mdx`)

  if (error !== null) {
    throw new Error(`Attempting to read in "${item.title}" from ${item.href}.mdx failed, with error message: ${error.message}`, { cause: error })
  }

  const frontmatter = await parseFrontmatter<"name" | "description" | "sdk">(fileContent)

  if (frontmatter === undefined) {
    throw new Error(`Frontmatter parsing failed for ${item.href}`)
  }

  const frontmatterSDKs = frontmatter.sdk?.split(', ')

  if (frontmatterSDKs !== undefined && isValidSdks(frontmatterSDKs) === false) {
    const invalidSDKs = frontmatterSDKs.filter(sdk => isValidSdk(sdk) === false)
    throw new Error(`Invalid SDK ${JSON.stringify(invalidSDKs)} found in: ${item.href}`)
  }

  const slugify = slugifyWithCounter()
  const headingsHashs: Array<string> = []

  const fileWarnings = await markdownProcessor()
    .use(() => (tree) => {
      mdastVisit(tree,
        node => node.type === "heading",
        node => {
          const slug = slugify(toString(node).trim())
          headingsHashs.push(slug)
        }
      )
    })
    .use(() => (tree, vfile) => {
      return mdastMap(tree,
        node => {

          const partialSrc = extractComponentPropValueFromNode(tree, vfile, "Include", "src")

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
                  vfile.fail("Partials inside of partials is not yet supported, please report if you are seeing this error", node.position)
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

          return partialNode

        }
      )
    })
    .use(() => (tree, vfile) => {

      // We are only checking files that have opted in to sdk filtering by frontmatter
      if (frontmatterSDKs === undefined) return;

      mdastVisit(tree,
        node => {
          const sdk = extractComponentPropValueFromNode(node, vfile, "If", "sdk")

          if (sdk === undefined) return;

          const sdksFilter = extractSDKsFromIfProp(node, vfile, sdk)

          if (sdksFilter === undefined) return

          sdksFilter.forEach(sdk => {
            const available = frontmatterSDKs.includes(sdk)

            if (available === false) {
              vfile.fail(`<If /> component is attempting to filter to sdk "${sdk}" but it is not available in the guides frontmatter ["${frontmatterSDKs.join('", "')}"], if this is a mistake please remove it from the <If /> otherwise update the frontmatter to include "${sdk}"`, node.position)
            }

          })
        }
      )
    })
    .process({
      path: `${item.href}.mdx`,
      value: fileContent
    })

  return {
    file: {
      ...item,
      sdk: frontmatterSDKs,
      fileContent: String(fileWarnings),
      headingsHashs,
      frontmatter
    },
    fileWarnings
  }
}

const main = async () => {
  await ensureDirectory(DIST_PATH)

  const manifest = await readManifest()
  const docsFiles = await readDocsFolder()
  const partials = await readPartialsMarkdown((await readPartialsFolder()).map(item => item.path))

  const guides = new Map<string, ManifestItem & { fileContent: string, headingsHashs: Array<string>, inManifest: boolean }>()
  const markdownFileWarnings: VFile[] = []

  // This first pass goes through and grabs the sdk scoping out of the markdown files frontmatter
  const fullManifest = await traverseTree(manifest,
    async (item) => {

      if (!item.href?.startsWith('/docs/')) return item
      if (item.target !== undefined) return item

      const ignore = IGNORE.some((ignoreItem) => item.href.startsWith(ignoreItem))
      if (ignore === true) return item // even thou we are not processing them, we still need to keep them

      const { file: markdownFile, fileWarnings } = await parseInMarkdownFile(item, partials)

      guides.set(item.href, {
        ...markdownFile,
        inManifest: true
      })

      markdownFileWarnings.push(fileWarnings)

      return { ...markdownFile } as const

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
    }
  )

  await Promise.all(docsFiles.map(async (file) => {
    const href = removeMdxSuffix(`/docs/${file.path}`)
    if (guides.has(href) === false) {
      console.log(`Guide /docs/${file.path} not found in manifest`)

      const { file: markdownFile, fileWarnings } = await parseInMarkdownFile({
        title: "Unknown Title (Not referenced in manifest)",
        href
      }, partials)

      guides.set(href, {
        ...markdownFile,
        inManifest: false
      })

      markdownFileWarnings.push(fileWarnings)

      if (markdownFile.sdk === undefined) {
        await writeDistFile(`${markdownFile.href.replace("/docs/", "")}.mdx`, markdownFile.fileContent)
      }
    }
  }))

  const flatManifest = flattenTree(fullManifest)

  const vfiles = (await Promise.all(flatManifest.map(async (item) => {
    if ("fileContent" in item) {

      const vfile = await markdownProcessor()
        .use(() => (tree, vfile) => {
          mdastVisit(tree,
            node => node.type === "link" && "url" in node && typeof node.url === "string" && node.url.startsWith("/docs/"),
            node => {
              if ("url" in node && typeof node.url === "string") {
                const [url, hash] = node.url.split("#")

                const ignore = IGNORE.some((ignoreItem) => url.startsWith(ignoreItem))
                if (ignore === true) return;

                const guide = guides.get(url)

                if (guide === undefined) {
                  vfile.message(`Guide ${url} not found`, node.position)
                  return;
                }

                if (hash !== undefined) {
                  const hasHash = guide.headingsHashs.includes(hash)

                  if (hasHash === false) {
                    vfile.message(`Hash "${hash}" not found in ${url}`, node.position)
                    return;
                  }
                }
              }
            }
          )
        }).process({
          path: `${item.href.startsWith('/') ? item.href.slice(1) : item.href}.mdx`,
          value: item.fileContent
        })

      if (item.sdk === undefined) {
        await writeDistFile(`${item.href.replace("/docs/", "")}.mdx`, item.fileContent)
      }

      return vfile
    }
  }))).filter((item): item is NonNullable<typeof item> => item !== undefined)

  const sdkSpecificMarkdownFileWarnings: VFile[] = []

  for (const targetSdk of VALID_SDKS) {

    // This second pass goes through and removes any items that are not scoped to the target sdk
    const sdkFilteredManifest = await traverseTree(fullManifest,
      async ({ sdk, ...item }) => {

        // This means its generic, not scoped to a specific sdk, so we keep it
        if (sdk === undefined) return {
          ...item,
        }

        // This item is not scoped to the target sdk, so we remove it
        if (sdk.includes(targetSdk) === false) return null

        // This is a scoped item and its scoped to our target sdk
        return {
          ...item,
          scopedHref: scopeHrefToSDK(item.href, targetSdk)
        }
      },
      async ({ sdk, ...group }) => {

        if (sdk === undefined) return group

        if (sdk.includes(targetSdk) === false) return null

        return group
      }
    )

    // Here we are filtering out content for different sdks, and updating links to make them scoped to the sdk when necessary
    await traverseTree(sdkFilteredManifest,
      async (item) => {
        if ("fileContent" in item) {
          const filePath = `${item.href.replace("/docs/", "")}.mdx`

          const vfile = await markdownProcessor()
            .use(() => (tree, vfile) => {
              return mdastFilter(tree,
                node => {
                  const sdk = extractComponentPropValueFromNode(node, vfile, "If", "sdk")

                  if (sdk === undefined) return;

                  const sdksFilter = extractSDKsFromIfProp(node, vfile, sdk)

                  if (sdksFilter === undefined) return

                  if (sdksFilter.includes(targetSdk)) {
                    return true
                  }

                  return false

                }
              )
            })
            // .use(() => (tree, vfile) => {
            //   let offset = 0

            //   visit(tree,
            //     node => node.type === "link" && "url" in node && typeof node.url === "string" && node.url.startsWith("/docs/"),
            //     node => {

            //       if (!("url" in node)) {

            //       }

            //       console.log(node)
            //     }
            //   )
            // })
            .process({
              path: filePath,
              value: item.fileContent
            })

          sdkSpecificMarkdownFileWarnings.push(vfile)

          await writeSDKFile(targetSdk, filePath, String(vfile))
        }
        return null
      })

    // const report = reporter(markdownFileWarnings, { quiet: true })

    // if (report !== "") {
    //   console.info(report)
    // }

    const navigation = await traverseTree(sdkFilteredManifest,
      async (item) => {
        // @ts-expect-error - simplest way to remove these properties
        const { scopedHref, fileContent, frontmatter, headingsHashs, ...details } = item

        return {
          ...details,
          href: scopedHref ?? details.href,
        }
      },
    )

    await writeSDKFile(targetSdk, 'manifest.json', JSON.stringify({ navigation }))
  }

  const output = reporter([...vfiles, ...markdownFileWarnings, ...sdkSpecificMarkdownFileWarnings], { quiet: true })

  if (output !== "") {
    console.info(output)
  }


}

main()