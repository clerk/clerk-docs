import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchTemplateMetadata, templateGitHubToken, type TemplateGitHubMetadata } from './lib/template-graphql'
import { readTemplateRepositories, type TemplateRepository } from './lib/templates'

type Fetch = typeof fetch

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const dataPath = path.join(scriptDirectory, '..', 'data')

export function templateRepositoryIssues(repository: TemplateRepository, remote: TemplateGitHubMetadata | null) {
  if (remote === null) return ['GitHub returned no repository (deleted, private, or otherwise inaccessible)']

  const issues: string[] = []
  if (remote.url !== repository.repositoryUrl) issues.push(`repository was renamed or transferred to ${remote.url}`)
  if (remote.private) issues.push('repository is not public')
  if (remote.archived) issues.push('repository is archived')
  if (remote.disabled) issues.push('repository is disabled')
  for (const examplePath of remote.missingExamples) {
    issues.push(`examplePath ${examplePath} is not a directory on ${remote.defaultBranch}`)
  }

  return issues
}

export async function checkTemplateRepositories(
  repositories: TemplateRepository[],
  options: { fetch?: Fetch; token?: string } = {},
) {
  const token = options.token ?? templateGitHubToken()
  requireGitHubToken(token)
  const metadata = await fetchTemplateMetadata(repositories, { fetch: options.fetch, token })

  const errors = repositories.flatMap((repository) =>
    templateRepositoryIssues(repository, metadata?.get(repository.name) ?? null).map(
      (issue) => `${repository.name}: ${issue}`,
    ),
  )
  if (errors.length > 0) throw new Error(`Template repository check failed:\n- ${errors.join('\n- ')}`)

  return repositories
}

export function requireGitHubToken(token = templateGitHubToken()) {
  if (!token) {
    throw new Error(
      'GITHUB_TOKEN is required for template repository checks. Run `GITHUB_TOKEN="$(gh auth token)" pnpm templates:check` or set GITHUB_TOKEN in your shell.',
    )
  }
}

async function main() {
  requireGitHubToken()

  const repositories = await readTemplateRepositories(dataPath)
  await checkTemplateRepositories(repositories)
  console.info(`Validated ${repositories.length} public template repositories`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
