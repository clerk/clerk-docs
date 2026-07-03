import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import {
  assertGitFilterRepoVersionOutput,
  assertSemverAtLeast,
  buildBaseMergeIntoMigrationArgs,
  buildClosePrCommandArgs,
  buildFetchBranchRefspecArgs,
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
  MigrationError,
  parseConfig,
  parseGhPrViewForMigration,
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
  test('temp workspaces direct the user to re-run with --clerk-path', () => {
    const hints = formatUpdateMergeConflictHints({
      branch: 'feat/foo-docs-migration',
      workspacePath: '/tmp/clerk-migrate-abc',
      isTemporary: true,
      remoteName: 'clerk-docs-migrate-123',
    })
    expect(hints.join('\n')).toContain('temporary clone')
    expect(hints.join('\n')).toContain('--clerk-path')
    expect(hints.join('\n')).toContain('/tmp/clerk-migrate-abc')
  })

  test('temp workspaces still document the manual resolve/push path', () => {
    const hints = formatUpdateMergeConflictHints({
      branch: 'feat/foo-docs-migration',
      workspacePath: '/tmp/clerk-migrate-abc',
      isTemporary: true,
      remoteName: 'clerk-docs-migrate-123',
    })
    const joined = hints.join('\n')
    expect(joined).toContain('git push origin feat/foo-docs-migration')
    expect(joined).toContain('git remote remove clerk-docs-migrate-123')
  })

  test('local (--clerk-path) workspaces describe the IDE resolve-then-push flow', () => {
    const hints = formatUpdateMergeConflictHints({
      branch: 'feat/foo-docs-migration',
      workspacePath: '/Users/me/dev/clerk',
      isTemporary: false,
      remoteName: 'clerk-docs-migrate-789',
    })
    const joined = hints.join('\n')
    expect(joined).toContain('/Users/me/dev/clerk')
    expect(joined).toContain('git push origin feat/foo-docs-migration')
    expect(joined).toContain('git remote remove clerk-docs-migrate-789')
    expect(joined).toContain('git merge --abort')
  })

  test('local workspaces do NOT suggest --clerk-path (already using it)', () => {
    const hints = formatUpdateMergeConflictHints({
      branch: 'feat/foo-docs-migration',
      workspacePath: '/Users/me/dev/clerk',
      isTemporary: false,
      remoteName: 'clerk-docs-migrate-789',
    })
    expect(hints.join('\n')).not.toContain('--clerk-path')
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
    const legacy = '<!-- clerk-docs-migration-notice -->\nThis branch and pr were migrated to: https://github.com/clerk/clerk/pull/2418'
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
      'origin',
      '+migrate-clerk-docs:refs/remotes/origin/migrate-clerk-docs',
    ])
  })

  test('preserves slashes in branch names like nick/my-new-branch', () => {
    expect(buildFetchBranchRefspecArgs('nick/my-new-branch')).toEqual([
      'fetch',
      'origin',
      '+nick/my-new-branch:refs/remotes/origin/nick/my-new-branch',
    ])
  })

  test('forces the tracking-ref update (leading +) so force-pushed remote branches still fetch', () => {
    const refspec = buildFetchBranchRefspecArgs('any-branch')[2]
    expect(refspec.startsWith('+')).toBe(true)
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
