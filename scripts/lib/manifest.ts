// parsing and traversing the manifest.json file

import fs from 'node:fs/promises'
import { z } from 'zod'
import { fromError } from 'zod-validation-error'
import type { BuildConfig } from './config'
import { errorMessages } from './error-messages'
import { parseJSON } from './io'
import { icon, sdk, tag, type Icon, type SDK, type Tag } from './schemas'
import { VFile } from 'vfile'

// read in the manifest, create a vfile to write warnings to

export const readManifest = (config: BuildConfig) => async () => {
  const { manifestSchema } = createManifestSchema(config)
  const unsafe_manifest = await fs.readFile(config.manifestFilePath, { encoding: 'utf-8' })

  const [error, json] = parseJSON(unsafe_manifest)

  if (error) {
    throw new Error(errorMessages['manifest-parse-error'](error))
  }

  const manifest = await z.object({ navigation: manifestSchema }).safeParseAsync(json)

  if (manifest.success === true) {
    return {
      manifest: manifest.data.navigation,
      vfile: new VFile({ path: config.manifestRelativePath }),
    }
  }

  throw new Error(errorMessages['manifest-parse-error'](fromError(manifest.error)))
}

// verify the manifest is valid

export type ManifestItem = {
  title: string
  href: string
  tag?: Tag
  wrap?: boolean
  icon?: Icon
  target?: '_blank'
  sdk?: SDK[]
  shortcut?: boolean
}

export type ManifestHeading = {
  title: string
  type: 'heading'
  sdk?: SDK[]
}

export type ManifestGroup = {
  title: string
  items: Manifest
  topNav?: boolean
  tag?: Tag
  wrap?: boolean
  icon?: Icon
  hideTitle?: boolean
  sdk?: SDK[]
  skip?: boolean
}

export type Manifest = (ManifestItem | ManifestHeading | ManifestGroup)[]

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
      shortcut: z.boolean().optional(),
    })
    .strict()

  const manifestHeading: z.ZodType<ManifestHeading> = z
    .object({
      title: z.string(),
      type: z.literal('heading'),
      sdk: z.array(sdk).optional(),
    })
    .strict()

  const manifestGroup: z.ZodType<ManifestGroup> = z
    .object({
      title: z.string(),
      items: z.lazy(() => manifestSchema),
      topNav: z.boolean().optional(),
      tag: tag.optional(),
      wrap: z.boolean().default(config.manifestOptions.wrapDefault),
      icon: icon.optional(),
      hideTitle: z.boolean().default(config.manifestOptions.hideTitleDefault),
      sdk: z.array(sdk).optional(),
      skip: z.boolean().optional(),
    })
    .strict()

  const manifestSchema: z.ZodType<Manifest> = z.array(z.union([manifestItem, manifestHeading, manifestGroup]))

  return {
    manifestItem,
    manifestHeading,
    manifestGroup,
    manifestSchema,
  }
}

// helper functions for traversing the manifest tree

export type BlankTree<Item extends object, Group extends { items: BlankTree<Item, Group> }> = Array<Item | Group>

export const traverseTree = async <
  Tree extends { items: BlankTree<any, any> },
  InItem extends Extract<Tree['items'][number], { href: string }>,
  InGroup extends Extract<Tree['items'][number], { items: BlankTree<InItem, InGroup> }>,
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
    tree.items.map(async (item) => {
      try {
        if ('href' in item) {
          return await itemCallback(item, tree)
        }

        if ('items' in item && Array.isArray(item.items)) {
          const newGroup = await groupCallback(item, tree)

          if (newGroup === null) return null

          // @ts-expect-error - OutGroup should always contain "items" property, so this is safe
          const newItems = await traverseTree(newGroup, itemCallback, groupCallback, errorCallback)

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

  return result.filter((item): item is NonNullable<typeof item> => item !== null) as unknown as OutTree
}

export const traverseTreeItemsFirst = async <
  Tree extends { items: BlankTree<any, any> },
  InItem extends Extract<Tree['items'][number], { href: string }>,
  InGroup extends Extract<Tree['items'][number], { items: BlankTree<InItem, InGroup> }>,
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
    tree.items.map(async (item) => {
      try {
        if ('href' in item) {
          return await itemCallback(item, tree)
        }

        if ('items' in item && Array.isArray(item.items)) {
          const newItems = await traverseTreeItemsFirst(item, itemCallback, groupCallback, errorCallback)

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

  return result.filter((item): item is NonNullable<typeof item> => item !== null) as unknown as OutTree
}

export function flattenTree<
  Tree extends BlankTree<any, any>,
  InItem extends Extract<Tree[number], { href: string }>,
  InGroup extends Extract<Tree[number], { items: BlankTree<InItem, InGroup> }>,
>(tree: Tree): InItem[] {
  const result: InItem[] = []

  for (const itemOrGroup of tree) {
    if ('href' in itemOrGroup) {
      // It's an item
      result.push(itemOrGroup)
    } else if ('items' in itemOrGroup && Array.isArray(itemOrGroup.items)) {
      // It's a group with its own sub-tree, flatten it
      result.push(...flattenTree(itemOrGroup.items))
    }
  }

  return result
}

// Read SDK-specific manifest files (e.g., manifest.ios.json, manifest.android.json)

export type SDKManifestItem = ManifestItem | ManifestHeading | ManifestGroup

export const readSDKManifest = (config: BuildConfig) => async (manifestPath: string) => {
  const { manifestItem, manifestHeading, manifestGroup } = createManifestSchema(config)

  const unsafe_manifest = await fs.readFile(manifestPath, { encoding: 'utf-8' })

  const [error, json] = parseJSON(unsafe_manifest)

  if (error) {
    throw new Error(errorMessages['manifest-parse-error'](error))
  }

  const sdkManifestSchema = z.array(z.union([manifestItem, manifestHeading, manifestGroup]))
  const manifest = await z.object({ navigation: sdkManifestSchema }).safeParseAsync(json)

  if (manifest.success === true) {
    return manifest.data.navigation
  }

  throw new Error(errorMessages['manifest-parse-error'](fromError(manifest.error)))
}
