import { z } from 'zod'
import type { BuildConfig } from './config'
import { icon, sdk, tag, type Icon, type SDK, type Tag } from './validators'
import { errorMessages } from './error-messages'
import fs from 'node:fs/promises'
import { fromError } from 'zod-validation-error'

type ManifestItem = {
  title: string
  href: string
  tag?: Tag
  wrap?: boolean
  icon?: Icon
  target?: '_blank'
  sdk?: SDK[]
}

export type ManifestGroup = {
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

const parseJSON = (json: string) => {
  try {
    const output = JSON.parse(json)

    return [null, output as unknown] as const
  } catch (error) {
    return [new Error(`Failed to parse JSON`, { cause: error }), null] as const
  }
}

export const readManifest = (config: BuildConfig) => async (): Promise<Manifest> => {
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
