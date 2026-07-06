/**
 * PR / branch migration only: run from your clerk-docs feature branch (not main).
 *
 * First run (create mode):
 *   Merges origin/main into the current clerk-docs branch, rewrites that branch's history under
 *   clerk/clerk-docs/ (preserving authors per imported commit), merges the rewritten history into a
 *   new branch in the clerk repo (branched from origin/<--clerk-base>, not the local base branch),
 *   pushes it, and opens a PR in clerk if an open clerk-docs PR exists. A backlink comment is added
 *   to the source clerk-docs PR and that PR is then closed (the close is skipped if the backlink
 *   comment could not be posted).
 *
 * Re-run on the same clerk-docs branch (update mode):
 *   Safe and idempotent. The script detects the existing `${headRef}-docs-migration` branch on clerk,
 *   merges the latest clerk base (taken from the existing clerk PR's base branch, falling back to
 *   --clerk-base) plus the latest clerk-docs commits onto it, and pushes. A clerk PR is only opened
 *   if the branch has no PR yet (recovers from a run where the push succeeded but PR creation failed).
 *   If the existing clerk PR is CLOSED or MERGED the script aborts with instructions. If a re-merge
 *   conflicts, the working tree is left in a conflicted state (with the filter-repo remote preserved)
 *   so you can resolve in your IDE and push manually, or `git merge --abort` and re-run.
 */
import { existsSync, lstatSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { z } from 'zod'

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'step'
type Json = Record<string, unknown>

/** Owner and repository name from a validated `owner/repo` slug. */
type RepoSlug = readonly [owner: string, name: string]

function formatRepoSlug(slug: RepoSlug): string {
  return `${slug[0]}/${slug[1]}`
}

/**
 * True when the clerk-docs project directory sits *below* the git root rather than being it.
 * In a standalone clerk-docs checkout these are the same path; after migration into clerk/clerk the
 * docs live at `<clerk>/clerk-docs`, so the git root is an ancestor — the signal we refuse on.
 */
function gitRootIsAboveDocsProject(docsProjectDir: string, gitRoot: string): boolean {
  return path.resolve(gitRoot) !== path.resolve(docsProjectDir)
}

interface CliConfig {
  /** If set, use this existing clone instead of cloning clerk to a temp directory */
  clerkPath?: string
  clerkDocsPath: string
  /** Optional branch to require/use in clerk-docs before migration begins */
  clerkDocsBaseBranch?: string
  /** Branch in clerk (see --clerk-repo) to base the migration branch and new PR on; default main */
  clerkBaseBranch: string
  /**
   * Whether --clerk-base was passed explicitly (vs defaulted to main). Update mode uses this to
   * decide between silently following the existing clerk PR's base and aborting on a mismatch.
   */
  clerkBaseBranchExplicit: boolean
  /**
   * Override the clerk-side branch name to migrate into (e.g. `nick/my-new-branch`).
   * When unset, defaults to `${headRef}-docs-migration`. Used for both create and update mode:
   * if the named branch already exists on clerk the run updates it instead of creating a new one.
   * `main` is rejected: update mode would push migration commits directly to clerk's default branch.
   */
  targetBranch?: string
  /**
   * Create or update the migrated branch locally but do not push, open PRs, or comment on the source PR.
   * In update mode this means the existing clerk branch is checked out and re-merged locally only.
   */
  localOnly: boolean
  dryRun: boolean
  /** Skip preflight refusal when local clerk has uncommitted changes */
  allowDirtyClerk: boolean
  /** Skip preflight refusal when clerk-docs has local uncommitted changes */
  allowDirtyClerkDocs: boolean
  /**
   * Skip preflight refusal when the current clerk-docs branch is `main`. Off by default because
   * migrating `main` rewrites the entire clerk-docs history into clerk and is almost always the
   * wrong thing to do for an ad-hoc PR migration.
   */
  allowClerkDocsMain: boolean
  debug: boolean
  clerkRepo: RepoSlug
  clerkDocsRepo: RepoSlug
  /** When several open PRs share the same head, use this PR number (required if stdin is not a TTY) */
  prNumber?: number
  /**
   * In create mode, close the source clerk-docs PR after posting the backlink comment. Default true.
   * Disable with `--no-close-source-pr` when you want to leave the source PR open for review.
   */
  closeSourcePr: boolean
  /**
   * Merge `origin/main` into the current clerk-docs branch as the first migration step. Default true.
   * Disable with `--no-merge-main` when the branch is already up to date with main or you want to
   * migrate the branch exactly as-is without picking up new commits from main.
   */
  mergeMain: boolean
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
  /** GitHub PR state: 'OPEN' | 'CLOSED' | 'MERGED' (uppercase from `gh pr list --json state`). */
  state: string
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
    hints: (): readonly string[] => [
      'Checkout your feature branch in clerk-docs and rerun from there.',
      'If you really want to migrate main (e.g. a one-shot full-history import), rerun with --allow-docs-main.',
    ],
  },
  'refuse-target-branch-main': {
    message: (): string =>
      '--target-branch cannot be "main": the target branch is the clerk-side branch this run pushes migration commits to. ' +
      'Since "main" already exists on clerk, the run would switch to update mode and push the migration directly to clerk\'s default branch instead of going through a PR.',
    hints: (): readonly string[] => [
      'Pass a feature branch name instead, e.g. --target-branch nick/my-docs-migration.',
      'Or drop --target-branch to use the default name: <docs-branch>-docs-migration.',
    ],
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
  'running-inside-enclosing-repo': {
    message: (params: { docsProjectDir: string; gitRoot: string }): string =>
      `Refusing to run: clerk-docs lives at ${params.docsProjectDir}, but the enclosing git repository is ${params.gitRoot}. ` +
      `This script is kept in clerk-docs/scripts and ships into clerk/clerk after migration — it looks like you're running the copy inside clerk, which would rewrite clerk's own history into clerk-docs/.`,
    hints: (_params: { docsProjectDir: string; gitRoot: string }): readonly string[] => [
      'Run this from a standalone clerk-docs checkout (where clerk-docs is the git root), not from the clerk-docs/ directory inside clerk.',
    ],
  },
  'migration-branch-pr-closed': {
    message: (params: { branch: string; prUrl: string; state: string }): string => formatClosedPrAbortMessage(params),
    hints: (_params: { branch: string; prUrl: string; state: string }): readonly string[] => [
      'Reopen the PR in clerk so this script can push new commits to the existing migration branch.',
      'Alternatively, delete the branch in clerk (gh api -X DELETE repos/<owner>/<repo>/git/refs/heads/<branch>) and re-run to start a fresh migration with a new PR.',
    ],
  },
  'update-merge-conflict': {
    message: (params: MergeConflictHintParams): string =>
      `Merge conflict while updating existing migration branch "${params.branch}". The latest clerk base or new clerk-docs changes conflict with the existing branch state in clerk.`,
    hints: (params: MergeConflictHintParams): readonly string[] => formatUpdateMergeConflictHints(params),
  },
  'create-merge-conflict': {
    message: (params: MergeConflictHintParams): string =>
      `Merge conflict while migrating clerk-docs history onto new branch "${params.branch}". The rewritten clerk-docs tree conflicts with the existing clerk-docs/ contents in clerk.`,
    hints: (params: MergeConflictHintParams): readonly string[] => formatUpdateMergeConflictHints(params),
  },
  'local-only-requires-clerk-path': {
    message: (): string =>
      '--local-only requires --clerk-path. Without it the migrated branch would only exist in a temporary clone that is deleted at the end of the run. Pass --clerk-path <path-to-clerk-checkout>.',
    hints: (): readonly string[] => [
      'Re-run with --clerk-path pointing at your local clerk checkout so the branch survives the run.',
      'Or drop --local-only to push the migrated branch to the clerk remote.',
    ],
  },
  'detached-head': {
    message: (): string =>
      'clerk-docs is on a detached HEAD (or an unborn branch); there is no current branch to migrate.',
    hints: (): readonly string[] => [
      'Checkout the clerk-docs feature branch you want to migrate (git checkout <branch>), then re-run.',
    ],
  },
  'docs-path-inside-enclosing-repo': {
    message: (params: { docsPath: string; gitRoot: string }): string =>
      `Refusing to run: --docs-path ${params.docsPath} is nested inside the git repository ${params.gitRoot} rather than being its own repo root. ` +
      `It looks like it points at the clerk-docs/ directory inside clerk (or another parent repo); running against it would fetch and merge that parent repo's history.`,
    hints: (_params: { docsPath: string; gitRoot: string }): readonly string[] => [
      'Point --docs-path at a standalone clerk-docs checkout whose git root is the clerk-docs directory itself.',
    ],
  },
  'docs-repo-shallow': {
    message: (docsPath: string): string =>
      `clerk-docs at ${docsPath} is a shallow clone. Migrating it would rewrite truncated history into clerk (losing commits/authors beyond the shallow boundary).`,
    hints: (_docsPath: string): readonly string[] => [
      'Fetch the full history first: git fetch --unshallow origin, then re-run.',
    ],
  },
  'origin-remote-mismatch': {
    message: (params: { label: string; repoPath: string; expectedSlug: string; originUrl: string }): string =>
      `${params.label} origin remote does not match the configured repo. Expected ${params.expectedSlug}, but origin in ${params.repoPath} points at ${params.originUrl}. ` +
      `Pushes/fetches use origin while gh calls use the configured slug, so they must refer to the same repository.`,
    hints: (params: {
      label: string
      repoPath: string
      expectedSlug: string
      originUrl: string
    }): readonly string[] => [
      `If the local clone is correct, pass the matching slug via ${params.label === 'clerk' ? '--clerk-repo' : '--docs-repo'}.`,
      `If the slug is correct, fix the remote: git -C "${params.repoPath}" remote set-url origin git@github.com:${params.expectedSlug}.git`,
    ],
  },
  'docs-branch-behind-origin': {
    message: (params: { branch: string; behindCount: number }): string =>
      `Local clerk-docs branch "${params.branch}" is ${params.behindCount} commit(s) behind origin/${params.branch}. ` +
      `Migrating now would silently drop those commits from the migration while still closing the source PR.`,
    hints: (params: { branch: string; behindCount: number }): readonly string[] => [
      `Pull the missing commits first (git pull origin ${params.branch}), then re-run.`,
    ],
  },
  'docs-branch-ahead-of-origin': {
    message: (params: { branch: string; aheadCount: number }): string =>
      `Local clerk-docs branch "${params.branch}" is ${params.aheadCount} commit(s) ahead of origin/${params.branch}. ` +
      `Migrating now would carry commits into clerk that were never part of the source clerk-docs PR, which this run then closes.`,
    hints: (params: { branch: string; aheadCount: number }): readonly string[] => [
      `Push the local commits first (git push origin ${params.branch}) so the source PR reflects everything being migrated, then re-run.`,
      `Or discard them intentionally: git reset --hard origin/${params.branch}, then re-run.`,
    ],
  },
  'migration-branch-local-ahead': {
    message: (params: { branch: string; aheadCount: number; workspacePath: string }): string =>
      `Refusing to reset migration branch "${params.branch}": the local branch in ${params.workspacePath} is ${params.aheadCount} commit(s) ahead of origin/${params.branch}. ` +
      `Continuing would silently discard those local commits (e.g. a manual conflict resolution that was never pushed).`,
    hints: (params: { branch: string; aheadCount: number; workspacePath: string }): readonly string[] => [
      `Push the local commits first: git -C "${params.workspacePath}" push origin ${params.branch}, then re-run.`,
      `Or discard them intentionally: git -C "${params.workspacePath}" branch -D ${params.branch}, then re-run.`,
    ],
  },
  'migration-branch-exists-locally': {
    message: (params: { branch: string; workspacePath: string }): string =>
      `Branch "${params.branch}" already exists locally in ${params.workspacePath} but not on the clerk remote, so this run cannot safely create it. ` +
      `It is probably left over from a previous --local-only run or a run whose push failed.`,
    hints: (params: { branch: string; workspacePath: string }): readonly string[] => [
      `To keep that work: push it (git -C "${params.workspacePath}" push -u origin ${params.branch}) and re-run — the script will switch to update mode.`,
      `To discard it: git -C "${params.workspacePath}" branch -D ${params.branch}, then re-run.`,
      'Or pass --target-branch <name> to migrate into a different clerk branch name.',
    ],
  },
  'clerk-base-mismatch': {
    message: (params: { prUrl: string; prBase: string; configuredBase: string; migrationBranch: string }): string =>
      `--clerk-base is "${params.configuredBase}" but the existing clerk PR (${params.prUrl}) is based on "${params.prBase}". ` +
      `Merging a different base into the migration branch would pull unrelated commits into the open PR.`,
    hints: (params: {
      prUrl: string
      prBase: string
      configuredBase: string
      migrationBranch: string
    }): readonly string[] => [
      `Re-run with --clerk-base ${params.prBase} (or drop --clerk-base to follow the PR's base automatically).`,
      `If you only want the commits from "${params.configuredBase}" included in the PR, keep the base as-is and merge them into the migration branch yourself: in a clerk checkout, git checkout ${params.migrationBranch}, git merge origin/${params.configuredBase}, git push — then re-run without --clerk-base.`,
      'If you really want a different base, retarget the clerk PR on GitHub first.',
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

Re-running on the same clerk-docs branch is safe: the script detects the existing ${'`${headRef}-docs-migration`'} branch in clerk and updates it with new commits instead of creating a duplicate branch or PR (a clerk PR is opened on re-run only if the branch has none yet). Update mode follows the existing clerk PR's base branch. If the existing clerk PR is CLOSED or MERGED the script aborts with instructions; if the re-merge conflicts, resolve in your IDE and push manually (or abort and re-run).

By default clones the clerk repo (see --clerk-repo) into a temp directory (needs gh auth with push access). Use --clerk-path for an existing local clone instead. Use --clerk-path when a conflict is likely, since conflict resolution happens in the clerk workspace.

Unknown flags, duplicate flags, and flags with missing values are rejected. Both "--flag value" and "--flag=value" forms work.

Optional:
  --clerk-path <path>         Path to the local clerk (default: clones into a temp directory)
  --clerk-repo <owner/repo>   Target PR repo (default: clerk/clerk); must match the clerk clone's origin remote
  --clerk-base <branch>       Branch in clerk to base the new PR on (default: main). In update mode the existing clerk PR's base wins; passing a conflicting --clerk-base aborts.
  --target-branch <branch>    Clerk-side branch name to migrate into, e.g. nick/my-new-branch (default: <docs-branch>-docs-migration). If that branch already exists on clerk, the run updates it instead of creating a new branch. "main" is rejected — updating it would push the migration directly to clerk's default branch.
  --allow-dirty-clerk         Skip clean-tree preflight for local clerk (only applies with --clerk-path); uncommitted changes stay in your working tree and are not included in the PR

  --docs-path <path>          Path to the clerk-docs repo (default: cwd)
  --docs-repo <owner/repo>    Source PR lookup (default: clerk/clerk-docs); must match the clerk-docs checkout's origin remote
  --docs-base <branch>        Desired checked-out branch in clerk-docs before migration starts
  --allow-dirty-docs          Skip clean-tree preflight for clerk-docs; only committed history is migrated (filter-repo reads commits, not the working tree), though the merge of origin/main can still abort if local edits conflict
  --allow-docs-main           Skip the preflight refusal when the current clerk-docs branch is "main". Off by default because migrating main rewrites the entire clerk-docs history into clerk; only use it when you know that is what you want (e.g. a one-shot full-history import).

  --local-only                Create or update the migrated branch in the clerk workspace only (skip push, PR creation, and source-PR comment). Requires --clerk-path; without it the branch would only exist in a temp clone that is deleted at the end of the run.
  --dry-run                   Print planned actions without git/GitHub writes (still performs read-only gh calls for auth, permissions, and PR lookups)
  --pr <number>               Open clerk-docs PR to use for this branch; always validated against the open PRs for the branch. Required when several PRs match and stdin is not a TTY.
  --no-close-source-pr        Skip closing the source clerk-docs PR after the backlink comment is posted (default: close it; the close is skipped automatically if the comment fails)
  --no-merge-main             Skip merging origin/main into the current clerk-docs branch before migration (default: merge it). Use when the branch is already up to date or you want to migrate it as-is.
  --debug, --verbose          Verbose logs (includes JSON metadata)
  --help
`)
}

/**
 * Full CLI surface for `util.parseArgs` in strict mode: unknown flags and value flags with a
 * missing value (`--clerk-path --dry-run`) are hard errors instead of being silently ignored.
 * Legacy `--clerk-docs-*` aliases are separate options coalesced in {@link parseConfig}.
 */
const CLI_OPTIONS = {
  help: { type: 'boolean' },
  'clerk-path': { type: 'string' },
  'clerk-repo': { type: 'string' },
  'clerk-base': { type: 'string' },
  'target-branch': { type: 'string' },
  'clerk-target-branch': { type: 'string' },
  'allow-dirty-clerk': { type: 'boolean' },
  'docs-path': { type: 'string' },
  'clerk-docs-path': { type: 'string' },
  'docs-repo': { type: 'string' },
  'clerk-docs-repo': { type: 'string' },
  'docs-base': { type: 'string' },
  'clerk-docs-base': { type: 'string' },
  'allow-dirty-docs': { type: 'boolean' },
  'allow-dirty-clerk-docs': { type: 'boolean' },
  'allow-docs-main': { type: 'boolean' },
  'allow-clerk-docs-main': { type: 'boolean' },
  'local-only': { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  pr: { type: 'string' },
  'no-close-source-pr': { type: 'boolean' },
  'no-merge-main': { type: 'boolean' },
  debug: { type: 'boolean' },
  verbose: { type: 'boolean' },
} as const

const CLI_OPTION_CANONICAL_NAMES: Record<keyof typeof CLI_OPTIONS, string> = {
  help: 'help',
  'clerk-path': 'clerk-path',
  'clerk-repo': 'clerk-repo',
  'clerk-base': 'clerk-base',
  'target-branch': 'target-branch',
  'clerk-target-branch': 'target-branch',
  'allow-dirty-clerk': 'allow-dirty-clerk',
  'docs-path': 'docs-path',
  'clerk-docs-path': 'docs-path',
  'docs-repo': 'docs-repo',
  'clerk-docs-repo': 'docs-repo',
  'docs-base': 'docs-base',
  'clerk-docs-base': 'docs-base',
  'allow-dirty-docs': 'allow-dirty-docs',
  'allow-dirty-clerk-docs': 'allow-dirty-docs',
  'allow-docs-main': 'allow-docs-main',
  'allow-clerk-docs-main': 'allow-docs-main',
  'local-only': 'local-only',
  'dry-run': 'dry-run',
  pr: 'pr',
  'no-close-source-pr': 'no-close-source-pr',
  'no-merge-main': 'no-merge-main',
  debug: 'debug',
  verbose: 'debug',
}

function assertNoDuplicateCliOptions(tokens: ReturnType<typeof parseArgs>['tokens']): void {
  const seen = new Map<string, string>()
  for (const token of tokens ?? []) {
    if (token.kind !== 'option') continue
    const canonical = CLI_OPTION_CANONICAL_NAMES[token.name as keyof typeof CLI_OPTIONS]
    if (!canonical) continue
    const previous = seen.get(canonical)
    if (previous) {
      throw new Error(
        `Duplicate CLI argument: --${previous} and --${token.name} both set ${canonical}. Pass it only once.`,
      )
    }
    seen.set(canonical, token.name)
  }
}

/** When false, readline prompts cannot run; caller must pass flags (e.g. --pr) or fix branch state instead. */
function stdinSupportsInteractivePrompts(): boolean {
  return Boolean(input.isTTY)
}

/**
 * GitHub owner/repo name charset. Also keeps the slug safe to interpolate into the Python
 * bytes literal built by {@link buildPrRefsRewriteCallback} (no quotes/backslashes possible).
 */
const REPO_SLUG_PART = /^[A-Za-z0-9_.-]+$/

/** Parses `owner/repo` into a two-element tuple. */
const repoSlugSchema = z
  .string()
  .refine(
    (s) => {
      const p = s.split('/')
      return p.length === 2 && REPO_SLUG_PART.test(p[0]) && REPO_SLUG_PART.test(p[1])
    },
    (slug) => ({ message: `Invalid repo slug: ${slug} (expected owner/repo using letters, digits, ".", "_", "-")` }),
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
  clerkBaseBranchExplicit: z.boolean(),
  targetBranch: z.string().min(1).optional(),
  localOnly: z.boolean(),
  dryRun: z.boolean(),
  allowDirtyClerk: z.boolean(),
  allowDirtyClerkDocs: z.boolean(),
  allowClerkDocsMain: z.boolean(),
  debug: z.boolean(),
  clerkRepo: repoSlugSchema,
  clerkDocsRepo: repoSlugSchema,
  prNumber: z.coerce
    .number()
    .catch(() => NaN)
    .pipe(githubPrNumberSchema)
    .optional(),
  closeSourcePr: z.boolean(),
  mergeMain: z.boolean(),
})

/** Avoid slashes in temp directory names (branch names like foo/bar are common). */
function sanitizeBranchForPath(branch: string): string {
  return branch.replace(/[/\\]/g, '-')
}

/** Canonical name for the clerk-side branch that mirrors a clerk-docs branch. */
function buildMigrationBranchName(headRef: string): string {
  return `${headRef}-docs-migration`
}

/**
 * The clerk-side branch this run targets: the explicit `--target-branch` if provided,
 * otherwise the canonical `${headRef}-docs-migration`.
 */
function resolveMigrationBranchName(config: Pick<CliConfig, 'targetBranch'>, headRef: string): string {
  return config.targetBranch ?? buildMigrationBranchName(headRef)
}

/**
 * Decide what the re-run dispatcher should do based on detected clerk-side state.
 *
 * - `null` existing: fresh migration, create new branch and PR.
 * - Existing branch with no PR yet: update the branch (fine to migrate before the clerk-docs PR is opened).
 * - Existing branch with an open PR: update the branch, leave the PR alone.
 * - Existing branch with a closed or merged PR: abort — user must reopen or delete the stale branch manually.
 */
function classifyExistingMigration(
  existing: { pr: { state: string } | null } | null,
): 'create' | 'update' | 'abort-closed' {
  if (!existing) return 'create'
  const state = existing.pr?.state
  if (state === 'CLOSED' || state === 'MERGED') return 'abort-closed'
  return 'update'
}

/** Message body for the `migration-branch-pr-closed` error (exported for tests). */
function formatClosedPrAbortMessage(params: { branch: string; prUrl: string; state: string }): string {
  return `Refusing to update migration branch "${params.branch}": its clerk PR is ${params.state.toLowerCase()} (${params.prUrl}).`
}

interface MergeConflictHintParams {
  branch: string
  workspacePath: string
  isTemporary: boolean
  remoteName: string
  /** The filter-repo'd clerk-docs duplicate the `remoteName` remote points at (also in the temp dir). */
  filterRepoClonePath: string
}

/**
 * Remediation hints when a merge conflict happens during create or update mode.
 * Split by workspace kind: for temp clones the primary fix is opening the clone in an IDE,
 * resolving, pushing, and re-running; a local clone (--clerk-path) is already IDE-friendly.
 * Cleanup differs too: deleting a temp clone deletes its remotes with it (no `git remote remove`
 * needed), while a --clerk-path checkout persists and needs the filter-repo remote removed.
 * Either way the filter-repo'd clerk-docs duplicate is a separate temp directory to delete.
 */
function formatUpdateMergeConflictHints(params: MergeConflictHintParams): readonly string[] {
  if (params.isTemporary) {
    return [
      `Open the temporary clone in your IDE (e.g. \`cursor "${params.workspacePath}"\`), resolve the conflicts listed by \`git status\`, \`git commit\`, then \`git push\` — the branch already tracks origin/${params.branch}, so a plain push (or your IDE's push button) lands there.`,
      'Then re-run this script: it picks up the pushed branch in update mode and creates/syncs the clerk PR.',
      'Prefer working in your own clerk checkout instead? Re-run the migration with --clerk-path pointing at it and resolve the conflicts there.',
      `Nothing is cleaned up automatically — when you're done, delete the temporary clone at ${params.workspacePath} and the filter-repo copy of clerk-docs at ${params.filterRepoClonePath} (deleting the clone removes the "${params.remoteName}" remote with it).`,
    ]
  }
  return [
    `Conflicts are in ${params.workspacePath} on branch "${params.branch}". \`git status\` in that folder lists the files.`,
    `Resolve the conflicts in your IDE, \`git commit\`, then \`git push\` — the branch already tracks origin/${params.branch}, so a plain push (or your IDE's push button) lands there. The clerk PR will update automatically. Push before re-running this script — a re-run refuses to proceed while the local branch has unpushed commits.`,
    `When you're done, clean up: \`git remote remove ${params.remoteName}\` in ${params.workspacePath}, and delete the filter-repo copy of clerk-docs at ${params.filterRepoClonePath}.`,
    'Alternatively, to abandon this merge and retry: `git merge --abort` in that folder, then re-run this script.',
  ]
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
  const { values, tokens } = parseArgs({
    args: process.argv.slice(2),
    options: CLI_OPTIONS,
    strict: true,
    allowPositionals: false,
    tokens: true,
  })
  assertNoDuplicateCliOptions(tokens)

  if (values.help) {
    printHelp()
    process.exit(0)
  }

  /** Reject `--flag ""` (e.g. from an unset shell variable) instead of silently resolving it. */
  const nonEmpty = (flag: string, value: string | undefined): string | undefined => {
    if (value === undefined) return undefined
    if (value.trim() === '') throw new Error(`--${flag} requires a non-empty value`)
    return value
  }

  const clerkPathArg = nonEmpty('clerk-path', values['clerk-path'])
  const docsPathArg =
    nonEmpty('docs-path', values['docs-path']) ?? nonEmpty('clerk-docs-path', values['clerk-docs-path'])
  const clerkBaseArg = nonEmpty('clerk-base', values['clerk-base'])

  const parsed = migrateCliSchema.safeParse({
    clerkPath: clerkPathArg ? path.resolve(expandHome(clerkPathArg)) : undefined,
    clerkDocsPath: path.resolve(expandHome(docsPathArg ?? process.cwd())),
    clerkDocsBaseBranch:
      nonEmpty('docs-base', values['docs-base']) ?? nonEmpty('clerk-docs-base', values['clerk-docs-base']),
    clerkBaseBranch: clerkBaseArg ?? 'main',
    clerkBaseBranchExplicit: clerkBaseArg !== undefined,
    targetBranch:
      nonEmpty('target-branch', values['target-branch']) ??
      nonEmpty('clerk-target-branch', values['clerk-target-branch']),
    localOnly: Boolean(values['local-only']),
    dryRun: Boolean(values['dry-run']),
    allowDirtyClerk: Boolean(values['allow-dirty-clerk']),
    allowDirtyClerkDocs: Boolean(values['allow-dirty-docs'] || values['allow-dirty-clerk-docs']),
    allowClerkDocsMain: Boolean(values['allow-docs-main'] || values['allow-clerk-docs-main']),
    debug: Boolean(values.debug || values.verbose),
    clerkRepo: nonEmpty('clerk-repo', values['clerk-repo']) ?? 'clerk/clerk',
    clerkDocsRepo:
      nonEmpty('docs-repo', values['docs-repo']) ??
      nonEmpty('clerk-docs-repo', values['clerk-docs-repo']) ??
      'clerk/clerk-docs',
    prNumber: nonEmpty('pr', values.pr),
    closeSourcePr: !values['no-close-source-pr'],
    mergeMain: !values['no-merge-main'],
  })
  if (!parsed.success) {
    const first = parsed.error.errors[0]
    throw new Error(first?.message ?? parsed.error.message)
  }
  if (parsed.data.localOnly && !parsed.data.clerkPath) {
    throwMigrationError('local-only-requires-clerk-path')
  }
  if (parsed.data.targetBranch === 'main') {
    throwMigrationError('refuse-target-branch-main')
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

/**
 * Guard against accidentally running the copy of this script that ships into clerk/clerk under
 * clerk-docs/scripts. This script always lives at `<docs-root>/scripts/`, so its project dir is the
 * clerk-docs root in a standalone checkout but a nested subdir once migrated into clerk. If the git
 * root is above that project dir, we're inside clerk — abort before rewriting clerk's own history.
 */
async function assertNotRunningInsideClerk(): Promise<void> {
  const docsProjectDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
  const result = await runCommand('git', ['-C', docsProjectDir, 'rev-parse', '--show-toplevel'], process.cwd(), {
    allowFailure: true,
  })
  if (result.code !== 0) return
  const gitRoot = result.stdout.trim()
  if (gitRootIsAboveDocsProject(docsProjectDir, gitRoot)) {
    throwMigrationError('running-inside-enclosing-repo', { docsProjectDir, gitRoot })
  }
  infoLog('clerk-docs is its own git root (not nested inside clerk)', { docsProjectDir })
}

/**
 * Refuse a --docs-path that is nested inside a larger git repository (e.g. the clerk-docs/
 * directory inside clerk after migration). {@link assertNotRunningInsideClerk} only validates
 * where the *script* lives; this validates the configured docs checkout, which would otherwise
 * pass `assertGitRepo` and let the merge-main step fetch/merge the *parent* repo's history.
 */
async function assertDocsPathIsGitRoot(docsPath: string): Promise<void> {
  const result = await runCommand('git', ['rev-parse', '--show-toplevel'], docsPath)
  const gitRoot = result.stdout.trim()
  if (gitRootIsAboveDocsProject(docsPath, gitRoot)) {
    throwMigrationError('docs-path-inside-enclosing-repo', { docsPath, gitRoot })
  }
}

/** A shallow docs clone would silently migrate truncated history (filter-repo rewrites what's local). */
async function assertDocsRepoNotShallow(docsPath: string): Promise<void> {
  const result = await runCommand('git', ['rev-parse', '--is-shallow-repository'], docsPath)
  if (result.stdout.trim() === 'true') {
    throwMigrationError('docs-repo-shallow', docsPath)
  }
}

/**
 * Parse a git remote URL (https, ssh://, or scp-like `git@host:owner/repo`) into an owner/repo
 * slug. Returns null for URLs that don't follow the GitHub owner/repo shape.
 */
function parseGitRemoteUrlToSlug(url: string): RepoSlug | null {
  const trimmed = url.trim().replace(/\.git$/i, '')
  const scpForm = trimmed.match(/^[\w.-]+@[\w.-]+:(.+)$/)
  const urlForm = trimmed.match(/^(?:https?|ssh|git):\/\/(?:[^/@]+@)?[^/]+\/(.+)$/)
  const pathPart = scpForm?.[1] ?? urlForm?.[1]
  if (!pathPart) return null
  const segments = pathPart.split('/').filter(Boolean)
  if (segments.length !== 2) return null
  const [owner, name] = segments
  if (!REPO_SLUG_PART.test(owner) || !REPO_SLUG_PART.test(name)) return null
  return [owner, name]
}

/** GitHub slugs are case-insensitive. */
function repoSlugsEqual(a: RepoSlug, b: RepoSlug): boolean {
  return a[0].toLowerCase() === b[0].toLowerCase() && a[1].toLowerCase() === b[1].toLowerCase()
}

/**
 * Pushes/fetches go to the clone's `origin` while all `gh` calls go to the configured slug; if
 * they point at different repositories (e.g. a fork-based clone) the run splits across two repos.
 */
async function assertOriginMatchesRepoSlug(
  repoPath: string,
  slug: RepoSlug,
  label: 'clerk' | 'clerk-docs',
): Promise<void> {
  const result = await runCommand('git', ['remote', 'get-url', 'origin'], repoPath, { allowFailure: true })
  if (result.code !== 0) {
    throw new Error(`${label} at ${repoPath} has no "origin" remote; the migration fetches and pushes via origin.`)
  }
  const originUrl = result.stdout.trim()
  const originSlug = parseGitRemoteUrlToSlug(originUrl)
  if (!originSlug) {
    warnLog(`Could not parse ${label} origin URL to verify it matches the configured repo; continuing.`, {
      originUrl,
      expected: formatRepoSlug(slug),
    })
    return
  }
  if (!repoSlugsEqual(originSlug, slug)) {
    throwMigrationError('origin-remote-mismatch', {
      label,
      repoPath,
      expectedSlug: formatRepoSlug(slug),
      originUrl,
    })
  }
  infoLog(`${label} origin remote matches configured repo`, { repo: formatRepoSlug(slug) })
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
    // No base-branch checkout here: create mode branches from origin/<baseRef> directly (after an
    // explicit fetch), so the local base branch's state — stale, diverged, or absent — is irrelevant.
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

/**
 * Whether `branch` exists on the remote `repoSlug`. Uses `gh api /repos/{owner}/{repo}/branches/{branch}`
 * so it works before any local clone exists.
 */
async function remoteBranchExists(repoSlug: RepoSlug, branch: string): Promise<boolean> {
  const apiPath = `repos/${encodeURIComponent(repoSlug[0])}/${encodeURIComponent(repoSlug[1])}/branches/${encodeURIComponent(branch)}`
  const result = await runCommand('gh', ['api', apiPath], process.cwd(), { allowFailure: true })
  return result.code === 0
}

/**
 * Look up an existing migration branch + (optionally) its most relevant PR on `clerkRepo`.
 * Returns `null` if no branch exists yet. If the branch exists but no PR ever was opened, returns
 * `{ branch, pr: null }`. An OPEN PR wins over a newer closed/merged one so a stale closed PR for
 * the same head can't wrongly trigger the abort-closed path while an open PR exists.
 */
async function findExistingClerkMigration(
  config: CliConfig,
  branchName: string,
): Promise<{ branch: string; pr: PullRequestView | null } | null> {
  const exists = await remoteBranchExists(config.clerkRepo, branchName)
  if (!exists) return null
  const prs = await commandJson<PullRequestView[]>(
    'gh',
    [
      'pr',
      'list',
      '--repo',
      formatRepoSlug(config.clerkRepo),
      '--head',
      branchName,
      '--state',
      'all',
      '--json',
      'number,title,body,baseRefName,headRefName,url,isDraft,state',
      '--limit',
      '20',
    ],
    process.cwd(),
  )
  const pr = prs.find((p) => p.state === 'OPEN') ?? prs[0] ?? null
  return { branch: branchName, pr }
}

/**
 * Create mode only: the desired branch is known to be absent on the clerk remote (otherwise the
 * run would be in update mode), so a collision means a stale *local* branch — typically left over
 * from a --local-only run or a run whose push failed. Auto-suffixing here would silently create a
 * duplicate branch (and, on re-runs, duplicate PRs), so abort with recovery instructions instead.
 */
async function assertBranchNameAvailable(repoPath: string, desired: string): Promise<void> {
  if (await branchExists(repoPath, desired)) {
    throwMigrationError('migration-branch-exists-locally', { branch: desired, workspacePath: repoPath })
  }
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
      'number,title,body,baseRefName,headRefName,url,isDraft,state',
      '--limit',
      '50',
    ],
    process.cwd(),
  )

  // An explicit --pr is always validated against the open PRs for this head, even when zero or one
  // match. Silently ignoring it could comment on and close a PR the user did not pick.
  if (config.prNumber !== undefined) {
    const picked = list.find((pr) => pr.number === config.prNumber)
    if (!picked) {
      const available = list.length > 0 ? list.map((p) => `#${p.number}`).join(', ') : '(none)'
      throw new Error(
        `--pr ${config.prNumber} does not match any open PR for head "${headBranch}". Open PRs for this branch: ${available}.`,
      )
    }
    infoLog('Using clerk-docs PR from --pr', { number: picked.number, isDraft: picked.isDraft })
    return picked
  }

  if (list.length === 1) {
    infoLog('Found open clerk-docs PR (for title/body and comment)', {
      number: list[0].number,
      isDraft: list[0].isDraft,
    })
    return list[0]
  }

  if (list.length > 1) {
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

/**
 * True when the working tree has unmerged index entries, i.e. a merge actually started and hit
 * content conflicts. Distinguishes real conflicts from merges that never started (dirty-tree
 * refusals, "not something we can merge", missing merge base) so we don't print
 * conflict-resolution instructions that don't apply.
 */
async function isMergeConflictState(repoPath: string): Promise<boolean> {
  const result = await runCommand('git', ['ls-files', '-u'], repoPath, { allowFailure: true })
  return result.code === 0 && result.stdout.trim().length > 0
}

/**
 * Abort when the local docs branch has diverged from `origin/<branch>` in either direction.
 * Behind (a collaborator pushed to the source PR): migrating would silently drop their commits
 * while still closing the source PR. Ahead (unpushed local commits): migrating would carry
 * commits into clerk that the source PR never showed — push or discard them first. A branch
 * that was never pushed at all has no source PR to misrepresent, so it only warns.
 */
async function assertDocsBranchInSyncWithOrigin(config: CliConfig, branch: string): Promise<void> {
  if (config.dryRun) {
    infoLog('Dry-run: would fetch origin and verify the local branch is in sync (neither behind nor ahead)', { branch })
    return
  }
  const fetch = await runCommand('git', buildFetchBranchRefspecArgs(branch), config.clerkDocsPath, {
    allowFailure: true,
  })
  if (fetch.code !== 0) {
    warnLog('Branch not found on clerk-docs origin (never pushed?); migrating the local branch as-is.', {
      branch,
      stderr: fetch.stderr.trim(),
    })
    return
  }
  const behind = await runCommand('git', ['rev-list', '--count', `${branch}..origin/${branch}`], config.clerkDocsPath)
  const behindCount = Number.parseInt(behind.stdout.trim(), 10) || 0
  if (behindCount > 0) {
    throwMigrationError('docs-branch-behind-origin', { branch, behindCount })
  }
  const ahead = await runCommand('git', ['rev-list', '--count', `origin/${branch}..${branch}`], config.clerkDocsPath)
  const aheadCount = Number.parseInt(ahead.stdout.trim(), 10) || 0
  if (aheadCount > 0) {
    throwMigrationError('docs-branch-ahead-of-origin', { branch, aheadCount })
  }
}

async function mergeMainIntoCurrentBranch(config: CliConfig): Promise<void> {
  const current = await getCurrentBranch(config.clerkDocsPath)
  if (!config.mergeMain) {
    warnLog('Skipping origin/main merge into current branch (--no-merge-main)', {
      current,
      note: 'Migration will proceed against your current branch as-is. If main has moved on, the rewritten history may not include those commits.',
    })
    return
  }
  stepLog('Merging clerk-docs/main into current branch')
  if (config.dryRun) {
    infoLog('Dry-run: would fetch and merge origin/main', { current })
    return
  }
  // Explicit refspec so origin/main exists even in a single-branch docs clone.
  await runCommand('git', buildFetchBranchRefspecArgs('main'), config.clerkDocsPath)
  const merge = await runCommand('git', ['merge', 'origin/main'], config.clerkDocsPath, { allowFailure: true })
  if (merge.code !== 0) {
    if (await isMergeConflictState(config.clerkDocsPath)) {
      throwMigrationError('merge-main-conflict')
    }
    throw new Error(
      `git merge origin/main failed before any merge started (this is not a content conflict): ${(merge.stderr + merge.stdout).trim()}`,
    )
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

/** One "migrated to" destination listed in the migration-notice comment. `branch` is absent for entries recovered from the legacy single-URL comment format. */
type MigrationNoticeEntry = { branch?: string; prUrl: string }

/**
 * Extract the branch/PR entries from an existing migration-notice comment body.
 * Understands the canonical list format produced by {@link formatMigrationNoticeCommentBody} and
 * the legacy single-line format ("This branch and pr were migrated to: <url>"), so old comments
 * upgrade to the list format the first time they're updated.
 */
function parseMigrationNoticeEntries(body: string): MigrationNoticeEntry[] {
  const entries: MigrationNoticeEntry[] = []
  for (const match of body.matchAll(/^- (?:`([^`]+)` → )?(https?:\/\/\S+)\s*$/gm)) {
    entries.push(match[1] ? { branch: match[1], prUrl: match[2] } : { prUrl: match[2] })
  }
  if (entries.length === 0) {
    const legacy = body.match(/migrated to:\s*(https?:\/\/\S+)/i)
    if (legacy) entries.push({ prUrl: legacy[1] })
  }
  return entries
}

/** Body for the backlink comment maintained by {@link upsertMigrationNoticeComment} on the source clerk-docs PR. */
function formatMigrationNoticeCommentBody(clerkRepoSlug: string, entries: readonly MigrationNoticeEntry[]): string {
  const lines = entries.map((entry) => (entry.branch ? `- \`${entry.branch}\` → ${entry.prUrl}` : `- ${entry.prUrl}`))
  return [
    MIGRATION_NOTICE_MARKER,
    `This branch and PR were migrated to ${clerkRepoSlug}. Migration branches/PRs created from this PR (most recent last):`,
    '',
    ...lines,
  ].join('\n')
}

/**
 * Post or update the single marker comment on the source clerk-docs PR so it lists *every* clerk
 * branch + PR this source PR was migrated to. Re-migrations to a different clerk branch/PR append
 * an entry instead of leaving the old backlink stale; a clerk PR that is already listed is not
 * added twice (idempotent re-runs).
 */
async function upsertMigrationNoticeComment(
  config: CliConfig,
  prNumber: number,
  repo: string,
  entry: { branch: string; prUrl: string },
): Promise<void> {
  // REST (not `gh pr view --json comments`) because updating a comment needs its numeric id.
  const comments = await commandJson<Array<{ id: number; body: string }>>(
    'gh',
    ['api', `repos/${repo}/issues/${prNumber}/comments?per_page=100`],
    process.cwd(),
  )
  const existing = comments.find((comment) => comment.body.includes(MIGRATION_NOTICE_MARKER))
  const clerkRepoSlug = formatRepoSlug(config.clerkRepo)
  if (!existing) {
    const body = formatMigrationNoticeCommentBody(clerkRepoSlug, [entry])
    if (config.dryRun) {
      infoLog('Dry-run: would post migration notice comment', { repo, prNumber, clerkPrUrl: entry.prUrl })
      return
    }
    await runCommand('gh', ['pr', 'comment', String(prNumber), '--repo', repo, '--body', body], process.cwd())
    return
  }
  const entries = parseMigrationNoticeEntries(existing.body)
  if (entries.some((listed) => listed.prUrl === entry.prUrl)) {
    infoLog('Migration notice comment already lists this clerk PR', { repo, prNumber, clerkPrUrl: entry.prUrl })
    return
  }
  const body = formatMigrationNoticeCommentBody(clerkRepoSlug, [...entries, entry])
  if (config.dryRun) {
    infoLog('Dry-run: would append new clerk PR to migration notice comment', {
      repo,
      prNumber,
      clerkPrUrl: entry.prUrl,
    })
    return
  }
  await runCommand(
    'gh',
    ['api', '--method', 'PATCH', `repos/${repo}/issues/comments/${existing.id}`, '-f', `body=${body}`],
    process.cwd(),
  )
  infoLog('Appended new clerk PR to existing migration notice comment', { repo, prNumber, clerkPrUrl: entry.prUrl })
}

/** `gh pr close` args used by {@link closeSourcePrAfterMigration} (extracted for unit testing). */
function buildClosePrCommandArgs(prNumber: number, repo: string): string[] {
  return ['pr', 'close', String(prNumber), '--repo', repo]
}

/**
 * `git fetch` args that materialize `origin/<branch>` even in a `--single-branch` clone.
 * The explicit `refs/heads/<branch>:refs/remotes/origin/<branch>` refspec is required because a bare
 * `git fetch origin <branch>` would only update FETCH_HEAD, leaving `origin/<branch>` undefined
 * and breaking a subsequent `git checkout`/`git merge origin/<branch>`. The leading `+` forces
 * the tracking-ref update so a force-pushed remote branch (e.g. after a manual conflict
 * resolution) doesn't fail the fetch with a non-fast-forward rejection.
 *
 * The source is fully qualified (`refs/heads/<branch>`) and `--no-prune` is passed so the fetch is
 * safe when the user has `fetch.prune` / `remote.origin.prune` enabled (a common global setting).
 * With an unqualified source, git's prune pass fails to match the remote head against the existing
 * `refs/remotes/origin/<branch>` and deletes it (`- [deleted] (none)`) right after updating it —
 * which then makes the following `git rev-list <branch>..origin/<branch>` sync check abort with
 * "unknown revision". Either guard alone prevents this; both are kept for defense in depth.
 */
function buildFetchBranchRefspecArgs(branch: string): string[] {
  return ['fetch', '--no-prune', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`]
}

/**
 * `git merge` args used in update mode to pull the latest clerk base into the migration branch.
 * Ordinary merge (no `--allow-unrelated-histories`): the migration branch descends from the base,
 * and it's a no-op when the base hasn't moved.
 */
function buildBaseMergeIntoMigrationArgs(baseRef: string, migrationBranch: string): string[] {
  return ['merge', `origin/${baseRef}`, '-m', `Merge clerk base ${baseRef} into ${migrationBranch}`]
}

/**
 * `git config` args (one command per entry) that make a not-yet-pushed branch track
 * `origin/<branch>`. `git branch --set-upstream-to` refuses while the remote branch doesn't exist,
 * so the two config keys are written directly. With this in place a plain `git push` (or an IDE
 * push/sync button) targets — and creates — the same-named branch on origin, which matters when a
 * merge conflict interrupts create mode before the script's own `git push -u` ran.
 */
function buildUpstreamConfigArgs(branch: string): string[][] {
  return [
    ['config', `branch.${branch}.remote`, 'origin'],
    ['config', `branch.${branch}.merge`, `refs/heads/${branch}`],
  ]
}

/**
 * Close the source clerk-docs PR after the backlink comment has been posted.
 * Idempotent in spirit: if the PR is already closed, `gh pr close` exits non-zero and the caller logs a warning.
 * Skips the close in dry-run mode.
 */
async function closeSourcePrAfterMigration(config: CliConfig, prNumber: number, repo: string): Promise<void> {
  if (config.dryRun) {
    infoLog('Dry-run: would close source PR after migration', { repo, prNumber })
    return
  }
  await runCommand('gh', buildClosePrCommandArgs(prNumber, repo), process.cwd())
  infoLog('Closed source clerk-docs PR after migration', { repo, prNumber })
}

interface MigrationOutcome {
  newBranch: string
  clerkPrUrl: string
  mode: 'create' | 'update'
}

/**
 * Duplicate local clerk-docs at `headRef`, rewrite its history under `${TARGET_DIR_IN_CLERK}/`,
 * and attach it to `clerkWorkPath` as a temporary remote so the caller can `git merge` from it.
 * Shared by both `createNewMigration` and `updateExistingMigration`.
 */
async function setupFilterRepoRemote(
  config: CliConfig,
  filterRepo: GitFilterRepoInvoker,
  clerkWorkPath: string,
  headRef: string,
): Promise<{ tempClonePath: string; remoteName: string }> {
  const tempClonePath = path.join(os.tmpdir(), `clerk-docs-migrate-${sanitizeBranchForPath(headRef)}-${Date.now()}`)
  const remoteName = `clerk-docs-migrate-${Date.now()}`
  stepLog('Duplicating local clerk-docs for filter-repo', {
    from: config.clerkDocsPath,
    to: tempClonePath,
    branch: headRef,
    note: 'This is a local git clone of your checkout (not gh clone of clerk/clerk-docs). Large repos can take many minutes.',
  })
  // --no-local: a plain local-path clone hardlinks objects with the source repo. git-filter-repo's
  // docs call that combination out explicitly ("it is better to pass --no-local to git clone than
  // passing --force to git-filter-repo") — without it the rewrite operates on objects shared with
  // the user's real clerk-docs checkout.
  await runCommand(
    'git',
    ['clone', '--no-local', '--single-branch', '--branch', headRef, config.clerkDocsPath, tempClonePath],
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
  return { tempClonePath, remoteName }
}

/**
 * Base branch this run should merge/branch from. In update mode with an existing clerk PR the
 * PR's actual base wins — merging a different base into the migration branch would pull unrelated
 * commits into the open PR. An explicitly-passed conflicting `--clerk-base` aborts instead of
 * being silently overridden.
 */
function resolveEffectiveClerkBase(params: {
  existingPr: { baseRefName: string; url: string } | null
  configuredBase: string
  configuredExplicitly: boolean
  migrationBranch: string
}): string {
  const { existingPr, configuredBase, configuredExplicitly, migrationBranch } = params
  if (!existingPr || existingPr.baseRefName === configuredBase) return configuredBase
  if (configuredExplicitly) {
    throwMigrationError('clerk-base-mismatch', {
      prUrl: existingPr.url,
      prBase: existingPr.baseRefName,
      configuredBase,
      migrationBranch,
    })
  }
  return existingPr.baseRefName
}

/**
 * Post-push PR lifecycle shared by create mode and by update mode when the branch has no PR yet
 * (recovers from a previous run where the push succeeded but PR creation failed):
 * reuse an already-open clerk PR for the branch or create one mirroring the source PR, then post
 * the backlink comment on the source PR and close it — the close is skipped when the comment
 * failed, so the source PR is never closed without a pointer to where it went.
 */
async function ensureClerkPrAndSyncSourcePr(
  config: CliConfig,
  params: { baseRef: string; branch: string; headRef: string; sourcePr: PullRequestView | null },
): Promise<string> {
  const { baseRef, branch, headRef, sourcePr } = params

  const sourceMeta =
    sourcePr !== null
      ? await fetchSourcePrMigrationMetadata(formatRepoSlug(config.clerkDocsRepo), sourcePr.number)
      : null
  const title = sourcePr?.title ?? `docs: migrate ${headRef}`
  let body =
    (sourcePr?.body ?? '') +
    (sourcePr ? `\n\nMigrated from ${sourcePr.url}` : `\n\nMigrated from clerk-docs branch ${headRef}`)
  if (sourceMeta) {
    body += formatSourcePrMigrationAppendix(sourceMeta)
  }

  const openForHead = await commandJson<Array<{ url: string }>>(
    'gh',
    ['pr', 'list', '--repo', formatRepoSlug(config.clerkRepo), '--state', 'open', '--head', branch, '--json', 'url'],
    process.cwd(),
  )
  let clerkPrUrl: string
  if (openForHead[0]?.url) {
    clerkPrUrl = openForHead[0].url
    infoLog('Clerk PR already open for this branch', { url: clerkPrUrl })
  } else if (sourcePr) {
    const isDraft = sourceMeta?.isDraft ?? sourcePr.isDraft
    clerkPrUrl = await createClerkPullRequestWithPeople(config, {
      baseRef,
      head: branch,
      title,
      body,
      isDraft,
      assigneeLogins: sourceMeta?.assigneeLogins ?? [],
      reviewerHandles: sourceMeta?.reviewerHandles ?? [],
    })
  } else {
    warnLog('Skipping clerk PR creation: open a clerk-docs PR for this branch first, or open a clerk PR manually.', {
      branch,
      headRef,
    })
    return '(no clerk PR — requires an open clerk-docs PR for this head)'
  }

  if (sourcePr) {
    const sourceRepoSlug = formatRepoSlug(config.clerkDocsRepo)
    let commentSucceeded = false
    try {
      await upsertMigrationNoticeComment(config, sourcePr.number, sourceRepoSlug, { branch, prUrl: clerkPrUrl })
      commentSucceeded = true
    } catch (err) {
      warnLog('Could not comment on source PR (migration itself succeeded)', {
        error: err instanceof Error ? err.message : String(err),
      })
    }
    if (!config.closeSourcePr) {
      infoLog('Leaving source clerk-docs PR open (--no-close-source-pr)', {
        repo: sourceRepoSlug,
        prNumber: sourcePr.number,
      })
    } else if (!commentSucceeded) {
      warnLog(
        'Skipping close of source PR: the backlink comment failed, and closing without it would leave no pointer to the clerk PR. Comment and close it manually.',
        { repo: sourceRepoSlug, prNumber: sourcePr.number, clerkPrUrl },
      )
    } else {
      try {
        await closeSourcePrAfterMigration(config, sourcePr.number, sourceRepoSlug)
      } catch (err) {
        warnLog('Could not close source PR (migration itself succeeded; close it manually)', {
          repo: sourceRepoSlug,
          prNumber: sourcePr.number,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }

  return clerkPrUrl
}

async function migrateCurrentBranch(
  config: CliConfig,
  filterRepo: GitFilterRepoInvoker,
  clerkWorkspace: ClerkWorkspace,
  headRef: string,
  baseRef: string,
  sourcePr: PullRequestView | null,
  existing: { branch: string; pr: PullRequestView | null } | null,
): Promise<MigrationOutcome> {
  const classification = classifyExistingMigration(existing)
  if (classification === 'abort-closed' && existing?.pr) {
    throwMigrationError('migration-branch-pr-closed', {
      branch: existing.branch,
      prUrl: existing.pr.url,
      state: existing.pr.state,
    })
  }
  if (classification === 'update' && existing) {
    const outcome = await updateExistingMigration(
      config,
      filterRepo,
      clerkWorkspace,
      headRef,
      baseRef,
      sourcePr,
      existing,
    )
    return { ...outcome, mode: 'update' }
  }
  const outcome = await createNewMigration(config, filterRepo, clerkWorkspace, headRef, baseRef, sourcePr)
  return { ...outcome, mode: 'create' }
}

async function createNewMigration(
  config: CliConfig,
  filterRepo: GitFilterRepoInvoker,
  clerkWorkspace: ClerkWorkspace,
  headRef: string,
  baseRef: string,
  sourcePr: PullRequestView | null,
): Promise<{ newBranch: string; clerkPrUrl: string }> {
  const clerkWorkPath = clerkWorkspace.path

  if (config.dryRun) {
    infoLog('Dry-run (create mode): would filter-repo, merge, push, open new PR', {
      clerkWorkPath: clerkWorkPath || '(would clone clerk to temp)',
      suggestedBranch: resolveMigrationBranchName(config, headRef),
      branchedFrom: `origin/${baseRef} (fetched explicitly; the local base branch state is not used)`,
      clerkPr: sourcePr ? 'would create (open clerk-docs PR exists)' : 'would skip (no open clerk-docs PR)',
      gitignore:
        'would remove /clerk-docs (and bare clerk-docs/) entries from clerk root .gitignore if present, then commit if changed',
      commitMessages: `would rewrite #NNN refs in commit messages to ${formatRepoSlug(config.clerkDocsRepo)}#NNN`,
      clerkPrPeople:
        sourcePr !== null
          ? 'would match draft + assignees + requested reviewers from source PR where possible; review approvals cannot transfer (summarized in PR body)'
          : 'n/a',
      sourcePrComment: sourcePr ? 'would post backlink comment to source clerk-docs PR' : 'n/a',
      sourcePrClose: sourcePr
        ? config.closeSourcePr
          ? 'would close source clerk-docs PR after the comment (skipped automatically if the comment fails)'
          : 'would leave source clerk-docs PR open (--no-close-source-pr)'
        : 'n/a',
    })
    return { newBranch: resolveMigrationBranchName(config, headRef), clerkPrUrl: '(dry-run)' }
  }

  const newBranch = resolveMigrationBranchName(config, headRef)
  await assertBranchNameAvailable(clerkWorkPath, newBranch)
  stepLog('Migrating current branch into clerk', { headRef, baseRef, newBranch, clerkWorkPath })

  const { tempClonePath, remoteName } = await setupFilterRepoRemote(config, filterRepo, clerkWorkPath, headRef)

  // On a real merge conflict, leave the workspace + filter-repo remote in place for manual resolution.
  let preserveOnExit = false

  try {
    // Branch from origin/<baseRef> directly (explicit refspec fetch so it exists even in
    // single-branch clones): the local base branch may be stale, diverged, or absent, and its
    // local-only commits must not leak into the pushed migration branch.
    await runCommand('git', buildFetchBranchRefspecArgs(baseRef), clerkWorkPath)
    // --no-track: without it the new branch would track origin/<baseRef>, and if the merge below
    // conflicts, an upstream-based push during manual resolution (plain `git push` with
    // push.default=upstream, or an IDE sync button) would land the merge commit on the clerk base
    // branch instead of the migration branch.
    await runCommand('git', ['checkout', '--no-track', '-b', newBranch, `origin/${baseRef}`], clerkWorkPath)
    // Point the upstream at origin/<newBranch> instead. That remote branch doesn't exist yet, so
    // `git branch --set-upstream-to` would refuse — write the config directly. This makes a plain
    // `git push` (or an IDE push/sync button) during manual conflict resolution create and push to
    // the migration branch, matching the `git push -u origin <newBranch>` the script itself runs
    // on the successful path.
    for (const configArgs of buildUpstreamConfigArgs(newBranch)) {
      await runCommand('git', configArgs, clerkWorkPath)
    }
    const merge = await runCommand(
      'git',
      [
        'merge',
        `${remoteName}/${headRef}`,
        '--allow-unrelated-histories',
        '-m',
        `Migrate clerk-docs branch ${headRef}`,
      ],
      clerkWorkPath,
      { allowFailure: true },
    )
    if (merge.code !== 0) {
      if (await isMergeConflictState(clerkWorkPath)) {
        preserveOnExit = true
        throwMigrationError('create-merge-conflict', {
          branch: newBranch,
          workspacePath: clerkWorkPath,
          isTemporary: clerkWorkspace.isTemporary,
          remoteName,
          filterRepoClonePath: tempClonePath,
        })
      }
      throw new Error(
        `git merge of the rewritten clerk-docs history failed before any merge started (this is not a content conflict): ${(merge.stderr + merge.stdout).trim()}`,
      )
    }
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

    const clerkPrUrl = await ensureClerkPrAndSyncSourcePr(config, {
      baseRef,
      branch: newBranch,
      headRef,
      sourcePr,
    })
    return { newBranch, clerkPrUrl }
  } finally {
    if (!preserveOnExit) {
      await runCommand('git', ['remote', 'remove', remoteName], clerkWorkPath, { allowFailure: true })
      await fs.rm(tempClonePath, { recursive: true, force: true })
    }
  }
}

/**
 * Update an already-migrated branch with new commits from clerk-docs.
 * - Checks out the existing migration branch in the clerk workspace, refusing first if the local
 *   branch has commits that were never pushed (a `checkout -B` would silently discard them —
 *   including a manual conflict resolution from a previous run).
 * - Merges the latest clerk base into the migration branch so re-runs carry base updates through,
 *   not just new docs commits (no-op when the base hasn't moved). `baseRef` is resolved by the
 *   caller from the existing clerk PR's base (see {@link resolveEffectiveClerkBase}).
 * - Merges the freshly-rewritten clerk-docs history on top (filter-repo is deterministic, so only
 *   the new commits are actually merged).
 * - On a real conflict (base or docs): leaves the working tree conflicted and preserves the
 *   filter-repo remote + temp clone so the user can finish manually or abort and re-run. On any
 *   other error or success: cleans up.
 * - Re-uses the existing clerk PR; if the branch has no PR yet (e.g. a previous run pushed but PR
 *   creation failed), creates one and syncs the source PR like create mode.
 */
async function updateExistingMigration(
  config: CliConfig,
  filterRepo: GitFilterRepoInvoker,
  clerkWorkspace: ClerkWorkspace,
  headRef: string,
  baseRef: string,
  sourcePr: PullRequestView | null,
  existing: { branch: string; pr: PullRequestView | null },
): Promise<{ newBranch: string; clerkPrUrl: string }> {
  const migrationBranch = existing.branch

  if (config.dryRun) {
    infoLog('Dry-run (update mode): would filter-repo, merge new commits onto existing branch, push', {
      migrationBranch,
      existingPr: existing.pr?.url ?? '(none)',
      baseMerge: `would merge latest clerk base "${baseRef}" into ${migrationBranch} (no-op if base unchanged)`,
      gitignore:
        'would re-run gitignore cleanup; idempotent after first migration (commits only if anything actually changed)',
      clerkPrCreate: existing.pr
        ? 're-uses the existing PR'
        : 'branch has no PR yet — would create one (and sync the source PR) if an open clerk-docs PR exists',
      sourcePrComment: existing.pr
        ? 'would ensure the migration notice comment on the source PR lists this branch + PR (appends if missing)'
        : 'would post if missing (idempotent when the clerk PR is already listed)',
      sourcePrClose: existing.pr
        ? 'skipped (source PR was already closed during the initial migration)'
        : 'would close after a successful comment (unless --no-close-source-pr)',
    })
    return { newBranch: migrationBranch, clerkPrUrl: existing.pr?.url ?? '(dry-run)' }
  }

  const clerkWorkPath = clerkWorkspace.path
  stepLog('Updating existing migration branch', {
    migrationBranch,
    existingPr: existing.pr?.url ?? '(no clerk PR yet)',
    baseRef,
    clerkWorkPath,
    isTemporaryWorkspace: clerkWorkspace.isTemporary,
  })

  const { tempClonePath, remoteName } = await setupFilterRepoRemote(config, filterRepo, clerkWorkPath, headRef)

  // If a merge conflict is surfaced, we want to leave state on disk so the user can finish manually.
  let preserveOnExit = false

  const conflictParams = {
    branch: migrationBranch,
    workspacePath: clerkWorkPath,
    isTemporary: clerkWorkspace.isTemporary,
    remoteName,
    filterRepoClonePath: tempClonePath,
  }

  try {
    // Temp clones are created with `--single-branch --depth 1` so only baseRef history is present.
    // To merge against the migration branch we need enough history to resolve the common ancestor;
    // `--unshallow` is the safest option and is a no-op on non-shallow clones.
    await runCommand('git', ['fetch', '--unshallow', 'origin'], clerkWorkPath, { allowFailure: true })
    // Temp clones use `--single-branch`, so origin's fetch refspec only tracks baseRef. Fetch the
    // migration branch with an explicit refspec so `origin/${migrationBranch}` actually gets created
    // (a bare `git fetch origin ${migrationBranch}` would only update FETCH_HEAD, and the checkout below
    // would then fail with "origin/${migrationBranch} is not a commit").
    await runCommand('git', buildFetchBranchRefspecArgs(migrationBranch), clerkWorkPath)

    // `checkout -B` resets the local branch to origin. If the local branch has unpushed commits
    // (e.g. the manual conflict resolution our own hints tell the user to make), that reset would
    // silently destroy them — refuse and tell the user to push or delete the branch first.
    const localBranch = await runCommand(
      'git',
      ['show-ref', '--verify', '--quiet', `refs/heads/${migrationBranch}`],
      clerkWorkPath,
      { allowFailure: true },
    )
    if (localBranch.code === 0) {
      const ahead = await runCommand(
        'git',
        ['rev-list', '--count', `origin/${migrationBranch}..${migrationBranch}`],
        clerkWorkPath,
      )
      const aheadCount = Number.parseInt(ahead.stdout.trim(), 10) || 0
      if (aheadCount > 0) {
        throwMigrationError('migration-branch-local-ahead', {
          branch: migrationBranch,
          aheadCount,
          workspacePath: clerkWorkPath,
        })
      }
    }
    await runCommand('git', ['checkout', '-B', migrationBranch, `origin/${migrationBranch}`], clerkWorkPath)

    // Pull the latest clerk base into the migration branch so re-runs carry base updates through,
    // not just new docs commits. The migration branch descends from baseRef, so this is an ordinary
    // merge (no --allow-unrelated-histories) and a no-op when the base hasn't moved. Fetch with an
    // explicit refspec for the same single-branch-clone reason as the migration branch fetch above.
    await runCommand('git', buildFetchBranchRefspecArgs(baseRef), clerkWorkPath)
    const baseMerge = await runCommand(
      'git',
      buildBaseMergeIntoMigrationArgs(baseRef, migrationBranch),
      clerkWorkPath,
      { allowFailure: true },
    )
    if (baseMerge.code !== 0) {
      if (await isMergeConflictState(clerkWorkPath)) {
        preserveOnExit = true
        throwMigrationError('update-merge-conflict', conflictParams)
      }
      throw new Error(
        `git merge origin/${baseRef} failed before any merge started (this is not a content conflict): ${(baseMerge.stderr + baseMerge.stdout).trim()}`,
      )
    }

    const merge = await runCommand(
      'git',
      [
        'merge',
        `${remoteName}/${headRef}`,
        '--allow-unrelated-histories',
        '-m',
        `Update clerk-docs migration for branch ${headRef}`,
      ],
      clerkWorkPath,
      { allowFailure: true },
    )
    if (merge.code !== 0) {
      if (await isMergeConflictState(clerkWorkPath)) {
        preserveOnExit = true
        throwMigrationError('update-merge-conflict', conflictParams)
      }
      throw new Error(
        `git merge of the rewritten clerk-docs history failed before any merge started (this is not a content conflict): ${(merge.stderr + merge.stdout).trim()}`,
      )
    }

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
      warnLog(`--local-only enabled: updated local branch "${migrationBranch}"; skipping push.`)
      return { newBranch: migrationBranch, clerkPrUrl: existing.pr?.url ?? '(local-only: not pushed)' }
    }

    await runCommand('git', ['push', 'origin', migrationBranch], clerkWorkPath)

    let clerkPrUrl = existing.pr?.url ?? '(branch updated; no clerk PR yet)'
    if (existing.pr) {
      infoLog('Pushed update to existing migration branch', { branch: migrationBranch, clerkPrUrl })
      // Self-heal the source PR's migration notice: if this branch/PR isn't listed there yet
      // (e.g. the branch was created before the list format existed, or the source PR was
      // previously migrated to a different branch), append it. Idempotent when already listed.
      if (sourcePr) {
        try {
          await upsertMigrationNoticeComment(config, sourcePr.number, formatRepoSlug(config.clerkDocsRepo), {
            branch: migrationBranch,
            prUrl: existing.pr.url,
          })
        } catch (err) {
          warnLog('Could not update migration notice comment on source PR (migration itself succeeded)', {
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }
    } else {
      // Recover from a previous run where the push succeeded but PR creation failed: without this,
      // every re-run lands in update mode and the branch stays PR-less forever.
      infoLog('Pushed update; branch has no clerk PR yet — attempting to create one', { branch: migrationBranch })
      clerkPrUrl = await ensureClerkPrAndSyncSourcePr(config, {
        baseRef,
        branch: migrationBranch,
        headRef,
        sourcePr,
      })
    }
    return { newBranch: migrationBranch, clerkPrUrl }
  } finally {
    if (!preserveOnExit) {
      await runCommand('git', ['remote', 'remove', remoteName], clerkWorkPath, { allowFailure: true })
      await fs.rm(tempClonePath, { recursive: true, force: true })
    }
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
    config.mergeMain
      ? '- Merges origin/main into your current clerk-docs feature branch'
      : '- Skips the origin/main merge into your clerk-docs branch (--no-merge-main)',
    '- Rewrites that branch history under clerk/clerk-docs/',
    '- Merges rewritten history into the clerk repo (create mode = new branch + PR; update mode = existing migration branch)',
    '- Pushes the branch and opens/links PRs when source PR context is available',
    '- In create mode, posts a backlink comment on the source clerk-docs PR and closes it (close skipped if the comment fails)',
    '- Re-runs on the same clerk-docs branch update the existing migration branch instead of creating duplicates',
    '',
    'Run configuration',
    `- mode: ${config.dryRun ? 'dry-run (no git/GitHub writes; read-only gh calls still run)' : 'execute'}`,
    `- clerk-docs path: ${config.clerkDocsPath}`,
    `- desired clerk-docs branch: ${config.clerkDocsBaseBranch ?? '(current branch)'}`,
    `- clerk path: ${config.clerkPath ?? '(temp clone via gh repo clone)'}`,
    `- clerk repo: ${formatRepoSlug(config.clerkRepo)}`,
    `- clerk-docs repo: ${formatRepoSlug(config.clerkDocsRepo)}`,
    `- clerk base branch: ${config.clerkBaseBranch}`,
    `- target branch in clerk: ${config.targetBranch ?? '(default: <docs-branch>-docs-migration)'}`,
    `- local-only (skip push/PR): ${config.localOnly ? 'yes' : 'no'}`,
    `- close source clerk-docs PR after migration: ${config.closeSourcePr ? 'yes' : 'no (--no-close-source-pr)'}`,
    `- merge origin/main into clerk-docs branch first: ${config.mergeMain ? 'yes' : 'no (--no-merge-main)'}`,
    `- allow dirty clerk: ${config.allowDirtyClerk ? 'yes' : 'no'}`,
    `- allow dirty clerk-docs: ${config.allowDirtyClerkDocs ? 'yes' : 'no'}`,
    `- allow clerk-docs main branch: ${config.allowClerkDocsMain ? 'yes (--allow-docs-main)' : 'no'}`,
    `- interactive prompts (stdin TTY): ${stdinSupportsInteractivePrompts() ? 'yes' : 'no'}`,
    `- verbose logging: ${config.debug ? 'yes' : 'no (use --verbose)'}`,
    '',
  ]
  console.log(lines.join('\n'))
}

function printRunOutro(details: { mode: 'create' | 'update'; newBranchInClerk: string; clerkPrUrl: string }): void {
  const isUpdate = details.mode === 'update'
  console.log(
    [
      '',
      'Results:',
      `- migration mode: ${details.mode}`,
      `- ${isUpdate ? 'updated' : 'migrated'} branch in clerk: ${details.newBranchInClerk}`,
      `- ${isUpdate ? 'existing PR in clerk' : 'migrated PR in clerk'}: ${details.clerkPrUrl}`,
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
  let config: CliConfig
  try {
    config = parseConfig()
  } catch (err) {
    errorLog(toErrorMessage(err))
    if (err instanceof MigrationError) {
      for (const hint of err.hints) {
        errorLog(`- ${hint}`)
      }
    }
    process.exitCode = 1
    return
  }
  const phases: RunPhase[] = []
  let currentPhase = 'start'
  let workspace: ClerkWorkspace | null = null

  printRunIntro(config)

  try {
    currentPhase = 'preflight'
    stepLog('Running preflight checks')
    await assertCommandAvailable('git')
    await assertCommandAvailable('gh')
    await assertMinimumVersion('git', 'git', ['--version'], MIN_TOOL_VERSIONS.git)
    await assertMinimumVersion('gh', 'gh', ['--version'], MIN_TOOL_VERSIONS.gh)
    const filterRepoInvoker = await resolveGitFilterRepoInvoker()
    await assertGhAuthenticated()
    await assertGithubRepoMigrationAccess(config)
    if (config.clerkPath) {
      assertClerkPathResolvable(config.clerkPath)
      await assertGitRepo(config.clerkPath, 'clerk')
      await assertNoStaleImportRemote(config.clerkPath)
      await assertOriginMatchesRepoSlug(config.clerkPath, config.clerkRepo, 'clerk')
    }
    await assertGitRepo(config.clerkDocsPath, 'clerk-docs')
    await assertNotRunningInsideClerk()
    await assertDocsPathIsGitRoot(config.clerkDocsPath)
    await assertDocsRepoNotShallow(config.clerkDocsPath)
    await assertOriginMatchesRepoSlug(config.clerkDocsPath, config.clerkDocsRepo, 'clerk-docs')
    if (config.allowDirtyClerkDocs) {
      warnLog(
        'Bypassing clean-working-tree check for clerk-docs due to --allow-dirty-docs. Only committed history is migrated (filter-repo reads commits, not the working tree), but the upcoming `git merge origin/main` can still abort if your local edits conflict with incoming changes.',
      )
    } else {
      await assertCleanWorkingTree(config.clerkDocsPath, 'clerk-docs')
    }

    let clerkDocsBranch = await getCurrentBranch(config.clerkDocsPath)
    if (!clerkDocsBranch) {
      // Detached HEAD / unborn branch: an empty head would otherwise flow into
      // `gh pr list --head ""` (which matches every open PR) and `git clone --branch ''`.
      throwMigrationError('detached-head')
    }
    clerkDocsBranch = await maybeAlignClerkDocsBranch(config, clerkDocsBranch)
    if (clerkDocsBranch === 'main') {
      if (!config.allowClerkDocsMain) {
        throwMigrationError('refuse-clerk-docs-main')
      }
      warnLog(
        'Bypassing clerk-docs/main refusal due to --allow-docs-main. This will rewrite the entire clerk-docs main history into clerk; make sure that is what you want.',
      )
    }

    const sourcePr = await resolveSourcePr(config, clerkDocsBranch)
    await assertDocsBranchInSyncWithOrigin(config, clerkDocsBranch)

    const migrationBranchName = resolveMigrationBranchName(config, clerkDocsBranch)
    const existingMigration = await findExistingClerkMigration(config, migrationBranchName)
    const migrationMode = classifyExistingMigration(existingMigration)
    if (migrationMode === 'abort-closed' && existingMigration?.pr) {
      throwMigrationError('migration-branch-pr-closed', {
        branch: existingMigration.branch,
        prUrl: existingMigration.pr.url,
        state: existingMigration.pr.state,
      })
    }
    stepLog(`Migration mode: ${migrationMode}`, {
      migrationBranchName,
      existingBranch: existingMigration?.branch ?? null,
      existingPrUrl: existingMigration?.pr?.url ?? null,
      existingPrState: existingMigration?.pr?.state ?? null,
    })

    // In update mode the existing clerk PR's base wins over --clerk-base (explicit mismatch aborts).
    const baseRef = resolveEffectiveClerkBase({
      existingPr: migrationMode === 'update' ? existingMigration?.pr ?? null : null,
      configuredBase: config.clerkBaseBranch,
      configuredExplicitly: config.clerkBaseBranchExplicit,
      migrationBranch: migrationBranchName,
    })
    if (baseRef !== config.clerkBaseBranch) {
      warnLog('Following the existing clerk PR base instead of the default --clerk-base', {
        prBase: baseRef,
        configuredBase: config.clerkBaseBranch,
      })
    }
    infoLog('Clerk PR will target base branch', { repo: formatRepoSlug(config.clerkRepo), baseRef })
    if (sourcePr && sourcePr.baseRefName !== baseRef) {
      warnLog(
        'Open clerk-docs PR targets a different base than the clerk base; the clerk PR uses the clerk base only.',
        {
          clerkDocsPrBase: sourcePr.baseRefName,
          clerkBase: baseRef,
        },
      )
    }

    phases.push({
      name: 'preflight',
      completed: ['Tools, auth, clerk-docs clean', `Migration mode: ${migrationMode}`],
    })

    await checkpoint({
      title: 'Preflight complete',
      completed: phases.flatMap((p) => p.completed),
      next: config.mergeMain
        ? 'Merge origin/main into this feature branch'
        : 'Skip origin/main merge (--no-merge-main), then prepare the clerk workspace',
    })

    // Merge main *before* preparing the clerk workspace: a docs-side merge conflict should not
    // strand a fresh multi-GB temp clone of clerk that was never needed.
    currentPhase = 'merge-main'
    await mergeMainIntoCurrentBranch(config)
    phases.push({
      name: 'merge-main',
      completed: [
        config.mergeMain
          ? 'Merged origin/main into feature branch (or dry-run)'
          : 'Skipped origin/main merge into feature branch (--no-merge-main)',
      ],
    })

    currentPhase = 'prepare-clerk-workspace'
    workspace = await prepareClerkWorkspace(config, baseRef)
    phases.push({
      name: 'prepare-clerk-workspace',
      completed: [
        workspace.isTemporary
          ? `Clerk workspace: temp clone at ${workspace.path || '(dry-run)'}`
          : `Clerk workspace: local ${workspace.path}`,
      ],
    })

    await checkpoint({
      title: 'Clerk workspace ready',
      completed: phases.flatMap((p) => p.completed),
      next:
        migrationMode === 'update'
          ? 'Update the existing migration branch in clerk with new commits'
          : 'Rewrite history and push in clerk (opens a clerk PR only if an open clerk-docs PR exists)',
    })

    currentPhase = 'migrate-branch'
    const { newBranch, clerkPrUrl, mode } = await migrateCurrentBranch(
      config,
      filterRepoInvoker,
      workspace,
      clerkDocsBranch,
      baseRef,
      sourcePr,
      existingMigration,
    )
    phases.push({
      name: 'migrate-branch',
      completed: [`${mode === 'update' ? 'Updated' : 'Pushed'} ${newBranch}`, `Clerk PR: ${clerkPrUrl}`],
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
      mode,
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
    if (!config.dryRun) {
      infoLog('State left on disk (cleanup reminders):')
      infoLog('- The clerk workspace is left as-is; on a preserved merge conflict, follow the hints above.')
      infoLog(
        '- Reset clerk-docs if needed before retrying (e.g. if the origin/main merge landed but migration failed).',
      )
      infoLog('- If you used a temp clerk clone, delete that folder when done inspecting it.')
      infoLog(
        '- If a clerk-docs-migrate-* remote or /tmp/clerk-docs-migrate-* clone remains, remove it (a preserved conflict keeps both on purpose).',
      )
    }
    process.exitCode = 1
    return
  }
}

/**
 * Whether this module is the CLI entrypoint. Compares filesystem paths instead of raw URL strings:
 * `import.meta.url` percent-encodes spaces and non-ASCII characters while `process.argv[1]` does
 * not, so the old `` import.meta.url === `file://${argv[1]}` `` comparison silently failed (the
 * script became an exit-0 no-op) for checkouts under paths like `~/My Projects/`.
 */
function isDirectCliInvocation(importMetaUrl: string, argv1: string | undefined): boolean {
  if (!argv1) return false
  try {
    return fileURLToPath(importMetaUrl) === path.resolve(argv1)
  } catch {
    return false
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
  gitRootIsAboveDocsProject,
  canPushToRepo,
  canReadRepo,
  canCommentOnPrInRepo,
  assertGitFilterRepoVersionOutput,
  rewritePrRefsInCommitMessage,
  buildPrRefsRewriteCallback,
  buildMigrationBranchName,
  resolveMigrationBranchName,
  classifyExistingMigration,
  formatUpdateMergeConflictHints,
  formatClosedPrAbortMessage,
  formatMigrationNoticeCommentBody,
  parseMigrationNoticeEntries,
  buildClosePrCommandArgs,
  buildFetchBranchRefspecArgs,
  buildBaseMergeIntoMigrationArgs,
  buildUpstreamConfigArgs,
  parseGitRemoteUrlToSlug,
  repoSlugsEqual,
  isDirectCliInvocation,
  resolveEffectiveClerkBase,
  MigrationError,
}

if (isDirectCliInvocation(import.meta.url, process.argv[1])) {
  main().catch((error) => {
    console.error('[migration][FATAL]', error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
