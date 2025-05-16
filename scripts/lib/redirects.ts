import type { BuildConfig } from './config'
import fs from 'node:fs/promises'
import path from 'node:path'
import { parse as parseJSONC } from 'jsonc-parser'

interface Redirect {
  source: string
  destination: string
  permanent: boolean
}

export function transformRedirectsToObject(redirects: Redirect[]) {
  return Object.fromEntries(redirects.map((item) => [item.source, item]))
}

export async function readRedirects(config: BuildConfig) {
  const { static: staticConfig, dynamic: dynamicConfig } = config.redirects ?? {}
  if (!staticConfig?.inputPath || !dynamicConfig?.inputPath) {
    throw new Error('Redirect paths not configured')
  }

  const [staticContent, dynamicContent] = await Promise.all([
    fs.readFile(staticConfig.inputPath, 'utf-8'),
    fs.readFile(dynamicConfig.inputPath, 'utf-8'),
  ])

  return {
    staticRedirects: JSON.parse(staticContent) as Redirect[],
    dynamicRedirects: parseJSONC(dynamicContent) as Redirect[],
  }
}

export function analyzeAndFixRedirects(redirects: Redirect[]): Redirect[] {
  const redirectMap = new Map(redirects.map((r) => [r.source, r.destination]))
  const finalDestinations = new Map<string, string>()

  // Find final destinations for each redirect
  for (const { source, destination, permanent } of redirects) {
    let current = destination
    const visited = new Set([source])

    while (redirectMap.has(current) && !visited.has(current)) {
      visited.add(current)
      current = redirectMap.get(current)!
    }

    finalDestinations.set(source, current)
  }

  // Create new redirects pointing to final destinations
  return redirects.map(({ source, permanent }) => ({
    source,
    destination: finalDestinations.get(source)!,
    permanent,
  }))
}

export async function writeRedirects(
  config: BuildConfig,
  staticRedirects: Record<string, Redirect>,
  dynamicRedirects: Redirect[],
) {
  const { static: staticConfig, dynamic: dynamicConfig } = config.redirects ?? {}
  if (!staticConfig?.outputPath || !dynamicConfig?.outputPath) {
    throw new Error('Redirect output paths not configured')
  }

  await fs.mkdir(path.dirname(staticConfig.outputPath), { recursive: true })

  await Promise.all([
    fs.writeFile(staticConfig.outputPath, JSON.stringify(staticRedirects)),
    fs.writeFile(dynamicConfig.outputPath, JSON.stringify(dynamicRedirects)),
  ])
}
