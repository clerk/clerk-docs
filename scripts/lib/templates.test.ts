import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { remark } from 'remark'
import remarkMdx from 'remark-mdx'
import type { BuildConfig } from './config'
import type { TemplateGitHubMetadata } from './template-graphql'
import { generateTemplatesPage, parseTemplateRepositories, renderTemplatesPage } from './templates'

const repository = {
  name: 'clerk-example',
  repositoryUrl: 'https://github.com/clerk/clerk-example',
  description: 'Shows how to use Clerk in an example application.',
  docsUrl: '/docs/guides/example',
}

const metadata = (name: string, overrides: Partial<TemplateGitHubMetadata> = {}) =>
  new Map<string, TemplateGitHubMetadata>([
    [
      name,
      {
        url: `https://github.com/clerk/${name}`,
        defaultBranch: 'main',
        lastUpdatedAt: '2026-09-20T12:30:00Z',
        exampleDates: {},
        missingExamples: [],
        archived: false,
        disabled: false,
        private: false,
        ...overrides,
      },
    ],
  ])

describe('parseTemplateRepositories', () => {
  test('accepts a valid repository', () => {
    expect(parseTemplateRepositories([repository])).toEqual([repository])
  })

  test('rejects duplicate repositories', () => {
    expect(() => parseTemplateRepositories([repository, repository])).toThrow('duplicate repository name')
  })

  test('accepts an SDK for any repository', () => {
    const quickstart = { ...repository, sdk: 'nextjs' as const }
    expect(parseTemplateRepositories([quickstart])).toEqual([quickstart])
    expect(parseTemplateRepositories([{ ...repository, sdk: 'ruby' }])).toEqual([{ ...repository, sdk: 'ruby' }])
    expect(() => parseTemplateRepositories([{ ...quickstart, sdk: 'unknown' }])).toThrow('has an invalid sdk')
    expect(() => parseTemplateRepositories([{ ...quickstart, framework: 'Next.js' }])).toThrow(
      'must use sdk instead of framework or sdkIcon',
    )
    expect(() => parseTemplateRepositories([{ ...quickstart, sdkIcon: 'nextjs' }])).toThrow(
      'must use sdk instead of framework or sdkIcon',
    )
  })

  test('rejects repositories outside the Clerk organization', () => {
    expect(() =>
      parseTemplateRepositories([{ ...repository, repositoryUrl: 'https://github.com/example/clerk-example' }]),
    ).toThrow('must use https://github.com/clerk/clerk-example')
  })

  test('accepts a linked example directory but rejects path traversal', () => {
    expect(parseTemplateRepositories([{ ...repository, examplePath: 'Examples/Quickstart' }])).toEqual([
      { ...repository, examplePath: 'Examples/Quickstart' },
    ])
    expect(() => parseTemplateRepositories([{ ...repository, examplePath: '../Examples' }])).toThrow(
      'has an invalid examplePath',
    )
    expect(() =>
      parseTemplateRepositories([{ ...repository, examplePath: 'Examples', exampleDescription: 'iOS examples.' }]),
    ).toThrow('must use description instead of exampleDescription')
  })

  test('accepts an additional example directory but rejects duplicate and unsafe paths', () => {
    const example = {
      path: 'Examples/Quickstart',
      description: 'An iOS quickstart.',
    }
    const iosRepository = {
      ...repository,
      examplePath: 'Examples',
      description: 'iOS examples.',
      additionalExamples: [example],
    }

    expect(parseTemplateRepositories([iosRepository])).toEqual([iosRepository])
    expect(() =>
      parseTemplateRepositories([{ ...iosRepository, additionalExamples: [{ ...example, path: 'Examples' }] }]),
    ).toThrow('contains duplicate example paths')
    expect(() =>
      parseTemplateRepositories([{ ...iosRepository, additionalExamples: [{ ...example, path: '../Quickstart' }] }]),
    ).toThrow('has an invalid additional example path')
  })

  test('requires a curated one-line description', () => {
    expect(() => parseTemplateRepositories([{ ...repository, description: null }])).toThrow(
      'must have a non-empty description',
    )
    expect(() => parseTemplateRepositories([{ ...repository, description: '  ' }])).toThrow(
      'must have a non-empty description',
    )
    expect(() => parseTemplateRepositories([{ ...repository, description: 'First line\nSecond line' }])).toThrow(
      'must use a one-line description',
    )
  })

  test('rejects the retired fallbackDescription field', () => {
    expect(() =>
      parseTemplateRepositories([{ ...repository, fallbackDescription: 'An unnecessary fallback.' }]),
    ).toThrow('must use description instead of fallbackDescription')
  })
})

describe('renderTemplatesPage', () => {
  test('escapes MDX syntax in descriptions without changing the catalog data', () => {
    const description = 'Use {client and <button> with \\ in a quickstart.'
    const output = renderTemplatesPage([
      {
        ...repository,
        description,
        additionalExamples: [{ path: 'AnotherExample', description: 'An <example> with {state.' }],
      },
    ])

    expect(output).toContain(String.raw`  - Use \{client and \<button\> with \\ in a quickstart.`)
    expect(output).toContain(String.raw`  - An \<example\> with \{state.`)
    expect(output).toContain(JSON.stringify({ description }).slice(1, -1))
    expect(() => remark().use(remarkMdx).parse(output)).not.toThrow()
  })

  test('renders an ungrouped catalog and a Markdown list', () => {
    const output = renderTemplatesPage([{ ...repository, sdk: 'nextjs' }], metadata(repository.name))

    expect(output).not.toContain('## Demos and examples')
    expect(output).toContain('<If is="human">')
    expect(output).toContain('<If is="llm">')
    expect(output).toContain('<TemplateCatalog items=')
    expect(output).toContain('<Cards>')
    expect(output).not.toContain('"kind"')
    expect(output).toContain('- [clerk-example](https://github.com/clerk/clerk-example)')
    expect(output).toContain("{{ lastUpdatedAt: '2026-09-20T12:30:00Z' }}")
    expect(output).toContain('- Shows how to use Clerk in an example application.')
    expect(output).not.toContain('**Framework:**')
    expect(output).not.toContain('<Icon')
  })

  test('links an example directory within a public repository', () => {
    const output = renderTemplatesPage(
      [
        {
          ...repository,
          name: 'clerk-ios',
          repositoryUrl: 'https://github.com/clerk/clerk-ios',
          examplePath: 'Examples',
          description: 'Example projects demonstrating the Clerk Swift package.',
        },
      ],
      metadata('clerk-ios', {
        defaultBranch: 'develop',
        exampleDates: { Examples: '2026-09-19T10:00:00Z' },
      }),
    )

    expect(output).toContain('- [clerk-ios/Examples](https://github.com/clerk/clerk-ios/tree/develop/Examples)')
    expect(output).toContain("{{ lastUpdatedAt: '2026-09-19T10:00:00Z' }}")
    expect(output).toContain('- Example projects demonstrating the Clerk Swift package.')
  })

  test('links a nested quickstart directory within a public repository', () => {
    const output = renderTemplatesPage(
      [
        {
          ...repository,
          name: 'clerk-android',
          repositoryUrl: 'https://github.com/clerk/clerk-android',
          examplePath: 'samples/quickstart',
          description: 'An Android quickstart sample.',
          sdk: 'android',
        },
      ],
      metadata('clerk-android', { exampleDates: { 'samples/quickstart': '2026-09-19T10:00:00Z' } }),
    )

    expect(output).toContain(
      '- [clerk-android/samples/quickstart](https://github.com/clerk/clerk-android/tree/main/samples/quickstart)',
    )
    expect(output).toContain('- An Android quickstart sample.')
    expect(output).not.toContain('<Icon')
  })

  test('keeps additional examples in the unified list', () => {
    const output = renderTemplatesPage(
      [
        {
          ...repository,
          name: 'clerk-ios',
          repositoryUrl: 'https://github.com/clerk/clerk-ios',
          examplePath: 'Examples',
          description: 'iOS examples.',
          sdk: 'ios',
          additionalExamples: [
            {
              path: 'Examples/Quickstart',
              description: 'An iOS quickstart.',
            },
          ],
        },
      ],
      metadata('clerk-ios', {
        defaultBranch: 'trunk',
        exampleDates: { Examples: '2026-09-18T10:00:00Z', 'Examples/Quickstart': '2026-09-19T10:00:00Z' },
      }),
    )

    expect(output).toContain('- [clerk-ios/Examples](https://github.com/clerk/clerk-ios/tree/trunk/Examples)')
    expect(output).toContain(
      '- [clerk-ios/Examples/Quickstart](https://github.com/clerk/clerk-ios/tree/trunk/Examples/Quickstart)',
    )
    expect(output).not.toContain('## Quickstarts')
    expect(output).toContain('"title":"clerk-ios/Examples/Quickstart"')
    expect(output).toContain(
      "[clerk-ios/Examples/Quickstart](https://github.com/clerk/clerk-ios/tree/trunk/Examples/Quickstart){{ lastUpdatedAt: '2026-09-19T10:00:00Z' }}",
    )
    expect(output).not.toContain('"kind"')
    expect(output).not.toContain('<Icon')
  })

  test('omits dates when GitHub metadata is unavailable', () => {
    const output = renderTemplatesPage([{ ...repository, examplePath: 'Examples' }])

    expect(output).toContain('https://github.com/clerk/clerk-example/tree/main/Examples')
    expect(output).not.toContain('lastUpdatedAt')
    expect(() => remark().use(remarkMdx).parse(output)).not.toThrow()
  })

  test('omits dates only for a repository GitHub could not resolve', () => {
    const other = { ...repository, name: 'clerk-other', repositoryUrl: 'https://github.com/clerk/clerk-other' }
    const output = renderTemplatesPage([repository, other], new Map([...metadata(repository.name), [other.name, null]]))

    expect(output).toContain(
      "[clerk-example](https://github.com/clerk/clerk-example){{ lastUpdatedAt: '2026-09-20T12:30:00Z' }}",
    )
    expect(output).toContain('[clerk-other](https://github.com/clerk/clerk-other)\n')
  })

  test('uses GITHUB_ACCESS_TOKEN on Vercel builds', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'template-build-test-'))
    const dataPath = path.join(directory, 'data')
    const distTempPath = path.join(directory, 'dist')
    await Promise.all([fs.mkdir(dataPath), fs.mkdir(distTempPath)])
    await fs.writeFile(path.join(dataPath, 'templates.json'), JSON.stringify([repository]))
    const fetch = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) => new Response(null, { status: 503 }),
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubEnv('GITHUB_ACCESS_TOKEN', 'vercel-token')
    vi.stubEnv('GITHUB_TOKEN', '')
    vi.stubGlobal('fetch', fetch)

    try {
      await generateTemplatesPage({ dataPath, distTempPath } as BuildConfig)
      expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: 'Bearer vercel-token' })
    } finally {
      vi.unstubAllEnvs()
      vi.unstubAllGlobals()
      warn.mockRestore()
      await fs.rm(directory, { recursive: true, force: true })
    }
  })

  test('fails a Vercel build without a GitHub token', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'template-build-test-'))
    const dataPath = path.join(directory, 'data')
    const distTempPath = path.join(directory, 'dist')
    await Promise.all([fs.mkdir(dataPath), fs.mkdir(distTempPath)])
    await fs.writeFile(path.join(dataPath, 'templates.json'), JSON.stringify([repository]))
    vi.stubEnv('VERCEL', '1')
    vi.stubEnv('GITHUB_ACCESS_TOKEN', '')
    vi.stubEnv('GITHUB_TOKEN', '')

    try {
      await expect(generateTemplatesPage({ dataPath, distTempPath } as BuildConfig)).rejects.toThrow(
        'GITHUB_ACCESS_TOKEN is required',
      )
    } finally {
      vi.unstubAllEnvs()
      await fs.rm(directory, { recursive: true, force: true })
    }
  })

  test('fails a Vercel build when GitHub rejects the token', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'template-build-test-'))
    const dataPath = path.join(directory, 'data')
    const distTempPath = path.join(directory, 'dist')
    await Promise.all([fs.mkdir(dataPath), fs.mkdir(distTempPath)])
    await fs.writeFile(path.join(dataPath, 'templates.json'), JSON.stringify([repository]))
    vi.stubEnv('VERCEL', '1')
    vi.stubEnv('GITHUB_ACCESS_TOKEN', 'revoked-token')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 401 })),
    )

    try {
      await expect(generateTemplatesPage({ dataPath, distTempPath } as BuildConfig)).rejects.toThrow('401')
    } finally {
      vi.unstubAllEnvs()
      vi.unstubAllGlobals()
      await fs.rm(directory, { recursive: true, force: true })
    }
  })

  test('still generates the page when GitHub fails during the build', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'template-build-test-'))
    const dataPath = path.join(directory, 'data')
    const distTempPath = path.join(directory, 'dist')
    await Promise.all([fs.mkdir(dataPath), fs.mkdir(distTempPath)])
    await fs.writeFile(path.join(dataPath, 'templates.json'), JSON.stringify([repository]))
    const fetch = vi.fn(async () => new Response(null, { status: 503 }))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubEnv('GITHUB_TOKEN', 'test-token')
    vi.stubGlobal('fetch', fetch)

    try {
      const page = await generateTemplatesPage({ dataPath, distTempPath } as BuildConfig)
      expect(fetch).toHaveBeenCalledTimes(2)
      expect(page?.content).toContain('clerk-example')
      expect(page?.content).not.toContain('lastUpdatedAt')
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('building without dates'))
    } finally {
      vi.unstubAllEnvs()
      vi.unstubAllGlobals()
      warn.mockRestore()
      await fs.rm(directory, { recursive: true, force: true })
    }
  })
})
