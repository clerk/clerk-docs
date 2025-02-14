import fs from 'node:fs/promises'
import path from 'node:path'

const BASE_PATH = process.cwd()
const MANIFEST_FILE_PATH = path.join(BASE_PATH, './docs/manifest.json')
const DIST_PATH = path.join(BASE_PATH, './dist')
const CLERK_PATH = path.join(BASE_PATH, "../clerk")
const IGNORE = ["/docs/core-1"]

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


const isValidSdk = (sdk: string): sdk is SDK => {
  return VALID_SDKS.includes(sdk as SDK)
}

const isValidSdks = (sdks: string[]): sdks is SDK[] => {
  return sdks.every(isValidSdk)
}

const readManifest = async (): Promise<Manifest> => {
  const manifest = await fs.readFile(MANIFEST_FILE_PATH, 'utf8')
  return JSON.parse(manifest).navigation
}

const readMarkdownFile = async (docPath: string): Promise<string> => {
  const filePath = path.join(process.cwd(), `${docPath}.mdx`)
  const fileContent = await fs.readFile(filePath, 'utf8')
  return fileContent
}

const parseFrontmatter = (content: string, key: string) => {
  const frontmatterMatch = content.match(/---\n([\s\S]*?)---/)
  if (!frontmatterMatch) {
    return null
  }

  const frontmatter = frontmatterMatch[1]
  const keyRegex = new RegExp(`${key}:\\s*([\\s\\S]*?)\\n`)
  const valueMatch = frontmatter.match(keyRegex)

  if (!valueMatch) {
    return null
  }

  const rawValue = valueMatch[1].trim()

  if (rawValue.includes(',')) {
    return rawValue.split(/\s*,\s*/)
  }

  return rawValue
}

const ensureDirectory = async (path: string): Promise<void> => {
  try {
    await fs.access(path)
  } catch {
    await fs.mkdir(path)
  }
}

const writeSDKFile = async (sdk: SDK, filePath: string, contents: string) => {
  const fullPath = path.join(DIST_PATH, sdk, filePath)
  await ensureDirectory(path.dirname(fullPath))
  await fs.writeFile(fullPath, contents)
}

type ItemCallback = (item: ManifestItem) => Promise<ManifestItem | null>
type GroupCallback = (item: ManifestGroup) => Promise<ManifestGroup | null>

// this will recursively traverse the manifest
// if you return null it will filter out the item (and filter out groups that become empty)
const traverseManifest = async (
  manifest: Manifest,
  itemCallback: ItemCallback = async (item) => item,
  groupCallback: GroupCallback = async (item) => item
): Promise<Manifest> => {
  const result = await Promise.all(manifest.map(async (navGroup) => {
    return Promise.all(navGroup.map(async (item) => {
      if ('href' in item) {
        return await itemCallback(item)
      }

      if ('items' in item && Array.isArray(item.items)) {
        return await groupCallback({
          ...item,
          items: (await traverseManifest(item.items, itemCallback, groupCallback)).map(group => group.filter((item): item is NonNullable<typeof item> => item !== null))
        })
      }

      return item
    }))
  }))

  return result.map(group => group.filter((item): item is NonNullable<typeof item> => item !== null))
}

const scopeItemToSDK = (item: Omit<ManifestItem, 'sdk'>, itemSDK: undefined | SDK[], targetSDK: SDK): ManifestItem => {

  // This is external so can't change it
  if (item.href.startsWith('/docs') === false) return item

  // This item is not scoped to a specific sdk, so leave it alone
  if (itemSDK === undefined) return item

  const hrefSegments = item.href.split('/')

  // This is a little hacky so we might change it
  // if the url already contains the sdk, we don't need to change it
  if (hrefSegments.includes(targetSDK)) {
    return item
  }

  // Add the sdk to the url
  return {
    ...item,
    href: `/docs/${targetSDK}/${hrefSegments.slice(1).join('/')}`
  }
}

const main = async () => {
  await ensureDirectory(DIST_PATH)

  const manifest = await readManifest()

  // This first pass goes through and grabs the sdk scoping out of the markdown files frontmatter
  const fullManifest = await traverseManifest(manifest,
    async (item) => {

      if (!item.href?.startsWith('/docs/')) return item
      if (item.target !== undefined) return item
      if (IGNORE.includes(item.href)) return item

      const fileContent = await readMarkdownFile(item.href)
      const frontmatterSDK = parseFrontmatter(fileContent, 'sdk')

      if (frontmatterSDK === null) return item

      const sdks = Array.isArray(frontmatterSDK) ? frontmatterSDK : [frontmatterSDK]

      if (isValidSdks(sdks) === false) {
        throw new Error(`Invalid SDK ${JSON.stringify(sdks)} found in: ${item.href}`)
      }

      return {
        ...item,
        sdk: sdks
      }
    },
    async (group) => {
      const sdk = Array.from(new Set(group.items?.flatMap((item) =>
        item.flatMap((item) => item.sdk)))).filter((sdk): sdk is SDK => Boolean(sdk))

      const { items, ...details } = group
      if (sdk.length === 0) return { ...details, items }
      return {
        ...details,
        sdk,
        items
      }
    }
  )

  for (const targetSdk of VALID_SDKS) {

    // This second pass goes through and removes any items that are not scoped to the target sdk
    const sdkSpecificManifest = await traverseManifest(fullManifest,
      async ({ sdk, ...item }) => {

        // this means its generic, not scoped to a specific sdk, so we keep it
        if (sdk === undefined) return item

        // this item is not scoped to the target sdk, so we remove it
        if (sdk.includes(targetSdk) === false) return null

        // this item is scoped to the target sdk, so we keep it 
        return scopeItemToSDK(item, sdk, targetSdk)
      },
      async ({ sdk, ...group }) => {

        if (sdk === undefined) return group

        if (sdk.includes(targetSdk) === false) return null

        return group
      }
    )

    await writeSDKFile(targetSdk, 'manifest.json', JSON.stringify({ navigation: sdkSpecificManifest }))
  }
}

main()