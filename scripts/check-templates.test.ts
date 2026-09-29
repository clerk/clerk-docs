import { describe, expect, test, vi } from 'vitest'
import { checkTemplateRepositories, requireGitHubToken } from './check-templates'

const repository = {
  name: 'clerk-example',
  repositoryUrl: 'https://github.com/clerk/clerk-example',
  description: 'An example application.',
  docsUrl: null,
}

const exampleRepository = {
  ...repository,
  name: 'clerk-ios',
  repositoryUrl: 'https://github.com/clerk/clerk-ios',
  examplePath: 'Examples',
  description: 'iOS examples.',
  additionalExamples: [{ path: 'Examples/Quickstart', description: 'An iOS quickstart.' }],
}

const remote = (overrides: Record<string, unknown> = {}) => ({
  url: repository.repositoryUrl,
  isArchived: false,
  isDisabled: false,
  isPrivate: false,
  defaultBranchRef: { name: 'main', target: { committedDate: '2026-09-20T12:30:00Z' } },
  ...overrides,
})

const respond = (data: Record<string, unknown>) =>
  vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ data })))

const check = (repositories: Parameters<typeof checkTemplateRepositories>[0], fetch: typeof globalThis.fetch) =>
  checkTemplateRepositories(repositories, { fetch, token: 'test-token' })

describe('checkTemplateRepositories', () => {
  test('accepts a public repository in one GraphQL request', async () => {
    const fetch = respond({ repo0: remote() })

    await expect(check([repository], fetch)).resolves.toEqual([repository])
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0]?.[0]).toBe('https://api.github.com/graphql')
  })

  test('reports a timed-out GitHub request', async () => {
    const fetch = vi.fn(async () => {
      throw new DOMException('The operation timed out', 'TimeoutError')
    })

    await expect(check([repository], fetch)).rejects.toThrow('The operation timed out')
  })

  test('rejects archived, disabled, and private repositories', async () => {
    const fetch = respond({ repo0: remote({ isArchived: true, isDisabled: true, isPrivate: true }) })

    await expect(check([repository], fetch)).rejects.toThrow(
      /clerk-example: repository is not public\n- clerk-example: repository is archived\n- clerk-example: repository is disabled/,
    )
  })

  test('rejects a renamed or transferred repository', async () => {
    const fetch = respond({ repo0: remote({ url: 'https://github.com/clerk/clerk-renamed' }) })

    await expect(check([repository], fetch)).rejects.toThrow(
      'clerk-example: repository was renamed or transferred to https://github.com/clerk/clerk-renamed',
    )
  })

  test('rejects a repository GitHub cannot resolve', async () => {
    const fetch = respond({ repo0: null })

    await expect(check([repository], fetch)).rejects.toThrow(
      'clerk-example: GitHub returned no repository (deleted, private, or otherwise inaccessible)',
    )
  })

  test('accepts example directories that exist on the default branch', async () => {
    const fetch = respond({
      repo0: remote({
        url: exampleRepository.repositoryUrl,
        object0: { __typename: 'Tree' },
        object1: { __typename: 'Tree' },
      }),
    })

    await expect(check([exampleRepository], fetch)).resolves.toEqual([exampleRepository])
    const query = JSON.parse(fetch.mock.calls[0]?.[1]?.body as string).query as string
    expect(query).toContain('object0: object(expression: "HEAD:Examples")')
    expect(query).toContain('object1: object(expression: "HEAD:Examples/Quickstart")')
  })

  test('rejects a missing or non-directory example path', async () => {
    const fetch = respond({
      repo0: remote({
        url: exampleRepository.repositoryUrl,
        defaultBranchRef: { name: 'develop', target: { committedDate: '2026-09-20T12:30:00Z' } },
        object0: { __typename: 'Blob' },
        object1: null,
      }),
    })

    await expect(check([exampleRepository], fetch)).rejects.toThrow(
      /clerk-ios: examplePath Examples is not a directory on develop\n- clerk-ios: examplePath Examples\/Quickstart is not a directory on develop/,
    )
  })

  test('allows an old but available repository', async () => {
    const fetch = respond({
      repo0: remote({ defaultBranchRef: { name: 'main', target: { committedDate: '2020-01-01T00:00:00Z' } } }),
    })

    await expect(check([repository], fetch)).resolves.toEqual([repository])
  })
})

describe('requireGitHubToken', () => {
  test('fails with an actionable command when no token is available', () => {
    expect(() => requireGitHubToken(undefined)).toThrow(
      'GITHUB_TOKEN is required for template repository checks. Run `GITHUB_TOKEN="$(gh auth token)" pnpm templates:check`',
    )
  })

  test('accepts an available token', () => {
    expect(() => requireGitHubToken('test-token')).not.toThrow()
  })
})
