/**
 * PR / branch migration only: run from your clerk-docs feature branch (not main).
 * Merges origin/main, rewrites clerk-docs history under clerk/clerk-docs/, merges that history into a clerk branch (preserving authors per imported commit), pushes and opens a PR only if an open clerk-docs PR exists, then comments that source PR.
 */
import { existsSync, lstatSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { z } from 'zod'

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'step'
type Json = Record<string, unknown>

/** Owner and repository name from a validated `owner/repo` slug. */
type RepoSlug = readonly [owner: string, name: string]

function formatRepoSlug(slug: RepoSlug): string {
  return `${slug[0]}/${slug[1]}`
}

interface CliConfig {
  /** If set, use this existing clone instead of cloning clerk to a temp directory */
  clerkPath?: string
  clerkDocsPath: string
  /** Optional branch to require/use in clerk-docs before migration begins */
  clerkDocsBaseBranch?: string
  /** Branch in clerk (see --clerk-repo) to check out and open the new PR against; default main */
  clerkBaseBranch: string
  /** Create migrated branch locally but do not push or open/comment PRs */
  localOnly: boolean
  dryRun: boolean
  /** Skip preflight refusal when local clerk has uncommitted changes */
  allowDirtyClerk: boolean
  /** Skip preflight refusal when clerk-docs has local uncommitted changes */
  allowDirtyClerkDocs: boolean
  debug: boolean
  clerkRepo: RepoSlug
  clerkDocsRepo: RepoSlug
  /** When several open PRs share the same head, use this PR number (required if stdin is not a TTY) */
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
const MIGRATION_NOTICE_MARKER = '<!-- clerk-docs-migration-notice -->'
const MIN_TOOL_VERSIONS = {
  git: '2.39.0',
  gh: '2.40.0',
  gitFilterRepo: '2.38.0',
} as const

const MIGRATION_GIT_FILTER_REPO_INSTALL_HINT = [
  'git-filter-repo is not installed or not on your PATH.',
  'Install it, then re-run:',
  '  macOS:   brew install git-filter-repo',
  '  pip:    pip install git-filter-repo   (or pipx install git-filter-repo)',
  'Docs:    https://github.com/newren/git-filter-repo/blob/main/INSTALL.md',
].join('\n')

/**
 * Central migration failures: message + hints per key (same idea as `scripts/lib/error-messages.ts`, plus hints).
 * `message` and `hints` share the same parameter list for each key so `throwMigrationError` can infer args from the key.
 */
const migrationErrorDefinitions = {
  'gh-not-authenticated': {
    message: (): string => 'GitHub CLI is not authenticated. Run: gh auth login',
    hints: (): readonly string[] => ['Run `gh auth login` and verify with `gh auth status`, then rerun.'],
  },
  'merge-main-conflict': {
    message: (): string => 'Merge conflict while merging origin/main. Resolve conflicts, commit, then rerun.',
    hints: (): readonly string[] => [
      'Resolve conflicts in clerk-docs, create a commit, then rerun the migration.',
      'If you want to postpone migration, abort and rebase/merge your branch first.',
    ],
  },
  'stale-migrate-remote': {
    message: (): string =>
      [
        'Detected leftover state from a previous run: temporary migrate remote is still configured in clerk',
        'Stop and fix manually (remove stale remote, revert repos), then retry.',
      ].join('\n'),
    hints: (): readonly string[] => [
      'In your clerk repo, remove stale remotes matching `clerk-docs-migrate-*`.',
      'Ensure no partial migration branch/merge is in progress before rerunning.',
    ],
  },
  'refuse-clerk-docs-main': {
    message: (): string =>
      'Refusing to run on clerk-docs/main. Use a feature branch for your PR, or migrate main separately by hand.',
    hints: (): readonly string[] => ['Checkout your feature branch in clerk-docs and rerun from there.'],
  },
  'insufficient-repo-access': {
    message: (detail: string): string => detail,
    hints: (_detail: string): readonly string[] => [
      'Verify your GitHub account has the required repo permissions.',
      'If your org uses SSO, authorize GitHub CLI for the org and rerun.',
    ],
  },
  'git-filter-repo-missing': {
    message: (): string => MIGRATION_GIT_FILTER_REPO_INSTALL_HINT,
    hints: (): readonly string[] => ['Install git-filter-repo (`brew install git-filter-repo`), then rerun.'],
  },
  'json-parse-failed': {
    message: (command: string, argsLine: string): string => `Failed parsing JSON from ${command} ${argsLine}`,
    hints: (_command: string, _argsLine: string): readonly string[] => [
      'Re-run with --verbose to capture command output and identify malformed JSON response.',
    ],
  },
  'uncommitted-changes': {
    message: (label: 'clerk' | 'clerk-docs'): string => {
      const suffix = label === 'clerk-docs' ? ' or rerun with --allow-dirty-docs.' : '.'
      return `${label} has uncommitted changes. Commit or stash your local changes first${suffix}`
    },
    hints: (label: 'clerk' | 'clerk-docs'): readonly string[] => [
      'Commit or stash changes in the mentioned repo, then rerun.',
      ...(label === 'clerk'
        ? ['If intentional, rerun with --allow-dirty-clerk to bypass the local clerk clean check.']
        : []),
      ...(label === 'clerk-docs' ? ['If intentional, rerun with --allow-dirty-docs to bypass this check.'] : []),
    ],
  },
  'github-api-repo-inaccessible': {
    message: (detail: string): string => detail,
    hints: (_detail: string): readonly string[] => [
      'Verify the repo exists and you can access it with `gh`.',
      'If this org uses SAML SSO, authorize the org for GitHub CLI (GitHub → Settings → Applications → Authorized OAuth apps → GitHub CLI → Configure SSO).',
    ],
  },
  'github-api-no-permissions': {
    message: (detail: string): string => detail,
    hints: (_detail: string): readonly string[] => [
      'Re-authenticate with `gh auth login` or refresh SSO authorization for the org.',
    ],
  },
  'clerk-path-not-found': {
    message: (resolvedPath: string): string => `Clerk path does not exist (from --clerk-path): ${resolvedPath}`,
    hints: (_resolvedPath: string): readonly string[] => [
      'Fix the path to your local clerk clone (typo, wrong folder, or repo not checked out yet).',
      'Use an absolute path or resolve `../` from clerk-docs root if unsure.',
    ],
  },
  'clerk-path-not-a-directory': {
    message: (resolvedPath: string): string => `Clerk path is not a directory (from --clerk-path): ${resolvedPath}`,
    hints: (_resolvedPath: string): readonly string[] => [
      'Pass the root directory of the clerk git checkout, not a file.',
    ],
  },
} as const

type MigrationErrorCode = keyof typeof migrationErrorDefinitions

class MigrationError extends Error {
  public readonly code: MigrationErrorCode
  public readonly hints: readonly string[]

  constructor(code: MigrationErrorCode, message: string, hints: readonly string[]) {
    super(message)
    this.name = 'MigrationError'
    this.code = code
    this.hints = hints
  }
}

function throwMigrationError<K extends MigrationErrorCode>(
  code: K,
  ...args: Parameters<(typeof migrationErrorDefinitions)[K]['message']>
): never {
  const def = migrationErrorDefinitions[code]
  // @ts-expect-error -- per-key `message`/`hints` share the same args tuple; TypeScript cannot prove the spread
  const message: string = def.message(...args)
  // @ts-expect-error -- same
  const hints: readonly string[] = def.hints(...args)
  throw new MigrationError(code, message, [...hints])
}

function color(text: string, code: number): string {
  if (!Boolean(output.isTTY && !process.env.NO_COLOR)) return text
  return `\u001B[${code}m${text}\u001B[0m`
}

function levelBadge(level: LogLevel): string {
  switch (level) {
    case 'debug':
      return color('DEBUG', 90)
    case 'info':
      return color(' INFO', 36)
    case 'warn':
      return color(' WARN', 33)
    case 'error':
      return color('ERROR', 31)
    case 'step':
      return color(' STEP', 35)
    default:
      return color('  LOG', 37)
  }
}

function formatMeta(meta: Json): string {
  const lines = JSON.stringify(meta, null, 2).split('\n')
  return lines
    .map((line, idx) => {
      const prefix = idx === 0 ? color('meta ', 90) : '     '
      return `    ${prefix}${color('|', 90)} ${line}`
    })
    .join('\n')
}

const _verbose = process.argv.includes('--debug') || process.argv.includes('--verbose')

function log(level: LogLevel, message: string, meta?: Json): void {
  if (level === 'debug' && !_verbose) return
  const badge = levelBadge(level)
  if (level === 'step') {
    console.log(`\n${badge} ${message}`)
  } else {
    console.log(`${badge} ${message}`)
  }
  if (meta && _verbose) console.log(formatMeta(meta))
}

function debugLog(message: string, meta?: Json): void {
  log('debug', message, meta)
}

function infoLog(message: string, meta?: Json): void {
  log('info', message, meta)
}

function warnLog(message: string, meta?: Json): void {
  log('warn', message, meta)
}

function stepLog(message: string, meta?: Json): void {
  log('step', message, meta)
}

function errorLog(message: string, meta?: Json): void {
  log('error', message, meta)
}

function printHelp(): void {
  console.log(`
Usage:
  tsx ./scripts/migrate-clerk-docs-to-clerk.ts [options]

Run from your clerk-docs feature branch (not main). Migrates that branch into clerk under ${TARGET_DIR_IN_CLERK}/.

By default clones the clerk repo (see --clerk-repo) into a temp directory (needs gh auth with push access). Use --clerk-path for an existing local clone instead.

Optional:
  --clerk-path <path>         Path to the local clerk (default: clones into a temp directory)
  --clerk-repo <owner/repo>   Target PR repo (default: clerk/clerk)
  --clerk-base <branch>       Branch in clerk to base the new PR on (default: main)
  --allow-dirty-clerk         Skip clean-tree preflight for local clerk (only applies with --clerk-path); uncommitted changes stay in your working tree and are not included in the PR

  --docs-path <path>          Path to the clerk-docs repo (default: cwd)
  --docs-repo <owner/repo>    Source PR lookup (default: clerk/clerk-docs)
  --docs-base <branch>        Desired checked-out branch in clerk-docs before migration starts
  --allow-dirty-docs          Skip clean-tree preflight for clerk-docs; only committed history is migrated (filter-repo reads commits, not the working tree), though the merge of origin/main can still abort if local edits conflict

  --local-only                Create the migrated branch in the clerk workspace only (skip push, PR creation, and source-PR comment); pair with --clerk-path, otherwise the temp clerk clone is deleted at the end and the branch is lost
  --dry-run                   Print actions only
  --pr <number>               Open clerk-docs PR to use when several match this branch (required if stdin is not a TTY)
  --debug, --verbose          Verbose logs (includes JSON metadata)
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

function getArgAliases(flags: string[]): string | undefined {
  for (const flag of flags) {
    const value = getArg(flag)
    if (value !== undefined) return value
  }
  return undefined
}

function hasFlagAliases(flags: string[]): boolean {
  return flags.some((flag) => hasFlag(flag))
}

/** When false, readline prompts cannot run; caller must pass flags (e.g. --pr) or fix branch state instead. */
function stdinSupportsInteractivePrompts(): boolean {
  return Boolean(input.isTTY)
}

/** Parses `owner/repo` into a two-element tuple (same rules as `parseRepoSlug`). */
const repoSlugSchema = z
  .string()
  .refine(
    (s) => {
      const p = s.split('/')
      return p.length === 2 && Boolean(p[0]) && Boolean(p[1])
    },
    (slug) => ({ message: `Invalid repo slug: ${slug} (expected owner/repo)` }),
  )
  .transform((s): RepoSlug => {
    const [owner, name] = s.split('/')
    return [owner, name]
  })

const PR_NUMBER_INVALID = '--pr must be a positive integer (GitHub PR number)'

const githubPrNumberSchema = z
  .number({
    errorMap: (issue, ctx) => {
      if (issue.code === z.ZodIssueCode.invalid_type && issue.received === 'nan') {
        return { message: PR_NUMBER_INVALID }
      }
      return { message: ctx.defaultError }
    },
  })
  .int({ message: PR_NUMBER_INVALID })
  .positive({ message: PR_NUMBER_INVALID })

const migrateCliSchema = z.object({
  clerkPath: z.string().optional(),
  clerkDocsPath: z.string().min(1),
  clerkDocsBaseBranch: z.string().min(1).optional(),
  clerkBaseBranch: z.string().min(1),
  localOnly: z.boolean(),
  dryRun: z.boolean(),
  allowDirtyClerk: z.boolean(),
  allowDirtyClerkDocs: z.boolean(),
  debug: z.boolean(),
  clerkRepo: repoSlugSchema,
  clerkDocsRepo: repoSlugSchema,
  prNumber: z.coerce
    .number()
    .catch(() => NaN)
    .pipe(githubPrNumberSchema)
    .optional(),
})

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
  const normalized = beforeComment.replace(/^\//, '').replace(/\/$/, '')
  return normalized === 'clerk-docs'
}

async function stripClerkDocsRootGitignoreEntries(clerkWorkPath: string): Promise<boolean> {
  const gitignorePath = path.join(clerkWorkPath, '.gitignore')
  if (!existsSync(gitignorePath)) {
    debugLog('No root .gitignore; skipping clerk-docs ignore cleanup', { clerkWorkPath })
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
  const out = kept.join('\n')
  await fs.writeFile(gitignorePath, out, 'utf8')
  infoLog('Removed symlink-era clerk-docs rules from root .gitignore', { linesRemoved: removed })
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

  const parsed = migrateCliSchema.safeParse({
    clerkPath: clerkPathArg ? path.resolve(expandHome(clerkPathArg)) : undefined,
    clerkDocsPath: path.resolve(expandHome(getArgAliases(['--docs-path', '--clerk-docs-path']) ?? process.cwd())),
    clerkDocsBaseBranch: getArgAliases(['--docs-base', '--clerk-docs-base']),
    clerkBaseBranch: getArg('--clerk-base') ?? 'main',
    localOnly: hasFlag('--local-only'),
    dryRun: hasFlag('--dry-run'),
    allowDirtyClerk: hasFlag('--allow-dirty-clerk'),
    allowDirtyClerkDocs: hasFlagAliases(['--allow-dirty-docs', '--allow-dirty-clerk-docs']),
    debug: hasFlag('--debug') || hasFlag('--verbose'),
    clerkRepo: getArg('--clerk-repo') ?? 'clerk/clerk',
    clerkDocsRepo: getArgAliases(['--docs-repo', '--clerk-docs-repo']) ?? 'clerk/clerk-docs',
    prNumber: getArg('--pr'),
  })
  if (!parsed.success) {
    const first = parsed.error.errors[0]
    throw new Error(first?.message ?? parsed.error.message)
  }
  return parsed.data
}

async function checkpoint(details: { title: string; completed: string[]; next: string }): Promise<void> {
  stepLog(`Checkpoint: ${details.title}`)
  infoLog('Completed in this phase', { completed: details.completed })
  infoLog('Next planned action', { next: details.next })
}

async function promptPickSourcePr(list: PullRequestView[]): Promise<PullRequestView> {
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
      const picked = list.find((pr) => pr.number === n)
      if (!picked) {
        output.write(`No matching PR in the list. Choose one of: ${list.map((p) => p.number).join(', ')}\n`)
        continue
      }
      infoLog('User selected clerk-docs PR', { number: picked.number })
      return picked
    }
  } finally {
    rl.close()
  }
}

/**
 * Extract a handle suitable for `gh pr create --reviewer` from a single review request node.
 * `gh pr view --json reviewRequests` already returns team slugs in `org/team-slug` format
 * (via its `LoginOrSlug()` helper), so we pass them through as-is.
 */
function reviewRequestToHandle(req: { __typename?: string; login?: string; slug?: string }): string | null {
  if (req.__typename === 'User' && req.login) return req.login
  if (req.__typename === 'Team' && req.slug) return req.slug
  return null
}

function parseGhPrViewForMigration(raw: GhPrViewForMigration): SourcePrMigrationMetadata {
  const assigneeLogins = (raw.assignees ?? []).map((a) => a.login).filter((l): l is string => Boolean(l))
  const requestedHandles = (raw.reviewRequests ?? [])
    .map((req) => reviewRequestToHandle(req))
    .filter((h): h is string => Boolean(h))
  const latestReviewRows = (raw.latestReviews ?? []).map((r) => ({
    login: r.author?.login ?? '(unknown)',
    state: r.state ?? 'UNKNOWN',
  }))
  const reviewedLogins = latestReviewRows.map((r) => r.login).filter((l) => l !== '(unknown)')
  const seen = new Set(requestedHandles)
  const reviewerHandles = [...requestedHandles]
  for (const login of reviewedLogins) {
    if (!seen.has(login)) {
      seen.add(login)
      reviewerHandles.push(login)
    }
  }
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
  clerkDocsRepo: string,
  prNumber: number,
): Promise<SourcePrMigrationMetadata | null> {
  try {
    const raw = await commandJson<GhPrViewForMigration>(
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
  } catch (err) {
    warnLog('Could not load source PR metadata (assignees/reviewers/reviews)', {
      prNumber,
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

function formatSourcePrMigrationAppendix(meta: SourcePrMigrationMetadata): string {
  const assigneeLine = meta.assigneeLogins.length > 0 ? meta.assigneeLogins.map((l) => `@${l}`).join(', ') : '—'
  const reviewerLine = meta.reviewerHandles.length > 0 ? meta.reviewerHandles.join(', ') : '—'
  const decisionLine = meta.reviewDecision.trim() || '—'
  const reviewLines =
    meta.latestReviewRows.length > 0
      ? meta.latestReviewRows.map((r) => `  - @${r.login}: **${r.state}**`).join('\n')
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
  const repo = formatRepoSlug(config.clerkRepo)

  const createArgs = [
    'pr',
    'create',
    '--repo',
    repo,
    '--base',
    baseRef,
    '--head',
    head,
    '--title',
    title,
    '--body',
    body,
  ]
  if (isDraft) createArgs.push('--draft')

  const prUrl = (await runCommand('gh', createArgs, process.cwd())).stdout.trim()

  const editArgs = ['pr', 'edit', prUrl, '--repo', repo]
  for (const handle of reviewerHandles) {
    editArgs.push('--add-reviewer', handle)
  }
  for (const login of assigneeLogins) {
    editArgs.push('--add-assignee', login)
  }

  if (editArgs.length > 5) {
    const result = await runCommand('gh', editArgs, process.cwd(), { allowFailure: true })
    if (result.code !== 0) {
      warnLog('Could not add reviewers/assignees to clerk PR (metadata still in PR body)', {
        url: prUrl,
        reviewers: reviewerHandles,
        assignees: assigneeLogins,
        stderr: result.stderr.trim(),
      })
    }
  }

  return prUrl
}

type RunCommandOptions = { allowFailure?: boolean; inheritStdio?: boolean }

async function runCommand(
  command: string,
  args: string[],
  cwd: string,
  options?: RunCommandOptions,
): Promise<CommandResult> {
  if (options?.inheritStdio) {
    infoLog('Running (live output below; large repos may take several minutes)', { command, args, cwd })
  } else {
    debugLog('Executing command', { command, args, cwd })
  }
  return await new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let settled = false

    const tryFinish = (result: CommandResult): void => {
      if (settled) return
      settled = true
      if (result.code !== 0 && !options?.allowFailure) {
        const detail = options?.inheritStdio ? `exit ${result.code}` : (result.stdout + result.stderr).trim()
        reject(new Error(`Command failed (${command} ${args.join(' ')}): ${detail}`))
        return
      }
      resolve(result)
    }

    if (options?.inheritStdio) {
      const child = spawn(command, args, { cwd, env: process.env, stdio: 'inherit' })
      child.on('error', (err) => {
        if (settled) return
        const msg = err instanceof Error ? err.message : String(err)
        if (options?.allowFailure) {
          debugLog('Spawn error treated as failed command', { command, message: msg })
          tryFinish({ code: 127, stdout: '', stderr: msg })
          return
        }
        settled = true
        reject(err)
      })
      child.on('close', (code) => {
        tryFinish({ code: code === null || code === undefined ? 1 : code, stdout: '', stderr: '' })
      })
      return
    }

    const child = spawn(command, args, { cwd, env: process.env })
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString()
      stdout += text
      debugLog('Command stdout chunk', { command, chunk: text.trim() })
    })
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString()
      stderr += text
      debugLog('Command stderr chunk', { command, chunk: text.trim() })
    })
    child.on('error', (err) => {
      if (settled) return
      const msg = err instanceof Error ? err.message : String(err)
      if (options?.allowFailure) {
        debugLog('Spawn error treated as failed command', { command, message: msg })
        tryFinish({ code: 127, stdout, stderr: stderr ? `${stderr}\n${msg}` : msg })
        return
      }
      settled = true
      reject(err)
    })
    child.on('close', (code) => {
      tryFinish({ code: code === null || code === undefined ? 1 : code, stdout, stderr })
    })
  })
}

async function commandJson<T>(command: string, args: string[], cwd: string): Promise<T> {
  const result = await runCommand(command, args, cwd)
  try {
    return JSON.parse(result.stdout) as T
  } catch {
    throwMigrationError('json-parse-failed', command, args.join(' '))
  }
}

async function assertCommandAvailable(command: string, args: string[] = ['--version']): Promise<void> {
  infoLog(`Checking dependency: ${command}`)
  await runCommand(command, args, process.cwd())
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
  label: string,
  command: string,
  args: string[],
  minimumVersion: string,
): Promise<void> {
  infoLog(`Checking ${label} minimum version`, { minimumVersion })
  const result = await runCommand(command, args, process.cwd())
  assertSemverAtLeast(label, `${result.stdout}\n${result.stderr}`, minimumVersion)
}

function assertSemverAtLeast(label: string, rawOutput: string, minimumVersion: string): void {
  const raw = rawOutput.trim()
  const actualParsed = parseSemverLoose(raw)
  const minimumParsed = parseSemverLoose(minimumVersion)
  if (!actualParsed || !minimumParsed) {
    throw new Error(`${label} version could not be parsed. Raw output: "${raw}". Expected at least ${minimumVersion}.`)
  }
  if (!isSemverAtLeast(actualParsed, minimumParsed)) {
    throw new Error(`${label} ${actualParsed.join('.')} is too old. Minimum supported is ${minimumVersion}.`)
  }
  infoLog(`${label} version check passed`, {
    detectedVersion: actualParsed.join('.'),
    minimumVersion,
  })
}

/** How to invoke filter-repo: either `git filter-repo ...` or standalone `git-filter-repo ...`. */
interface GitFilterRepoInvoker {
  command: string
  argsPrefix: string[]
}

function assertGitFilterRepoVersionOutput(label: string, rawOutput: string, minimumVersion: string): void {
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
    infoLog(`${label} version check passed`, {
      detectedVersion: actualParsed.join('.'),
      minimumVersion,
    })
    return
  }

  // Some installs (e.g. brew) print only a git short hash for `git filter-repo --version`.
  if (/^[0-9a-f]{7,40}$/i.test(raw)) {
    warnLog(
      `${label} printed a build/commit id instead of semver; treating as installed (cannot verify >= ${minimumVersion})`,
      { raw },
    )
    return
  }

  throw new Error(
    `${label} version could not be parsed. Raw output: "${raw}". Expected semver like ${minimumVersion} or a git hash.`,
  )
}

async function resolveGitFilterRepoInvoker(): Promise<GitFilterRepoInvoker> {
  infoLog('Checking git-filter-repo (git filter-repo or git-filter-repo on PATH)')
  const asSub = await runCommand('git', ['filter-repo', '--version'], process.cwd(), { allowFailure: true })
  if (asSub.code === 0) {
    assertGitFilterRepoVersionOutput(
      'git-filter-repo (git subcommand)',
      `${asSub.stdout}\n${asSub.stderr}`,
      MIN_TOOL_VERSIONS.gitFilterRepo,
    )
    return { command: 'git', argsPrefix: ['filter-repo'] }
  }
  const standalone = await runCommand('git-filter-repo', ['--version'], process.cwd(), { allowFailure: true })
  if (standalone.code === 0) {
    assertGitFilterRepoVersionOutput(
      'git-filter-repo (standalone)',
      `${standalone.stdout}\n${standalone.stderr}`,
      MIN_TOOL_VERSIONS.gitFilterRepo,
    )
    return { command: 'git-filter-repo', argsPrefix: [] }
  }
  throwMigrationError('git-filter-repo-missing')
}

async function assertGitRepo(repoPath: string, label: string): Promise<void> {
  infoLog(`Validating git repository for ${label}`, { repoPath })
  if (!existsSync(repoPath)) throw new Error(`${label} path does not exist: ${repoPath}`)
  await runCommand('git', ['rev-parse', '--is-inside-work-tree'], repoPath)
}

async function getCurrentBranch(repoPath: string): Promise<string> {
  return (await runCommand('git', ['branch', '--show-current'], repoPath)).stdout.trim()
}

async function assertCleanWorkingTree(repoPath: string, label: string): Promise<void> {
  const status = await runCommand('git', ['status', '--porcelain'], repoPath)
  if (status.stdout.trim().length > 0) {
    throwMigrationError('uncommitted-changes', label === 'clerk-docs' ? 'clerk-docs' : 'clerk')
  }
}

async function assertGhAuthenticated(): Promise<void> {
  const status = await runCommand('gh', ['auth', 'status'], process.cwd(), { allowFailure: true })
  if (status.code !== 0) throwMigrationError('gh-not-authenticated')
}

/** `permissions` from GET /repos/{owner}/{repo} for the authenticated user */
interface RepoPermissions {
  admin?: boolean
  maintain?: boolean
  push?: boolean
  triage?: boolean
  pull?: boolean
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
  slug: RepoSlug,
): Promise<{ full_name: string; permissions: RepoPermissions }> {
  const [owner, repo] = slug
  const slugStr = formatRepoSlug(slug)
  const apiPath = `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
  const result = await runCommand('gh', ['api', apiPath], process.cwd(), { allowFailure: true })
  if (result.code !== 0) {
    const err = (result.stderr + result.stdout).trim()
    throwMigrationError(
      'github-api-repo-inaccessible',
      `Cannot access ${slugStr} via GitHub API (need to see the repo). ${err}\n` +
        `If this org uses SAML SSO, authorize the org for GitHub CLI (GitHub → Settings → Applications → Authorized OAuth apps → GitHub CLI → Configure SSO).`,
    )
  }
  const data = JSON.parse(result.stdout) as { full_name: string; permissions?: RepoPermissions }
  if (!data.permissions) {
    throwMigrationError(
      'github-api-no-permissions',
      `GitHub API did not return permissions for ${slugStr}. Re-authenticate or authorize SSO for the org.`,
    )
  }
  return { full_name: data.full_name, permissions: data.permissions }
}

async function assertGithubRepoMigrationAccess(config: CliConfig): Promise<void> {
  infoLog('Checking GitHub API access for migration repos')
  const me = await commandJson<{ login: string }>('gh', ['api', 'user'], process.cwd())
  infoLog('GitHub API user', { login: me.login })

  const clerk = await fetchRepoPermissionsForUser(config.clerkRepo)
  if (config.localOnly) {
    if (!canReadRepo(clerk.permissions)) {
      throwMigrationError(
        'insufficient-repo-access',
        `Insufficient access to ${formatRepoSlug(config.clerkRepo)}: need at least pull access to clone and prepare a local branch. ` +
          `Your permissions: ${JSON.stringify(clerk.permissions)}`,
      )
    }
  } else if (!canPushToRepo(clerk.permissions)) {
    throwMigrationError(
      'insufficient-repo-access',
      `Insufficient access to ${formatRepoSlug(config.clerkRepo)}: need push (or maintain/admin) to push a branch and open a PR. ` +
        `Your permissions: ${JSON.stringify(clerk.permissions)}`,
    )
  }
  infoLog('clerk repo access OK', { repo: clerk.full_name, permissions: clerk.permissions })

  const docs = await fetchRepoPermissionsForUser(config.clerkDocsRepo)
  if (!canReadRepo(docs.permissions)) {
    throwMigrationError(
      'insufficient-repo-access',
      `Insufficient access to ${formatRepoSlug(config.clerkDocsRepo)}: need at least pull to list PRs. ` +
        `Your permissions: ${JSON.stringify(docs.permissions)}`,
    )
  }
  if (!canCommentOnPrInRepo(docs.permissions)) {
    warnLog('You may lack triage or write on clerk-docs; commenting on the source PR could fail. Continuing.', {
      repo: docs.full_name,
      permissions: docs.permissions,
    })
  } else {
    infoLog('clerk-docs repo access OK for PR comment', { repo: docs.full_name, permissions: docs.permissions })
  }
}

async function reconcileClerkDocsTargetPath(clerkPath: string, dryRun: boolean): Promise<string> {
  const target = path.join(clerkPath, TARGET_DIR_IN_CLERK)
  if (!existsSync(target)) {
    infoLog(`Target path ${TARGET_DIR_IN_CLERK}/ does not exist in clerk yet; migration will create/populate it.`, {
      target,
    })
    return target
  }
  if (lstatSync(target).isSymbolicLink()) {
    if (dryRun) {
      infoLog(`Dry-run: would remove existing ${TARGET_DIR_IN_CLERK}/ symlink before migration.`, { target })
      return target
    }
    await fs.rm(target, { recursive: true, force: true })
    infoLog(`Removed existing ${TARGET_DIR_IN_CLERK}/ symlink before migration.`, { target })
    return target
  }
  infoLog(`${TARGET_DIR_IN_CLERK}/ already exists as a real directory; continuing and merging new changes into it.`, {
    target,
  })
  return target
}

/**
 * Matches bare `#123` PR/issue refs that are NOT already qualified with a repo slug.
 * Negative lookbehind rejects `#` preceded by `/` or word chars (avoids URLs and `owner/repo#N`).
 * Identical semantics in JavaScript and Python regex engines.
 */
const PR_REF_PATTERN = /(?<![/\w])#(\d+)/g

/**
 * Rewrites bare `#123` refs in a commit message to fully-qualified cross-repo refs
 * (e.g. `clerk/clerk-docs#123`) so GitHub links resolve correctly after migration.
 */
function rewritePrRefsInCommitMessage(message: string, docsRepoSlug: string): string {
  return message.replace(PR_REF_PATTERN, `${docsRepoSlug}#$1`)
}

/**
 * Builds a Python snippet for `git filter-repo --message-callback` that applies
 * the same rewrite as {@link rewritePrRefsInCommitMessage} on the bytes-level message.
 */
function buildPrRefsRewriteCallback(docsRepoSlug: string): string {
  return [
    'import re',
    `return re.sub(rb'(?<![/\\w])#(\\d+)', lambda m: b'${docsRepoSlug}#' + m.group(1), message)`,
  ].join('\n')
}

/** Fail before spawning `git` in `clerkPath` (bad cwd yields opaque `spawn git ENOENT`). */
function assertClerkPathResolvable(clerkPath: string): void {
  if (!existsSync(clerkPath)) {
    throwMigrationError('clerk-path-not-found', clerkPath)
  }
  if (!lstatSync(clerkPath).isDirectory()) {
    throwMigrationError('clerk-path-not-a-directory', clerkPath)
  }
}

async function assertNoStaleImportRemote(clerkPath: string): Promise<void> {
  const remotes = await runCommand('git', ['remote'], clerkPath)
  if (remotes.stdout.split('\n').some((name) => name.trim().startsWith('clerk-docs-migrate-'))) {
    throwMigrationError('stale-migrate-remote')
  }
}

interface ClerkWorkspace {
  path: string
  isTemporary: boolean
}

/**
 * Use --clerk-path if provided; otherwise clone clerk (--clerk-repo) at baseRef into a fresh temp directory.
 */
async function prepareClerkWorkspace(config: CliConfig, baseRef: string): Promise<ClerkWorkspace> {
  if (config.clerkPath) {
    await assertNoStaleImportRemote(config.clerkPath)
    await assertGitRepo(config.clerkPath, 'clerk')
    if (config.allowDirtyClerk) {
      warnLog('Bypassing clean-working-tree check for clerk due to --allow-dirty-clerk.')
    } else {
      await assertCleanWorkingTree(config.clerkPath, 'clerk')
    }
    await ensureClerkOnBranch(config, config.clerkPath, baseRef)
    const clerkNow = await getCurrentBranch(config.clerkPath)
    if (!config.dryRun && clerkNow !== baseRef) {
      throw new Error(`clerk must be on branch "${baseRef}" (matching PR base). Current: ${clerkNow}`)
    }
    await reconcileClerkDocsTargetPath(config.clerkPath, config.dryRun)
    infoLog('Using local clerk workspace', { path: config.clerkPath })
    return { path: config.clerkPath, isTemporary: false }
  }

  if (config.dryRun) {
    infoLog('Dry-run: would clone clerk into a temp directory', { repo: formatRepoSlug(config.clerkRepo), baseRef })
    return { path: '', isTemporary: true }
  }

  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clerk-migrate-'))
  stepLog('Cloning clerk into temp workspace', {
    path: tmpRoot,
    repo: formatRepoSlug(config.clerkRepo),
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
    'gh',
    ['repo', 'clone', formatRepoSlug(config.clerkRepo), tmpRoot, '--', ...gitClonePassthrough],
    process.cwd(),
  )
  const clerkNow = (await getCurrentBranch(tmpRoot)).trim()
  if (clerkNow !== baseRef) {
    throw new Error(`Expected clone to be on "${baseRef}"; got "${clerkNow}"`)
  }
  await reconcileClerkDocsTargetPath(tmpRoot, config.dryRun)
  infoLog('Temporary clerk workspace ready', { path: tmpRoot })
  return { path: tmpRoot, isTemporary: true }
}

async function branchExists(repoPath: string, branch: string): Promise<boolean> {
  const local = await runCommand('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], repoPath, {
    allowFailure: true,
  })
  if (local.code === 0) return true
  const remote = await runCommand('git', ['ls-remote', '--heads', 'origin', branch], repoPath)
  return Boolean(remote.stdout.trim())
}

async function ensureBranchNameAvailable(repoPath: string, desired: string): Promise<string> {
  let candidate = desired
  let i = 1
  while (await branchExists(repoPath, candidate)) {
    candidate = `${desired}-docs-migration-${i}`
    i += 1
  }
  return candidate
}

/**
 * Open clerk-docs PR for this head, if any. Used for clerk PR title/body, backlink comment, and whether we may open a clerk PR.
 * The clerk PR base always comes from --clerk-base (default main).
 */
async function resolveSourcePr(config: CliConfig, headBranch: string): Promise<PullRequestView | null> {
  const list = await commandJson<PullRequestView[]>(
    'gh',
    [
      'pr',
      'list',
      '--repo',
      formatRepoSlug(config.clerkDocsRepo),
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
    infoLog('Found open clerk-docs PR (for title/body and comment)', {
      number: list[0].number,
      isDraft: list[0].isDraft,
    })
    return list[0]
  }

  if (list.length > 1) {
    if (config.prNumber !== undefined && Number.isFinite(config.prNumber)) {
      const picked = list.find((pr) => pr.number === config.prNumber)
      if (!picked) {
        throw new Error(
          `--pr ${config.prNumber} does not match any of the open PRs for head "${headBranch}": ${list.map((p) => p.number).join(', ')}`,
        )
      }
      infoLog('Using clerk-docs PR from --pr', { number: picked.number, isDraft: picked.isDraft })
      return picked
    }
    if (!stdinSupportsInteractivePrompts()) {
      throw new Error(
        `Multiple open PRs for head "${headBranch}": ${list.map((p) => `#${p.number}`).join(', ')}. Re-run with --pr <number> (stdin is not a TTY).`,
      )
    }
    return await promptPickSourcePr(list)
  }

  warnLog(
    'No open clerk-docs PR for this head; migration will still push a clerk branch but will not open a clerk PR.',
    {
      headBranch,
    },
  )
  return null
}

async function ensureClerkOnBranch(config: CliConfig, clerkPath: string, branch: string): Promise<void> {
  const current = await getCurrentBranch(clerkPath)
  if (current === branch) return
  if (config.dryRun) {
    warnLog('Dry-run: clerk should be on base branch before migrate', { expected: branch, current })
    return
  }
  await runCommand('git', ['checkout', branch], clerkPath)
}

async function mergeMainIntoCurrentBranch(config: CliConfig): Promise<void> {
  stepLog('Merging clerk-docs/main into current branch')
  const current = await getCurrentBranch(config.clerkDocsPath)
  if (config.dryRun) {
    infoLog('Dry-run: would fetch and merge origin/main', { current })
    return
  }
  await runCommand('git', ['fetch', 'origin', 'main'], config.clerkDocsPath)
  const merge = await runCommand('git', ['merge', 'origin/main'], config.clerkDocsPath, { allowFailure: true })
  if (merge.code !== 0) {
    throwMigrationError('merge-main-conflict')
  }
}

async function maybeAlignClerkDocsBranch(config: CliConfig, currentBranch: string): Promise<string> {
  const desired = config.clerkDocsBaseBranch
  if (!desired || desired === currentBranch) return currentBranch
  if (!stdinSupportsInteractivePrompts()) {
    throw new Error(
      `Current clerk-docs branch is "${currentBranch}", but --docs-base is "${desired}". ` +
        'Non-interactive environment (stdin is not a TTY): checkout that branch manually, or run from an interactive terminal.',
    )
  }

  output.write(`\nCurrent clerk-docs branch is "${currentBranch}", but --docs-base requested "${desired}".\n`)
  const rl = readline.createInterface({ input, output })
  try {
    const answer = (await rl.question(`Checkout "${desired}" before continuing? (y/N): `)).trim().toLowerCase()
    if (answer !== 'y' && answer !== 'yes') {
      throw new Error('Stopped by user before switching clerk-docs branch.')
    }
  } finally {
    rl.close()
  }

  if (config.dryRun) {
    warnLog(`Dry-run: would checkout clerk-docs branch "${desired}" before continuing.`)
    return desired
  }
  await runCommand('git', ['checkout', desired], config.clerkDocsPath)
  const after = await getCurrentBranch(config.clerkDocsPath)
  if (after !== desired) {
    throw new Error(`Attempted to checkout "${desired}" but current branch is "${after}".`)
  }
  warnLog(`Checked out clerk-docs branch "${desired}" before migration.`)
  return after
}

async function maybeCommentWithMarker(
  config: CliConfig,
  prNumber: number,
  repo: string,
  body: string,
): Promise<boolean> {
  const view = await commandJson<{ comments: Array<{ body: string }> }>(
    'gh',
    ['pr', 'view', String(prNumber), '--repo', repo, '--json', 'comments'],
    process.cwd(),
  )
  if (view.comments.some((comment) => comment.body.includes(MIGRATION_NOTICE_MARKER))) {
    infoLog('Skipping comment; marker already exists', { repo, prNumber })
    return false
  }
  if (!config.dryRun) {
    await runCommand('gh', ['pr', 'comment', String(prNumber), '--repo', repo, '--body', body], process.cwd())
  } else {
    infoLog('Dry-run: would post comment', { repo, prNumber })
  }
  return true
}

async function migrateCurrentBranch(
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
    infoLog('Dry-run: would filter-repo, merge, push', {
      clerkWorkPath: clerkWorkPath || '(would clone clerk to temp)',
      suggestedBranch: `${headRef}-docs-migration`,
      clerkPr: sourcePr ? 'would create (open clerk-docs PR exists)' : 'would skip (no open clerk-docs PR)',
      gitignore:
        'would remove /clerk-docs (and bare clerk-docs/) entries from clerk root .gitignore if present, then commit if changed',
      commitMessages: `would rewrite #NNN refs in commit messages to ${formatRepoSlug(config.clerkDocsRepo)}#NNN`,
      clerkPrPeople:
        sourcePr !== null
          ? 'would match draft + assignees + requested reviewers from source PR where possible; review approvals cannot transfer (summarized in PR body)'
          : 'n/a',
    })
    return { newBranch: `${headRef}-docs-migration`, clerkPrUrl: '(dry-run)' }
  }

  const sourceMeta =
    sourcePr !== null
      ? await fetchSourcePrMigrationMetadata(formatRepoSlug(config.clerkDocsRepo), sourcePr.number)
      : null
  let body = bodyBase
  if (sourceMeta) {
    body += formatSourcePrMigrationAppendix(sourceMeta)
  }

  const newBranch = await ensureBranchNameAvailable(clerkWorkPath, `${headRef}-docs-migration`)
  stepLog('Migrating current branch into clerk', { headRef, baseRef, newBranch, clerkWorkPath })

  const tempClonePath = path.join(os.tmpdir(), `clerk-docs-migrate-${sanitizeBranchForPath(headRef)}-${Date.now()}`)
  const remoteName = `clerk-docs-migrate-${Date.now()}`

  try {
    stepLog('Duplicating local clerk-docs for filter-repo', {
      from: config.clerkDocsPath,
      to: tempClonePath,
      branch: headRef,
      note: 'This is a local git clone of your checkout (not gh clone of clerk/clerk-docs). Large repos can take many minutes.',
    })
    await runCommand(
      'git',
      ['clone', '--single-branch', '--branch', headRef, config.clerkDocsPath, tempClonePath],
      process.cwd(),
    )
    const messageCallback = buildPrRefsRewriteCallback(formatRepoSlug(config.clerkDocsRepo))
    await runCommand(
      filterRepo.command,
      [
        ...filterRepo.argsPrefix,
        '--to-subdirectory-filter',
        TARGET_DIR_IN_CLERK,
        '--message-callback',
        messageCallback,
        '--force',
      ],
      tempClonePath,
    )
    await runCommand('git', ['remote', 'add', remoteName, tempClonePath], clerkWorkPath)
    await runCommand('git', ['fetch', remoteName], clerkWorkPath)
    await runCommand('git', ['checkout', baseRef], clerkWorkPath)
    await runCommand('git', ['checkout', '-b', newBranch], clerkWorkPath)
    await runCommand(
      'git',
      [
        'merge',
        `${remoteName}/${headRef}`,
        '--allow-unrelated-histories',
        '-m',
        `Migrate clerk-docs branch ${headRef}`,
      ],
      clerkWorkPath,
    )
    const gitignoreStripped = await stripClerkDocsRootGitignoreEntries(clerkWorkPath)
    if (gitignoreStripped) {
      await runCommand('git', ['add', '.gitignore'], clerkWorkPath)
      await runCommand(
        'git',
        ['commit', '-m', 'chore: stop ignoring clerk-docs after in-repo migration'],
        clerkWorkPath,
      )
    }
    if (config.localOnly) {
      warnLog(
        `--local-only enabled: created local branch "${newBranch}" in clerk workspace; skipping push and PR sync.`,
      )
      return { newBranch, clerkPrUrl: '(local-only: not pushed, no PR created)' }
    }

    await runCommand('git', ['push', '-u', 'origin', newBranch], clerkWorkPath)

    const existing = await commandJson<Array<{ url: string }>>(
      'gh',
      [
        'pr',
        'list',
        '--repo',
        formatRepoSlug(config.clerkRepo),
        '--state',
        'open',
        '--head',
        newBranch,
        '--json',
        'url',
      ],
      process.cwd(),
    )
    let clerkPrUrl: string
    if (existing[0]?.url) {
      clerkPrUrl = existing[0].url
      infoLog('Clerk PR already open for this branch', { url: clerkPrUrl })
    } else if (sourcePr) {
      const isDraft = sourceMeta?.isDraft ?? sourcePr.isDraft
      const assigneeLogins = sourceMeta?.assigneeLogins ?? []
      const reviewerHandles = sourceMeta?.reviewerHandles ?? []
      clerkPrUrl = await createClerkPullRequestWithPeople(config, {
        baseRef,
        head: newBranch,
        title,
        body,
        isDraft,
        assigneeLogins,
        reviewerHandles,
      })
    } else {
      warnLog('Skipping clerk PR creation: open a clerk-docs PR for this branch first, or open a clerk PR manually.', {
        newBranch,
        headRef,
      })
      clerkPrUrl = '(no clerk PR — requires an open clerk-docs PR for this head)'
    }

    if (sourcePr) {
      try {
        await maybeCommentWithMarker(
          config,
          sourcePr.number,
          formatRepoSlug(config.clerkDocsRepo),
          `${MIGRATION_NOTICE_MARKER}\nThis branch and pr were migrated to: ${clerkPrUrl}`,
        )
      } catch (err) {
        warnLog('Could not comment on source PR (migration itself succeeded)', {
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    return { newBranch, clerkPrUrl }
  } finally {
    await runCommand('git', ['remote', 'remove', remoteName], clerkWorkPath, { allowFailure: true })
    await fs.rm(tempClonePath, { recursive: true, force: true })
  }
}

interface RunPhase {
  name: string
  completed: string[]
}

function printRunIntro(config: CliConfig): void {
  const lines = [
    '',
    'Migration overview',
    '- Merges origin/main into your current clerk-docs feature branch',
    '- Rewrites that branch history under clerk/clerk-docs/',
    '- Merges rewritten history into a new branch in the clerk repo',
    '- Pushes the branch and opens/links PRs when source PR context is available',
    '',
    'Run configuration',
    `- mode: ${config.dryRun ? 'dry-run (no writes)' : 'execute'}`,
    `- clerk-docs path: ${config.clerkDocsPath}`,
    `- desired clerk-docs branch: ${config.clerkDocsBaseBranch ?? '(current branch)'}`,
    `- clerk path: ${config.clerkPath ?? '(temp clone via gh repo clone)'}`,
    `- clerk repo: ${formatRepoSlug(config.clerkRepo)}`,
    `- clerk-docs repo: ${formatRepoSlug(config.clerkDocsRepo)}`,
    `- clerk base branch: ${config.clerkBaseBranch}`,
    `- local-only (skip push/PR): ${config.localOnly ? 'yes' : 'no'}`,
    `- allow dirty clerk: ${config.allowDirtyClerk ? 'yes' : 'no'}`,
    `- allow dirty clerk-docs: ${config.allowDirtyClerkDocs ? 'yes' : 'no'}`,
    `- interactive prompts (stdin TTY): ${stdinSupportsInteractivePrompts() ? 'yes' : 'no'}`,
    `- verbose logging: ${config.debug ? 'yes' : 'no (use --verbose)'}`,
    '',
  ]
  console.log(lines.join('\n'))
}

function printRunOutro(details: { newBranchInClerk: string; clerkPrUrl: string }): void {
  console.log(
    [
      '',
      'Results:',
      `- migrated branch in clerk: ${details.newBranchInClerk}`,
      `- migrated PR in clerk: ${details.clerkPrUrl}`,
      '',
    ].join('\n'),
  )
}

interface ActionableFailure {
  summary: string
  hints: string[]
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return String(error)
}

function describeFailure(error: unknown, config: CliConfig): ActionableFailure {
  if (error instanceof MigrationError) {
    const raw = error.message.trim()
    return {
      summary: raw.split('\n')[0] ?? raw,
      hints: [...error.hints],
    }
  }

  const raw = toErrorMessage(error).trim()
  const summary = raw.split('\n')[0] ?? raw

  // Non-existent --clerk-path cwd often surfaces as spawn ENOENT before we could run git; same text if `git` is missing.
  if (summary.includes('spawn git ENOENT')) {
    return {
      summary,
      hints: [
        'If you passed --clerk-path: confirm that folder exists and is the clerk repo root (typos cause this error).',
        'Otherwise ensure `git` is installed and on your PATH (`which git`).',
      ],
    }
  }

  return {
    summary,
    hints: config.debug ? [] : ['Re-run with --verbose for additional diagnostics.'],
  }
}

async function main(): Promise<void> {
  const config = parseConfig()
  const phases: RunPhase[] = []
  let currentPhase = 'start'
  let workspace: ClerkWorkspace | null = null
  let temporaryWorkspaceRemoved = false

  printRunIntro(config)

  try {
    currentPhase = 'preflight'
    stepLog('Running preflight checks')
    if (config.clerkPath) {
      assertClerkPathResolvable(config.clerkPath)
      await assertNoStaleImportRemote(config.clerkPath)
    }
    await assertCommandAvailable('git')
    await assertCommandAvailable('gh')
    await assertMinimumVersion('git', 'git', ['--version'], MIN_TOOL_VERSIONS.git)
    await assertMinimumVersion('gh', 'gh', ['--version'], MIN_TOOL_VERSIONS.gh)
    const filterRepoInvoker = await resolveGitFilterRepoInvoker()
    await assertGhAuthenticated()
    await assertGithubRepoMigrationAccess(config)
    await assertGitRepo(config.clerkDocsPath, 'clerk-docs')
    if (config.allowDirtyClerkDocs) {
      warnLog(
        'Bypassing clean-working-tree check for clerk-docs due to --allow-dirty-docs. Local edits may affect migration output.',
      )
    } else {
      await assertCleanWorkingTree(config.clerkDocsPath, 'clerk-docs')
    }

    let clerkDocsBranch = await getCurrentBranch(config.clerkDocsPath)
    clerkDocsBranch = await maybeAlignClerkDocsBranch(config, clerkDocsBranch)
    if (clerkDocsBranch === 'main') {
      throwMigrationError('refuse-clerk-docs-main')
    }

    const baseRef = config.clerkBaseBranch
    infoLog('Clerk PR will target base branch', { repo: formatRepoSlug(config.clerkRepo), baseRef })
    const sourcePr = await resolveSourcePr(config, clerkDocsBranch)
    if (sourcePr && sourcePr.baseRefName !== baseRef) {
      warnLog(
        'Open clerk-docs PR targets a different base than --clerk-base; the new clerk PR uses --clerk-base only.',
        {
          clerkDocsPrBase: sourcePr.baseRefName,
          clerkBase: baseRef,
        },
      )
    }
    workspace = await prepareClerkWorkspace(config, baseRef)
    phases.push({
      name: 'preflight',
      completed: [
        'Tools, auth, clerk-docs clean',
        workspace.isTemporary
          ? `Clerk workspace: temp clone at ${workspace.path || '(dry-run)'}`
          : `Clerk workspace: local ${workspace.path}`,
      ],
    })

    await checkpoint({
      title: 'Preflight complete',
      completed: phases.flatMap((p) => p.completed),
      next: 'Merge origin/main into this feature branch',
    })

    currentPhase = 'merge-main'
    await mergeMainIntoCurrentBranch(config)
    phases.push({ name: 'merge-main', completed: ['Merged origin/main into feature branch (or dry-run)'] })

    await checkpoint({
      title: 'Merge main complete',
      completed: phases.flatMap((p) => p.completed),
      next: 'Rewrite history and push in clerk (opens a clerk PR only if an open clerk-docs PR exists)',
    })

    currentPhase = 'migrate-branch'
    const { newBranch, clerkPrUrl } = await migrateCurrentBranch(
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

    if (!workspace.isTemporary) {
      const clerkDocsInClerk = path.join(workspace.path, TARGET_DIR_IN_CLERK)
      if (config.dryRun) {
        infoLog('Dry-run: would run pnpm install in clerk-docs inside clerk workspace', { path: clerkDocsInClerk })
      } else if (existsSync(clerkDocsInClerk)) {
        stepLog('Installing clerk-docs dependencies in clerk workspace')
        const pnpmResult = await runCommand('pnpm', ['install'], clerkDocsInClerk, {
          inheritStdio: true,
          allowFailure: true,
        })
        if (pnpmResult.code !== 0) {
          warnLog('pnpm install failed (non-fatal; migration itself succeeded). You may need to run it manually.', {
            exitCode: pnpmResult.code,
          })
        }
      }
    }

    if (workspace.isTemporary && workspace.path && !config.dryRun) {
      try {
        await fs.rm(workspace.path, { recursive: true, force: true })
        temporaryWorkspaceRemoved = true
        infoLog('Removed temporary clerk clone', { path: workspace.path })
      } catch (cleanupErr) {
        warnLog('Could not remove temporary clerk clone (non-fatal). Delete it manually if desired.', {
          path: workspace.path,
          error: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
        })
      }
    }

    stepLog('Migration completed')
    printRunOutro({
      newBranchInClerk: newBranch,
      clerkPrUrl,
    })
  } catch (err) {
    const failure = describeFailure(err, config)
    errorLog(`Migration failed: ${failure.summary}`)
    if (failure.hints.length > 0) {
      errorLog('Suggested fix:')
      for (const hint of failure.hints) {
        errorLog(`- ${hint}`)
      }
    }
    infoLog(`Stopped in phase: ${currentPhase}`)
    if (workspace?.isTemporary && workspace.path) {
      warnLog(`Temporary clerk clone may still exist on disk: ${workspace.path}`)
    }
    warnLog('No automatic cleanup on failure.')
    if (!config.dryRun) {
      infoLog('Cleanup reminders:')
      infoLog('- Reset clerk-docs if needed before retrying.')
      infoLog('- If you used a temp clerk clone, delete that folder when done inspecting it.')
      infoLog('- If you used --clerk-path, remove any clerk-docs-migrate-* remote if present.')
    }
    process.exitCode = 1
    return
  }
}

export {
  sanitizeBranchForPath,
  lineIgnoresSymlinkedClerkDocsRoot,
  stripClerkDocsRootGitignoreEntries,
  parseConfig,
  reviewRequestToHandle,
  parseGhPrViewForMigration,
  formatSourcePrMigrationAppendix,
  runCommand,
  commandJson,
  parseSemverLoose,
  isSemverAtLeast,
  assertSemverAtLeast,
  canPushToRepo,
  canReadRepo,
  canCommentOnPrInRepo,
  assertGitFilterRepoVersionOutput,
  rewritePrRefsInCommitMessage,
  buildPrRefsRewriteCallback,
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('[migration][FATAL]', error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
