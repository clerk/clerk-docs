import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Heading, Paragraph, Root, RootContent } from 'mdast'
import { toString } from 'mdast-util-to-string'
import { remark } from 'remark'
import remarkFrontmatter from 'remark-frontmatter'
import remarkMdx from 'remark-mdx'
import { visit } from 'unist-util-visit'
import yaml from 'yaml'
import { findGroup } from './lib/manifest'

const SOCIAL_CONNECTIONS_PREFIX = '/docs/guides/configure/auth-strategies/social-connections/'

type Protocol = 'OAuth' | 'OpenID Connect (OIDC)'

interface ManifestItem {
  href?: string
  items?: ManifestItem[]
  tag?: string
  title?: string
}

interface DocsManifest {
  navigation: ManifestItem[]
}

export interface SocialConnectionGuide {
  accountName: string
  credentialHeading: string
  credentialUsesPartial: boolean
  fileName: string
  href: string
  introAside?: { linkText: string; url: string }
  introConnector: 'with' | 'via'
  introDocumentationUrl: string
  introProvider: string
  protocol: Protocol
  setupProvider: string
  titleProvider: string
}

export type SocialConnectionGuideRule =
  | 'accessibility-language'
  | 'clerk-prerequisite'
  | 'credential-step'
  | 'description-clerk-application'
  | 'description-protocol'
  | 'environment-sections'
  | 'intro-clerk-app'
  | 'intro-provider-link'
  | 'screenshots'
  | 'steps-heading-depth'
  | 'steps-order'
  | 'setup-heading'
  | 'test-connection-step'
  | 'title-format'
  | 'tutorial-hero'

export interface SocialConnectionGuideIssue {
  message: string
  rule: SocialConnectionGuideRule
}

const STANDARD_CREDENTIAL_HEADING = 'Set the Client ID and Client Secret in the Clerk Dashboard'
interface ProviderConfig {
  documentationUrl: string
  accountName?: string
  introProvider?: string
  introAside?: { linkText: string; url: string }
  introConnector?: 'with' | 'via'
  protocol?: Protocol
  setupProvider?: string
  titleProvider?: string
  manifestTitle?: string
  credential?: { heading: string; usesPartial?: boolean }
}

/** Provider-specific URLs and exceptions. A title override also pins the manifest label so nav and frontmatter cannot drift. */
const PROVIDERS: Record<string, ProviderConfig> = {
  'agentid.mdx': { documentationUrl: 'https://www.agentid.com/docs' },
  // Apple's product link and four-part credential form use different wording from the shared template.
  'apple.mdx': {
    documentationUrl: 'https://developer.apple.com/sign-in-with-apple/',
    accountName: 'Apple ID',
    introProvider: 'Sign in with Apple',
    introConnector: 'via',
    credential: { heading: 'Connect your Apple app to your Clerk app' },
  },
  'atlassian.mdx': {
    documentationUrl: 'https://developer.atlassian.com/cloud/oauth/',
    credential: { heading: 'Set the Client ID and Secret in the Clerk Dashboard', usesPartial: true },
  },
  'bitbucket.mdx': {
    documentationUrl: 'https://developer.atlassian.com/cloud/bitbucket/oauth-2',
    credential: { heading: 'Set the Key and Secret in the Clerk Dashboard' },
  },
  'box.mdx': { documentationUrl: 'https://developer.box.com/guides/authentication/oauth2/' },
  'coinbase.mdx': { documentationUrl: 'https://docs.cdp.coinbase.com/coinbase-app/oauth2-integration/integrations' },
  'discord.mdx': { documentationUrl: 'https://discord.com/developers/docs/topics/oauth2' },
  'dropbox.mdx': {
    documentationUrl: 'https://developers.dropbox.com/oauth-guide',
    credential: { heading: 'Set the App Key and App Secret in the Clerk Dashboard' },
  },
  'facebook.mdx': {
    documentationUrl: 'https://developers.facebook.com/docs/facebook-login/',
    credential: { heading: 'Set the App ID and App Secret in the Clerk Dashboard' },
  },
  'github.mdx': {
    documentationUrl: 'https://docs.github.com/en/developers/apps/building-oauth-apps/creating-an-oauth-app',
  },
  'gitlab.mdx': {
    documentationUrl: 'https://docs.gitlab.com/ee/integration/oauth_provider.html',
    credential: {
      heading: 'Set the Application ID and Secret in the Clerk Dashboard',
    },
  },
  'google.mdx': { documentationUrl: 'https://developers.google.com/identity/protocols/oauth2' },
  // The manifest's older capitalization differs from the product name.
  'hubspot.mdx': {
    documentationUrl:
      'https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/oauth/oauth-quickstart-guide',
    manifestTitle: 'Hubspot',
    introProvider: 'HubSpot',
    setupProvider: 'HubSpot',
    titleProvider: 'HubSpot',
  },
  'hugging-face.mdx': {
    documentationUrl: 'https://huggingface.co/docs/hub/oauth',
    credential: {
      heading: 'Set the Client ID and App Secret in the Clerk Dashboard',
    },
  },
  // The product name is conventionally uppercase, unlike its manifest label.
  'line.mdx': {
    documentationUrl: 'https://developers.line.biz/en/docs/line-login/overview/',
    manifestTitle: 'Line',
    introProvider: 'LINE',
    setupProvider: 'LINE',
    titleProvider: 'LINE',
    credential: {
      heading: 'Set the Channel ID and Channel Secret in the Clerk Dashboard',
    },
  },
  'linear.mdx': { documentationUrl: 'https://linear.app/developers/oauth-2-0-authentication' },
  // This connection uses OIDC; its page title is more specific than the navigation and Dashboard labels.
  'linkedin-oidc.mdx': {
    documentationUrl: 'https://learn.microsoft.com/en-us/linkedin/shared/authentication/authentication',
    manifestTitle: 'LinkedIn OIDC',
    accountName: 'LinkedIn account',
    introProvider: 'LinkedIn',
    protocol: 'OpenID Connect (OIDC)',
    setupProvider: 'LinkedIn',
    titleProvider: 'LinkedIn OpenID Connect (OIDC)',
    credential: {
      heading: 'Set the Client ID and Primary Client Secret in the Clerk Dashboard',
    },
  },
  // The page uses the Entra ID product name; the manifest and Dashboard connection use Microsoft.
  'microsoft.mdx': {
    documentationUrl: 'https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols',
    manifestTitle: 'Microsoft',
    accountName: 'Microsoft account',
    introProvider: 'Microsoft Entra ID',
    introAside: {
      linkText: 'Azure Active Directory',
      url: 'https://learn.microsoft.com/en-us/entra/fundamentals/new-name',
    },
    setupProvider: 'Microsoft',
    titleProvider: 'Microsoft Entra ID',
  },
  'notion.mdx': { documentationUrl: 'https://developers.notion.com/guides/get-started/authorization' },
  'slack.mdx': { documentationUrl: 'https://api.slack.com/authentication' },
  'spotify.mdx': { documentationUrl: 'https://developer.spotify.com/documentation/web-api/concepts/authorization' },
  'tiktok.mdx': { documentationUrl: 'https://developers.tiktok.com/doc/login-kit-manage-user-access-tokens' },
  'twitch.mdx': {
    documentationUrl: 'https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#authorization-code-grant-flow',
  },
  'vercel.mdx': { documentationUrl: 'https://vercel.com/docs/sign-in-with-vercel' },
  // The title distinguishes v2 from the deprecated v1 guide; the connection label does not.
  'x-twitter.mdx': {
    documentationUrl: 'https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code',
    manifestTitle: 'X (Twitter v2)',
    introProvider: 'X/Twitter',
    setupProvider: 'X/Twitter',
    titleProvider: 'X/Twitter v2',
  },
  'xero.mdx': { documentationUrl: 'https://developer.xero.com/documentation/guides/oauth2/overview' },
}

export function activeSocialConnectionGuides(manifest: DocsManifest) {
  const allProviders = findGroup(manifest.navigation, 'All providers')
  if (!allProviders?.items) throw new Error('Could not find the "All providers" social connection manifest group')

  return allProviders.items
    .filter((item) => item.tag !== 'deprecated')
    .map((item): SocialConnectionGuide => {
      if (!item.href?.startsWith(SOCIAL_CONNECTIONS_PREFIX)) {
        throw new Error(
          `Active social connection manifest entry "${item.title}" must link under ${SOCIAL_CONNECTIONS_PREFIX}`,
        )
      }

      const fileName = `${item.href.slice(SOCIAL_CONNECTIONS_PREFIX.length)}.mdx`
      const config = PROVIDERS[fileName]
      if (!config) {
        throw new Error(`Active social connection guide "${fileName}" must define its OAuth/OIDC documentation URL`)
      }
      const manifestProvider = item.title ?? fileName
      if (config.titleProvider && !config.manifestTitle) {
        throw new Error(`Title override for "${fileName}" must pin its manifest title`)
      }
      if (config.manifestTitle && config.manifestTitle !== manifestProvider) {
        throw new Error(
          `Active social connection guide "${fileName}" must use manifest title "${config.manifestTitle}"`,
        )
      }
      const introProvider = config.introProvider ?? manifestProvider
      const credentialStep = config.credential
      const credentialHeading = credentialStep?.heading ?? STANDARD_CREDENTIAL_HEADING

      return {
        accountName: config.accountName ?? `${introProvider} account`,
        credentialHeading,
        credentialUsesPartial: credentialStep?.usesPartial ?? credentialHeading === STANDARD_CREDENTIAL_HEADING,
        fileName,
        href: item.href,
        introAside: config.introAside,
        introConnector: config.introConnector ?? 'with',
        introDocumentationUrl: config.documentationUrl,
        introProvider,
        protocol: config.protocol ?? 'OAuth',
        setupProvider: config.setupProvider ?? manifestProvider,
        titleProvider: config.titleProvider ?? manifestProvider,
      }
    })
}

type MdxElement = RootContent & {
  attributes: Array<{ name?: string; type?: string; value?: unknown }>
  children: RootContent[]
  name: string | null
}

interface ParsedGuide {
  frontmatter: Record<string, unknown>
  root: Root
}

function parseGuide(content: string): ParsedGuide {
  const root = remark().use(remarkFrontmatter).use(remarkMdx).parse(content)
  const frontmatterNode = root.children.find((node) => node.type === 'yaml')
  const frontmatter = frontmatterNode?.type === 'yaml' ? yaml.parse(frontmatterNode.value) : {}

  return {
    frontmatter: typeof frontmatter === 'object' && frontmatter !== null ? frontmatter : {},
    root,
  }
}

function mdxElements(root: Root, name: string): MdxElement[] {
  const elements: MdxElement[] = []
  visit(root, 'mdxJsxFlowElement', (node) => {
    if (node.name === name) elements.push(node as MdxElement)
  })
  return elements
}

function sourceForNode(content: string, node: RootContent): string {
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  return start === undefined || end === undefined ? '' : content.slice(start, end)
}

function headings(root: Root): Heading[] {
  const result: Heading[] = []
  visit(root, 'heading', (node) => result.push(node))
  return result
}

function directHeadingIndex(children: RootContent[], depth: number, text: string): number {
  return children.findIndex((node) => node.type === 'heading' && node.depth === depth && toString(node) === text)
}

function sectionChildren(children: RootContent[], headingIndex: number): RootContent[] {
  const section: RootContent[] = []
  for (const node of children.slice(headingIndex + 1)) {
    if (node.type === 'heading') break
    section.push(node)
  }
  return section
}

function hasInclude(section: RootContent[], source: string): boolean {
  return section.some(
    (node) =>
      node.type === 'mdxJsxFlowElement' &&
      node.name === 'Include' &&
      node.attributes.some(
        (attribute) => attribute.type === 'mdxJsxAttribute' && attribute.name === 'src' && attribute.value === source,
      ),
  )
}

function textContent(root: Root): string {
  const values: string[] = []
  visit(root, 'text', (node) => values.push(node.value))
  return values.join(' ')
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/**
 * Collect the string values of every `title` property in a parsed estree. Reading the parsed `beforeYouStart` value
 * rather than the component's raw source keeps a commented-out title from satisfying the prerequisite rule.
 */
function collectPrerequisiteTitles(node: unknown, titles: string[]): void {
  if (Array.isArray(node)) {
    for (const child of node) collectPrerequisiteTitles(child, titles)
    return
  }
  if (typeof node !== 'object' || node === null || typeof (node as { type?: unknown }).type !== 'string') return
  const estreeNode = node as Record<string, unknown> & { type: string }
  if (estreeNode.type === 'Property') {
    const key = estreeNode.key as { type?: string; name?: unknown; value?: unknown } | undefined
    const keyName = key?.type === 'Identifier' ? key.name : key?.type === 'Literal' ? key.value : undefined
    const value = estreeNode.value as { type?: string; value?: unknown } | undefined
    if (keyName === 'title' && value?.type === 'Literal' && typeof value.value === 'string') {
      titles.push(value.value)
    }
  }
  for (const [propertyName, child] of Object.entries(estreeNode)) {
    if (propertyName === 'loc' || propertyName === 'range' || propertyName === 'position') continue
    collectPrerequisiteTitles(child, titles)
  }
}

function tutorialHeroPrerequisiteTitles(element: MdxElement): string[] {
  const attribute = element.attributes.find(
    (candidate) => candidate.type === 'mdxJsxAttribute' && candidate.name === 'beforeYouStart',
  )
  const estree = (attribute?.value as { data?: { estree?: unknown } } | null | undefined)?.data?.estree
  const titles: string[] = []
  collectPrerequisiteTitles(estree, titles)
  return titles
}

export function validateSocialConnectionGuide(
  content: string,
  guide: SocialConnectionGuide,
): SocialConnectionGuideIssue[] {
  const issues: SocialConnectionGuideIssue[] = []
  const { frontmatter, root } = parseGuide(content)
  const description = typeof frontmatter.description === 'string' ? frontmatter.description : ''
  const title = typeof frontmatter.title === 'string' ? frontmatter.title : ''
  const tutorialHeroes = mdxElements(root, 'TutorialHero')
  const tutorialHero = tutorialHeroes[0]
  const tutorialHeroIsSelfClosing =
    tutorialHero !== undefined && sourceForNode(content, tutorialHero).trimEnd().endsWith('/>')
  const tutorialHeroIndex = tutorialHero ? root.children.indexOf(tutorialHero) : -1
  const developmentHeadingIndex = directHeadingIndex(root.children, 2, 'Configure for your development instance')
  const productionHeadingIndex = directHeadingIndex(root.children, 2, 'Configure for your production instance')
  const environmentHeadingIndices = [developmentHeadingIndex, productionHeadingIndex].filter((index) => index !== -1)
  const firstEnvironmentHeadingIndex = environmentHeadingIndices.length ? Math.min(...environmentHeadingIndices) : -1
  const introNode =
    firstEnvironmentHeadingIndex === -1
      ? undefined
      : root.children
          .slice(tutorialHeroIndex + 1, firstEnvironmentHeadingIndex)
          .find((node): node is Paragraph => node.type === 'paragraph')
  const introText = introNode ? normalizeWhitespace(toString(introNode)) : ''
  const steps = mdxElements(root, 'Steps')
  const stepChildren = steps[0]?.children ?? []
  const expectedTitle = `Add ${guide.titleProvider} as a social connection`
  const expectedDescription = `Learn how to allow users to sign up and sign in to your Clerk application with their ${guide.accountName} using ${guide.protocol}.`
  const expectedSetupHeading = `Enable ${guide.setupProvider} as a social connection in Clerk`

  if (title !== expectedTitle) {
    issues.push({
      rule: 'title-format',
      message: `Frontmatter title must be "${expectedTitle}".`,
    })
  }

  if (!description.includes('Clerk application') || !description.includes(`with their ${guide.accountName}`)) {
    issues.push({
      rule: 'description-clerk-application',
      message: `Frontmatter description must refer to a "Clerk application" and the "${guide.accountName}" identity. Expected: "${expectedDescription}"`,
    })
  }
  if (!description.includes(`using ${guide.protocol}`)) {
    issues.push({
      rule: 'description-protocol',
      message: `Frontmatter description must describe the connection as "using ${guide.protocol}".`,
    })
  }
  if (!tutorialHero || !tutorialHeroPrerequisiteTitles(tutorialHero).includes('A Clerk application is required.')) {
    issues.push({
      rule: 'clerk-prerequisite',
      message: 'TutorialHero must include the exact prerequisite title "A Clerk application is required.".',
    })
  }
  if (tutorialHeroes.length !== 1 || !tutorialHeroIsSelfClosing) {
    issues.push({
      rule: 'tutorial-hero',
      message: 'The guide must include a self-closing <TutorialHero /> component.',
    })
  }
  if (!introText.includes('Clerk app')) {
    issues.push({
      rule: 'intro-clerk-app',
      message: 'The introductory paragraph must appear before the environment sections and use "Clerk app".',
    })
  }
  const definitions = new Map<string, string>()
  visit(root, 'definition', (definition) => {
    definitions.set(definition.identifier, definition.url)
  })
  const introLinks =
    introNode?.children.filter((child) => child.type === 'link' || child.type === 'linkReference') ?? []
  const introLinkUrl = (link: (typeof introLinks)[number]) =>
    link.type === 'link' ? link.url : definitions.get(link.identifier)
  const aside = guide.introAside ? ` (formerly ${guide.introAside.linkText})` : ''
  const expectedIntro = `Enabling ${guide.protocol} ${guide.introConnector} ${guide.introProvider}${aside} allows your users to sign up and sign in to your Clerk app with their ${guide.accountName}.`
  if (
    introText !== expectedIntro ||
    introLinks.length !== (guide.introAside ? 2 : 1) ||
    normalizeWhitespace(toString(introLinks[0])) !== guide.introProvider ||
    introLinkUrl(introLinks[0]) !== guide.introDocumentationUrl ||
    (guide.introAside !== undefined &&
      (normalizeWhitespace(toString(introLinks[1])) !== guide.introAside.linkText ||
        introLinkUrl(introLinks[1]) !== guide.introAside.url))
  ) {
    issues.push({
      rule: 'intro-provider-link',
      message: `The introductory paragraph must appear before the environment sections, use the standard "Enabling ${guide.protocol} ${guide.introConnector}" wording, and link the provider to its documentation.`,
    })
  }
  const setupHeadingIndex = directHeadingIndex(stepChildren, 3, expectedSetupHeading)
  if (steps.length !== 1 || setupHeadingIndex === -1) {
    issues.push({
      rule: 'setup-heading',
      message: `The <Steps> block must include the exact heading "${expectedSetupHeading}".`,
    })
  }

  if (developmentHeadingIndex === -1 || productionHeadingIndex === -1) {
    issues.push({
      rule: 'environment-sections',
      message:
        'The guide must include both "Configure for your development instance" and "Configure for your production instance" as top-level sections.',
    })
  }
  if (
    developmentHeadingIndex !== -1 &&
    productionHeadingIndex !== -1 &&
    developmentHeadingIndex > productionHeadingIndex
  ) {
    issues.push({
      rule: 'environment-sections',
      message: 'The development instance section must appear before the production instance section.',
    })
  }

  const credentialHeadingIndex = directHeadingIndex(stepChildren, 3, guide.credentialHeading)
  const credentialSection = credentialHeadingIndex === -1 ? [] : sectionChildren(stepChildren, credentialHeadingIndex)
  const credentialIsValid = guide.credentialUsesPartial
    ? hasInclude(credentialSection, '_partials/authentication/social-connections/set-client-id-secret')
    : credentialSection.some((node) => node.type === 'list' && node.ordered === true)
  if (credentialHeadingIndex === -1 || !credentialIsValid) {
    issues.push({
      rule: 'credential-step',
      message: guide.credentialUsesPartial
        ? 'The <Steps> block must include a credential step with the set-client-id-secret partial.'
        : 'The <Steps> block must include a credential step with an ordered list of instructions.',
    })
  }

  const testHeadingIndex = directHeadingIndex(stepChildren, 3, 'Test your connection')
  const testSection = testHeadingIndex === -1 ? [] : sectionChildren(stepChildren, testHeadingIndex)
  if (!hasInclude(testSection, '_partials/authentication/social-connections/test-your-connection')) {
    issues.push({
      rule: 'test-connection-step',
      message: 'The <Steps> block must include the standard "Test your connection" heading and partial.',
    })
  }
  if (
    setupHeadingIndex !== -1 &&
    credentialHeadingIndex !== -1 &&
    testHeadingIndex !== -1 &&
    !(setupHeadingIndex < credentialHeadingIndex && credentialHeadingIndex < testHeadingIndex)
  ) {
    issues.push({
      rule: 'steps-order',
      message: 'The <Steps> block must place the enable step before credentials, then test the connection.',
    })
  }

  const invalidStepHeadings = steps.flatMap((step) =>
    headings(step as unknown as Root).filter((heading) => heading.depth !== 3),
  )
  if (steps.length !== 1 || invalidStepHeadings.length > 0) {
    const detail =
      invalidStepHeadings.length > 0
        ? ` Found: ${invalidStepHeadings.map((heading) => toString(heading)).join(', ')}.`
        : ''
    issues.push({
      rule: 'steps-heading-depth',
      message: `Use exactly one <Steps> block and level-three (###) headings inside it.${detail}`,
    })
  }

  const prose = textContent(root)
  const inaccessibleWord = prose.match(/\b(easy|easier)\b/i)?.[0]
  if (inaccessibleWord) {
    issues.push({
      rule: 'accessibility-language',
      message: `Avoid "${inaccessibleWord}" in shared provider setup copy; describe the action directly.`,
    })
  }

  let hasScreenshot = false
  visit(root, (node) => {
    if (
      node.type === 'image' ||
      node.type === 'imageReference' ||
      ((node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') &&
        (node.name === 'img' || node.name === 'Image'))
    ) {
      hasScreenshot = true
    }
  })
  if (hasScreenshot) {
    issues.push({
      rule: 'screenshots',
      message: 'Do not use screenshots in social connection guides; make the UI instructions explicit instead.',
    })
  }

  if (/\bfill out\b/i.test(prose)) {
    issues.push({
      rule: 'accessibility-language',
      message: 'Use "complete" instead of "fill out" when referring to forms or fields.',
    })
  }

  return issues
}

function runValidation(): void {
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
  const docsRoot = path.resolve(scriptDirectory, '..')
  const guidesDirectory = path.join(docsRoot, 'docs/guides/configure/auth-strategies/social-connections')
  const manifest = JSON.parse(fs.readFileSync(path.join(docsRoot, 'docs/manifest.json'), 'utf8')) as DocsManifest
  const guides = activeSocialConnectionGuides(manifest)
  const failures = guides.flatMap((guide) => {
    const content = fs.readFileSync(path.join(guidesDirectory, guide.fileName), 'utf8')
    return validateSocialConnectionGuide(content, guide).map((issue) => ({ guide, issue }))
  })

  if (failures.length === 0) {
    console.log(`Checked ${guides.length} active social connection guides`)
    return
  }

  console.error(`Found ${failures.length} social connection guide convention violation(s):\n`)
  for (const { guide, issue } of failures) {
    console.error(`  ${guide.fileName} [${issue.rule}] ${issue.message}`)
  }
  console.error('\nSee styleguides/SSO.STYLEGUIDE.MD before changing the shared conventions or exceptions.')
  process.exitCode = 1
}

function run(): void {
  try {
    runValidation()
  } catch (error) {
    console.error(
      `Social connection guide validation failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    process.exitCode = 1
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) run()
