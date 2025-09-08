import type { BuildConfig } from './config'
import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'

export async function readSiteFlags(config: BuildConfig) {
  const { inputPath, outputPath } = config.siteFlags ?? {}
  if (!inputPath || !outputPath) {
    throw new Error('Site flags paths not configured')
  }

  const flags = await fs.readFile(inputPath, 'utf-8')

  if (!flags) {
    throw new Error(`Site flags not found at ${inputPath}`)
  }

  return z.record(z.string(), z.boolean()).parse(JSON.parse(flags))
}

export type Flags = Awaited<ReturnType<typeof readSiteFlags>>

export async function writeSiteFlags(config: BuildConfig, flags: Flags) {
  const { outputPath } = config.siteFlags ?? {}
  if (!outputPath) {
    throw new Error('Prompts output path not configured')
  }

  // Create the directory if it doesn't exist
  await fs.mkdir(path.dirname(outputPath), { recursive: true })

  // Write the flags to the file
  await fs.writeFile(outputPath, JSON.stringify(flags))
}
