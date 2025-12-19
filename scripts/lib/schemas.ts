// zod schemas for some of the basic types

import { z } from 'zod'
import type { BuildConfig } from './config'

export const VALID_SDKS = [
  'nextjs',
  'react',
  'js-frontend',
  'chrome-extension',
  'expo',
  'android',
  'ios',
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
  'js-backend',
] as const

export type SDK = (typeof VALID_SDKS)[number]

export const sdk = z.enum(VALID_SDKS)

export const icon = z.enum([
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
  'cpu',
  'door',
  'document',
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
  'api',
])

export type Icon = z.infer<typeof icon>

export const tag = z.enum(['(Beta)', '(Community)'])

export type Tag = z.infer<typeof tag>

export const isValidSdk =
  (config: BuildConfig) =>
  (sdk: string): sdk is SDK => {
    return config.validSdks.includes(sdk as SDK)
  }

export const isValidSdks =
  (config: BuildConfig) =>
  (sdks: string[]): sdks is SDK[] => {
    return sdks.every(isValidSdk(config))
  }
