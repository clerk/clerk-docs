import { describe, expect, it } from 'vitest'
import { checkPromptInvariants, validatePromptInvariants, type Prompt } from './prompts'

const routableDocsHrefs = ['/docs/nextjs/getting-started/quickstart']
const shellCommandSeparators = ['&&', '||', ';', '&', '|']

function prompt(content: string, name = 'example.md'): Prompt {
  return { filePath: `prompts/${name}`, name, content }
}

function codeFence(content: string, info = 'bash') {
  return ['```' + info, content, '```'].join('\n')
}

describe('validatePromptInvariants', () => {
  it('accepts current package-runner, setup, and quickstart forms', () => {
    expect(() =>
      validatePromptInvariants(
        [
          prompt(
            'Supported frameworks default to accountless setup.\n```bash\nnpx clerk@latest init\n```\nThen `npx clerk@latest auth login`.\nhttps://clerk.com/docs/nextjs/getting-started/quickstart.md',
            'cli-setup.md',
          ),
        ],
        routableDocsHrefs,
      ),
    ).not.toThrow()
  })

  it('leaves accountless wording to the prompt style guide', () => {
    expect(() =>
      validatePromptInvariants(
        [
          prompt(
            '# Accountless setup always provisions an app\nAccountless setup always provisions an app.',
            'react.md',
          ),
        ],
        [],
      ),
    ).not.toThrow()
  })

  it.each(['npm install -g clerk', 'npm install clerk -g', 'pnpm add --global clerk', 'pnpm add clerk --global'])(
    'rejects global CLI installation: %s',
    (command) => {
      expect(() => validatePromptInvariants([prompt(`\`${command}\``)], [])).toThrow('globally')
    },
  )

  it('rejects global CLI installation in prose', () => {
    expect(() => validatePromptInvariants([prompt('Install it with npm install -g clerk if needed.')], [])).toThrow(
      'globally',
    )
  })

  it('rejects bare and unversioned CLI commands', () => {
    expect(() => validatePromptInvariants([prompt(codeFence('clerk init'))], [])).toThrow('package runner')
    expect(() => validatePromptInvariants([prompt(codeFence('clerk init', ''))], [])).toThrow('package runner')
    expect(() => validatePromptInvariants([prompt(codeFence('$ clerk init'))], [])).toThrow('package runner')
    expect(() => validatePromptInvariants([prompt(codeFence('clerk@latest init'))], [])).toThrow('package runner')
    expect(() => validatePromptInvariants([prompt('Run `npx clerk init`.')], [])).toThrow('clerk@latest')
  })

  it.each(['```console\nclerk auth login\n```', "```bash {{ filename: 'terminal' }}\nclerk init\n```"])(
    'rejects bare commands in any fenced code block: %s',
    (content) => {
      expect(() => validatePromptInvariants([prompt(content)], [])).toThrow('package runner')
    },
  )

  it.each(shellCommandSeparators)('rejects bare commands chained with %s after a valid command', (separator) => {
    expect(() =>
      validatePromptInvariants([prompt(codeFence(`npx clerk@latest init ${separator} clerk doctor`))], []),
    ).toThrow('package runner')
  })

  it('reports the correct line for repeated invalid commands', () => {
    expect(() => validatePromptInvariants([prompt(codeFence('clerk init\n\nclerk init'))], [])).toThrow(
      'prompts/example.md:4',
    )
  })

  it('returns formatted fatal messages for the docs build reporter', () => {
    const [vfile] = checkPromptInvariants([prompt(codeFence('clerk@latest init'))], [])

    expect(vfile.path).toBe('prompts/example.md')
    expect(vfile.messages[0]).toMatchObject({
      fatal: true,
      line: 2,
      column: 1,
      message: 'use a package runner with clerk@latest instead of `clerk@latest init`',
    })
  })

  it('accepts optional sign-in before init for an existing application', () => {
    expect(() =>
      validatePromptInvariants(
        [
          prompt(
            '## Step 1: Sign in (optional)\n```bash\nnpx clerk@latest auth login\n```\n## Step 2: Initialize\n```bash\nnpx clerk@latest init --app app_123\n```',
            'cli-setup.md',
          ),
        ],
        [],
      ),
    ).not.toThrow()
  })

  it('accepts optional sign-in under a subheading of an optional step', () => {
    expect(() =>
      validatePromptInvariants(
        [
          prompt(
            '## Step 1: Sign in (optional)\n### Run the login\n```bash\nnpx clerk@latest auth login\n```\n## Step 2: Initialize\n```bash\nnpx clerk@latest init\n```',
            'cli-setup.md',
          ),
        ],
        [],
      ),
    ).not.toThrow()
  })

  it('ignores optional headings inside blockquotes', () => {
    expect(() =>
      validatePromptInvariants(
        [
          prompt(
            '## Step 1: Sign in\n> ## Example (optional)\n\n```bash\nnpx clerk@latest auth login\n```\n## Step 2: Initialize\n```bash\nnpx clerk@latest init\n```',
            'cli-setup.md',
          ),
        ],
        [],
      ),
    ).toThrow('do not require Clerk authentication before initialization')
  })

  it('does not let body prose make pre-init login optional', () => {
    expect(() =>
      validatePromptInvariants(
        [
          prompt(
            '## Step 1: Sign in\nOnly sign in if the user wants an existing application. This is optional.\n```bash\nnpx clerk@latest auth login\n```\n## Step 2: Initialize\n```bash\nnpx clerk@latest init\n```',
            'cli-setup.md',
          ),
        ],
        [],
      ),
    ).toThrow('do not require Clerk authentication before initialization')
  })

  it('rejects mandatory sign-in under a heading before the first Step', () => {
    expect(() =>
      validatePromptInvariants(
        [
          prompt(
            '# Set up Clerk\n## Authenticate\n```bash\nnpx clerk@latest auth login\n```\n## Step 1: Initialize\n```bash\nnpx clerk@latest init\n```',
            'cli-setup.md',
          ),
        ],
        [],
      ),
    ).toThrow('do not require Clerk authentication before initialization')
  })

  it.each(shellCommandSeparators)('rejects mandatory sign-in chained with %s before initialization', (separator) => {
    expect(() =>
      validatePromptInvariants(
        [
          prompt(
            `## Authenticate\n${codeFence(`npx clerk@latest auth login ${separator} npx clerk@latest init`)}`,
            'cli-setup.md',
          ),
        ],
        [],
      ),
    ).toThrow('do not require Clerk authentication before initialization')
  })

  it('requires setup prompts to include an initialization fence', () => {
    expect(() =>
      validatePromptInvariants([prompt('Run `npx clerk@latest init` to set up Clerk.', 'cli-setup.md')], []),
    ).toThrow('include Clerk initialization')
  })

  it.each(['initialize', 'init-extra'])('does not treat %s as the init command', (subcommand) => {
    expect(() =>
      validatePromptInvariants([prompt(codeFence(`npx clerk@latest ${subcommand}`), 'cli-setup.md')], []),
    ).toThrow('include Clerk initialization')
  })

  it.each(['logins', 'login-extra'])('does not treat auth %s as the login command', (subcommand) => {
    expect(() =>
      validatePromptInvariants(
        [
          prompt(
            [
              codeFence(`npx clerk@latest auth ${subcommand}`),
              '## Step 1: Initialize',
              codeFence('npx clerk@latest init'),
            ].join('\n'),
            'cli-setup.md',
          ),
        ],
        [],
      ),
    ).not.toThrow()
  })

  it('rejects non-md and unroutable framework quickstart links', () => {
    expect(() =>
      validatePromptInvariants([prompt('https://clerk.com/docs/nextjs/getting-started/quickstart')], routableDocsHrefs),
    ).toThrow('end in .md')
    expect(() =>
      validatePromptInvariants(
        [prompt('https://clerk.com/docs/react/getting-started/quickstart.md')],
        routableDocsHrefs,
      ),
    ).toThrow('does not resolve')
  })

  it.each(['#install-clerk', '?manual=1'])('accepts a quickstart .md URL with %s', (suffix) => {
    expect(() =>
      validatePromptInvariants(
        [prompt(`https://clerk.com/docs/nextjs/getting-started/quickstart.md${suffix}`)],
        routableDocsHrefs,
      ),
    ).not.toThrow()
  })

  it('accepts an inline-code quickstart URL without capturing the closing backtick', () => {
    expect(() =>
      validatePromptInvariants(
        [prompt('Use `https://clerk.com/docs/nextjs/getting-started/quickstart.md`.')],
        routableDocsHrefs,
      ),
    ).not.toThrow()
  })

  it('validates quickstart URLs inside fenced code blocks', () => {
    expect(() =>
      validatePromptInvariants(
        [prompt('```text\nhttps://clerk.com/docs/react/getting-started/quickstart.md\n```')],
        routableDocsHrefs,
      ),
    ).toThrow('does not resolve')
  })

  it.each(['.mdx', '.md-old'])('rejects a quickstart URL ending in %s', (suffix) => {
    expect(() =>
      validatePromptInvariants(
        [prompt(`https://clerk.com/docs/nextjs/getting-started/quickstart${suffix}`)],
        routableDocsHrefs,
      ),
    ).toThrow('end in .md')
  })
})
