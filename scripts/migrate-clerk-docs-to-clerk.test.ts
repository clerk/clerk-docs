import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import {
  assertGitFilterRepoVersionOutput,
  assertSemverAtLeast,
  autoResolveConflictsToBranchFinalState,
  blobIsWithinDocsHistory,
  buildBaseMergeIntoMigrationArgs,
  cherryPickDeltaCommits,
  collectAppliedCommitFingerprints,
  commitFingerprint,
  formatConflictSyncedToDocsHints,
  syncConflictsBackToDocsRepo,
  buildClosePrCommandArgs,
  buildDeltaRevListArgs,
  buildFetchBranchRefspecArgs,
  buildGitCherryArgs,
  buildUpstreamConfigArgs,
  buildMigrationBranchName,
  buildPrRefsRewriteCallback,
  canCommentOnPrInRepo,
  canPushToRepo,
  canReadRepo,
  classifyExistingMigration,
  commandJson,
  formatClosedPrAbortMessage,
  formatMigrationNoticeCommentBody,
  formatSourcePrMigrationAppendix,
  formatUpdateMergeConflictHints,
  gitRootIsAboveDocsProject,
  isDirectCliInvocation,
  isSemverAtLeast,
  lineIgnoresSymlinkedClerkDocsRoot,
  MIGRATION_DELTA_BASE_REF,
  MigrationError,
  parseConfig,
  parseGhPrViewForMigration,
  parseGitCherryUnappliedShas,
  parseGitRemoteUrlToSlug,
  parseMigrationNoticeEntries,
  parseSemverLoose,
  repoSlugsEqual,
  resolveEffectiveClerkBase,
  resolveMigrationBranchName,
  reviewRequestToHandle,
  rewritePrRefsInCommitMessage,
  runCommand,
  sanitizeBranchForPath,
  stripClerkDocsRootGitignoreEntries,
} from './migrate-clerk-docs-to-clerk'

describe('migrate-clerk-docs-to-clerk core helpers', () => {
  test('sanitizeBranchForPath replaces separators', () => {
    expect(sanitizeBranchForPath('feature/docs-migration')).toBe('feature-docs-migration')
    expect(sanitizeBranchForPath('feat\\windows\\path')).toBe('feat-windows-path')
  })

  test('lineIgnoresSymlinkedClerkDocsRoot only matches root ignore rules', () => {
    expect(lineIgnoresSymlinkedClerkDocsRoot('/clerk-docs')).toBe(true)
    expect(lineIgnoresSymlinkedClerkDocsRoot('clerk-docs/')).toBe(true)
    expect(lineIgnoresSymlinkedClerkDocsRoot('/clerk-docs/')).toBe(true)
    expect(lineIgnoresSymlinkedClerkDocsRoot('clerk-docs # legacy sync')).toBe(true)
    expect(lineIgnoresSymlinkedClerkDocsRoot('docs/clerk-docs')).toBe(false)
    expect(lineIgnoresSymlinkedClerkDocsRoot('# clerk-docs')).toBe(false)
  })
})

describe('gitignore cleanup', () => {
  let tempDir = ''

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'migrate-clerk-docs-test-'))
  })

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })

  test('stripClerkDocsRootGitignoreEntries removes only symlink-era lines', async () => {
    await fs.writeFile(
      path.join(tempDir, '.gitignore'),
      ['/clerk-docs', 'clerk-docs/', 'node_modules', 'docs/clerk-docs'].join('\n') + '\n',
      'utf8',
    )

    const changed = await stripClerkDocsRootGitignoreEntries(tempDir)
    const next = await fs.readFile(path.join(tempDir, '.gitignore'), 'utf8')

    expect(changed).toBe(true)
    expect(next).toBe('node_modules\ndocs/clerk-docs\n')
    expect(next.split('\n').filter(Boolean)).toEqual(['node_modules', 'docs/clerk-docs'])
  })

  test('stripClerkDocsRootGitignoreEntries returns false when nothing to remove', async () => {
    await fs.writeFile(path.join(tempDir, '.gitignore'), 'node_modules\n', 'utf8')

    const changed = await stripClerkDocsRootGitignoreEntries(tempDir)

    expect(changed).toBe(false)
  })
})

describe('semver utilities', () => {
  test('parseSemverLoose extracts semver tuple', () => {
    expect(parseSemverLoose('git version 2.43.0')).toEqual([2, 43, 0])
    expect(parseSemverLoose('v2.40.1')).toEqual([2, 40, 1])
    expect(parseSemverLoose('abc')).toBeNull()
  })

  test('isSemverAtLeast compares versions correctly', () => {
    expect(isSemverAtLeast([2, 40, 1], [2, 40, 0])).toBe(true)
    expect(isSemverAtLeast([2, 40, 0], [2, 40, 0])).toBe(true)
    expect(isSemverAtLeast([2, 39, 9], [2, 40, 0])).toBe(false)
    expect(isSemverAtLeast([3, 20, 9], [2, 40, 0])).toBe(true)
  })

  test('assertSemverAtLeast throws for old versions', () => {
    expect(() => assertSemverAtLeast('git', 'git version 2.38.0', '2.39.0')).toThrow('Minimum supported is 2.39.0')
  })

  test('assertGitFilterRepoVersionOutput accepts semver and hash outputs', () => {
    expect(() => assertGitFilterRepoVersionOutput('git-filter-repo', '2.38.0', '2.38.0')).not.toThrow()
    expect(() => assertGitFilterRepoVersionOutput('git-filter-repo', '1a2b3c4d5e', '2.38.0')).not.toThrow()
  })
})

describe('PR metadata helpers', () => {
  test('reviewRequestToHandle handles user and team requests', () => {
    expect(reviewRequestToHandle({ __typename: 'User', login: 'alice' })).toBe('alice')
    // gh CLI returns team slugs already org-qualified (e.g. "clerk/docs-team")
    expect(reviewRequestToHandle({ __typename: 'Team', slug: 'clerk/docs-team' })).toBe('clerk/docs-team')
    expect(reviewRequestToHandle({ __typename: 'Unknown' })).toBeNull()
    expect(reviewRequestToHandle({})).toBeNull()
  })

  test('parseGhPrViewForMigration and appendix formatting include migration fields', () => {
    const parsed = parseGhPrViewForMigration({
      url: 'https://github.com/clerk/clerk-docs/pull/123',
      isDraft: true,
      assignees: [{ login: 'octocat' }, {}],
      reviewRequests: [
        { __typename: 'User', login: 'reviewer-user' },
        { __typename: 'Team', slug: 'clerk/docs-team' },
      ],
      latestReviews: [{ author: { login: 'reviewer-user' }, state: 'APPROVED' }],
      reviewDecision: 'REVIEW_REQUIRED',
    })

    expect(parsed.assigneeLogins).toEqual(['octocat'])
    expect(parsed.reviewerHandles).toEqual(['reviewer-user', 'clerk/docs-team'])
    expect(parsed.latestReviewRows).toEqual([{ login: 'reviewer-user', state: 'APPROVED' }])

    const appendix = formatSourcePrMigrationAppendix(parsed)
    expect(appendix).toContain('Source PR: https://github.com/clerk/clerk-docs/pull/123')
    expect(appendix).toContain('**Review decision (source):** REVIEW_REQUIRED')
    expect(appendix).toContain('@reviewer-user')
  })

  test('parseGhPrViewForMigration includes reviewers who already reviewed but are no longer in reviewRequests', () => {
    const parsed = parseGhPrViewForMigration({
      url: 'https://github.com/clerk/clerk-docs/pull/456',
      isDraft: false,
      assignees: [],
      reviewRequests: [],
      latestReviews: [{ author: { login: 'author' }, state: 'COMMENTED' }],
      reviewDecision: 'REVIEW_REQUIRED',
    })

    expect(parsed.reviewerHandles).toEqual(['author'])
    expect(parsed.latestReviewRows).toEqual([{ login: 'author', state: 'COMMENTED' }])
  })

  test('parseGhPrViewForMigration deduplicates reviewers present in both reviewRequests and latestReviews', () => {
    const parsed = parseGhPrViewForMigration({
      url: 'https://github.com/clerk/clerk-docs/pull/789',
      isDraft: false,
      assignees: [],
      reviewRequests: [{ __typename: 'User', login: 'alice' }],
      latestReviews: [
        { author: { login: 'alice' }, state: 'CHANGES_REQUESTED' },
        { author: { login: 'bob' }, state: 'APPROVED' },
      ],
      reviewDecision: 'CHANGES_REQUESTED',
    })

    expect(parsed.reviewerHandles).toEqual(['alice', 'bob'])
  })
})

describe('permissions and repo slug helpers', () => {
  test('permission check helpers map access expectations', () => {
    expect(canPushToRepo({ push: true })).toBe(true)
    expect(canReadRepo({ pull: true })).toBe(true)
    expect(canCommentOnPrInRepo({ triage: true })).toBe(true)
    expect(canCommentOnPrInRepo({ pull: true })).toBe(false)
  })
})

describe('gitRootIsAboveDocsProject', () => {
  test('false when clerk-docs is its own git root (standalone checkout)', () => {
    expect(gitRootIsAboveDocsProject('/Users/me/dev/clerk-docs', '/Users/me/dev/clerk-docs')).toBe(false)
  })

  test('true when the git root is an ancestor (clerk-docs nested inside clerk after migration)', () => {
    expect(gitRootIsAboveDocsProject('/Users/me/dev/clerk/clerk-docs', '/Users/me/dev/clerk')).toBe(true)
  })

  test('normalizes paths before comparing (trailing slash is irrelevant)', () => {
    expect(gitRootIsAboveDocsProject('/Users/me/dev/clerk-docs/', '/Users/me/dev/clerk-docs')).toBe(false)
  })
})

describe('command wrappers', () => {
  test('runCommand captures stdout for successful commands', async () => {
    const result = await runCommand('node', ['-e', "process.stdout.write('ok')"], process.cwd())
    expect(result.code).toBe(0)
    expect(result.stdout).toBe('ok')
  })

  test('runCommand returns non-zero code when allowFailure is true', async () => {
    const result = await runCommand('node', ['-e', 'process.exit(2)'], process.cwd(), { allowFailure: true })
    expect(result.code).toBe(2)
  })

  test('commandJson parses JSON stdout', async () => {
    const json = await commandJson<{ value: number }>(
      'node',
      ['-e', 'process.stdout.write(JSON.stringify({value: 42}))'],
      process.cwd(),
    )
    expect(json.value).toBe(42)
  })
})

describe('parseConfig', () => {
  const originalArgv = process.argv.slice()

  afterEach(() => {
    process.argv = originalArgv.slice()
  })

  test('parseConfig maps CLI flags into config values', () => {
    process.argv = [
      'node',
      'scripts/migrate-clerk-docs-to-clerk.ts',
      '--clerk-path',
      '~/work/clerk',
      '--docs-path',
      './',
      '--docs-base',
      'docs-feature',
      '--clerk-base',
      'release',
      '--local-only',
      '--allow-dirty-clerk',
      '--dry-run',
      '--allow-dirty-docs',
      '--allow-docs-main',
      '--debug',
      '--clerk-repo',
      'acme/clerk',
      '--docs-repo',
      'acme/clerk-docs',
      '--pr',
      '9',
    ]

    const config = parseConfig()
    expect(config.clerkBaseBranch).toBe('release')
    expect(config.clerkDocsBaseBranch).toBe('docs-feature')
    expect(config.localOnly).toBe(true)
    expect(config.allowDirtyClerk).toBe(true)
    expect(config.dryRun).toBe(true)
    expect(config.allowDirtyClerkDocs).toBe(true)
    expect(config.allowClerkDocsMain).toBe(true)
    expect(config.debug).toBe(true)
    expect(config.clerkRepo).toEqual(['acme', 'clerk'])
    expect(config.clerkDocsRepo).toEqual(['acme', 'clerk-docs'])
    expect(config.prNumber).toBe(9)
    expect(config.closeSourcePr).toBe(true)
    expect(config.mergeMain).toBe(true)
  })

  test('parseConfig defaults closeSourcePr to true when no flag is passed', () => {
    process.argv = ['node', 'scripts/migrate-clerk-docs-to-clerk.ts']
    const config = parseConfig()
    expect(config.closeSourcePr).toBe(true)
  })

  test('parseConfig sets closeSourcePr to false when --no-close-source-pr is passed', () => {
    process.argv = ['node', 'scripts/migrate-clerk-docs-to-clerk.ts', '--no-close-source-pr']
    const config = parseConfig()
    expect(config.closeSourcePr).toBe(false)
  })

  test('parseConfig defaults mergeMain to true when no flag is passed', () => {
    process.argv = ['node', 'scripts/migrate-clerk-docs-to-clerk.ts']
    const config = parseConfig()
    expect(config.mergeMain).toBe(true)
  })

  test('parseConfig sets mergeMain to false when --no-merge-main is passed', () => {
    process.argv = ['node', 'scripts/migrate-clerk-docs-to-clerk.ts', '--no-merge-main']
    const config = parseConfig()
    expect(config.mergeMain).toBe(false)
  })

  test('parseConfig defaults allowClerkDocsMain to false when no flag is passed', () => {
    process.argv = ['node', 'scripts/migrate-clerk-docs-to-clerk.ts']
    const config = parseConfig()
    expect(config.allowClerkDocsMain).toBe(false)
  })

  test('parseConfig sets allowClerkDocsMain to true when --allow-docs-main is passed', () => {
    process.argv = ['node', 'scripts/migrate-clerk-docs-to-clerk.ts', '--allow-docs-main']
    const config = parseConfig()
    expect(config.allowClerkDocsMain).toBe(true)
  })

  test('parseConfig accepts the legacy --allow-clerk-docs-main alias', () => {
    process.argv = ['node', 'scripts/migrate-clerk-docs-to-clerk.ts', '--allow-clerk-docs-main']
    const config = parseConfig()
    expect(config.allowClerkDocsMain).toBe(true)
  })

  test('parseConfig defaults targetBranch to undefined when no flag is passed', () => {
    process.argv = ['node', 'scripts/migrate-clerk-docs-to-clerk.ts']
    const config = parseConfig()
    expect(config.targetBranch).toBeUndefined()
  })

  test('parseConfig reads --target-branch into targetBranch', () => {
    process.argv = ['node', 'scripts/migrate-clerk-docs-to-clerk.ts', '--target-branch', 'nick/my-new-branch']
    const config = parseConfig()
    expect(config.targetBranch).toBe('nick/my-new-branch')
  })

  test('parseConfig accepts the --clerk-target-branch alias', () => {
    process.argv = ['node', 'scripts/migrate-clerk-docs-to-clerk.ts', '--clerk-target-branch', 'nick/my-new-branch']
    const config = parseConfig()
    expect(config.targetBranch).toBe('nick/my-new-branch')
  })

  test('parseConfig rejects --target-branch main (update mode would push straight to clerk main)', () => {
    process.argv = ['node', 'scripts/migrate-clerk-docs-to-clerk.ts', '--target-branch', 'main']
    expect(() => parseConfig()).toThrow(/--target-branch cannot be "main"/)
  })

  test('parseConfig rejects main through the --clerk-target-branch alias too', () => {
    process.argv = ['node', 'scripts/migrate-clerk-docs-to-clerk.ts', '--clerk-target-branch', 'main']
    expect(() => parseConfig()).toThrow(/--target-branch cannot be "main"/)
  })

  test('parseConfig rejects invalid --pr values', () => {
    process.argv = ['node', 'scripts/migrate-clerk-docs-to-clerk.ts', '--pr', 'zero']
    expect(() => parseConfig()).toThrow('--pr must be a positive integer')
  })

  test('parseConfig accepts --verbose as debug alias', () => {
    process.argv = ['node', 'scripts/migrate-clerk-docs-to-clerk.ts', '--verbose']
    const config = parseConfig()
    expect(config.debug).toBe(true)
  })

  test('parseConfig still accepts legacy --clerk-docs-* flags', () => {
    process.argv = [
      'node',
      'scripts/migrate-clerk-docs-to-clerk.ts',
      '--clerk-docs-path',
      './',
      '--clerk-docs-base',
      'legacy-branch',
      '--clerk-docs-repo',
      'legacy/docs',
      '--allow-dirty-clerk-docs',
    ]
    const config = parseConfig()
    expect(config.clerkDocsBaseBranch).toBe('legacy-branch')
    expect(config.clerkDocsRepo).toEqual(['legacy', 'docs'])
    expect(config.allowDirtyClerkDocs).toBe(true)
  })

  test('parseConfig rejects unknown flags (a typo cannot silently change run behavior)', () => {
    process.argv = ['node', 'scripts/migrate-clerk-docs-to-clerk.ts', '--dry-runn']
    expect(() => parseConfig()).toThrow(/Unknown option/)
  })

  test('parseConfig rejects a value flag with a missing value at the end of argv', () => {
    process.argv = ['node', 'scripts/migrate-clerk-docs-to-clerk.ts', '--clerk-path']
    expect(() => parseConfig()).toThrow(/argument missing/)
  })

  test('parseConfig rejects a value flag whose value is the next flag (no silent mode flip)', () => {
    process.argv = ['node', 'scripts/migrate-clerk-docs-to-clerk.ts', '--clerk-path', '--local-only']
    expect(() => parseConfig()).toThrow(/ambiguous/)
  })

  test('parseConfig supports the --flag=value form', () => {
    process.argv = ['node', 'scripts/migrate-clerk-docs-to-clerk.ts', '--clerk-base=release']
    const config = parseConfig()
    expect(config.clerkBaseBranch).toBe('release')
    expect(config.clerkBaseBranchExplicit).toBe(true)
  })

  test('parseConfig rejects duplicate value flags', () => {
    process.argv = ['node', 'scripts/migrate-clerk-docs-to-clerk.ts', '--clerk-base', 'one', '--clerk-base', 'two']
    expect(() => parseConfig()).toThrow(
      'Duplicate CLI argument: --clerk-base and --clerk-base both set clerk-base. Pass it only once.',
    )
  })

  test('parseConfig rejects duplicate settings passed through aliases', () => {
    process.argv = [
      'node',
      'scripts/migrate-clerk-docs-to-clerk.ts',
      '--docs-path',
      './docs-a',
      '--clerk-docs-path',
      './docs-b',
    ]
    expect(() => parseConfig()).toThrow(
      'Duplicate CLI argument: --docs-path and --clerk-docs-path both set docs-path. Pass it only once.',
    )
  })

  test('parseConfig rejects empty string values (e.g. from an unset shell variable)', () => {
    process.argv = ['node', 'scripts/migrate-clerk-docs-to-clerk.ts', '--clerk-base', '']
    expect(() => parseConfig()).toThrow('--clerk-base requires a non-empty value')
  })

  test('parseConfig rejects --local-only without --clerk-path (branch would die with the temp clone)', () => {
    process.argv = ['node', 'scripts/migrate-clerk-docs-to-clerk.ts', '--local-only']
    expect(() => parseConfig()).toThrow(/--local-only requires --clerk-path/)
  })

  test('parseConfig accepts --local-only together with --clerk-path', () => {
    process.argv = ['node', 'scripts/migrate-clerk-docs-to-clerk.ts', '--local-only', '--clerk-path', './']
    const config = parseConfig()
    expect(config.localOnly).toBe(true)
    expect(config.clerkPath).toBeTruthy()
  })

  test('parseConfig marks clerkBaseBranchExplicit false when --clerk-base is defaulted', () => {
    process.argv = ['node', 'scripts/migrate-clerk-docs-to-clerk.ts']
    const config = parseConfig()
    expect(config.clerkBaseBranch).toBe('main')
    expect(config.clerkBaseBranchExplicit).toBe(false)
  })

  test('parseConfig rejects repo slugs with characters outside the GitHub charset', () => {
    process.argv = ['node', 'scripts/migrate-clerk-docs-to-clerk.ts', '--clerk-repo', "clerk/cl'erk"]
    expect(() => parseConfig()).toThrow(/Invalid repo slug/)
  })

  test('parseConfig rejects repo slugs with too many path segments', () => {
    process.argv = ['node', 'scripts/migrate-clerk-docs-to-clerk.ts', '--docs-repo', 'a/b/c']
    expect(() => parseConfig()).toThrow(/Invalid repo slug/)
  })
})

describe('parseGitRemoteUrlToSlug', () => {
  test('parses https URLs with and without .git suffix', () => {
    expect(parseGitRemoteUrlToSlug('https://github.com/clerk/clerk.git')).toEqual(['clerk', 'clerk'])
    expect(parseGitRemoteUrlToSlug('https://github.com/clerk/clerk-docs')).toEqual(['clerk', 'clerk-docs'])
  })

  test('parses scp-like ssh remotes (git@github.com:owner/repo.git)', () => {
    expect(parseGitRemoteUrlToSlug('git@github.com:clerk/clerk-docs.git')).toEqual(['clerk', 'clerk-docs'])
  })

  test('parses ssh:// URLs', () => {
    expect(parseGitRemoteUrlToSlug('ssh://git@github.com/clerk/clerk.git')).toEqual(['clerk', 'clerk'])
  })

  test('returns null for local paths and non-owner/repo shapes', () => {
    expect(parseGitRemoteUrlToSlug('/Users/me/dev/clerk')).toBeNull()
    expect(parseGitRemoteUrlToSlug('https://github.com/clerk')).toBeNull()
    expect(parseGitRemoteUrlToSlug('https://github.com/a/b/c')).toBeNull()
  })
})

describe('repoSlugsEqual', () => {
  test('compares case-insensitively (GitHub slugs are case-insensitive)', () => {
    expect(repoSlugsEqual(['Clerk', 'Clerk-Docs'], ['clerk', 'clerk-docs'])).toBe(true)
    expect(repoSlugsEqual(['clerk', 'clerk'], ['clerk', 'clerk-docs'])).toBe(false)
  })
})

describe('isDirectCliInvocation', () => {
  test('true when argv[1] resolves to the module path, including paths with spaces', () => {
    const scriptPath = '/tmp/My Projects/clerk-docs/scripts/migrate.ts'
    const url = pathToFileURL(scriptPath).href
    // The old string comparison (`file://${argv1}`) failed here because pathToFileURL percent-encodes.
    expect(url).not.toBe(`file://${scriptPath}`)
    expect(isDirectCliInvocation(url, scriptPath)).toBe(true)
  })

  test('resolves relative argv[1] against the cwd', () => {
    const abs = path.join(process.cwd(), 'scripts/migrate-clerk-docs-to-clerk.ts')
    expect(isDirectCliInvocation(pathToFileURL(abs).href, 'scripts/migrate-clerk-docs-to-clerk.ts')).toBe(true)
  })

  test('false when argv[1] is missing or points elsewhere (module imported, not executed)', () => {
    const url = pathToFileURL('/repo/scripts/migrate.ts').href
    expect(isDirectCliInvocation(url, undefined)).toBe(false)
    expect(isDirectCliInvocation(url, '/usr/bin/vitest')).toBe(false)
  })
})

describe('resolveEffectiveClerkBase', () => {
  test('uses the configured base when there is no existing PR', () => {
    expect(
      resolveEffectiveClerkBase({
        existingPr: null,
        configuredBase: 'main',
        configuredExplicitly: false,
        migrationBranch: 'feat/foo-docs-migration',
      }),
    ).toBe('main')
  })

  test('uses the configured base when it matches the existing PR base', () => {
    expect(
      resolveEffectiveClerkBase({
        existingPr: { baseRefName: 'main', url: 'https://github.com/clerk/clerk/pull/1' },
        configuredBase: 'main',
        configuredExplicitly: true,
        migrationBranch: 'feat/foo-docs-migration',
      }),
    ).toBe('main')
  })

  test('follows the existing PR base when --clerk-base was defaulted', () => {
    expect(
      resolveEffectiveClerkBase({
        existingPr: { baseRefName: 'release', url: 'https://github.com/clerk/clerk/pull/1' },
        configuredBase: 'main',
        configuredExplicitly: false,
        migrationBranch: 'feat/foo-docs-migration',
      }),
    ).toBe('release')
  })

  test('aborts when an explicit --clerk-base conflicts with the existing PR base', () => {
    const conflicting = {
      existingPr: { baseRefName: 'release', url: 'https://github.com/clerk/clerk/pull/1' },
      configuredBase: 'main',
      configuredExplicitly: true,
      migrationBranch: 'feat/foo-docs-migration',
    }
    expect(() => resolveEffectiveClerkBase(conflicting)).toThrow(MigrationError)
    try {
      resolveEffectiveClerkBase(conflicting)
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(MigrationError)
      const migrationErr = err as InstanceType<typeof MigrationError>
      expect(migrationErr.code).toBe('clerk-base-mismatch')
      const hints = migrationErr.hints.join('\n')
      expect(hints).toContain('git merge origin/main')
      expect(hints).toContain('git checkout feat/foo-docs-migration')
    }
  })
})

describe('rewritePrRefsInCommitMessage', () => {
  const SLUG = 'clerk/clerk-docs'

  test('rewrites a squash-merge PR ref like (#123)', () => {
    expect(rewritePrRefsInCommitMessage('Fix typo (#123)', SLUG)).toBe('Fix typo (clerk/clerk-docs#123)')
  })

  test('rewrites standalone #NNN at the start of the message', () => {
    expect(rewritePrRefsInCommitMessage('#42 is fixed', SLUG)).toBe('clerk/clerk-docs#42 is fixed')
  })

  test('rewrites keyword refs like Fixes #456', () => {
    expect(rewritePrRefsInCommitMessage('Fixes #456', SLUG)).toBe('Fixes clerk/clerk-docs#456')
  })

  test('rewrites multiple refs in a single message', () => {
    expect(rewritePrRefsInCommitMessage('Fixes #10, relates to #20 (#30)', SLUG)).toBe(
      'Fixes clerk/clerk-docs#10, relates to clerk/clerk-docs#20 (clerk/clerk-docs#30)',
    )
  })

  test('does not double-qualify an already qualified ref', () => {
    expect(rewritePrRefsInCommitMessage('See clerk/clerk-docs#99', SLUG)).toBe('See clerk/clerk-docs#99')
  })

  test('does not rewrite refs inside a URL path', () => {
    expect(rewritePrRefsInCommitMessage('https://github.com/clerk/clerk-docs/pull/123', SLUG)).toBe(
      'https://github.com/clerk/clerk-docs/pull/123',
    )
  })

  test('does not rewrite a number preceded by a word character', () => {
    expect(rewritePrRefsInCommitMessage('foo#789', SLUG)).toBe('foo#789')
  })

  test('leaves messages with no refs unchanged', () => {
    expect(rewritePrRefsInCommitMessage('Just a plain commit message', SLUG)).toBe('Just a plain commit message')
  })

  test('does not match markdown headings', () => {
    expect(rewritePrRefsInCommitMessage('# Heading\n## Subheading', SLUG)).toBe('# Heading\n## Subheading')
  })

  test('handles multiline commit messages', () => {
    const msg = 'feat: add feature (#7)\n\nCloses #8\nRelated to #9'
    expect(rewritePrRefsInCommitMessage(msg, SLUG)).toBe(
      'feat: add feature (clerk/clerk-docs#7)\n\nCloses clerk/clerk-docs#8\nRelated to clerk/clerk-docs#9',
    )
  })

  test('works with a custom repo slug', () => {
    expect(rewritePrRefsInCommitMessage('Fix (#1)', 'acme/docs')).toBe('Fix (acme/docs#1)')
  })

  test('rewrites ref at end of line with no trailing text', () => {
    expect(rewritePrRefsInCommitMessage('done #55', SLUG)).toBe('done clerk/clerk-docs#55')
  })

  test('handles PR numbers of any length', () => {
    expect(rewritePrRefsInCommitMessage('(#1)', SLUG)).toBe('(clerk/clerk-docs#1)')
    expect(rewritePrRefsInCommitMessage('(#23)', SLUG)).toBe('(clerk/clerk-docs#23)')
    expect(rewritePrRefsInCommitMessage('(#456)', SLUG)).toBe('(clerk/clerk-docs#456)')
    expect(rewritePrRefsInCommitMessage('(#2234)', SLUG)).toBe('(clerk/clerk-docs#2234)')
    expect(rewritePrRefsInCommitMessage('(#99999)', SLUG)).toBe('(clerk/clerk-docs#99999)')
  })
})

describe('buildPrRefsRewriteCallback', () => {
  test('returns a Python snippet with the repo slug embedded', () => {
    const result = buildPrRefsRewriteCallback('clerk/clerk-docs')
    expect(result).toContain('import re')
    expect(result).toContain("clerk/clerk-docs#'")
    expect(result).toContain('message')
  })

  test('uses the same lookbehind pattern as the TypeScript regex', () => {
    const result = buildPrRefsRewriteCallback('clerk/clerk-docs')
    expect(result).toContain('(?<![/\\w])#(\\d+)')
  })
})

describe('buildMigrationBranchName', () => {
  test('appends the canonical suffix to the clerk-docs branch name', () => {
    expect(buildMigrationBranchName('feat/foo')).toBe('feat/foo-docs-migration')
    expect(buildMigrationBranchName('bug-1234')).toBe('bug-1234-docs-migration')
  })

  test('is a pure function of its input (no hidden state)', () => {
    const name = 'any-branch'
    expect(buildMigrationBranchName(name)).toBe(buildMigrationBranchName(name))
  })
})

describe('resolveMigrationBranchName', () => {
  test('falls back to the canonical name when no target branch is set', () => {
    expect(resolveMigrationBranchName({ targetBranch: undefined }, 'feat/foo')).toBe('feat/foo-docs-migration')
  })

  test('uses the explicit target branch verbatim when provided', () => {
    expect(resolveMigrationBranchName({ targetBranch: 'nick/my-new-branch' }, 'feat/foo')).toBe('nick/my-new-branch')
  })
})

describe('classifyExistingMigration', () => {
  test('returns "create" when no migration branch exists yet', () => {
    expect(classifyExistingMigration(null)).toBe('create')
  })

  test('returns "update" when a branch exists but no PR has been opened yet', () => {
    expect(classifyExistingMigration({ pr: null })).toBe('update')
  })

  test('returns "update" when the existing PR is open', () => {
    expect(classifyExistingMigration({ pr: { state: 'OPEN' } })).toBe('update')
  })

  test('returns "abort-closed" when the existing PR is closed', () => {
    expect(classifyExistingMigration({ pr: { state: 'CLOSED' } })).toBe('abort-closed')
  })

  test('returns "abort-closed" when the existing PR is merged', () => {
    expect(classifyExistingMigration({ pr: { state: 'MERGED' } })).toBe('abort-closed')
  })

  test('treats unknown PR states as safe-to-update (forward compat)', () => {
    expect(classifyExistingMigration({ pr: { state: 'DRAFT' } })).toBe('update')
  })
})

describe('formatClosedPrAbortMessage', () => {
  test('includes the branch, state, and PR URL in lower-case', () => {
    const msg = formatClosedPrAbortMessage({
      branch: 'feat/foo-docs-migration',
      prUrl: 'https://github.com/clerk/clerk/pull/42',
      state: 'MERGED',
    })
    expect(msg).toContain('feat/foo-docs-migration')
    expect(msg).toContain('merged')
    expect(msg).toContain('https://github.com/clerk/clerk/pull/42')
  })

  test('handles CLOSED state', () => {
    const msg = formatClosedPrAbortMessage({
      branch: 'any-branch-docs-migration',
      prUrl: 'https://example.invalid/pr/1',
      state: 'CLOSED',
    })
    expect(msg).toContain('closed')
  })
})

describe('formatUpdateMergeConflictHints', () => {
  const tempParams = {
    branch: 'feat/foo-docs-migration',
    workspacePath: '/tmp/clerk-migrate-abc',
    isTemporary: true,
    remoteName: 'clerk-docs-migrate-123',
    filterRepoClonePath: '/tmp/clerk-docs-migrate-feat-foo-456',
  }
  const localParams = {
    branch: 'feat/foo-docs-migration',
    workspacePath: '/Users/me/dev/clerk',
    isTemporary: false,
    remoteName: 'clerk-docs-migrate-789',
    filterRepoClonePath: '/tmp/clerk-docs-migrate-feat-foo-456',
  }

  test('temp workspaces lead with the IDE resolve-in-temp-clone fix, --clerk-path as fallback', () => {
    const hints = formatUpdateMergeConflictHints(tempParams)
    expect(hints[0]).toContain('cursor "/tmp/clerk-migrate-abc"')
    expect(hints[1]).toContain('re-run this script')
    expect(hints.join('\n')).toContain('temporary clone')
    expect(hints.join('\n')).toContain('--clerk-path')
    const joined = hints.join('\n')
    expect(joined.indexOf('cursor "/tmp/clerk-migrate-abc"')).toBeLessThan(joined.indexOf('--clerk-path'))
  })

  test('temp workspaces still document the manual resolve/push path', () => {
    const hints = formatUpdateMergeConflictHints(tempParams)
    const joined = hints.join('\n')
    expect(joined).toContain('git push')
    expect(joined).toContain('tracks origin/feat/foo-docs-migration')
  })

  test('temp workspaces say deleting both temp dirs is the whole cleanup (no git remote remove)', () => {
    const hints = formatUpdateMergeConflictHints(tempParams)
    const joined = hints.join('\n')
    expect(joined).not.toContain('git remote remove')
    expect(joined).toContain('/tmp/clerk-migrate-abc')
    expect(joined).toContain('/tmp/clerk-docs-migrate-feat-foo-456')
  })

  test('local (--clerk-path) workspaces describe the IDE resolve-then-push flow', () => {
    const hints = formatUpdateMergeConflictHints(localParams)
    const joined = hints.join('\n')
    expect(joined).toContain('/Users/me/dev/clerk')
    expect(joined).toContain('git push')
    expect(joined).toContain('tracks origin/feat/foo-docs-migration')
    expect(joined).toContain('git remote remove clerk-docs-migrate-789')
    expect(joined).toContain('git merge --abort')
  })

  test('local workspaces still list the filter-repo temp clone for deletion', () => {
    const hints = formatUpdateMergeConflictHints(localParams)
    expect(hints.join('\n')).toContain('/tmp/clerk-docs-migrate-feat-foo-456')
  })

  test('local workspaces do NOT suggest --clerk-path (already using it)', () => {
    const hints = formatUpdateMergeConflictHints(localParams)
    expect(hints.join('\n')).not.toContain('--clerk-path')
  })

  test('merge conflicts (default operation) resume with git commit and abort with git merge --abort', () => {
    for (const params of [localParams, { ...localParams, operation: 'merge' as const }]) {
      const joined = formatUpdateMergeConflictHints(params).join('\n')
      expect(joined).toContain('`git commit`')
      expect(joined).toContain('`git merge --abort`')
      expect(joined).not.toContain('cherry-pick')
    }
  })

  test('cherry-pick conflicts resume with git cherry-pick --continue and abort with git cherry-pick --abort', () => {
    const joined = formatUpdateMergeConflictHints({ ...localParams, operation: 'cherry-pick' }).join('\n')
    expect(joined).toContain('`git cherry-pick --continue`')
    expect(joined).toContain('`git cherry-pick --abort`')
    expect(joined).not.toContain('`git commit`')
    expect(joined).not.toContain('`git merge --abort`')
  })

  test('cherry-pick conflicts in temp workspaces name the resume command and promise the re-run picks up pending commits', () => {
    const hints = formatUpdateMergeConflictHints({ ...tempParams, operation: 'cherry-pick' })
    expect(hints[0]).toContain('`git cherry-pick --continue`')
    expect(hints[1]).toContain('still pending')
  })
})

describe('formatMigrationNoticeCommentBody', () => {
  test('embeds the marker and every migrated branch + clerk PR URL', () => {
    const body = formatMigrationNoticeCommentBody('clerk/clerk', [
      { branch: 'feat/foo-docs-migration', prUrl: 'https://github.com/clerk/clerk/pull/1234' },
      { branch: 'nick/retry-branch', prUrl: 'https://github.com/clerk/clerk/pull/5678' },
    ])
    expect(body).toContain('<!-- clerk-docs-migration-notice -->')
    expect(body).toContain('- `feat/foo-docs-migration` → https://github.com/clerk/clerk/pull/1234')
    expect(body).toContain('- `nick/retry-branch` → https://github.com/clerk/clerk/pull/5678')
  })

  test('starts with the marker so upsertMigrationNoticeComment can detect re-runs', () => {
    const body = formatMigrationNoticeCommentBody('clerk/clerk', [
      { branch: 'b', prUrl: 'https://example.invalid/pr/1' },
    ])
    expect(body.startsWith('<!-- clerk-docs-migration-notice -->')).toBe(true)
  })

  test('renders entries without a branch (recovered from the legacy comment format)', () => {
    const body = formatMigrationNoticeCommentBody('clerk/clerk', [{ prUrl: 'https://github.com/clerk/clerk/pull/9' }])
    expect(body).toContain('- https://github.com/clerk/clerk/pull/9')
    expect(body).not.toContain('`')
  })
})

describe('parseMigrationNoticeEntries', () => {
  test('round-trips entries through formatMigrationNoticeCommentBody', () => {
    const entries = [
      { branch: 'feat/foo-docs-migration', prUrl: 'https://github.com/clerk/clerk/pull/1234' },
      { prUrl: 'https://github.com/clerk/clerk/pull/42' },
    ]
    const body = formatMigrationNoticeCommentBody('clerk/clerk', entries)
    expect(parseMigrationNoticeEntries(body)).toEqual(entries)
  })

  test('recovers the URL from the legacy single-line comment format', () => {
    const legacy =
      '<!-- clerk-docs-migration-notice -->\nThis branch and pr were migrated to: https://github.com/clerk/clerk/pull/2418'
    expect(parseMigrationNoticeEntries(legacy)).toEqual([{ prUrl: 'https://github.com/clerk/clerk/pull/2418' }])
  })

  test('returns no entries for unrelated comment bodies', () => {
    expect(parseMigrationNoticeEntries('just a regular PR comment')).toEqual([])
  })
})

describe('buildClosePrCommandArgs', () => {
  test('returns the gh CLI args to close a PR by number in a specific repo', () => {
    expect(buildClosePrCommandArgs(42, 'clerk/clerk-docs')).toEqual(['pr', 'close', '42', '--repo', 'clerk/clerk-docs'])
  })

  test('coerces the PR number to a string for the CLI', () => {
    const args = buildClosePrCommandArgs(7, 'acme/docs')
    expect(args[2]).toBe('7')
    expect(typeof args[2]).toBe('string')
  })
})

describe('buildFetchBranchRefspecArgs', () => {
  test('uses a forced explicit refspec so origin/<branch> is created in a single-branch clone', () => {
    expect(buildFetchBranchRefspecArgs('migrate-clerk-docs')).toEqual([
      'fetch',
      '--no-prune',
      'origin',
      '+refs/heads/migrate-clerk-docs:refs/remotes/origin/migrate-clerk-docs',
    ])
  })

  test('preserves slashes in branch names like nick/my-new-branch', () => {
    expect(buildFetchBranchRefspecArgs('nick/my-new-branch')).toEqual([
      'fetch',
      '--no-prune',
      'origin',
      '+refs/heads/nick/my-new-branch:refs/remotes/origin/nick/my-new-branch',
    ])
  })

  test('forces the tracking-ref update (leading +) so force-pushed remote branches still fetch', () => {
    const refspec = buildFetchBranchRefspecArgs('any-branch').at(-1)
    expect(refspec?.startsWith('+')).toBe(true)
  })

  test('is prune-safe: passes --no-prune and a fully-qualified source so a user prune config cannot delete the tracking ref', () => {
    const args = buildFetchBranchRefspecArgs('any-branch')
    expect(args).toContain('--no-prune')
    expect(args.at(-1)).toBe('+refs/heads/any-branch:refs/remotes/origin/any-branch')
  })
})

describe('buildBaseMergeIntoMigrationArgs', () => {
  test('merges origin/<base> into the migration branch with a descriptive message', () => {
    expect(buildBaseMergeIntoMigrationArgs('nick/local-clerk-docs', 'migrate-clerk-docs')).toEqual([
      'merge',
      'origin/nick/local-clerk-docs',
      '-m',
      'Merge clerk base nick/local-clerk-docs into migrate-clerk-docs',
    ])
  })

  test('does not pass --allow-unrelated-histories (migration branch descends from the base)', () => {
    expect(buildBaseMergeIntoMigrationArgs('main', 'feat/foo-docs-migration')).not.toContain(
      '--allow-unrelated-histories',
    )
  })
})

describe('buildDeltaRevListArgs', () => {
  test('enumerates the rewritten delta range oldest-first with merges dropped', () => {
    expect(buildDeltaRevListArgs('clerk-docs-migrate-123', 'nick/my-new-branch')).toEqual([
      'rev-list',
      '--reverse',
      '--no-merges',
      `clerk-docs-migrate-123/${MIGRATION_DELTA_BASE_REF}..clerk-docs-migrate-123/nick/my-new-branch`,
    ])
  })

  test('bounds the range at the stamped delta base so clerk-docs main history is excluded', () => {
    const range = buildDeltaRevListArgs('mig', 'feat').at(-1)
    expect(range).toBe(`mig/${MIGRATION_DELTA_BASE_REF}..mig/feat`)
  })
})

describe('buildGitCherryArgs', () => {
  test('compares the rewritten delta against the migration branch by patch-id', () => {
    expect(buildGitCherryArgs('feat/foo-docs-migration', 'clerk-docs-migrate-123', 'feat/foo')).toEqual([
      'cherry',
      'feat/foo-docs-migration',
      'clerk-docs-migrate-123/feat/foo',
      `clerk-docs-migrate-123/${MIGRATION_DELTA_BASE_REF}`,
    ])
  })
})

describe('parseGitCherryUnappliedShas', () => {
  test('returns only + (unapplied) SHAs, preserving commit order', () => {
    const stdout = [
      '- c99139fb700f7f2714919731b4d762c01c1a0a37',
      '+ 92441b5e019015da358e1309ba9593d55f765e19',
      '- b4a2cb03ef241b397cbda74faaec70356449a8a8',
      '+ 8f87892e4d86943ce0ae0e45abd90090c102c8c0',
    ].join('\n')
    expect(parseGitCherryUnappliedShas(stdout)).toEqual([
      '92441b5e019015da358e1309ba9593d55f765e19',
      '8f87892e4d86943ce0ae0e45abd90090c102c8c0',
    ])
  })

  test('returns [] when everything is already applied (all - lines) or output is empty', () => {
    expect(parseGitCherryUnappliedShas('- abc123\n- def456\n')).toEqual([])
    expect(parseGitCherryUnappliedShas('')).toEqual([])
    expect(parseGitCherryUnappliedShas('\n\n')).toEqual([])
  })

  test('tolerates surrounding whitespace without misreading a SHA', () => {
    expect(parseGitCherryUnappliedShas('  + abc123  \n')).toEqual(['abc123'])
  })
})

describe('buildUpstreamConfigArgs', () => {
  test('writes remote + merge config so the branch tracks its own name on origin', () => {
    expect(buildUpstreamConfigArgs('nick/test-migrate-clerk-docs-2')).toEqual([
      ['config', 'branch.nick/test-migrate-clerk-docs-2.remote', 'origin'],
      ['config', 'branch.nick/test-migrate-clerk-docs-2.merge', 'refs/heads/nick/test-migrate-clerk-docs-2'],
    ])
  })
})

describe('conflict auto-resolution and fingerprint dedup (real git repos)', () => {
  let repo = ''

  const git = (...args: string[]) => runCommand('git', args, repo)
  const gitAllowFail = (...args: string[]) => runCommand('git', args, repo, { allowFailure: true })

  async function write(file: string, content: string): Promise<void> {
    await fs.mkdir(path.dirname(path.join(repo, file)), { recursive: true })
    await fs.writeFile(path.join(repo, file), content, 'utf8')
  }

  /** Commit everything with a fixed author date so fingerprints are deterministic per commit. */
  async function commitAll(message: string, date: string): Promise<string> {
    await git('add', '-A')
    await git('commit', '-m', message, '--date', date)
    return (await git('rev-parse', 'HEAD')).stdout.trim()
  }

  async function contentAt(ref: string, file: string): Promise<string> {
    return (await git('show', `${ref}:${file}`)).stdout
  }

  async function fileExistsAt(ref: string, file: string): Promise<boolean> {
    return (await gitAllowFail('cat-file', '-e', `${ref}:${file}`)).code === 0
  }

  beforeEach(async () => {
    repo = await fs.mkdtemp(path.join(os.tmpdir(), 'migrate-clerk-docs-git-test-'))
    await git('init', '-b', 'main')
    await git('config', 'user.email', 'docs-author@example.com')
    await git('config', 'user.name', 'Docs Author')
    await git('config', 'commit.gpgsign', 'false')
  })

  afterEach(async () => {
    if (repo) {
      await fs.rm(repo, { recursive: true, force: true })
    }
  })

  /**
   * The *safe* conflict shape the auto-resolver exists for: the clerk base's copy of the file is
   * itself a docs-history state (here, mid-history v2 — like a squashed import that carried a
   * docs-main state the branch had merged), and the delta commits are stale hunks authored
   * against long-gone versions of the same line. Picking them conflicts, but clerk holds no
   * independent edit.
   */
  async function setupStaleHunkDelta() {
    await write('docs/doc.md', 'line one\nline two\nline three\n')
    const rootSha = await commitAll('root: initial doc', '2026-01-01T00:00:01Z')

    await git('checkout', '-b', 'docs')
    await write('docs/doc.md', 'line one\nline two (v1)\nline three\n')
    await write('docs/extra.md', 'extra\n')
    const d1 = await commitAll('docs: edit line two and add extra', '2026-01-01T00:00:02Z')
    await write('docs/doc.md', 'line one\nline two (v2)\nline three\n')
    const d2 = await commitAll('docs: line two v2', '2026-01-01T00:00:03Z')
    await write('docs/doc.md', 'line one\nline two (v3)\nline three\n')
    const d3 = await commitAll('docs: line two v3', '2026-01-01T00:00:04Z')

    await git('checkout', 'main')
    await write('docs/doc.md', 'line one\nline two (v2)\nline three\n')
    await commitAll('clerk: import carries a docs-history state of doc.md', '2026-01-01T00:00:05Z')

    return { rootSha, d1, d2, d3 }
  }

  /**
   * The *unsafe* shape: the clerk base's copy of the file carries an edit that exists nowhere in
   * the docs branch's history (a clerk-side fix, or another migration PR that already merged).
   * Auto-resolving to the docs final tree would silently revert it.
   */
  async function setupClerkDivergedDelta() {
    await write('docs/doc.md', 'line one\nline two\nline three\n')
    const rootSha = await commitAll('root: initial doc', '2026-01-01T00:00:01Z')

    await git('checkout', '-b', 'docs')
    await write('docs/doc.md', 'line one\nline two (docs edit)\nline three\n')
    const d1 = await commitAll('docs: edit line two', '2026-01-01T00:00:02Z')
    await write('docs/doc.md', 'line one\nline two (docs edit)\nline three (docs edit)\n')
    const d2 = await commitAll('docs: edit line three', '2026-01-01T00:00:03Z')

    await git('checkout', 'main')
    await write('docs/doc.md', 'line one\nline two (clerk edit)\nline three\n')
    await commitAll('clerk: conflicting edit to line two', '2026-01-01T00:00:04Z')

    return { rootSha, d1, d2 }
  }

  test('cherryPickDeltaCommits auto-resolves a stale-hunk conflict to the docs branch final tree and continues', async () => {
    const { rootSha, d1, d2, d3 } = await setupStaleHunkDelta()

    const picked = await cherryPickDeltaCommits(repo, [d1, d2, d3], 'docs', rootSha)

    expect(picked.conflictSha).toBeNull()
    // Resolving d1's conflict takes the *whole final file* — including d2/d3's later edits — so
    // their own picks become empty and are skipped. This is the documented "coarsens which
    // mid-sequence commit carries a disputed hunk" behavior: net tree right, attribution coarser.
    expect(picked.applied).toBe(1)
    expect(picked.skippedEmpty).toBe(2)
    // The conflicted file moved forward along docs history to the final content, not a mix.
    expect(await contentAt('main', 'docs/doc.md')).toBe(await contentAt('docs', 'docs/doc.md'))
    expect(await contentAt('main', 'docs/extra.md')).toBe('extra\n')
    const subjects = (await git('log', '--format=%s', 'main')).stdout
    // The auto-resolved commit keeps the source subject (and author), which fingerprint dedup relies on.
    expect(subjects).toContain('docs: edit line two and add extra')
    // d2/d3 subjects never land — their content rode along in the auto-resolved d1.
    expect(subjects).not.toContain('docs: line two v2')
    expect(subjects).not.toContain('docs: line two v3')
  })

  test('cherryPickDeltaCommits resolves to deletion when the docs branch itself deletes the conflicted file', async () => {
    await write('docs/old.md', 'stale content\n')
    const rootSha = await commitAll('root: add old doc', '2026-01-01T00:00:01Z')

    await git('checkout', '-b', 'docs')
    await write('docs/old.md', 'docs rewrite\n')
    const d1 = await commitAll('docs: rewrite old doc', '2026-01-01T00:00:02Z')
    await write('docs/old.md', 'docs rewrite v2\n')
    const d2 = await commitAll('docs: rewrite old doc again', '2026-01-01T00:00:03Z')
    await fs.rm(path.join(repo, 'docs/old.md'))
    const d3 = await commitAll('docs: delete old doc', '2026-01-01T00:00:04Z')

    // clerk base holds a docs-history state of the file (no independent clerk edit).
    await git('checkout', 'main')
    await write('docs/old.md', 'docs rewrite v2\n')
    await commitAll('clerk: import carries a docs-history state of old doc', '2026-01-01T00:00:05Z')

    const picked = await cherryPickDeltaCommits(repo, [d1, d2, d3], 'docs', rootSha)

    expect(picked.conflictSha).toBeNull()
    expect(await fileExistsAt('main', 'docs/old.md')).toBe(false)
  })

  test('cherryPickDeltaCommits skips a conflicted pick whose resolution is a no-op against HEAD', async () => {
    await write('docs/doc.md', 'line two\n')
    const rootSha = await commitAll('root: initial doc', '2026-01-01T00:00:01Z')

    await git('checkout', '-b', 'docs')
    await write('docs/doc.md', 'TWO\n')
    const d1 = await commitAll('docs: first edit', '2026-01-01T00:00:02Z')
    await write('docs/doc.md', 'TWO plus\n')
    const d2 = await commitAll('docs: second edit', '2026-01-01T00:00:03Z')

    // clerk base is already at the docs final content (e.g. a previous run landed it).
    await git('checkout', 'main')
    await write('docs/doc.md', 'TWO plus\n')
    await commitAll('clerk: already at final content', '2026-01-01T00:00:04Z')

    const picked = await cherryPickDeltaCommits(repo, [d1, d2], 'docs', rootSha)

    expect(picked.conflictSha).toBeNull()
    expect(picked.applied).toBe(0)
    expect(picked.skippedEmpty).toBe(2)
    expect(await contentAt('main', 'docs/doc.md')).toBe('TWO plus\n')
  })

  test('autoResolveConflictsToBranchFinalState returns null when no conflict is in progress', async () => {
    await write('docs/doc.md', 'content\n')
    const rootSha = await commitAll('root', '2026-01-01T00:00:01Z')
    expect(await autoResolveConflictsToBranchFinalState(repo, 'main', rootSha, 'cherry-pick')).toBeNull()
  })

  test('merge conflicts auto-resolve to the docs final tree when the base side is a docs-history state', async () => {
    await write('clerk-docs/docs/doc.md', 'line one\nline two\n')
    const rootSha = await commitAll('root', '2026-01-01T00:00:01Z')

    await git('checkout', '-b', 'docs')
    await write('clerk-docs/docs/doc.md', 'line one\nline two (v1)\n')
    await commitAll('docs: v1', '2026-01-01T00:00:02Z')
    await write('clerk-docs/docs/doc.md', 'line one\nline two (v2)\n')
    await commitAll('docs: v2', '2026-01-01T00:00:03Z')

    // The migration branch already carries the docs final tree.
    await git('checkout', '-b', 'migration', rootSha)
    await write('clerk-docs/docs/doc.md', 'line one\nline two (v2)\n')
    await commitAll('migration: at docs final', '2026-01-01T00:00:04Z')

    // The clerk base moved to a docs-history state (e.g. an earlier migration PR merged v1).
    await git('checkout', '-b', 'base', rootSha)
    await write('clerk-docs/docs/doc.md', 'line one\nline two (v1)\n')
    await commitAll('base: carries docs v1', '2026-01-01T00:00:05Z')

    await git('checkout', 'migration')
    const merge = await gitAllowFail('merge', 'base', '-m', 'Merge clerk base into migration')
    expect(merge.code).not.toBe(0)

    const resolved = await autoResolveConflictsToBranchFinalState(repo, 'docs', rootSha, 'merge')

    expect(resolved).toBe('applied')
    expect(await contentAt('migration', 'clerk-docs/docs/doc.md')).toBe('line one\nline two (v2)\n')
    // The merge concluded as a real merge commit (two parents), so base ancestry is recorded.
    expect((await git('rev-list', '--parents', '-1', 'migration')).stdout.trim().split(/\s+/)).toHaveLength(3)
  })

  test('merge conflicts with clerk-own base edits refuse auto-resolution', async () => {
    await write('clerk-docs/docs/doc.md', 'line one\nline two\n')
    const rootSha = await commitAll('root', '2026-01-01T00:00:01Z')

    await git('checkout', '-b', 'docs')
    await write('clerk-docs/docs/doc.md', 'line one\nline two (docs edit)\n')
    await commitAll('docs: edit', '2026-01-01T00:00:02Z')

    await git('checkout', '-b', 'migration', rootSha)
    await write('clerk-docs/docs/doc.md', 'line one\nline two (docs edit)\n')
    await commitAll('migration: at docs final', '2026-01-01T00:00:03Z')

    await git('checkout', '-b', 'base', rootSha)
    await write('clerk-docs/docs/doc.md', 'line one\nline two (clerk edit)\n')
    await commitAll('base: clerk-side fix', '2026-01-01T00:00:04Z')

    await git('checkout', 'migration')
    const merge = await gitAllowFail('merge', 'base', '-m', 'Merge clerk base into migration')
    expect(merge.code).not.toBe(0)

    expect(await autoResolveConflictsToBranchFinalState(repo, 'docs', rootSha, 'merge')).toBeNull()
    // Conflict state left intact for the sync-back / manual fallback.
    expect((await git('ls-files', '-u')).stdout.trim()).not.toBe('')
  })

  test('GUARD: clerk-side edits on a conflicted path refuse auto-resolution and stop for manual handling', async () => {
    // If the clerk base carries its own edit to the conflicted file (another merged migration PR,
    // or a direct clerk-side fix), resolving to the docs final tree would silently revert it —
    // the PR's diff against the base would include undoing that edit. The guard detects that the
    // clerk-side file state is not a docs-history state and leaves the conflict for a human.
    const { rootSha, d1, d2 } = await setupClerkDivergedDelta()

    const before = await contentAt('main', 'docs/doc.md')
    expect(before).toContain('clerk edit')

    const picked = await cherryPickDeltaCommits(repo, [d1, d2], 'docs', rootSha)

    // Stops on the conflicting commit instead of auto-resolving...
    expect(picked.conflictSha).toBe(d1)
    // ...with the conflict state intact for manual resolution...
    expect((await git('ls-files', '-u')).stdout.trim()).not.toBe('')
    // ...and the clerk-side edit still in place on the branch.
    expect(await contentAt('main', 'docs/doc.md')).toContain('clerk edit')
  })

  test('GUARD accepts a blob that only exists as a docs merge-commit resolution (git log -m)', async () => {
    // A conflict resolved *inside a merge commit* on the docs branch produces a blob that no
    // ordinary (non-merge) commit introduces. `git log --raw` skips merge diffs by default, so
    // without -m the guard would wrongly treat that docs-owned state as a clerk edit.
    await write('docs/doc.md', 'line one\nline two\n')
    const rootSha = await commitAll('root', '2026-01-01T00:00:01Z')

    await git('checkout', '-b', 'docs')
    await write('docs/doc.md', 'line one\nline two (branch)\n')
    await commitAll('docs: branch edit', '2026-01-01T00:00:02Z')

    await git('checkout', '-b', 'docs-main', rootSha)
    await write('docs/doc.md', 'line one\nline two (main)\n')
    await commitAll('docs-main: main edit', '2026-01-01T00:00:03Z')

    // Merge main into the branch and resolve the conflict to brand-new content: this blob exists
    // only in the merge commit's tree.
    await git('checkout', 'docs')
    await gitAllowFail('merge', 'docs-main', '-m', 'merge docs main')
    await write('docs/doc.md', 'line one\nline two (merged resolution)\n')
    await git('add', '-A')
    await git('commit', '--no-edit')
    await write('docs/doc.md', 'line one\nline two (merged resolution)\nline three\n')
    await commitAll('docs: after merge', '2026-01-01T00:00:04Z')

    const mergeResolutionBlob = (await git('rev-parse', 'docs~1:docs/doc.md')).stdout.trim()
    expect(await blobIsWithinDocsHistory(repo, 'docs/doc.md', mergeResolutionBlob, 'docs', rootSha)).toBe(true)

    // A genuinely foreign blob still fails.
    await git('checkout', '-b', 'clerk', rootSha)
    await write('docs/doc.md', 'line one\nline two (clerk only)\n')
    await commitAll('clerk: own edit', '2026-01-01T00:00:05Z')
    const clerkBlob = (await git('rev-parse', 'clerk:docs/doc.md')).stdout.trim()
    expect(await blobIsWithinDocsHistory(repo, 'docs/doc.md', clerkBlob, 'docs', rootSha)).toBe(false)
  })

  test('GUARD accepts a clerk-side deletion when the docs final tree also lacks the file', async () => {
    await write('docs/doc.md', 'content\n')
    await write('docs/gone.md', 'delete me\n')
    const rootSha = await commitAll('root', '2026-01-01T00:00:01Z')

    await git('checkout', '-b', 'docs')
    await git('rm', 'docs/gone.md')
    await git('commit', '-m', 'docs: delete gone.md', '--date', '2026-01-01T00:00:02Z')

    // Clerk deleted it too (blob undefined = that side has no stage): deletion matches the docs
    // final tree, so resolving to the final tree cannot resurrect anything.
    expect(await blobIsWithinDocsHistory(repo, 'docs/gone.md', undefined, 'docs', rootSha)).toBe(true)
    // But a clerk-side deletion of a file the docs branch still has is a clerk edit.
    expect(await blobIsWithinDocsHistory(repo, 'docs/doc.md', undefined, 'docs', rootSha)).toBe(false)
  })

  test('fingerprint dedup: an auto-resolved pick is invisible to git cherry but caught by fingerprints (fixes the re-pick loop)', async () => {
    const { rootSha, d1 } = await setupStaleHunkDelta()

    // Freeze origin/main at the clerk base tip; collectAppliedCommitFingerprints subtracts it.
    const mainSha = (await git('rev-parse', 'main')).stdout.trim()
    await git('update-ref', 'refs/remotes/origin/main', mainSha)

    // Update-mode analog: the migration branch picks d1, which conflicts and is auto-resolved.
    await git('checkout', '-b', 'migration')
    const picked = await cherryPickDeltaCommits(repo, [d1], 'docs', rootSha)
    expect(picked.applied).toBe(1)

    // Patch-id bookkeeping alone re-picks it: the resolved commit's patch no longer matches d1,
    // so `git cherry` still reports d1 as unapplied (+). This is the pre-change infinite loop.
    const cherry = await git('cherry', 'migration', 'docs', rootSha)
    expect(parseGitCherryUnappliedShas(cherry.stdout)).toContain(d1)

    // The fingerprint filter recognizes the prior application and skips it.
    const applied = await collectAppliedCommitFingerprints(repo, 'migration', 'main')
    expect(applied.has(await commitFingerprint(repo, d1))).toBe(true)
  })

  test('commitFingerprint is author email|timestamp|subject and survives a cherry-pick', async () => {
    await write('docs/doc.md', 'base\n')
    await commitAll('root', '2026-01-01T00:00:01Z')

    await git('checkout', '-b', 'docs')
    await write('docs/other.md', 'new file\n')
    const d1 = await commitAll('docs: add other doc', '2026-02-03T04:05:06Z')

    const fingerprint = await commitFingerprint(repo, d1)
    expect(fingerprint).toBe(`docs-author@example.com|${Date.parse('2026-02-03T04:05:06Z') / 1000}|docs: add other doc`)

    await git('checkout', 'main')
    await git('cherry-pick', d1)
    expect(await commitFingerprint(repo, 'main')).toBe(fingerprint)
  })

  test('LIMITATION: a manual resolution that rewrote the subject is not recognized and would be re-picked', async () => {
    const { rootSha, d1 } = await setupStaleHunkDelta()
    const mainSha = (await git('rev-parse', 'main')).stdout.trim()
    await git('update-ref', 'refs/remotes/origin/main', mainSha)

    await git('checkout', '-b', 'migration')
    const picked = await cherryPickDeltaCommits(repo, [d1], 'docs', rootSha)
    expect(picked.applied).toBe(1)
    // A human rewording the resolution commit breaks the subject-based fingerprint match.
    await git('commit', '--amend', '-m', 'resolve conflict my own way')

    const applied = await collectAppliedCommitFingerprints(repo, 'migration', 'main')
    expect(applied.has(await commitFingerprint(repo, d1))).toBe(false)
  })

  test('collectAppliedCommitFingerprints excludes base commits and merge commits', async () => {
    await write('docs/doc.md', 'base\n')
    await commitAll('root', '2026-01-01T00:00:01Z')
    const mainSha = (await git('rev-parse', 'main')).stdout.trim()
    await git('update-ref', 'refs/remotes/origin/main', mainSha)

    await git('checkout', '-b', 'migration')
    await write('docs/new.md', 'delta\n')
    await commitAll('migration: delta commit', '2026-01-01T00:00:02Z')

    // Advance main and merge it in, like update mode's base merge.
    await git('checkout', 'main')
    await write('docs/base-move.md', 'base moved\n')
    await commitAll('main: base moves on', '2026-01-01T00:00:03Z')
    await git('update-ref', 'refs/remotes/origin/main', (await git('rev-parse', 'main')).stdout.trim())
    await git('checkout', 'migration')
    await git('merge', 'main', '-m', 'Merge clerk base main into migration')

    const applied = await collectAppliedCommitFingerprints(repo, 'migration', 'main')
    expect(applied).toEqual(
      new Set([`docs-author@example.com|${Date.parse('2026-01-01T00:00:02Z') / 1000}|migration: delta commit`]),
    )
  })
})

describe('syncing conflicts back to the clerk-docs repo (real git repos)', () => {
  let clerkRepo = ''
  let docsRepo = ''

  const run = (repo: string, ...args: string[]) => runCommand('git', args, repo)
  const runAllowFail = (repo: string, ...args: string[]) => runCommand('git', args, repo, { allowFailure: true })

  async function write(repo: string, file: string, content: string): Promise<void> {
    await fs.mkdir(path.dirname(path.join(repo, file)), { recursive: true })
    await fs.writeFile(path.join(repo, file), content, 'utf8')
  }

  async function commitAll(repo: string, message: string, date: string): Promise<string> {
    await run(repo, 'add', '-A')
    await run(repo, 'commit', '-m', message, '--date', date)
    return (await run(repo, 'rev-parse', 'HEAD')).stdout.trim()
  }

  async function initRepo(repo: string): Promise<void> {
    await run(repo, 'init', '-b', 'main')
    await run(repo, 'config', 'user.email', 'docs-author@example.com')
    await run(repo, 'config', 'user.name', 'Docs Author')
    await run(repo, 'config', 'commit.gpgsign', 'false')
  }

  beforeEach(async () => {
    clerkRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'migrate-sync-clerk-'))
    docsRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'migrate-sync-docs-'))
    await initRepo(clerkRepo)
    await initRepo(docsRepo)
  })

  afterEach(async () => {
    await fs.rm(clerkRepo, { recursive: true, force: true })
    await fs.rm(docsRepo, { recursive: true, force: true })
  })

  /**
   * Mirrors the real layout: the clerk workspace holds the *rewritten* docs history (paths under
   * clerk-docs/) as branch `docs`, and its `main` (the clerk base) carries a clerk-side edit that
   * conflicts with the docs delta. The separate docs repo is the user's clerk-docs checkout on
   * branch `feature` with the same logical history at unprefixed paths.
   */
  async function setupConflict() {
    const docsContent = 'line one\nline two (docs edit)\nline three\n'
    const clerkContent = 'line one\nline two (clerk edit)\nline three\n'
    const baseContent = 'line one\nline two\nline three\n'

    await write(clerkRepo, 'clerk-docs/docs/doc.md', baseContent)
    const rootSha = await commitAll(clerkRepo, 'root', '2026-01-01T00:00:01Z')
    await run(clerkRepo, 'checkout', '-b', 'docs')
    await write(clerkRepo, 'clerk-docs/docs/doc.md', docsContent)
    const d1 = await commitAll(clerkRepo, 'docs: edit line two', '2026-01-01T00:00:02Z')
    await run(clerkRepo, 'checkout', 'main')
    await write(clerkRepo, 'clerk-docs/docs/doc.md', clerkContent)
    await commitAll(clerkRepo, 'clerk: own edit to line two', '2026-01-01T00:00:03Z')

    await write(docsRepo, 'docs/doc.md', baseContent)
    await commitAll(docsRepo, 'root', '2026-01-01T00:00:01Z')
    await run(docsRepo, 'checkout', '-b', 'feature')
    await write(docsRepo, 'docs/doc.md', docsContent)
    await commitAll(docsRepo, 'docs: edit line two', '2026-01-01T00:00:02Z')

    // Create the guard-refused conflict state in the clerk workspace.
    const pick = await runAllowFail(clerkRepo, 'cherry-pick', d1)
    expect(pick.code).not.toBe(0)

    return { rootSha, d1, docsContent, clerkContent }
  }

  test('syncConflictsBackToDocsRepo records clerk state as a commit and writes markers into the docs worktree', async () => {
    const { docsContent, clerkContent } = await setupConflict()

    const synced = await syncConflictsBackToDocsRepo(clerkRepo, docsRepo, 'feature', 'ours')

    expect(synced).not.toBeNull()
    expect(synced?.docsPaths).toEqual(['docs/doc.md'])
    // The sync commit anchors clerk's exact content in the docs branch history.
    const syncedContent = (await run(docsRepo, 'show', `${synced?.syncCommitSha}:docs/doc.md`)).stdout
    expect(syncedContent).toBe(clerkContent)
    const subject = (await run(docsRepo, 'log', '-1', '--format=%s')).stdout
    expect(subject).toContain("record clerk's state")
    // The working tree has ordinary conflict markers with both sides present, left uncommitted.
    const worktree = await fs.readFile(path.join(docsRepo, 'docs/doc.md'), 'utf8')
    expect(worktree).toContain('<<<<<<<')
    expect(worktree).toContain('line two (docs edit)')
    expect(worktree).toContain('line two (clerk edit)')
    expect(worktree).toContain('>>>>>>>')
    expect(docsContent).not.toBe(worktree)
    expect((await run(docsRepo, 'status', '--porcelain')).stdout.trim()).not.toBe('')
  })

  test('syncConflictsBackToDocsRepo refuses when the docs repo is dirty or on the wrong branch', async () => {
    await setupConflict()

    await fs.writeFile(path.join(docsRepo, 'unrelated.md'), 'uncommitted\n', 'utf8')
    expect(await syncConflictsBackToDocsRepo(clerkRepo, docsRepo, 'feature', 'ours')).toBeNull()
    await fs.rm(path.join(docsRepo, 'unrelated.md'))

    expect(await syncConflictsBackToDocsRepo(clerkRepo, docsRepo, 'some-other-branch', 'ours')).toBeNull()
  })

  test('ROUND TRIP: resolve in clerk-docs, re-run, and the migration finishes without touching the clerk clone', async () => {
    const { rootSha, d1, clerkContent } = await setupConflict()

    // Run 1: guard-refused conflict is synced back, clerk workspace cleaned up.
    const synced = await syncConflictsBackToDocsRepo(clerkRepo, docsRepo, 'feature', 'ours')
    expect(synced).not.toBeNull()
    await run(clerkRepo, 'cherry-pick', '--abort')

    // The user resolves the markers in their clerk-docs checkout, keeping both edits, and commits.
    const resolvedContent = 'line one\nline two (docs edit, keeping clerk edit)\nline three\n'
    await write(docsRepo, 'docs/doc.md', resolvedContent)
    const r = await commitAll(docsRepo, 'resolve migration conflict with clerk', '2026-01-01T00:00:05Z')
    const s = `${r}^`

    // Run 2: filter-repo deterministically re-rewrites the docs branch, so the sync commit and
    // the resolution commit appear (path-prefixed) on the rewritten branch. Simulate that here.
    await run(clerkRepo, 'checkout', 'docs')
    await write(clerkRepo, 'clerk-docs/docs/doc.md', clerkContent)
    const sPrime = await commitAll(
      clerkRepo,
      (await run(docsRepo, 'log', '-1', '--format=%s', s)).stdout.trim(),
      '2026-01-01T00:00:04Z',
    )
    await write(clerkRepo, 'clerk-docs/docs/doc.md', resolvedContent)
    const rPrime = await commitAll(clerkRepo, 'resolve migration conflict with clerk', '2026-01-01T00:00:05Z')
    await run(clerkRepo, 'checkout', 'main')

    const picked = await cherryPickDeltaCommits(clerkRepo, [d1, sPrime, rPrime], 'docs', rootSha)

    // Everything lands unattended: the guard now passes because the docs branch history contains
    // clerk's state (the sync commit), and the final tree is the user's resolution.
    expect(picked.conflictSha).toBeNull()
    expect((await run(clerkRepo, 'show', 'main:clerk-docs/docs/doc.md')).stdout).toBe(resolvedContent)
    expect((await run(clerkRepo, 'show', 'main:clerk-docs/docs/doc.md')).stdout).toContain('clerk edit')
  })

  test('sync-back leaves the clerk workspace clean enough that nothing conflicted remains', async () => {
    await setupConflict()

    const synced = await syncConflictsBackToDocsRepo(clerkRepo, docsRepo, 'feature', 'ours')
    expect(synced).not.toBeNull()
    await run(clerkRepo, 'cherry-pick', '--abort')

    expect((await run(clerkRepo, 'ls-files', '-u')).stdout.trim()).toBe('')
    expect((await run(clerkRepo, 'status', '--porcelain')).stdout.trim()).toBe('')
  })

  test('formatConflictSyncedToDocsHints names the files, the branch, and the sync commit', () => {
    const hints = formatConflictSyncedToDocsHints({
      files: ['docs/doc.md', 'docs/other.md'],
      branch: 'feature/foo',
      syncCommitSha: 'abcdef0123456789',
    }).join('\n')
    expect(hints).toContain('docs/doc.md, docs/other.md')
    expect(hints).toContain('feature/foo')
    expect(hints).toContain('abcdef0123')
    expect(hints).toContain('re-run')
    expect(hints).toContain('do not need to open the clerk workspace')
  })
})

describe('END TO END: multi-run migration lifecycle (real git repos + bare origin)', () => {
  let docsRepo = ''
  let clerkWork = ''
  let clerkOrigin = ''

  const run = (repo: string, ...args: string[]) => runCommand('git', args, repo)
  const runAllowFail = (repo: string, ...args: string[]) => runCommand('git', args, repo, { allowFailure: true })

  async function write(repo: string, file: string, content: string): Promise<void> {
    await fs.mkdir(path.dirname(path.join(repo, file)), { recursive: true })
    await fs.writeFile(path.join(repo, file), content, 'utf8')
  }

  async function commitAll(repo: string, message: string, date: string): Promise<string> {
    await run(repo, 'add', '-A')
    await run(repo, 'commit', '-m', message, '--date', date)
    return (await run(repo, 'rev-parse', 'HEAD')).stdout.trim()
  }

  async function initRepo(repo: string): Promise<void> {
    await run(repo, 'init', '-b', 'main')
    await run(repo, 'config', 'user.email', 'docs-author@example.com')
    await run(repo, 'config', 'user.name', 'Docs Author')
    await run(repo, 'config', 'commit.gpgsign', 'false')
  }

  beforeEach(async () => {
    docsRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'migrate-e2e-docs-'))
    clerkWork = await fs.mkdtemp(path.join(os.tmpdir(), 'migrate-e2e-clerk-'))
    clerkOrigin = await fs.mkdtemp(path.join(os.tmpdir(), 'migrate-e2e-origin-'))
    await initRepo(docsRepo)
    await initRepo(clerkWork)
    await run(clerkOrigin, 'init', '--bare', '-b', 'main')
  })

  afterEach(async () => {
    await fs.rm(docsRepo, { recursive: true, force: true })
    await fs.rm(clerkWork, { recursive: true, force: true })
    await fs.rm(clerkOrigin, { recursive: true, force: true })
  })

  const QUICKSTART_V0 = [
    '# Quickstart',
    '',
    'intro text',
    '',
    'step one: install the sdk',
    '',
    'filler alpha',
    'filler beta',
    'filler gamma',
    '',
    'step two: configure the app',
    '',
  ].join('\n')
  const quickstart = (stepOne: string, stepTwo: string) =>
    QUICKSTART_V0.replace('step one: install the sdk', stepOne).replace('step two: configure the app', stepTwo)

  test('create → clerk hotfix races the branch → sync-back → resolve in docs → converge → idempotent re-run', async () => {
    const STEP1_V0 = 'step one: install the sdk'
    const STEP1_DOCS = 'step one: install the sdk (docs improvement)'
    const STEP1_DOCS_V2 = 'step one: install the sdk (docs improvement, v2)'
    const STEP1_HOTFIX = 'step one: install the sdk (clerk hotfix)'
    const STEP1_RESOLVED = 'step one: install the sdk (docs improvement v2 + clerk hotfix)'
    const STEP2_V0 = 'step two: configure the app'
    const STEP2_DOCS = 'step two: configure the app (more docs)'

    // ---- The user's clerk-docs checkout: main root, then a feature branch with three commits.
    await write(docsRepo, 'docs/quickstart.mdx', quickstart(STEP1_V0, STEP2_V0))
    await write(docsRepo, 'docs/other.mdx', 'alpha\n')
    await write(docsRepo, 'docs/config.txt', 'npm\n')
    await commitAll(docsRepo, 'root', '2026-01-01T00:00:01Z')
    await run(docsRepo, 'checkout', '-b', 'feature')
    await write(docsRepo, 'docs/quickstart.mdx', quickstart(STEP1_DOCS, STEP2_V0))
    await write(docsRepo, 'docs/other.mdx', 'alpha (docs)\n')
    await write(docsRepo, 'docs/config.txt', 'npm-tweak\n')
    await commitAll(docsRepo, 'docs: improve step one and tweak config', '2026-01-01T00:00:02Z')
    await write(docsRepo, 'docs/quickstart.mdx', quickstart(STEP1_DOCS_V2, STEP2_V0))
    await write(docsRepo, 'docs/config.txt', 'pnpm\n')
    await commitAll(docsRepo, 'docs: step one v2 and pnpm', '2026-01-01T00:00:03Z')

    // ---- The clerk workspace: clerk's own files plus the imported clerk-docs tree. The import
    // carries the docs branch's *final* config state (pnpm) — the classic stale-hunk setup.
    await write(clerkWork, 'src/app.ts', 'console.log("clerk app")\n')
    await write(clerkWork, 'clerk-docs/docs/quickstart.mdx', quickstart(STEP1_V0, STEP2_V0))
    await write(clerkWork, 'clerk-docs/docs/other.mdx', 'alpha\n')
    await write(clerkWork, 'clerk-docs/docs/config.txt', 'pnpm\n')
    await commitAll(clerkWork, 'clerk: root with docs import', '2026-01-01T00:00:01Z')
    await run(clerkWork, 'remote', 'add', 'origin', clerkOrigin)
    await run(clerkWork, 'push', '-u', 'origin', 'main')

    // ---- Simulate the filter-repo rewrite: an unrelated-history `docs` branch inside the clerk
    // workspace holding the docs commits at clerk-docs/-prefixed paths (blobs are identical to
    // the docs repo's since blobs are content-addressed).
    await run(clerkWork, 'checkout', '--orphan', 'docs')
    await run(clerkWork, 'rm', '-rf', '.')
    await write(clerkWork, 'clerk-docs/docs/quickstart.mdx', quickstart(STEP1_V0, STEP2_V0))
    await write(clerkWork, 'clerk-docs/docs/other.mdx', 'alpha\n')
    await write(clerkWork, 'clerk-docs/docs/config.txt', 'npm\n')
    const docsRootSha = await commitAll(clerkWork, 'root', '2026-01-01T00:00:01Z')
    await write(clerkWork, 'clerk-docs/docs/quickstart.mdx', quickstart(STEP1_DOCS, STEP2_V0))
    await write(clerkWork, 'clerk-docs/docs/other.mdx', 'alpha (docs)\n')
    await write(clerkWork, 'clerk-docs/docs/config.txt', 'npm-tweak\n')
    const d1aPrime = await commitAll(clerkWork, 'docs: improve step one and tweak config', '2026-01-01T00:00:02Z')
    await write(clerkWork, 'clerk-docs/docs/quickstart.mdx', quickstart(STEP1_DOCS_V2, STEP2_V0))
    await write(clerkWork, 'clerk-docs/docs/config.txt', 'pnpm\n')
    const d1bPrime = await commitAll(clerkWork, 'docs: step one v2 and pnpm', '2026-01-01T00:00:03Z')

    // ======== RUN 1 (create mode): pick the delta onto the clerk base.
    await run(clerkWork, 'checkout', '-b', 'migration', 'main')
    const deltaShas = (await run(clerkWork, 'rev-list', '--reverse', '--no-merges', `${docsRootSha}..docs`)).stdout
      .trim()
      .split('\n')
    const run1 = await cherryPickDeltaCommits(clerkWork, deltaShas, 'docs', docsRootSha)
    expect(run1.conflictSha).toBeNull()
    // The stale config hunk (npm → npm-tweak vs clerk's pnpm) was auto-resolved to the final
    // pnpm state inside the first pick; both commits still landed.
    expect(run1.applied).toBe(2)
    expect((await run(clerkWork, 'show', 'migration:clerk-docs/docs/config.txt')).stdout).toBe('pnpm\n')
    await run(clerkWork, 'push', '-u', 'origin', 'migration')

    // ======== Between runs: a clerk-side hotfix to the same step-one line merges into clerk
    // main (another PR racing this branch), and the user keeps working docs-side.
    await run(clerkWork, 'checkout', 'main')
    await write(clerkWork, 'clerk-docs/docs/quickstart.mdx', quickstart(STEP1_HOTFIX, STEP2_V0))
    await commitAll(clerkWork, 'clerk: hotfix step one wording', '2026-01-01T00:00:04Z')
    await run(clerkWork, 'push', 'origin', 'main')

    await write(docsRepo, 'docs/quickstart.mdx', quickstart(STEP1_DOCS_V2, STEP2_DOCS))
    await commitAll(docsRepo, 'docs: expand step two', '2026-01-01T00:00:05Z')
    await run(clerkWork, 'checkout', 'docs')
    await write(clerkWork, 'clerk-docs/docs/quickstart.mdx', quickstart(STEP1_DOCS_V2, STEP2_DOCS))
    const d2Prime = await commitAll(clerkWork, 'docs: expand step two', '2026-01-01T00:00:05Z')

    // ======== RUN 2 (update mode): the base merge hits the hotfix conflict; the guard refuses
    // (clerk-own content), so the conflict is synced back into the docs repo and aborted here.
    await run(clerkWork, 'fetch', 'origin')
    await run(clerkWork, 'checkout', '-B', 'migration', 'origin/migration')
    const merge2 = await runAllowFail(clerkWork, 'merge', 'origin/main', '-m', 'Merge clerk base main into migration')
    expect(merge2.code).not.toBe(0)
    expect(await autoResolveConflictsToBranchFinalState(clerkWork, 'docs', docsRootSha, 'merge')).toBeNull()
    const synced = await syncConflictsBackToDocsRepo(clerkWork, docsRepo, 'feature', 'theirs')
    expect(synced).not.toBeNull()
    expect(synced?.docsPaths).toEqual(['docs/quickstart.mdx'])
    await run(clerkWork, 'merge', '--abort')
    expect((await run(clerkWork, 'status', '--porcelain')).stdout.trim()).toBe('')

    // The docs worktree has real markers with both sides; the sync commit holds clerk's content.
    const markers = await fs.readFile(path.join(docsRepo, 'docs/quickstart.mdx'), 'utf8')
    expect(markers).toContain('<<<<<<<')
    expect(markers).toContain(STEP1_DOCS_V2)
    expect(markers).toContain(STEP1_HOTFIX)
    expect((await run(docsRepo, 'show', `HEAD:docs/quickstart.mdx`)).stdout).toContain(STEP1_HOTFIX)
    // The non-conflicting docs-side step-two edit survived into the marker file's clean region.
    expect(markers).toContain(STEP2_DOCS)

    // ---- The user resolves in their own checkout and commits; filter-repo would rewrite the
    // sync + resolution commits onto the rewritten branch on the next run — mirror that by
    // copying the *actual* content of those commits from the docs repo (filter-repo only
    // re-prefixes paths; blobs and subjects are preserved verbatim).
    await write(docsRepo, 'docs/quickstart.mdx', quickstart(STEP1_RESOLVED, STEP2_DOCS))
    await commitAll(docsRepo, 'resolve clerk hotfix conflict', '2026-01-01T00:00:07Z')
    const syncCommitContent = (await run(docsRepo, 'show', `${synced?.syncCommitSha}:docs/quickstart.mdx`)).stdout
    const syncCommitSubject = (
      await run(docsRepo, 'log', '-1', '--format=%s', synced?.syncCommitSha ?? 'HEAD^')
    ).stdout.trim()
    await run(clerkWork, 'checkout', 'docs')
    await write(clerkWork, 'clerk-docs/docs/quickstart.mdx', syncCommitContent)
    const sPrime = await commitAll(clerkWork, syncCommitSubject, '2026-01-01T00:00:06Z')
    await write(clerkWork, 'clerk-docs/docs/quickstart.mdx', quickstart(STEP1_RESOLVED, STEP2_DOCS))
    const rPrime = await commitAll(clerkWork, 'resolve clerk hotfix conflict', '2026-01-01T00:00:07Z')
    // Sanity: the sync commit anchored clerk's exact hotfix blob in the docs branch history.
    expect(syncCommitContent).toBe(quickstart(STEP1_HOTFIX, STEP2_V0))

    // ======== RUN 3 (update mode): everything now converges unattended.
    await run(clerkWork, 'fetch', 'origin')
    await run(clerkWork, 'checkout', '-B', 'migration', 'origin/migration')
    const merge3 = await runAllowFail(clerkWork, 'merge', 'origin/main', '-m', 'Merge clerk base main into migration')
    expect(merge3.code).not.toBe(0)
    // The hotfix blob is now anchored in docs history by the sync commit, so the base merge
    // auto-resolves to the docs final tree (which contains the user's resolution).
    expect(await autoResolveConflictsToBranchFinalState(clerkWork, 'docs', docsRootSha, 'merge')).toBe('applied')

    // Update mode's delta selection: patch-id comparison plus the fingerprint filter.
    const cherry3 = await run(clerkWork, 'cherry', 'migration', 'docs', docsRootSha)
    const unapplied3 = parseGitCherryUnappliedShas(cherry3.stdout)
    const fingerprints3 = await collectAppliedCommitFingerprints(clerkWork, 'migration', 'main')
    const newShas3: string[] = []
    for (const sha of unapplied3) {
      if (!fingerprints3.has(await commitFingerprint(clerkWork, sha))) newShas3.push(sha)
    }
    // Both original docs commits are recognized as applied (auto-resolution broke their
    // patch-ids, the fingerprints catch them); only the post-run-1 commits remain.
    expect(newShas3).not.toContain(d1aPrime)
    expect(newShas3).not.toContain(d1bPrime)
    expect(newShas3).toEqual([d2Prime, sPrime, rPrime])
    const run3 = await cherryPickDeltaCommits(clerkWork, newShas3, 'docs', docsRootSha)
    expect(run3.conflictSha).toBeNull()
    // All three are already represented on the branch (the base-merge resolution carried the
    // docs final tree), so they skip as empty instead of duplicating content.
    expect(run3.applied).toBe(0)
    expect(run3.skippedEmpty).toBe(3)
    await run(clerkWork, 'push', 'origin', 'migration')

    // ---- Final-state invariants.
    expect((await run(clerkWork, 'show', 'migration:clerk-docs/docs/quickstart.mdx')).stdout).toBe(
      quickstart(STEP1_RESOLVED, STEP2_DOCS),
    )
    expect((await run(clerkWork, 'show', 'migration:clerk-docs/docs/other.mdx')).stdout).toBe('alpha (docs)\n')
    expect((await run(clerkWork, 'show', 'migration:clerk-docs/docs/config.txt')).stdout).toBe('pnpm\n')
    expect((await run(clerkWork, 'show', 'migration:src/app.ts')).stdout).toBe('console.log("clerk app")\n')
    // The clerk base (with the hotfix) is an ancestor, so the PR diff contains no base revert.
    expect((await runAllowFail(clerkWork, 'merge-base', '--is-ancestor', 'origin/main', 'migration')).code).toBe(0)
    // Each docs commit landed exactly once — no duplicates across the three runs.
    const subjects = (await run(clerkWork, 'log', '--format=%s', 'migration')).stdout
    expect(subjects.match(/docs: improve step one and tweak config/g)).toHaveLength(1)
    expect(subjects.match(/docs: step one v2 and pnpm/g)).toHaveLength(1)
    expect(subjects.match(/docs: expand step two/g)).toBeNull()

    // ======== RUN 4 (idempotency): nothing changed — the branch must not move at all.
    const tipBefore = (await run(clerkWork, 'rev-parse', 'migration')).stdout.trim()
    await run(clerkWork, 'fetch', 'origin')
    await run(clerkWork, 'checkout', '-B', 'migration', 'origin/migration')
    const merge4 = await runAllowFail(clerkWork, 'merge', 'origin/main', '-m', 'Merge clerk base main into migration')
    expect(merge4.code).toBe(0) // already up to date
    const cherry4 = await run(clerkWork, 'cherry', 'migration', 'docs', docsRootSha)
    const fingerprints4 = await collectAppliedCommitFingerprints(clerkWork, 'migration', 'main')
    const newShas4: string[] = []
    for (const sha of parseGitCherryUnappliedShas(cherry4.stdout)) {
      if (!fingerprints4.has(await commitFingerprint(clerkWork, sha))) newShas4.push(sha)
    }
    const run4 = await cherryPickDeltaCommits(clerkWork, newShas4, 'docs', docsRootSha)
    expect(run4.conflictSha).toBeNull()
    expect(run4.applied).toBe(0)
    expect((await run(clerkWork, 'rev-parse', 'migration')).stdout.trim()).toBe(tipBefore)
  }, 30000)
})
