/**
 * PR / branch migration only: run from your clerk-docs feature branch (not main).
 * Merges origin/main, rewrites clerk-docs history under clerk/clerk-docs/, merges that history into a clerk branch (preserving authors per imported commit), pushes and opens a PR only if an open clerk-docs PR exists, then comments that source PR.
 * No repo-wide bootstrap or multi-branch orchestration.
 */
import { existsSync, lstatSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'step'
type Json = Record<string, unknown>

interface CliConfig {
  /** If set, use this existing clone instead of cloning clerk to a temp directory */
  clerkPath?: string
  clerkDocsPath: string
  /** Branch in clerk (see --clerk-repo) to check out and open the new PR against; default main */
  clerkBaseBranch: string
  dryRun: boolean
  autoApprove: boolean
  debug: boolean
  clerkRepo: string
  clerkDocsRepo: string
  /** When several open PRs share the same head, use this PR number (required with --yes if ambiguous) */
  prNumber?: number
}

interface CommandResult {
  code: number
  stdout: string
  stderr: string
}

interface PullRequestView {
  number: number
  title: string
  body: string
  baseRefName: string
  headRefName: string
  url: string
  isDraft: boolean
}

/** `gh pr view --json` subset for copying people + review context to the clerk PR */
interface GhPrViewForMigration {
  url: string
  isDraft: boolean
  assignees: Array<{ login?: string }>
  reviewRequests: Array<{ __typename?: string; login?: string; slug?: string }>
  latestReviews: Array<{ author?: { login?: string }; state?: string }>
  reviewDecision: string
}

interface SourcePrMigrationMetadata {
  url: string
  isDraft: boolean
  assigneeLogins: string[]
  reviewerHandles: string[]
  reviewDecision: string
  latestReviewRows: Array<{ login: string; state: string }>
}

const TARGET_DIR_IN_CLERK = 'clerk-docs'
/** Temp `gh repo clone` of clerk: only baseRef snapshot + merge/push; full history not needed. */
const CLERK_TEMP_CLONE_DEPTH = 1
/**
 * Partial clone: skip downloading file blobs until Git needs them (smaller/faster initial clone).
 * Merge + push still require the full tree at `baseRef` eventually, so blobs may stream in during merge.
 */
const CLERK_TEMP_CLONE_FILTER_BLOB_NONE = true
const SYNC_BOT_HINT = 'sync'
const MIGRATION_NOTICE_MARKER = '[clerk-docs-migration-notice]'
const MIN_TOOL_VERSIONS = {
  git: '2.39.0',
  gh: '2.40.0',
  gitFilterRepo: '2.38.0',
} as const

class Logger {
  private readonly debugEnabled: boolean

  public constructor(debugEnabled: boolean) {
    this.debugEnabled = debugEnabled
  }

  public log(level: LogLevel, message: string, meta?: Json): void {
    if (level === 'debug' && !this.debugEnabled) return
    const ts = new Date().toISOString()
    const prefix = `[migration][${ts}][${level.toUpperCase()}]`
    console.log(`${prefix} ${message}`)
    if (meta) console.log(`${prefix} META ${JSON.stringify(meta, null, 2)}`)
  }
  public debug(message: string, meta?: Json): void {
    this.log('debug', message, meta)
  }
  public info(message: string, meta?: Json): void {
    this.log('info', message, meta)
  }
  public warn(message: string, meta?: Json): void {
    this.log('warn', message, meta)
  }
  public error(message: string, meta?: Json): void {
    this.log('error', message, meta)
  }
  public step(message: string, meta?: Json): void {
    this.log('step', message, meta)
  }
}

function printHelp(): void {
  console.log(`
Usage:
  tsx ./scripts/migrate-clerk-docs-to-clerk.ts [options]

Run from your clerk-docs feature branch (not main). Migrates that branch into clerk under ${TARGET_DIR_IN_CLERK}/.

By default clones the clerk repo (see --clerk-repo) into a temp directory (needs gh auth with push access). Use --clerk-path for an existing local clone instead.

Optional:
  --clerk-path <path>         Existing local clerk clone (skips temp clone; expects ${TARGET_DIR_IN_CLERK} symlink as today)
  --clerk-docs-path <path>     clerk-docs repo (default: cwd)
  --clerk-repo <owner/repo>   Target PR repo (default: clerk/clerk)
  --clerk-docs-repo <o/r>     Source PR lookup (default: clerk/clerk-docs)
  --clerk-base <branch>       Branch in clerk to base the new PR on (default: main)
  --dry-run                   Print actions only
  --yes                       Skip checkpoint prompts (with multiple PRs for this head, pass --pr)
  --pr <number>              Open clerk-docs PR to use for title/body/comment when several match this branch
  --debug                     Verbose logs
  --help
`)
}

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag)
  if (idx === -1) return undefined
  const value = process.argv[idx + 1]
  if (!value || value.startsWith('--')) return undefined
  return value
}
function hasFlag(flag: string): boolean {
  return process.argv.includes(flag)
}
/** Avoid slashes in temp directory names (branch names like foo/bar are common). */
function sanitizeBranchForPath(branch: string): string {
  return branch.replace(/[/\\]/g, '-')
}

/**
 * Root .gitignore lines that hid the symlinked clerk-docs tree during the sync workflow.
 * After migration, `clerk-docs/` is a normal tracked directory.
 */
function lineIgnoresSymlinkedClerkDocsRoot(line: string): boolean {
  const beforeComment = line.split('#')[0]?.trim() ?? ''
  if (!beforeComment) return false
  return beforeComment === '/clerk-docs' || beforeComment === 'clerk-docs' || beforeComment === 'clerk-docs/'
}

async function stripClerkDocsRootGitignoreEntries(logger: Logger, clerkWorkPath: string): Promise<boolean> {
  const gitignorePath = path.join(clerkWorkPath, '.gitignore')
  if (!existsSync(gitignorePath)) {
    logger.debug('No root .gitignore; skipping clerk-docs ignore cleanup', { clerkWorkPath })
    return false
  }
  const raw = await fs.readFile(gitignorePath, 'utf8')
  const lines = raw.split(/\r?\n/)
  const kept: string[] = []
  let removed = 0
  for (const line of lines) {
    if (lineIgnoresSymlinkedClerkDocsRoot(line)) {
      removed++
      continue
    }
    kept.push(line)
  }
  if (removed === 0) return false
  const out = kept.join('\n') + (raw.endsWith('\n') ? '\n' : '')
  await fs.writeFile(gitignorePath, out, 'utf8')
  logger.info('Removed symlink-era clerk-docs rules from root .gitignore', { linesRemoved: removed })
  return true
}

function expandHome(input: string): string {
  if (!input.startsWith('~/')) return input
  return process.env.HOME ? path.join(process.env.HOME, input.slice(2)) : input
}

function parseConfig(): CliConfig {
  if (hasFlag('--help')) {
    printHelp()
    process.exit(0)
  }

  const clerkPathArg = getArg('--clerk-path')
  const prArg = getArg('--pr')
  const cwd = process.cwd()
  let prNumber: number | undefined
  if (prArg !== undefined) {
    const n = Number.parseInt(prArg, 10)
    if (!Number.isFinite(n) || n < 1) throw new Error('--pr must be a positive integer (GitHub PR number)')
    prNumber = n
  }
  return {
    clerkPath: clerkPathArg ? path.resolve(expandHome(clerkPathArg)) : undefined,
    clerkDocsPath: path.resolve(expandHome(getArg('--clerk-docs-path') ?? cwd)),
    clerkBaseBranch: getArg('--clerk-base') ?? 'main',
    dryRun: hasFlag('--dry-run'),
    autoApprove: hasFlag('--yes'),
    debug: hasFlag('--debug'),
    clerkRepo: getArg('--clerk-repo') ?? 'clerk/clerk',
    clerkDocsRepo: getArg('--clerk-docs-repo') ?? 'clerk/clerk-docs',
    prNumber,
  }
}

async function checkpoint(
  logger: Logger,
  config: CliConfig,
  details: { title: string; completed: string[]; next: string },
): Promise<void> {
  logger.step(`Checkpoint: ${details.title}`)
  logger.info('Completed in this phase', { completed: details.completed })
  logger.info('Next planned action', { next: details.next })
  if (config.autoApprove) return logger.info('Auto-approved due to --yes.')
  const rl = readline.createInterface({ input, output })
  try {
    const answer = (await rl.question('Continue? (y/N): ')).trim().toLowerCase()
    if (answer !== 'y' && answer !== 'yes') throw new Error('Stopped by user at checkpoint.')
  } finally {
    rl.close()
  }
}

async function promptPickSourcePr(logger: Logger, list: PullRequestView[]): Promise<PullRequestView> {
  output.write('\nMultiple open PRs use this branch. Pick one for title/body and the backlink comment:\n')
  for (const pr of list) {
    const draftTag = pr.isDraft ? ' [draft]' : ''
    output.write(`  #${pr.number}  base=${pr.baseRefName}${draftTag}  ${pr.title}\n     ${pr.url}\n`)
  }
  const rl = readline.createInterface({ input, output })
  try {
    for (;;) {
      const raw = (await rl.question('Enter PR number: ')).trim()
      const n = Number.parseInt(raw, 10)
      if (!Number.isFinite(n)) {
        output.write('Please enter a numeric PR number.\n')
        continue
      }
      const picked = list.find(pr => pr.number === n)
      if (!picked) {
        output.write(`No matching PR in the list. Choose one of: ${list.map(p => p.number).join(', ')}\n`)
        continue
      }
      logger.info('User selected clerk-docs PR', { number: picked.number })
      return picked
    }
  } finally {
    rl.close()
  }
}

function reviewRequestToHandle(req: { __typename?: string; login?: string; slug?: string }): string | null {
  if (req.__typename === 'User' && req.login) return req.login
  if (req.__typename === 'Team' && req.slug) return req.slug
  return null
}

function parseGhPrViewForMigration(raw: GhPrViewForMigration): SourcePrMigrationMetadata {
  const assigneeLogins = (raw.assignees ?? []).map(a => a.login).filter((l): l is string => Boolean(l))
  const reviewerHandles = (raw.reviewRequests ?? []).map(reviewRequestToHandle).filter((h): h is string => Boolean(h))
  const latestReviewRows = (raw.latestReviews ?? []).map(r => ({
    login: r.author?.login ?? '(unknown)',
    state: r.state ?? 'UNKNOWN',
  }))
  return {
    url: raw.url,
    isDraft: Boolean(raw.isDraft),
    assigneeLogins,
    reviewerHandles,
    reviewDecision: raw.reviewDecision ?? '',
    latestReviewRows,
  }
}

async function fetchSourcePrMigrationMetadata(
  logger: Logger,
  clerkDocsRepo: string,
  prNumber: number,
): Promise<SourcePrMigrationMetadata | null> {
  try {
    const raw = await commandJson<GhPrViewForMigration>(
      logger,
      'gh',
      [
        'pr',
        'view',
        String(prNumber),
        '--repo',
        clerkDocsRepo,
        '--json',
        'url,isDraft,assignees,reviewRequests,latestReviews,reviewDecision',
      ],
      process.cwd(),
    )
    return parseGhPrViewForMigration(raw)
  } catch (error) {
    logger.warn('Could not load source PR metadata (assignees/reviewers/reviews)', {
      prNumber,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

function formatSourcePrMigrationAppendix(meta: SourcePrMigrationMetadata): string {
  const assigneeLine = meta.assigneeLogins.length > 0 ? meta.assigneeLogins.map(l => `@${l}`).join(', ') : '—'
  const reviewerLine = meta.reviewerHandles.length > 0 ? meta.reviewerHandles.join(', ') : '—'
  const decisionLine = meta.reviewDecision.trim() || '—'
  const reviewLines =
    meta.latestReviewRows.length > 0
      ? meta.latestReviewRows.map(r => `  - @${r.login}: **${r.state}**`).join('\n')
      : '  —'

  return [
    '',
    '---',
    '<details>',
    '<summary>Source clerk-docs PR (reviewers, assignees, review state)</summary>',
    '',
    `Source PR: ${meta.url}`,
    '',
    `- **Draft (source):** ${meta.isDraft ? 'yes' : 'no'}`,
    `- **Review decision (source):** ${decisionLine}`,
    `- **Assignees (source):** ${assigneeLine}`,
    `- **Requested reviewers (source):** ${reviewerLine}`,
    '- **Latest reviews (source; GitHub does not transfer approvals to this repo):**',
    reviewLines,
    '',
    '</details>',
    '',
  ].join('\n')
}

async function createClerkPullRequestWithPeople(
  logger: Logger,
  config: CliConfig,
  params: {
    baseRef: string
    head: string
    title: string
    body: string
    isDraft: boolean
    assigneeLogins: string[]
    reviewerHandles: string[]
  },
): Promise<string> {
  const { baseRef, head, title, body, isDraft, assigneeLogins, reviewerHandles } = params

  const buildArgs = (includePeople: boolean): string[] => {
    const args = [
      'pr',
      'create',
      '--repo',
      config.clerkRepo,
      '--base',
      baseRef,
      '--head',
      head,
      '--title',
      title,
      '--body',
      body,
    ]
    if (isDraft) args.push('--draft')
    if (includePeople) {
      for (const login of assigneeLogins) {
        args.push('--assignee', login)
      }
      for (const handle of reviewerHandles) {
        args.push('--reviewer', handle)
      }
    }
    return args
  }

  const hasPeople = assigneeLogins.length > 0 || reviewerHandles.length > 0
  if (!hasPeople) {
    return (await runCommand(logger, 'gh', buildArgs(false), process.cwd())).stdout.trim()
  }

  const withPeople = await runCommand(logger, 'gh', buildArgs(true), process.cwd(), { allowFailure: true })
  if (withPeople.code === 0) return withPeople.stdout.trim()

  logger.warn('gh pr create with assignees/reviewers failed; retrying without (metadata still in PR body)', {
    stderr: (withPeople.stderr + withPeople.stdout).trim(),
  })
  return (await runCommand(logger, 'gh', buildArgs(false), process.cwd())).stdout.trim()
}

type RunCommandOptions = { allowFailure?: boolean; inheritStdio?: boolean }

async function runCommand(
  logger: Logger,
  command: string,
  args: string[],
  cwd: string,
  options?: RunCommandOptions,
): Promise<CommandResult> {
  if (options?.inheritStdio) {
    logger.info('Running (live output below; large repos may take several minutes)', { command, args, cwd })
  } else {
    logger.debug('Executing command', { command, args, cwd })
  }
  return await new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let settled = false

    const tryFinish = (result: CommandResult): void => {
      if (settled) return
      settled = true
      if (result.code !== 0 && !options?.allowFailure) {
        const detail = options?.inheritStdio
          ? `exit ${result.code}`
          : (result.stdout + result.stderr).trim()
        reject(new Error(`Command failed (${command} ${args.join(' ')}): ${detail}`))
        return
      }
      resolve(result)
    }

    if (options?.inheritStdio) {
      const child = spawn(command, args, { cwd, env: process.env, stdio: 'inherit' })
      child.on('error', err => {
        if (settled) return
        const msg = err instanceof Error ? err.message : String(err)
        if (options?.allowFailure) {
          logger.debug('Spawn error treated as failed command', { command, message: msg })
          tryFinish({ code: 127, stdout: '', stderr: msg })
          return
        }
        settled = true
        reject(err)
      })
      child.on('close', code => {
        tryFinish({ code: code === null || code === undefined ? 1 : code, stdout: '', stderr: '' })
      })
      return
    }

    const child = spawn(command, args, { cwd, env: process.env })
    child.stdout.on('data', chunk => {
      const text = chunk.toString()
      stdout += text
      logger.debug('Command stdout chunk', { command, chunk: text.trim() })
    })
    child.stderr.on('data', chunk => {
      const text = chunk.toString()
      stderr += text
      logger.debug('Command stderr chunk', { command, chunk: text.trim() })
    })
    child.on('error', err => {
      if (settled) return
      const msg = err instanceof Error ? err.message : String(err)
      if (options?.allowFailure) {
        logger.debug('Spawn error treated as failed command', { command, message: msg })
        tryFinish({ code: 127, stdout, stderr: stderr ? `${stderr}\n${msg}` : msg })
        return
      }
      settled = true
      reject(err)
    })
    child.on('close', code => {
      tryFinish({ code: code === null || code === undefined ? 1 : code, stdout, stderr })
    })
  })
}

async function commandJson<T>(logger: Logger, command: string, args: string[], cwd: string): Promise<T> {
  const result = await runCommand(logger, command, args, cwd)
  try {
    return JSON.parse(result.stdout) as T
  } catch {
    throw new Error(`Failed parsing JSON from ${command} ${args.join(' ')}`)
  }
}

async function assertCommandAvailable(logger: Logger, command: string, args: string[] = ['--version']): Promise<void> {
  logger.step(`Checking dependency: ${command}`)
  await runCommand(logger, command, args, process.cwd())
}

function parseSemverLoose(input: string): [number, number, number] | null {
  const match = input.match(/(\d+)\.(\d+)\.(\d+)/)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function isSemverAtLeast(actual: [number, number, number], minimum: [number, number, number]): boolean {
  for (let i = 0; i < 3; i += 1) {
    if (actual[i] > minimum[i]) return true
    if (actual[i] < minimum[i]) return false
  }
  return true
}

async function assertMinimumVersion(
  logger: Logger,
  label: string,
  command: string,
  args: string[],
  minimumVersion: string,
): Promise<void> {
  logger.step(`Checking ${label} minimum version`, { minimumVersion })
  const result = await runCommand(logger, command, args, process.cwd())
  assertSemverAtLeast(logger, label, `${result.stdout}\n${result.stderr}`, minimumVersion)
}

function assertSemverAtLeast(logger: Logger, label: string, rawOutput: string, minimumVersion: string): void {
  const raw = rawOutput.trim()
  const actualParsed = parseSemverLoose(raw)
  const minimumParsed = parseSemverLoose(minimumVersion)
  if (!actualParsed || !minimumParsed) {
    throw new Error(
      `${label} version could not be parsed. Raw output: "${raw}". Expected at least ${minimumVersion}.`,
    )
  }
  if (!isSemverAtLeast(actualParsed, minimumParsed)) {
    throw new Error(`${label} ${actualParsed.join('.')} is too old. Minimum supported is ${minimumVersion}.`)
  }
  logger.info(`${label} version check passed`, {
    detectedVersion: actualParsed.join('.'),
    minimumVersion,
  })
}

const GIT_FILTER_REPO_INSTALL_HINT = [
  'git-filter-repo is not installed or not on your PATH.',
  'Install it, then re-run:',
  '  macOS:   brew install git-filter-repo',
  '  pip:    pip install git-filter-repo   (or pipx install git-filter-repo)',
  'Docs:    https://github.com/newren/git-filter-repo/blob/main/INSTALL.md',
].join('\n')

/** How to invoke filter-repo: either `git filter-repo ...` or standalone `git-filter-repo ...`. */
interface GitFilterRepoInvoker {
  command: string
  argsPrefix: string[]
}

function assertGitFilterRepoVersionOutput(logger: Logger, label: string, rawOutput: string, minimumVersion: string): void {
  const raw = rawOutput.trim()
  const semverMatch = raw.match(/(\d+)\.(\d+)\.(\d+)/)
  if (semverMatch) {
    const actualParsed: [number, number, number] = [
      Number(semverMatch[1]),
      Number(semverMatch[2]),
      Number(semverMatch[3]),
    ]
    const minimumParsed = parseSemverLoose(minimumVersion)
    if (!minimumParsed) {
      throw new Error(`Invalid minimum version constant: ${minimumVersion}`)
    }
    if (!isSemverAtLeast(actualParsed, minimumParsed)) {
      throw new Error(`${label} ${actualParsed.join('.')} is too old. Minimum supported is ${minimumVersion}.`)
    }
    logger.info(`${label} version check passed`, {
      detectedVersion: actualParsed.join('.'),
      minimumVersion,
    })
    return
  }

  // Some installs (e.g. brew) print only a git short hash for `git filter-repo --version`.
  if (/^[0-9a-f]{7,40}$/i.test(raw)) {
    logger.warn(
      `${label} printed a build/commit id instead of semver; treating as installed (cannot verify >= ${minimumVersion})`,
      { raw },
    )
    return
  }

  throw new Error(
    `${label} version could not be parsed. Raw output: "${raw}". Expected semver like ${minimumVersion} or a git hash.`,
  )
}

async function resolveGitFilterRepoInvoker(logger: Logger): Promise<GitFilterRepoInvoker> {
  logger.step('Checking git-filter-repo (git filter-repo or git-filter-repo on PATH)')
  const asSub = await runCommand(logger, 'git', ['filter-repo', '--version'], process.cwd(), { allowFailure: true })
  if (asSub.code === 0) {
    assertGitFilterRepoVersionOutput(
      logger,
      'git-filter-repo (git subcommand)',
      `${asSub.stdout}\n${asSub.stderr}`,
      MIN_TOOL_VERSIONS.gitFilterRepo,
    )
    return { command: 'git', argsPrefix: ['filter-repo'] }
  }
  const standalone = await runCommand(logger, 'git-filter-repo', ['--version'], process.cwd(), { allowFailure: true })
  if (standalone.code === 0) {
    assertGitFilterRepoVersionOutput(
      logger,
      'git-filter-repo (standalone)',
      `${standalone.stdout}\n${standalone.stderr}`,
      MIN_TOOL_VERSIONS.gitFilterRepo,
    )
    return { command: 'git-filter-repo', argsPrefix: [] }
  }
  throw new Error(GIT_FILTER_REPO_INSTALL_HINT)
}

async function assertGitRepo(logger: Logger, repoPath: string, label: string): Promise<void> {
  logger.step(`Validating git repository for ${label}`, { repoPath })
  if (!existsSync(repoPath)) throw new Error(`${label} path does not exist: ${repoPath}`)
  await runCommand(logger, 'git', ['rev-parse', '--is-inside-work-tree'], repoPath)
}

async function getCurrentBranch(logger: Logger, repoPath: string): Promise<string> {
  return (await runCommand(logger, 'git', ['branch', '--show-current'], repoPath)).stdout.trim()
}

async function assertCleanWorkingTree(logger: Logger, repoPath: string, label: string): Promise<void> {
  const status = await runCommand(logger, 'git', ['status', '--porcelain'], repoPath)
  if (status.stdout.trim().length > 0) throw new Error(`${label} has uncommitted changes.`)
}

async function assertGhAuthenticated(logger: Logger): Promise<void> {
  const status = await runCommand(logger, 'gh', ['auth', 'status'], process.cwd(), { allowFailure: true })
  if (status.code !== 0) throw new Error('GitHub CLI is not authenticated. Run: gh auth login')
}

/** `permissions` from GET /repos/{owner}/{repo} for the authenticated user */
interface RepoPermissions {
  admin?: boolean
  maintain?: boolean
  push?: boolean
  triage?: boolean
  pull?: boolean
}

function parseRepoSlug(slug: string): [string, string] {
  const parts = slug.split('/')
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid repo slug: ${slug} (expected owner/repo)`)
  }
  return [parts[0], parts[1]]
}

function canPushToRepo(p: RepoPermissions): boolean {
  return !!(p.admin || p.maintain || p.push)
}

function canReadRepo(p: RepoPermissions): boolean {
  return !!(p.admin || p.maintain || p.push || p.triage || p.pull)
}

function canCommentOnPrInRepo(p: RepoPermissions): boolean {
  return !!(p.admin || p.maintain || p.push || p.triage)
}

async function fetchRepoPermissionsForUser(
  logger: Logger,
  slug: string,
): Promise<{ full_name: string; permissions: RepoPermissions }> {
  const [owner, repo] = parseRepoSlug(slug)
  const apiPath = `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
  const result = await runCommand(logger, 'gh', ['api', apiPath], process.cwd(), { allowFailure: true })
  if (result.code !== 0) {
    const err = (result.stderr + result.stdout).trim()
    throw new Error(
      `Cannot access ${slug} via GitHub API (need to see the repo). ${err}\n` +
        `If this org uses SAML SSO, authorize the org for GitHub CLI (GitHub → Settings → Applications → Authorized OAuth apps → GitHub CLI → Configure SSO).`,
    )
  }
  const data = JSON.parse(result.stdout) as { full_name: string; permissions?: RepoPermissions }
  if (!data.permissions) {
    throw new Error(
      `GitHub API did not return permissions for ${slug}. Re-authenticate or authorize SSO for the org.`,
    )
  }
  return { full_name: data.full_name, permissions: data.permissions }
}

async function assertGithubRepoMigrationAccess(logger: Logger, config: CliConfig): Promise<void> {
  logger.step('Checking GitHub API access for migration repos')
  const me = await commandJson<{ login: string }>(logger, 'gh', ['api', 'user'], process.cwd())
  logger.info('GitHub API user', { login: me.login })

  const clerk = await fetchRepoPermissionsForUser(logger, config.clerkRepo)
  if (!canPushToRepo(clerk.permissions)) {
    throw new Error(
      `Insufficient access to ${config.clerkRepo}: need push (or maintain/admin) to push a branch and open a PR. ` +
        `Your permissions: ${JSON.stringify(clerk.permissions)}`,
    )
  }
  logger.info('clerk repo access OK', { repo: clerk.full_name, permissions: clerk.permissions })

  const docs = await fetchRepoPermissionsForUser(logger, config.clerkDocsRepo)
  if (!canReadRepo(docs.permissions)) {
    throw new Error(
      `Insufficient access to ${config.clerkDocsRepo}: need at least pull to list PRs. ` +
        `Your permissions: ${JSON.stringify(docs.permissions)}`,
    )
  }
  if (!canCommentOnPrInRepo(docs.permissions)) {
    logger.warn(
      'You may lack triage or write on clerk-docs; commenting on the source PR could fail. Continuing.',
      { repo: docs.full_name, permissions: docs.permissions },
    )
  } else {
    logger.info('clerk-docs repo access OK for PR comment', { repo: docs.full_name, permissions: docs.permissions })
  }
}

async function maybeWarnAboutSyncBotCommit(logger: Logger, repoPath: string): Promise<void> {
  const author = (await runCommand(logger, 'git', ['log', '-1', '--pretty=%an <%ae>'], repoPath)).stdout.trim()
  if (author.toLowerCase().includes(SYNC_BOT_HINT)) logger.warn('Latest commit author appears to be sync/bot-like.', { author })
}

async function assertSymlinkAtTarget(logger: Logger, clerkPath: string): Promise<string> {
  const target = path.join(clerkPath, TARGET_DIR_IN_CLERK)
  if (!existsSync(target)) throw new Error(`Target path does not exist in clerk: ${target}`)
  if (!lstatSync(target).isSymbolicLink()) {
    throw new Error(`Expected ${TARGET_DIR_IN_CLERK} to be a symlink to local clerk-docs (not a real directory yet): ${target}`)
  }
  return target
}

function failFastRerunMessage(reason: string): string {
  return [
    `Detected leftover state from a previous run: ${reason}`,
    'Stop and fix manually (remove stale remote, revert repos), then retry.',
  ].join('\n')
}

async function assertNoStaleImportRemote(logger: Logger, clerkPath: string): Promise<void> {
  const remotes = await runCommand(logger, 'git', ['remote'], clerkPath)
  if (remotes.stdout.split('\n').some(name => name.trim().startsWith('clerk-docs-migrate-'))) {
    throw new Error(failFastRerunMessage('temporary migrate remote is still configured in clerk'))
  }
}

interface ClerkWorkspace {
  path: string
  isTemporary: boolean
}

/**
 * Use --clerk-path if provided; otherwise clone clerk (--clerk-repo) at baseRef into a fresh temp directory.
 */
async function prepareClerkWorkspace(
  logger: Logger,
  config: CliConfig,
  baseRef: string,
): Promise<ClerkWorkspace> {
  if (config.clerkPath) {
    const p = config.clerkPath
    await assertNoStaleImportRemote(logger, p)
    await assertGitRepo(logger, p, 'clerk')
    await assertCleanWorkingTree(logger, p, 'clerk')
    await ensureClerkOnBranch(logger, config, p, baseRef)
    const clerkNow = await getCurrentBranch(logger, p)
    if (!config.dryRun && clerkNow !== baseRef) {
      throw new Error(`clerk must be on branch "${baseRef}" (matching PR base). Current: ${clerkNow}`)
    }
    await maybeWarnAboutSyncBotCommit(logger, p)
    await assertSymlinkAtTarget(logger, p)
    logger.info('Using local clerk workspace', { path: p })
    return { path: p, isTemporary: false }
  }

  if (config.dryRun) {
    logger.info('Dry-run: would clone clerk into a temp directory', { repo: config.clerkRepo, baseRef })
    return { path: '', isTemporary: true }
  }

  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clerk-migrate-'))
  logger.step('Cloning clerk into temp workspace', {
    path: tmpRoot,
    repo: config.clerkRepo,
    branch: baseRef,
    depth: CLERK_TEMP_CLONE_DEPTH,
    filterBlobNone: CLERK_TEMP_CLONE_FILTER_BLOB_NONE,
    note: 'Shallow + optional blob-less filter: faster first download; merge may still pull many blobs for the full tree.',
  })
  const gitClonePassthrough = [
    '--branch',
    baseRef,
    '--single-branch',
    '--depth',
    String(CLERK_TEMP_CLONE_DEPTH),
    ...(CLERK_TEMP_CLONE_FILTER_BLOB_NONE ? (['--filter=blob:none'] as const) : []),
  ]
  await runCommand(
    logger,
    'gh',
    ['repo', 'clone', config.clerkRepo, tmpRoot, '--', ...gitClonePassthrough],
    process.cwd(),
    { inheritStdio: true },
  )
  const clerkNow = (await getCurrentBranch(logger, tmpRoot)).trim()
  if (clerkNow !== baseRef) {
    throw new Error(`Expected clone to be on "${baseRef}"; got "${clerkNow}"`)
  }
  logger.info('Temporary clerk workspace ready', { path: tmpRoot })
  return { path: tmpRoot, isTemporary: true }
}

async function branchExists(logger: Logger, repoPath: string, branch: string): Promise<boolean> {
  const local = await runCommand(logger, 'git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], repoPath, {
    allowFailure: true,
  })
  if (local.code === 0) return true
  const remote = await runCommand(logger, 'git', ['ls-remote', '--heads', 'origin', branch], repoPath)
  return Boolean(remote.stdout.trim())
}

async function ensureBranchNameAvailable(logger: Logger, repoPath: string, desired: string): Promise<string> {
  let candidate = desired
  let i = 1
  while (await branchExists(logger, repoPath, candidate)) {
    candidate = `${desired}-migrated-${i}`
    i += 1
  }
  return candidate
}

/**
 * Open clerk-docs PR for this head, if any. Used for clerk PR title/body, backlink comment, and whether we may open a clerk PR.
 * The clerk PR base always comes from --clerk-base (default main).
 */
async function resolveSourcePr(
  logger: Logger,
  config: CliConfig,
  headBranch: string,
): Promise<PullRequestView | null> {
  const list = await commandJson<PullRequestView[]>(
    logger,
    'gh',
    [
      'pr',
      'list',
      '--repo',
      config.clerkDocsRepo,
      '--head',
      headBranch,
      '--state',
      'open',
      '--json',
      'number,title,body,baseRefName,headRefName,url,isDraft',
      '--limit',
      '50',
    ],
    process.cwd(),
  )

  if (list.length === 1) {
    logger.info('Found open clerk-docs PR (for title/body and comment)', {
      number: list[0].number,
      isDraft: list[0].isDraft,
    })
    return list[0]
  }

  if (list.length > 1) {
    if (config.prNumber !== undefined && Number.isFinite(config.prNumber)) {
      const picked = list.find(pr => pr.number === config.prNumber)
      if (!picked) {
        throw new Error(
          `--pr ${config.prNumber} does not match any of the open PRs for head "${headBranch}": ${list.map(p => p.number).join(', ')}`,
        )
      }
      logger.info('Using clerk-docs PR from --pr', { number: picked.number, isDraft: picked.isDraft })
      return picked
    }
    if (config.autoApprove) {
      throw new Error(
        `Multiple open PRs for head "${headBranch}": ${list.map(p => `#${p.number}`).join(', ')}. Re-run with --pr <number> or drop --yes.`,
      )
    }
    return await promptPickSourcePr(logger, list)
  }

  logger.warn(
    'No open clerk-docs PR for this head; migration will still push a clerk branch but will not open a clerk PR.',
    { headBranch },
  )
  return null
}

async function ensureClerkOnBranch(logger: Logger, config: CliConfig, clerkPath: string, branch: string): Promise<void> {
  const current = await getCurrentBranch(logger, clerkPath)
  if (current === branch) return
  if (config.dryRun) {
    logger.warn('Dry-run: clerk should be on base branch before migrate', { expected: branch, current })
    return
  }
  await runCommand(logger, 'git', ['checkout', branch], clerkPath)
}

async function mergeMainIntoCurrentBranch(logger: Logger, config: CliConfig): Promise<void> {
  logger.step('Merging clerk-docs/main into current branch')
  const current = await getCurrentBranch(logger, config.clerkDocsPath)
  if (config.dryRun) {
    logger.info('Dry-run: would fetch and merge origin/main', { current })
    return
  }
  await runCommand(logger, 'git', ['fetch', 'origin', 'main'], config.clerkDocsPath)
  const merge = await runCommand(logger, 'git', ['merge', 'origin/main'], config.clerkDocsPath, { allowFailure: true })
  if (merge.code !== 0) {
    throw new Error(
      'Merge conflict while merging origin/main. Resolve conflicts, commit, then rerun.',
    )
  }
}

async function maybeCommentWithMarker(
  logger: Logger,
  config: CliConfig,
  prNumber: number,
  repo: string,
  body: string,
): Promise<boolean> {
  const view = await commandJson<{ comments: Array<{ body: string }> }>(
    logger,
    'gh',
    ['pr', 'view', String(prNumber), '--repo', repo, '--json', 'comments'],
    process.cwd(),
  )
  if (view.comments.some(comment => comment.body.includes(MIGRATION_NOTICE_MARKER))) {
    logger.info('Skipping comment; marker already exists', { repo, prNumber })
    return false
  }
  if (!config.dryRun) {
    await runCommand(logger, 'gh', ['pr', 'comment', String(prNumber), '--repo', repo, '--body', body], process.cwd())
  } else {
    logger.info('Dry-run: would post comment', { repo, prNumber })
  }
  return true
}

async function migrateCurrentBranch(
  logger: Logger,
  config: CliConfig,
  filterRepo: GitFilterRepoInvoker,
  clerkWorkPath: string,
  headRef: string,
  baseRef: string,
  sourcePr: PullRequestView | null,
): Promise<{ newBranch: string; clerkPrUrl: string }> {
  const title = sourcePr?.title ?? `docs: migrate ${headRef}`
  const bodyBase =
    (sourcePr?.body ?? '') +
    (sourcePr ? `\n\nMigrated from ${sourcePr.url}` : `\n\nMigrated from clerk-docs branch ${headRef}`)

  if (config.dryRun) {
    logger.info('Dry-run: would filter-repo, merge, push', {
      clerkWorkPath: clerkWorkPath || '(would clone clerk to temp)',
      suggestedBranch: `${headRef}-migrated`,
      clerkPr: sourcePr ? 'would create (open clerk-docs PR exists)' : 'would skip (no open clerk-docs PR)',
      gitignore:
        'would remove /clerk-docs (and bare clerk-docs/) entries from clerk root .gitignore if present, then commit if changed',
      clerkPrPeople:
        sourcePr !== null
          ? 'would match draft + assignees + requested reviewers from source PR where possible; review approvals cannot transfer (summarized in PR body)'
          : 'n/a',
    })
    return { newBranch: `${headRef}-migrated`, clerkPrUrl: '(dry-run)' }
  }

  const sourceMeta =
    sourcePr !== null
      ? await fetchSourcePrMigrationMetadata(logger, config.clerkDocsRepo, sourcePr.number)
      : null
  let body = bodyBase
  if (sourceMeta) {
    body += formatSourcePrMigrationAppendix(sourceMeta)
  }

  const newBranch = await ensureBranchNameAvailable(logger, clerkWorkPath, `${headRef}-migrated`)
  logger.step('Migrating current branch into clerk', { headRef, baseRef, newBranch, clerkWorkPath })

  const tempClonePath = path.join(os.tmpdir(), `clerk-docs-migrate-${sanitizeBranchForPath(headRef)}-${Date.now()}`)
  const remoteName = `clerk-docs-migrate-${Date.now()}`

  try {
    logger.step('Duplicating local clerk-docs for filter-repo', {
      from: config.clerkDocsPath,
      to: tempClonePath,
      branch: headRef,
      note: 'This is a local git clone of your checkout (not gh clone of clerk/clerk-docs). Large repos can take many minutes.',
    })
    await runCommand(
      logger,
      'git',
      ['clone', '--progress', '--single-branch', '--branch', headRef, config.clerkDocsPath, tempClonePath],
      process.cwd(),
      { inheritStdio: true },
    )
    await runCommand(
      logger,
      filterRepo.command,
      [...filterRepo.argsPrefix, '--to-subdirectory-filter', TARGET_DIR_IN_CLERK, '--force'],
      tempClonePath,
    )
    await runCommand(logger, 'git', ['remote', 'add', remoteName, tempClonePath], clerkWorkPath)
    await runCommand(logger, 'git', ['fetch', remoteName], clerkWorkPath)
    await runCommand(logger, 'git', ['checkout', baseRef], clerkWorkPath)
    await runCommand(logger, 'git', ['checkout', '-b', newBranch], clerkWorkPath)
    await runCommand(
      logger,
      'git',
      ['merge', `${remoteName}/${headRef}`, '--allow-unrelated-histories', '-m', `Migrate clerk-docs branch ${headRef}`],
      clerkWorkPath,
    )
    const gitignoreStripped = await stripClerkDocsRootGitignoreEntries(logger, clerkWorkPath)
    if (gitignoreStripped) {
      await runCommand(logger, 'git', ['add', '.gitignore'], clerkWorkPath)
      await runCommand(
        logger,
        'git',
        ['commit', '-m', 'chore: stop ignoring clerk-docs after in-repo migration'],
        clerkWorkPath,
      )
    }
    await runCommand(logger, 'git', ['push', '-u', 'origin', newBranch], clerkWorkPath)

    const existing = await commandJson<Array<{ url: string }>>(
      logger,
      'gh',
      ['pr', 'list', '--repo', config.clerkRepo, '--state', 'open', '--head', newBranch, '--json', 'url'],
      process.cwd(),
    )
    let clerkPrUrl: string
    if (existing[0]?.url) {
      clerkPrUrl = existing[0].url
      logger.info('Clerk PR already open for this branch', { url: clerkPrUrl })
    } else if (sourcePr) {
      const isDraft = sourceMeta?.isDraft ?? sourcePr.isDraft
      const assigneeLogins = sourceMeta?.assigneeLogins ?? []
      const reviewerHandles = sourceMeta?.reviewerHandles ?? []
      clerkPrUrl = await createClerkPullRequestWithPeople(logger, config, {
        baseRef,
        head: newBranch,
        title,
        body,
        isDraft,
        assigneeLogins,
        reviewerHandles,
      })
    } else {
      logger.warn(
        'Skipping clerk PR creation: open a clerk-docs PR for this branch first, or open a clerk PR manually.',
        { newBranch, headRef },
      )
      clerkPrUrl = '(no clerk PR — requires an open clerk-docs PR for this head)'
    }

    if (sourcePr) {
      await maybeCommentWithMarker(
        logger,
        config,
        sourcePr.number,
        config.clerkDocsRepo,
        `${MIGRATION_NOTICE_MARKER}\nThis work was migrated to: ${clerkPrUrl}`,
      )
    }

    return { newBranch, clerkPrUrl }
  } finally {
    await runCommand(logger, 'git', ['remote', 'remove', remoteName], clerkWorkPath, { allowFailure: true })
    await fs.rm(tempClonePath, { recursive: true, force: true })
  }
}

interface RunPhase {
  name: string
  completed: string[]
}

async function main(): Promise<void> {
  const config = parseConfig()
  const logger = new Logger(config.debug)
  const phases: RunPhase[] = []
  let currentPhase = 'start'
  let workspace: ClerkWorkspace | null = null

  logger.info('PR/branch migration starting', {
    mode: config.dryRun ? 'dry-run' : 'execute',
    clerkDocsPath: config.clerkDocsPath,
    clerkPath: config.clerkPath ?? '(temp clone via gh)',
  })

  try {
    currentPhase = 'preflight'
    if (config.clerkPath) {
      await assertNoStaleImportRemote(logger, config.clerkPath)
    }
    await assertCommandAvailable(logger, 'git')
    await assertCommandAvailable(logger, 'gh')
    await assertMinimumVersion(logger, 'git', 'git', ['--version'], MIN_TOOL_VERSIONS.git)
    await assertMinimumVersion(logger, 'gh', 'gh', ['--version'], MIN_TOOL_VERSIONS.gh)
    const filterRepoInvoker = await resolveGitFilterRepoInvoker(logger)
    await assertGhAuthenticated(logger)
    await assertGithubRepoMigrationAccess(logger, config)
    await assertGitRepo(logger, config.clerkDocsPath, 'clerk-docs')
    await assertCleanWorkingTree(logger, config.clerkDocsPath, 'clerk-docs')

    const clerkDocsBranch = await getCurrentBranch(logger, config.clerkDocsPath)
    if (clerkDocsBranch === 'main') {
      throw new Error(
        'Refusing to run on clerk-docs/main. Use a feature branch for your PR, or migrate main separately by hand.',
      )
    }

    const baseRef = config.clerkBaseBranch
    logger.info('Clerk PR will target base branch', { repo: config.clerkRepo, baseRef })
    const sourcePr = await resolveSourcePr(logger, config, clerkDocsBranch)
    if (sourcePr && sourcePr.baseRefName !== baseRef) {
      logger.warn(
        'Open clerk-docs PR targets a different base than --clerk-base; the new clerk PR uses --clerk-base only.',
        { clerkDocsPrBase: sourcePr.baseRefName, clerkBase: baseRef },
      )
    }
    workspace = await prepareClerkWorkspace(logger, config, baseRef)
    phases.push({
      name: 'preflight',
      completed: [
        'Tools, auth, clerk-docs clean',
        workspace.isTemporary ? `Clerk workspace: temp clone at ${workspace.path || '(dry-run)'}` : `Clerk workspace: local ${workspace.path}`,
      ],
    })

    await checkpoint(logger, config, {
      title: 'Preflight complete',
      completed: phases.flatMap(p => p.completed),
      next: 'Merge origin/main into this feature branch',
    })

    currentPhase = 'merge-main'
    await mergeMainIntoCurrentBranch(logger, config)
    phases.push({ name: 'merge-main', completed: ['Merged origin/main into feature branch (or dry-run)'] })

    await checkpoint(logger, config, {
      title: 'Merge main complete',
      completed: phases.flatMap(p => p.completed),
      next: 'Rewrite history and push in clerk (opens a clerk PR only if an open clerk-docs PR exists)',
    })

    currentPhase = 'migrate-branch'
    const { newBranch, clerkPrUrl } = await migrateCurrentBranch(
      logger,
      config,
      filterRepoInvoker,
      workspace.path,
      clerkDocsBranch,
      baseRef,
      sourcePr,
    )
    phases.push({
      name: 'migrate-branch',
      completed: [`Pushed ${newBranch}`, `Clerk PR: ${clerkPrUrl}`],
    })

    if (workspace.isTemporary && workspace.path && !config.dryRun) {
      await fs.rm(workspace.path, { recursive: true, force: true })
      logger.info('Removed temporary clerk clone', { path: workspace.path })
    }

    logger.step('Migration completed')
    logger.info('Summary', {
      clerkDocsBranch,
      baseRef,
      newBranchInClerk: newBranch,
      clerkPrUrl,
      sourcePrNumber: sourcePr?.number ?? null,
    })
  } catch (error) {
    logger.error('Migration failed', { error: error instanceof Error ? error.message : String(error) })
    logger.error('Progress before failure', {
      currentPhase,
      phasesCompleted: phases.map(p => p.name),
      detail: phases,
    })
    if (workspace?.isTemporary && workspace.path) {
      logger.error('Temporary clerk clone may still exist on disk', { path: workspace.path })
    }
    logger.warn('No automatic cleanup on failure.')
    if (!config.dryRun) {
      logger.error('Guidance', {
        steps: [
          'Reset clerk-docs if needed; fix the error above.',
          'If you used a temp clerk clone, delete that folder manually if you are done inspecting it.',
          'If you used --clerk-path, remove any clerk-docs-migrate-* remote from that repo if present.',
          'Retry after fixing the error above.',
        ],
      })
    }
    throw error
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('[migration][FATAL]', error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
