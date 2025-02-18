import fs from 'node:fs/promises'
import path from 'node:path'
import remarkMdx from 'remark-mdx'
import { remark } from 'remark'
import { visit } from 'unist-util-visit'
import remarkFrontmatter from 'remark-frontmatter'
import yaml from "yaml"
import { slugifyWithCounter } from '@sindresorhus/slugify'
import { toString } from 'mdast-util-to-string'
import reporter from 'vfile-reporter'

const BASE_PATH = process.cwd()
const MANIFEST_FILE_PATH = path.join(BASE_PATH, './docs/manifest.json')
const DIST_PATH = path.join(BASE_PATH, './dist')
const CLERK_PATH = path.join(BASE_PATH, "../clerk")
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

const isValidSdk = (sdk: string): sdk is SDK => {
  return VALID_SDKS.includes(sdk as SDK)
}

const isValidSdks = (sdks: string[]): sdks is SDK[] => {
  return sdks.every(isValidSdk)
}

type ManifestItem = {
  title: string
  href: string
  target?: '_blank'
  sdk?: SDK[]
}

type ManifestGroup = {
  title: string
  items: Manifest
  sdk?: SDK[]
}

type Manifest = (ManifestItem | ManifestGroup)[][]

const readManifest = async (): Promise<Manifest> => {
  const manifest = await fs.readFile(MANIFEST_FILE_PATH, { "encoding": "utf-8" })
  return JSON.parse(manifest).navigation
}

const readMarkdownFile = async (docPath: string): Promise<string> => {
  const filePath = path.join(BASE_PATH, `${docPath}.mdx`)
  const fileContent = await fs.readFile(filePath, { "encoding": "utf-8" })
  return fileContent
}

const markdownProcessor = remark()
  .use(remarkFrontmatter)
  .use(remarkMdx)
  .freeze()

const parseFrontmatter = <Keys extends string>(fileContent: string): Record<Keys, string | undefined> | undefined => {
  let frontmatter: Record<Keys, string | undefined> | undefined = undefined

  markdownProcessor()
    .use(() => (tree, vfile) => {
      visit(tree,
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

const main = async () => {
  await ensureDirectory(DIST_PATH)

  const manifest = await readManifest()

  const guides = new Map<string, ManifestItem & { fileContent: string, headingsHashs: Array<string> }>()

  // This first pass goes through and grabs the sdk scoping out of the markdown files frontmatter
  const fullManifest = await traverseTree(manifest,
    async (item) => {

      if (!item.href?.startsWith('/docs/')) return item
      if (item.target !== undefined) return item

      const ignore = IGNORE.some((ignoreItem) => item.href.startsWith(ignoreItem))
      if (ignore === true) return item // even thou we are not processing them, we still need to keep them

      const fileContent = await readMarkdownFile(item.href)

      const slugify = slugifyWithCounter()

      const headingsHashs: Array<string> = []

      markdownProcessor()
        .use(() => (tree) => {
          visit(tree,
            node => node.type === "heading",
            node => {
              const slug = slugify(toString(node).trim())
              headingsHashs.push(slug)
            }
          )
        })
        .process(fileContent)

      const frontmatter = parseFrontmatter<"name" | "description" | "sdk">(fileContent)

      if (frontmatter === undefined) {
        throw new Error(`Frontmatter parsing failed for ${item.href}`)
      }

      if (frontmatter.sdk === undefined) {
        guides.set(item.href, {
          ...item,
          fileContent,
          headingsHashs
        })

        return {
          ...item,
          fileContent,
          frontmatter
        }
      }

      const sdks = frontmatter.sdk.split(', ')

      if (isValidSdks(sdks) === false) {
        throw new Error(`Invalid SDK ${JSON.stringify(sdks)} found in: ${item.href}`)
      }

      guides.set(item.href, {
        ...item,
        sdk: sdks,
        fileContent,
        headingsHashs
      })

      return {
        ...item,
        sdk: sdks,
        fileContent,
        frontmatter
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
    }
  )

  const flatManifest = flattenTree(fullManifest)

  const vfiles = (await Promise.all(flatManifest.map(async (item) => {
    if ("fileContent" in item) {

      const vfile = await markdownProcessor()
        .use(() => (tree, vfile) => {
          visit(tree,
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

  const output = reporter(vfiles, { quiet: true })

  if (output !== "") {
    console.info(output)
  }

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

    await traverseTree(sdkFilteredManifest,
      async (item) => {
        if ("fileContent" in item && "scopedHref" in item) {
          const filePath = `${item.href.replace("/docs/", "")}.mdx`
          await writeSDKFile(targetSdk, filePath, item.fileContent)
        }
        return null
      })

    const navigation = await traverseTree(sdkFilteredManifest,
      async (item) => {
        // @ts-expect-error - simplest way to remove these properties
        const { scopedHref, fileContent, frontmatter, ...details } = item

        return {
          ...details,
          href: scopedHref ?? details.href,
        }
      },
    )

    await writeSDKFile(targetSdk, 'manifest.json', JSON.stringify({ navigation }))
  }
}

main()