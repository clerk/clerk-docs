import type { TemplateRepository } from './templates'

export interface TemplateGitHubMetadata {
  url: string
  defaultBranch: string
  lastUpdatedAt?: string
  exampleDates: Record<string, string>
  missingExamples: string[]
  archived: boolean
  disabled: boolean
  private: boolean
}

const REQUEST_TIMEOUT_MS = 30_000
const RETRY_DELAY_MS = 500

// A revoked or expired token is a configuration error, not a temporary GitHub failure.
export class TemplateGitHubAuthError extends Error {}

// Vercel builds get GITHUB_ACCESS_TOKEN; GitHub Actions and local shells use GITHUB_TOKEN.
export const templateGitHubToken = () => process.env.GITHUB_ACCESS_TOKEN || process.env.GITHUB_TOKEN || undefined

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && Array.isArray(value) === false

const examplePaths = (repository: TemplateRepository) => [
  ...(repository.examplePath ? [repository.examplePath] : []),
  ...(repository.additionalExamples ?? []).map((example) => example.path),
]

function readDate(value: unknown) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return undefined
  const normalized = new Date(value).toISOString()
  if (value !== normalized && value !== normalized.replace('.000Z', 'Z')) return undefined
  return normalized.replace('.000Z', 'Z')
}

function buildTemplateMetadataQuery(repositories: TemplateRepository[]) {
  const fields = repositories.map((repository, index) => {
    const paths = examplePaths(repository)
    const histories = paths
      .map(
        (examplePath, pathIndex) =>
          `example${pathIndex}: history(first: 1, path: ${JSON.stringify(examplePath)}) { nodes { committedDate } }`,
      )
      .join('\n')
    const objects = paths
      .map(
        (examplePath, pathIndex) =>
          `object${pathIndex}: object(expression: ${JSON.stringify(`HEAD:${examplePath}`)}) { __typename }`,
      )
      .join('\n')

    return `repo${index}: repository(owner: "clerk", name: ${JSON.stringify(repository.name)}) {
      url
      isArchived
      isDisabled
      isPrivate
      ${objects}
      defaultBranchRef {
        name
        target { ... on Commit { committedDate ${histories} } }
      }
    }`
  })

  return `query TemplateMetadata { ${fields.join('\n')} }`
}

function readRepository(repository: TemplateRepository, remote: unknown): TemplateGitHubMetadata | null {
  if (!isRecord(remote) || !isRecord(remote.defaultBranchRef) || !isRecord(remote.defaultBranchRef.target)) return null
  const branch = remote.defaultBranchRef.name
  const target = remote.defaultBranchRef.target
  if (
    typeof remote.url !== 'string' ||
    typeof branch !== 'string' ||
    branch === '' ||
    typeof remote.isArchived !== 'boolean' ||
    typeof remote.isDisabled !== 'boolean' ||
    typeof remote.isPrivate !== 'boolean'
  ) {
    return null
  }

  const exampleDates: Record<string, string> = {}
  const missingExamples: string[] = []
  for (const [pathIndex, examplePath] of examplePaths(repository).entries()) {
    const object = remote[`object${pathIndex}`]
    if (!isRecord(object) || object.__typename !== 'Tree') missingExamples.push(examplePath)

    const history = target[`example${pathIndex}`]
    const date = isRecord(history) && Array.isArray(history.nodes) ? history.nodes[0]?.committedDate : undefined
    const lastUpdatedAt = readDate(date)
    if (lastUpdatedAt) exampleDates[examplePath] = lastUpdatedAt
  }

  return {
    url: remote.url,
    defaultBranch: branch,
    lastUpdatedAt: readDate(target.committedDate),
    exampleDates,
    missingExamples,
    archived: remote.isArchived,
    disabled: remote.isDisabled,
    private: remote.isPrivate,
  }
}

async function requestTemplateMetadata(
  repositories: TemplateRepository[],
  options: { fetch?: typeof fetch; token: string },
) {
  const response = await (options.fetch ?? fetch)('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${options.token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'clerk-docs-templates',
    },
    body: JSON.stringify({ query: buildTemplateMetadataQuery(repositories) }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (response.status === 401) {
    throw new TemplateGitHubAuthError('GitHub GraphQL returned 401; the token is expired, revoked, or invalid')
  }
  if (!response.ok) throw new Error(`GitHub GraphQL returned ${response.status} ${response.statusText}`)

  // GraphQL returns partial data alongside per-repository errors, such as NOT_FOUND for a deleted repository.
  const payload: unknown = await response.json()
  if (!isRecord(payload) || !isRecord(payload.data)) {
    throw new Error('GitHub GraphQL returned an error or invalid data')
  }

  const data = payload.data
  return new Map(
    repositories.map((repository, index) => [repository.name, readRepository(repository, data[`repo${index}`])]),
  )
}

// Returns null without a token. A repository GitHub can't resolve maps to null, so one bad entry doesn't drop the
// rest of the catalog's data. A failed request is retried once before it throws, except a rejected token.
export async function fetchTemplateMetadata(
  repositories: TemplateRepository[],
  options: { fetch?: typeof fetch; token?: string; retryDelayMs?: number } = {},
): Promise<Map<string, TemplateGitHubMetadata | null> | null> {
  const token = options.token
  if (!token) return null

  try {
    return await requestTemplateMetadata(repositories, { fetch: options.fetch, token })
  } catch (error) {
    if (error instanceof TemplateGitHubAuthError) throw error
    await new Promise((resolve) => setTimeout(resolve, options.retryDelayMs ?? RETRY_DELAY_MS))
    return requestTemplateMetadata(repositories, { fetch: options.fetch, token })
  }
}
