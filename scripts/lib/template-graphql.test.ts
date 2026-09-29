import { describe, expect, test, vi } from 'vitest'
import { fetchTemplateMetadata, TemplateGitHubAuthError } from './template-graphql'

const repositories = [
  {
    name: 'clerk-ios',
    repositoryUrl: 'https://github.com/clerk/clerk-ios',
    description: 'iOS examples.',
    examplePath: 'Examples',
    additionalExamples: [{ path: 'Examples/Quickstart', description: 'An iOS quickstart.' }],
    docsUrl: null,
  },
  {
    name: 'clerk-electron-quickstart',
    repositoryUrl: 'https://github.com/clerk/clerk-electron-quickstart',
    description: 'An Electron quickstart.',
    docsUrl: null,
  },
]

const githubData = {
  data: {
    repo0: {
      url: 'https://github.com/clerk/clerk-ios',
      isArchived: false,
      isDisabled: false,
      isPrivate: false,
      object0: { __typename: 'Tree' },
      object1: { __typename: 'Tree' },
      defaultBranchRef: {
        name: 'develop',
        target: {
          committedDate: '2026-09-20T12:30:00Z',
          example0: { nodes: [{ committedDate: '2026-09-18T12:30:00Z' }] },
          example1: { nodes: [{ committedDate: '2026-09-19T12:30:00Z' }] },
        },
      },
    },
    repo1: {
      url: 'https://github.com/clerk/clerk-electron-quickstart',
      isArchived: false,
      isDisabled: false,
      isPrivate: false,
      defaultBranchRef: { name: 'main', target: { committedDate: '2026-09-16T18:22:50Z' } },
    },
  },
}

const respond = (body: unknown) =>
  vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(body)))

describe('fetchTemplateMetadata', () => {
  test('skips GitHub when there is no token', async () => {
    const fetch = vi.fn()
    await expect(fetchTemplateMetadata(repositories, { fetch })).resolves.toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  test('gets default branches, path-specific dates, and directory checks for the catalog in one request', async () => {
    const fetch = respond(githubData)
    const metadata = await fetchTemplateMetadata(repositories, { fetch, token: 'test-token' })

    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('https://api.github.com/graphql')
    expect(init?.method).toBe('POST')
    const query = JSON.parse(init?.body as string).query as string
    expect(query).toContain('repo0: repository(owner: "clerk", name: "clerk-ios")')
    expect(query).toContain('repo1: repository(owner: "clerk", name: "clerk-electron-quickstart")')
    expect(query).toContain('example0: history(first: 1, path: "Examples")')
    expect(query).toContain('example1: history(first: 1, path: "Examples/Quickstart")')
    expect(query).toContain('object1: object(expression: "HEAD:Examples/Quickstart")')
    expect(metadata?.get('clerk-ios')).toMatchObject({
      defaultBranch: 'develop',
      lastUpdatedAt: '2026-09-20T12:30:00Z',
      exampleDates: {
        Examples: '2026-09-18T12:30:00Z',
        'Examples/Quickstart': '2026-09-19T12:30:00Z',
      },
      missingExamples: [],
    })
    expect(metadata?.get('clerk-electron-quickstart')?.lastUpdatedAt).toBe('2026-09-16T18:22:50Z')
  })

  test('keeps the rest of the catalog when GitHub cannot resolve one repository', async () => {
    const fetch = respond({
      data: { ...githubData.data, repo0: null },
      errors: [
        {
          type: 'NOT_FOUND',
          path: ['repo0'],
          message: "Could not resolve to a Repository with the name 'clerk/clerk-ios'.",
        },
      ],
    })
    const metadata = await fetchTemplateMetadata(repositories, { fetch, token: 'test-token' })

    expect(metadata?.get('clerk-ios')).toBeNull()
    expect(metadata?.get('clerk-electron-quickstart')?.lastUpdatedAt).toBe('2026-09-16T18:22:50Z')
  })

  test('reports a missing example directory and omits its date', async () => {
    const fetch = respond({
      data: {
        ...githubData.data,
        repo0: {
          ...githubData.data.repo0,
          object1: null,
          defaultBranchRef: {
            ...githubData.data.repo0.defaultBranchRef,
            target: { ...githubData.data.repo0.defaultBranchRef.target, example1: { nodes: [] } },
          },
        },
      },
    })
    const metadata = await fetchTemplateMetadata(repositories, { fetch, token: 'test-token' })

    expect(metadata?.get('clerk-ios')).toMatchObject({
      exampleDates: { Examples: '2026-09-18T12:30:00Z' },
      missingExamples: ['Examples/Quickstart'],
    })
  })

  test('omits an invalid commit date', async () => {
    const fetch = respond({
      data: {
        ...githubData.data,
        repo1: {
          ...githubData.data.repo1,
          defaultBranchRef: { name: 'main', target: { committedDate: '2026-02-31T12:30:00Z' } },
        },
      },
    })
    const metadata = await fetchTemplateMetadata(repositories, { fetch, token: 'test-token' })

    expect(metadata?.get('clerk-electron-quickstart')).toMatchObject({ defaultBranch: 'main' })
    expect(metadata?.get('clerk-electron-quickstart')?.lastUpdatedAt).toBeUndefined()
  })

  test('retries a failed request once', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(githubData)))
    const metadata = await fetchTemplateMetadata(repositories, { fetch, token: 'test-token', retryDelayMs: 0 })

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(metadata?.get('clerk-electron-quickstart')?.lastUpdatedAt).toBe('2026-09-16T18:22:50Z')
  })

  test('rejects a revoked or expired token without retrying', async () => {
    const unauthorized = vi.fn(async () => new Response(null, { status: 401 }))
    await expect(
      fetchTemplateMetadata(repositories, { fetch: unauthorized, token: 'test-token', retryDelayMs: 0 }),
    ).rejects.toBeInstanceOf(TemplateGitHubAuthError)
    expect(unauthorized).toHaveBeenCalledTimes(1)
  })

  test('rejects when the retry also fails', async () => {
    const unavailable = vi.fn(async () => new Response(null, { status: 503 }))
    await expect(
      fetchTemplateMetadata(repositories, { fetch: unavailable, token: 'test-token', retryDelayMs: 0 }),
    ).rejects.toThrow('GitHub GraphQL returned 503')
    expect(unavailable).toHaveBeenCalledTimes(2)
  })
})
