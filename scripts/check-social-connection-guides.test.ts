import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  activeSocialConnectionGuides,
  type SocialConnectionGuide,
  type SocialConnectionGuideRule,
  validateSocialConnectionGuide,
} from './check-social-connection-guides'

const guide: SocialConnectionGuide = {
  accountName: 'Example account',
  credentialHeading: 'Set the Client ID and Client Secret in the Clerk Dashboard',
  credentialUsesPartial: true,
  fileName: 'example.mdx',
  href: '/docs/guides/configure/auth-strategies/social-connections/example',
  introConnector: 'with',
  introDocumentationUrl: 'https://example.com/oauth',
  introProvider: 'Example',
  protocol: 'OAuth',
  setupProvider: 'Example',
  titleProvider: 'Example',
}

const validGuide = `---
title: Add Example as a social connection
description: Learn how to allow users to sign up and sign in to your Clerk application with their Example account using OAuth.
---

<TutorialHero
  beforeYouStart={[
    {
      title: "A Clerk application is required.",
    },
  ]}
/>

Enabling OAuth with [Example](https://example.com/oauth) allows your users to sign up and sign in to your Clerk app with their Example account.

## Configure for your development instance

For development instances, use shared credentials.

## Configure for your production instance

For production instances, use custom credentials.

<Steps>
  ### Enable Example as a social connection in Clerk

  Configure the connection directly.

  ### Set the Client ID and Client Secret in the Clerk Dashboard

  <Include src="_partials/authentication/social-connections/set-client-id-secret" />

  ### Test your connection

  <Include src="_partials/authentication/social-connections/test-your-connection" />
</Steps>
`

function expectRule(content: string, rule: SocialConnectionGuideRule, message: string): void {
  expect(validateSocialConnectionGuide(content, guide)).toContainEqual({
    rule,
    message: expect.stringContaining(message),
  })
}

describe('validateSocialConnectionGuide', () => {
  it('accepts the shared provider-guide conventions', () => {
    expect(validateSocialConnectionGuide(validGuide, guide)).toEqual([])
  })

  it('requires "Clerk application" in the frontmatter description', () => {
    expectRule(
      validGuide.replace('your Clerk application', 'your app'),
      'description-clerk-application',
      'Clerk application',
    )
  })

  it('requires the style-guide title format', () => {
    expectRule(
      validGuide.replace('title: Add Example as', 'title: Configure Example as'),
      'title-format',
      'Add Example as a social connection',
    )
  })

  it('requires the provider-appropriate protocol in the frontmatter description', () => {
    expectRule(validGuide.replace('using OAuth.', 'using SAML.'), 'description-protocol', 'using OAuth')
  })

  it('requires the exact Clerk application prerequisite', () => {
    expectRule(
      validGuide.replace('A Clerk application is required.', 'Create a Clerk app.'),
      'clerk-prerequisite',
      'exact prerequisite title',
    )
  })

  it('requires the exact Clerk application prerequisite inside TutorialHero', () => {
    expectRule(
      `${validGuide.replace('A Clerk application is required.', 'Create a Clerk app.')}\n{/* title: "A Clerk application is required." */}`,
      'clerk-prerequisite',
      'exact prerequisite title',
    )
  })

  it('ignores a prerequisite title that only appears in a TutorialHero comment', () => {
    expectRule(
      validGuide.replace(
        '      title: "A Clerk application is required.",',
        '      title: "Create a Clerk app." /* title: "A Clerk application is required." */,',
      ),
      'clerk-prerequisite',
      'exact prerequisite title',
    )
  })

  it('requires the TutorialHero component', () => {
    expectRule(validGuide.replace('<TutorialHero', '<Prerequisites'), 'tutorial-hero', '<TutorialHero />')
  })

  it('requires TutorialHero to be self-closing', () => {
    const tutorialHeroSource = validGuide.match(/<TutorialHero[\s\S]*?\/>/)?.[0] ?? ''
    const pairedTutorialHero = tutorialHeroSource.replace(/\/>$/, '>\n  This paired form is invalid.\n</TutorialHero>')

    expectRule(validGuide.replace(tutorialHeroSource, pairedTutorialHero), 'tutorial-hero', '<TutorialHero />')
  })

  it('rejects a component whose name only starts with TutorialHero', () => {
    const prefixedComponent = validGuide.replace('<TutorialHero', '<TutorialHeroAlternative')

    expectRule(prefixedComponent, 'tutorial-hero', '<TutorialHero />')
    expectRule(prefixedComponent, 'clerk-prerequisite', 'exact prerequisite title')
  })

  it('does not accept TutorialHero or introductory copy from fenced code blocks', () => {
    const tutorialHeroSource = validGuide.match(/<TutorialHero[\s\S]*?\/>/)?.[0] ?? ''
    const introduction =
      'Enabling OAuth with [Example](https://example.com/oauth) allows your users to sign up and sign in to your Clerk app with their Example account.'
    const fencedStructure = validGuide
      .replace(tutorialHeroSource, `\`\`\`mdx\n${tutorialHeroSource}\n\`\`\``)
      .replace(introduction, `\`\`\`mdx\n${introduction}\n\`\`\``)

    expectRule(fencedStructure, 'tutorial-hero', '<TutorialHero />')
    expectRule(fencedStructure, 'intro-provider-link', 'link the provider')
  })

  it('requires "Clerk app" in the introductory paragraph', () => {
    expectRule(validGuide.replace('your Clerk app with', 'your application with'), 'intro-clerk-app', 'Clerk app')
  })

  it('requires the provider account identity in the frontmatter description', () => {
    expectRule(
      validGuide.replace('their Example account using OAuth', 'their Notion account using OAuth'),
      'description-clerk-application',
      'Example account',
    )
  })

  it('requires the provider account identity in the introductory paragraph', () => {
    expectRule(
      validGuide.replace('their Example account.', 'their Notion account.'),
      'intro-provider-link',
      'link the provider',
    )
  })

  it('accepts an introductory paragraph wrapped across lines', () => {
    const wrappedIntroduction = validGuide.replace(
      'Enabling OAuth with [Example](https://example.com/oauth) allows your users to sign up and sign in to your Clerk app with their Example account.',
      `Enabling OAuth
with [Example](https://example.com/oauth) allows your users to sign up
and sign in to your Clerk app with their Example account.`,
    )

    expect(validateSocialConnectionGuide(wrappedIntroduction, guide)).toEqual([])
  })

  it('requires the introductory paragraph to link to provider protocol documentation', () => {
    expectRule(
      validGuide.replace('[Example](https://example.com/oauth)', 'Example'),
      'intro-provider-link',
      'link the provider',
    )
  })

  it('requires the introductory link to use the provider display name', () => {
    expectRule(
      validGuide.replace('[Example](https://example.com/oauth)', '[documentation](https://example.com/oauth)'),
      'intro-provider-link',
      'link the provider',
    )
  })

  it('requires the introductory link to use the provider protocol documentation URL', () => {
    expectRule(
      validGuide.replace('https://example.com/oauth', 'https://example.com/unrelated'),
      'intro-provider-link',
      'link the provider',
    )
  })

  it('accepts an introductory link that carries a title attribute', () => {
    expect(
      validateSocialConnectionGuide(
        validGuide.replace(
          '[Example](https://example.com/oauth)',
          '[Example](https://example.com/oauth "Provider OAuth documentation")',
        ),
        guide,
      ),
    ).toEqual([])
  })

  it('accepts a reference-style introductory provider link', () => {
    expect(
      validateSocialConnectionGuide(
        `${validGuide.replace('[Example](https://example.com/oauth)', '[Example][oauth]')}\n[oauth]: https://example.com/oauth\n`,
        guide,
      ),
    ).toEqual([])
  })

  it('rejects extra prose between the provider link and the standard introduction ending', () => {
    expectRule(
      validGuide.replace(
        '[Example](https://example.com/oauth) allows',
        '[Example](https://example.com/oauth) with arbitrary extra copy allows',
      ),
      'intro-provider-link',
      'standard',
    )
  })

  it('requires the standard setup heading', () => {
    expectRule(
      validGuide.replace('Enable Example as a social connection in Clerk', 'Configure Example'),
      'setup-heading',
      'exact heading',
    )
  })

  it('requires development and production sections when they apply', () => {
    expectRule(
      validGuide.replace('## Configure for your development instance', '## Development'),
      'environment-sections',
      'both "Configure for your development instance"',
    )
  })

  it('requires the development section before the production section', () => {
    const developmentSection =
      '## Configure for your development instance\n\nFor development instances, use shared credentials.'
    const productionSection =
      '## Configure for your production instance\n\nFor production instances, use custom credentials.'
    const reversedSections = validGuide.replace(
      `${developmentSection}\n\n${productionSection}`,
      `${productionSection}\n\n${developmentSection}`,
    )

    expect(validateSocialConnectionGuide(reversedSections, guide)).toEqual([
      {
        rule: 'environment-sections',
        message: 'The development instance section must appear before the production instance section.',
      },
    ])
  })

  it('does not accept required headings from MDX comments or code blocks', () => {
    const withoutEnvironmentHeadings = validGuide
      .replace('## Configure for your development instance', '## Development')
      .replace('## Configure for your production instance', '## Production')

    expectRule(
      `${withoutEnvironmentHeadings}\n{/* ## Configure for your development instance */}\n\n\`\`\`mdx\n## Configure for your production instance\n\`\`\``,
      'environment-sections',
      'both "Configure for your development instance"',
    )
  })

  it('requires environment headings to be top-level sections', () => {
    const nestedHeadings = validGuide
      .replace('## Configure for your development instance', '> ## Configure for your development instance')
      .replace('## Configure for your production instance', '> ## Configure for your production instance')

    expectRule(nestedHeadings, 'environment-sections', 'top-level sections')
  })

  it('does not search the rest of the guide for an introduction when both environment headings are missing', () => {
    const withoutEnvironmentHeadings = validGuide
      .replace('## Configure for your development instance', '## Development')
      .replace('## Configure for your production instance', '## Production')
    const misplacedIntroduction =
      withoutEnvironmentHeadings.replace(
        'Enabling OAuth with [Example](https://example.com/oauth) allows your users to sign up and sign in to your Clerk app with their Example account.',
        '',
      ) +
      '\nEnabling OAuth with [Example](https://example.com/oauth) allows your users to sign up and sign in to your Clerk app with their Example account.\n'

    expectRule(misplacedIntroduction, 'environment-sections', 'both')
    expectRule(misplacedIntroduction, 'intro-provider-link', 'before the environment sections')
  })

  it('requires the introduction before the first environment section', () => {
    const introduction =
      'Enabling OAuth with [Example](https://example.com/oauth) allows your users to sign up and sign in to your Clerk app with their Example account.'
    const misplacedIntroduction = validGuide.replace(
      `${introduction}\n\n## Configure for your development instance`,
      `## Configure for your development instance\n\n${introduction}`,
    )

    expectRule(misplacedIntroduction, 'intro-provider-link', 'before the environment sections')
  })

  it('accepts a Steps component with props', () => {
    expect(validateSocialConnectionGuide(validGuide.replace('<Steps>', '<Steps aria-label="Setup">'), guide)).toEqual(
      [],
    )
  })

  it('requires the standard credential partial when the provider uses standard terminology', () => {
    expectRule(
      validGuide.replace(
        '<Include src="_partials/authentication/social-connections/set-client-id-secret" />',
        'Paste the credentials.',
      ),
      'credential-step',
      'set-client-id-secret partial',
    )
  })

  it('requires the credential partial in the credential section', () => {
    expectRule(
      validGuide
        .replace(
          '<Include src="_partials/authentication/social-connections/set-client-id-secret" />',
          'Paste the credentials.',
        )
        .replace(
          '<Include src="_partials/authentication/social-connections/test-your-connection" />',
          '<Include src="_partials/authentication/social-connections/set-client-id-secret" />\n\n  <Include src="_partials/authentication/social-connections/test-your-connection" />',
        ),
      'credential-step',
      'set-client-id-secret partial',
    )
  })

  it('requires an explicitly declared custom credential heading and real content', () => {
    expectRule(
      validGuide
        .replace(
          '### Set the Client ID and Client Secret in the Clerk Dashboard',
          '### Set anything in the Clerk Dashboard',
        )
        .replace('<Include src="_partials/authentication/social-connections/set-client-id-secret" />', ''),
      'credential-step',
      'credential step',
    )
  })

  it('requires an ordered list under a custom credential heading, not a placeholder', () => {
    const customGuide: SocialConnectionGuide = {
      ...guide,
      credentialHeading: 'Set the Key and Secret in the Clerk Dashboard',
      credentialUsesPartial: false,
    }
    const customValidGuide = validGuide
      .replace(
        '### Set the Client ID and Client Secret in the Clerk Dashboard',
        '### Set the Key and Secret in the Clerk Dashboard',
      )
      .replace(
        '<Include src="_partials/authentication/social-connections/set-client-id-secret" />',
        '1. Paste the **Key** and **Secret** values into the respective fields.\n  1. Select **Save**.',
      )

    expect(validateSocialConnectionGuide(customValidGuide, customGuide)).toEqual([])
    expect(
      validateSocialConnectionGuide(
        customValidGuide.replace(
          '1. Paste the **Key** and **Secret** values into the respective fields.\n  1. Select **Save**.',
          'TBD.',
        ),
        customGuide,
      ).map((issue) => issue.rule),
    ).toContain('credential-step')
  })

  it('requires the standard test-connection heading and partial', () => {
    expectRule(
      validGuide.replace(
        '<Include src="_partials/authentication/social-connections/test-your-connection" />',
        'Test the connection.',
      ),
      'test-connection-step',
      'standard "Test your connection"',
    )
  })

  it('requires enable, credentials, then test inside Steps', () => {
    const enableStep = '  ### Enable Example as a social connection in Clerk\n\n  Configure the connection directly.'
    const credentialStep =
      '  ### Set the Client ID and Client Secret in the Clerk Dashboard\n\n  <Include src="_partials/authentication/social-connections/set-client-id-secret" />'
    const testStep =
      '  ### Test your connection\n\n  <Include src="_partials/authentication/social-connections/test-your-connection" />'
    const orderedSteps = `${enableStep}\n\n${credentialStep}\n\n${testStep}`

    for (const outOfOrderSteps of [
      `${credentialStep}\n\n${enableStep}\n\n${testStep}`,
      `${enableStep}\n\n${testStep}\n\n${credentialStep}`,
    ]) {
      expect(validateSocialConnectionGuide(validGuide.replace(orderedSteps, outOfOrderSteps), guide)).toEqual([
        {
          rule: 'steps-order',
          message: 'The <Steps> block must place the enable step before credentials, then test the connection.',
        },
      ])
    }
  })

  it('requires level-three headings inside Steps', () => {
    expectRule(
      validGuide.replace('  ### Test your connection', '  ## Test your connection'),
      'steps-heading-depth',
      '###',
    )
  })

  it('ignores heading-like text in fenced code blocks inside Steps', () => {
    const withCode = validGuide.replace(
      '  Configure the connection directly.',
      '  Configure the connection directly.\n\n  ```sh\n  # set the redirect\n  ```',
    )

    expect(validateSocialConnectionGuide(withCode, guide)).toEqual([])
  })

  it.each(['easy', 'easier'])('rejects accessibility-problematic "%s" wording', (word) => {
    expectRule(
      validGuide.replace('Configure the connection directly.', `Make setup ${word}.`),
      'accessibility-language',
      word,
    )
  })

  it('ignores accessibility wording in MDX comments and code blocks', () => {
    expect(
      validateSocialConnectionGuide(`${validGuide}\n{/* easier */}\n\n\`easy\``, guide).filter(
        (issue) => issue.rule === 'accessibility-language',
      ),
    ).toEqual([])
  })

  it('rejects screenshots in favor of explicit UI instructions', () => {
    expectRule(`${validGuide}\n![Settings](settings.png)`, 'screenshots', 'Do not use screenshots')
  })

  it('rejects multiline raw img screenshots', () => {
    expectRule(
      `${validGuide}\n<img\n  alt="Settings"\n  src="settings.png"\n/>`,
      'screenshots',
      'Do not use screenshots',
    )
  })

  it('rejects reference-style Markdown images', () => {
    expectRule(
      `${validGuide}\n![Settings][settings]\n\n[settings]: settings.png`,
      'screenshots',
      'Do not use screenshots',
    )
  })

  it('parses quoted and folded YAML frontmatter values', () => {
    const quotedFrontmatter = validGuide
      .replace('title: Add Example as a social connection', 'title: "Add Example as a social connection"')
      .replace(
        'description: Learn how to allow users to sign up and sign in to your Clerk application with their Example account using OAuth.',
        'description: >-\n  Learn how to allow users to sign up and sign in to your Clerk application with their Example account\n  using OAuth.',
      )

    expect(validateSocialConnectionGuide(quotedFrontmatter, guide)).toEqual([])
  })

  it('uses "complete" instead of "fill out"', () => {
    expectRule(
      validGuide.replace('Configure the connection directly.', 'Fill out the form.'),
      'accessibility-language',
      'complete',
    )
  })
})

describe('activeSocialConnectionGuides', () => {
  it('skips deprecated providers and applies narrowly allowlisted provider differences', () => {
    const manifest = {
      navigation: [
        {
          title: 'All providers',
          items: [
            {
              title: 'LinkedIn OIDC',
              href: '/docs/guides/configure/auth-strategies/social-connections/linkedin-oidc',
            },
            {
              title: 'Twitter',
              tag: 'deprecated',
              href: '/docs/guides/configure/auth-strategies/social-connections/twitter',
            },
          ],
        },
      ],
    }

    expect(activeSocialConnectionGuides(manifest)).toEqual([
      {
        accountName: 'LinkedIn account',
        credentialHeading: 'Set the Client ID and Primary Client Secret in the Clerk Dashboard',
        credentialUsesPartial: false,
        fileName: 'linkedin-oidc.mdx',
        href: '/docs/guides/configure/auth-strategies/social-connections/linkedin-oidc',
        introAside: undefined,
        introConnector: 'with',
        introDocumentationUrl: 'https://learn.microsoft.com/en-us/linkedin/shared/authentication/authentication',
        introProvider: 'LinkedIn',
        protocol: 'OpenID Connect (OIDC)',
        setupProvider: 'LinkedIn',
        titleProvider: 'LinkedIn OpenID Connect (OIDC)',
      },
    ])
  })

  it('rejects a stale manifest label for a provider with a title override', () => {
    const manifest = {
      navigation: [
        {
          title: 'All providers',
          items: [{ title: 'LinkedIn', href: guide.href.replace('example', 'linkedin-oidc') }],
        },
      ],
    }

    expect(() => activeSocialConnectionGuides(manifest)).toThrow('must use manifest title "LinkedIn OIDC"')
  })

  it('allows only the documented Microsoft introduction aside', () => {
    const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
    const docsRoot = path.resolve(scriptDirectory, '..')
    const manifest = JSON.parse(fs.readFileSync(path.join(docsRoot, 'docs/manifest.json'), 'utf8'))
    const microsoft = activeSocialConnectionGuides(manifest).find(
      (activeGuide) => activeGuide.fileName === 'microsoft.mdx',
    )!
    const content = fs.readFileSync(
      path.join(docsRoot, 'docs/guides/configure/auth-strategies/social-connections/microsoft.mdx'),
      'utf8',
    )

    expect(validateSocialConnectionGuide(content, microsoft)).toEqual([])
    expect(
      validateSocialConnectionGuide(
        content.replace(
          '(formerly [Azure Active Directory]',
          '(plus unrelated prose, formerly [Azure Active Directory]',
        ),
        microsoft,
      ).map((issue) => issue.rule),
    ).toContain('intro-provider-link')
    expect(
      validateSocialConnectionGuide(
        content.replace('https://learn.microsoft.com/en-us/entra/fundamentals/new-name', 'https://example.com/other'),
        microsoft,
      ).map((issue) => issue.rule),
    ).toContain('intro-provider-link')
  })

  it('uses manifest provider identity when frontmatter and guide labels name a different provider', () => {
    const manifest = {
      navigation: [
        {
          title: 'All providers',
          items: [
            {
              title: 'Box',
              href: '/docs/guides/configure/auth-strategies/social-connections/box',
            },
          ],
        },
      ],
    }
    const mislabeledGuide = validGuide
      .replace('title: Add Example as', 'title: Add Notion as')
      .replace(
        '[Example](https://example.com/oauth)',
        '[Notion](https://developer.box.com/guides/authentication/oauth2/)',
      )
      .replace('Enable Example as a social connection in Clerk', 'Enable Notion as a social connection in Clerk')
    const activeGuide = activeSocialConnectionGuides(manifest)[0]!
    const issues = validateSocialConnectionGuide(mislabeledGuide, activeGuide)

    expect(activeGuide.introProvider).toBe('Box')
    expect(activeGuide.setupProvider).toBe('Box')
    expect(activeGuide.titleProvider).toBe('Box')
    expect(issues).toContainEqual({
      rule: 'title-format',
      message: expect.stringContaining('Add Box as a social connection'),
    })
    expect(issues).toContainEqual({
      rule: 'intro-provider-link',
      message: expect.stringContaining('link the provider'),
    })
    expect(issues).toContainEqual({
      rule: 'setup-heading',
      message: expect.stringContaining('exact heading'),
    })
  })

  it('passes for every active social connection guide in the repository', () => {
    const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
    const docsRoot = path.resolve(scriptDirectory, '..')
    const guidesDirectory = path.join(docsRoot, 'docs/guides/configure/auth-strategies/social-connections')
    const manifest = JSON.parse(fs.readFileSync(path.join(docsRoot, 'docs/manifest.json'), 'utf8'))
    const guides = activeSocialConnectionGuides(manifest)

    const failures = guides.flatMap((activeGuide) => {
      const content = fs.readFileSync(path.join(guidesDirectory, activeGuide.fileName), 'utf8')
      return validateSocialConnectionGuide(content, activeGuide).map(
        (issue) => `${activeGuide.fileName}: ${issue.message}`,
      )
    })

    expect(failures).toEqual([])
  })
})
