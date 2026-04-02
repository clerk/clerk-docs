import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import {
  Logger,
  assertGitFilterRepoVersionOutput,
  assertSemverAtLeast,
  canCommentOnPrInRepo,
  canPushToRepo,
  canReadRepo,
  commandJson,
  formatSourcePrMigrationAppendix,
  isSemverAtLeast,
  lineIgnoresSymlinkedClerkDocsRoot,
  parseConfig,
  parseGhPrViewForMigration,
  parseRepoSlug,
  parseSemverLoose,
  reviewRequestToHandle,
  runCommand,
  sanitizeBranchForPath,
  stripClerkDocsRootGitignoreEntries,
} from './migrate-clerk-docs-to-clerk'

const logger = new Logger(false)

describe('migrate-clerk-docs-to-clerk core helpers', () => {
  test('sanitizeBranchForPath replaces separators', () => {
    expect(sanitizeBranchForPath('feature/docs-migration')).toBe('feature-docs-migration')
    expect(sanitizeBranchForPath('feat\\windows\\path')).toBe('feat-windows-path')
  })

  test('lineIgnoresSymlinkedClerkDocsRoot only matches root ignore rules', () => {
    expect(lineIgnoresSymlinkedClerkDocsRoot('/clerk-docs')).toBe(true)
    expect(lineIgnoresSymlinkedClerkDocsRoot('clerk-docs/')).toBe(true)
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

    const changed = await stripClerkDocsRootGitignoreEntries(logger, tempDir)
    const next = await fs.readFile(path.join(tempDir, '.gitignore'), 'utf8')

    expect(changed).toBe(true)
    expect(next.trimEnd().split('\n')).toEqual(['node_modules', 'docs/clerk-docs'])
  })

  test('stripClerkDocsRootGitignoreEntries returns false when nothing to remove', async () => {
    await fs.writeFile(path.join(tempDir, '.gitignore'), 'node_modules\n', 'utf8')

    const changed = await stripClerkDocsRootGitignoreEntries(logger, tempDir)

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
  })

  test('assertSemverAtLeast throws for old versions', () => {
    expect(() => assertSemverAtLeast(logger, 'git', 'git version 2.38.0', '2.39.0')).toThrow(
      'Minimum supported is 2.39.0',
    )
  })

  test('assertGitFilterRepoVersionOutput accepts semver and hash outputs', () => {
    expect(() => assertGitFilterRepoVersionOutput(logger, 'git-filter-repo', '2.38.0', '2.38.0')).not.toThrow()
    expect(() => assertGitFilterRepoVersionOutput(logger, 'git-filter-repo', '1a2b3c4d5e', '2.38.0')).not.toThrow()
  })
})

describe('PR metadata helpers', () => {
  test('reviewRequestToHandle handles user and team requests', () => {
    expect(reviewRequestToHandle({ __typename: 'User', login: 'alice' })).toBe('alice')
    expect(reviewRequestToHandle({ __typename: 'Team', slug: 'docs-team' })).toBe('docs-team')
    expect(reviewRequestToHandle({ __typename: 'Unknown' })).toBeNull()
  })

  test('parseGhPrViewForMigration and appendix formatting include migration fields', () => {
    const parsed = parseGhPrViewForMigration({
      url: 'https://github.com/clerk/clerk-docs/pull/123',
      isDraft: true,
      assignees: [{ login: 'octocat' }, {}],
      reviewRequests: [
        { __typename: 'User', login: 'reviewer-user' },
        { __typename: 'Team', slug: 'docs-team' },
      ],
      latestReviews: [{ author: { login: 'reviewer-user' }, state: 'APPROVED' }],
      reviewDecision: 'REVIEW_REQUIRED',
    })

    expect(parsed.assigneeLogins).toEqual(['octocat'])
    expect(parsed.reviewerHandles).toEqual(['reviewer-user', 'docs-team'])
    expect(parsed.latestReviewRows).toEqual([{ login: 'reviewer-user', state: 'APPROVED' }])

    const appendix = formatSourcePrMigrationAppendix(parsed)
    expect(appendix).toContain('Source PR: https://github.com/clerk/clerk-docs/pull/123')
    expect(appendix).toContain('**Review decision (source):** REVIEW_REQUIRED')
    expect(appendix).toContain('@reviewer-user')
  })
})

describe('permissions and repo slug helpers', () => {
  test('parseRepoSlug validates owner/repo format', () => {
    expect(parseRepoSlug('clerk/clerk')).toEqual(['clerk', 'clerk'])
    expect(() => parseRepoSlug('clerk')).toThrow('Invalid repo slug')
  })

  test('permission check helpers map access expectations', () => {
    expect(canPushToRepo({ push: true })).toBe(true)
    expect(canReadRepo({ pull: true })).toBe(true)
    expect(canCommentOnPrInRepo({ triage: true })).toBe(true)
    expect(canCommentOnPrInRepo({ pull: true })).toBe(false)
  })
})

describe('command wrappers', () => {
  test('runCommand captures stdout for successful commands', async () => {
    const result = await runCommand(logger, 'node', ['-e', "process.stdout.write('ok')"], process.cwd())
    expect(result.code).toBe(0)
    expect(result.stdout).toBe('ok')
  })

  test('runCommand returns non-zero code when allowFailure is true', async () => {
    const result = await runCommand(logger, 'node', ['-e', 'process.exit(2)'], process.cwd(), { allowFailure: true })
    expect(result.code).toBe(2)
  })

  test('commandJson parses JSON stdout', async () => {
    const json = await commandJson<{ value: number }>(
      logger,
      'node',
      ['-e', "process.stdout.write(JSON.stringify({value: 42}))"],
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
      '--yes',
      '--dry-run',
      '--allow-dirty-docs',
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
    expect(config.autoApprove).toBe(true)
    expect(config.dryRun).toBe(true)
    expect(config.allowDirtyClerkDocs).toBe(true)
    expect(config.debug).toBe(true)
    expect(config.clerkRepo).toBe('acme/clerk')
    expect(config.clerkDocsRepo).toBe('acme/clerk-docs')
    expect(config.prNumber).toBe(9)
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
    expect(config.clerkDocsRepo).toBe('legacy/docs')
    expect(config.allowDirtyClerkDocs).toBe(true)
  })
})
