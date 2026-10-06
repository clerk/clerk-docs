import { describe, expect, test } from 'vitest'
import { findPromptUsages } from './check-prompt-deeplink-length'

describe('findPromptUsages', () => {
  test('reads banner and card usages', () => {
    const usages = findPromptUsages(
      [
        '<Prompt variant="banner" src="prompts/a.md" title="A" output="link" />',
        '',
        '<Prompt variant="card" src="prompts/b.md" title="B" output="replace" />',
      ].join('\n'),
    )

    expect(usages).toEqual([
      { line: 1, src: 'prompts/a.md', variant: 'banner', deeplink: undefined },
      { line: 3, src: 'prompts/b.md', variant: 'card', deeplink: undefined },
    ])
  })

  test('reads props spread across lines', () => {
    const usages = findPromptUsages(
      [
        '# Title',
        '',
        '<Prompt',
        '  variant="card"',
        '  src="prompts/a.md"',
        '  title="A"',
        '  output="replace"',
        '/>',
      ].join('\n'),
    )

    expect(usages).toEqual([{ line: 3, src: 'prompts/a.md', variant: 'card', deeplink: undefined }])
  })

  test('treats a missing or unknown variant as a banner, like Prompt.tsx', () => {
    const usages = findPromptUsages(
      [
        '<Prompt src="prompts/a.md" title="A" output="link" />',
        '',
        '<Prompt variant="other" src="prompts/b.md" />',
      ].join('\n'),
    )

    expect(usages.map((usage) => usage.variant)).toEqual(['banner', 'banner'])
  })

  test('reads deeplink={false} and flags any other deeplink value', () => {
    const usages = findPromptUsages(
      [
        '<Prompt variant="banner" src="prompts/a.md" deeplink={false} />',
        '',
        '<Prompt variant="banner" src="prompts/b.md" deeplink="false" />',
        '',
        '<Prompt variant="banner" src="prompts/c.md" deeplink={true} />',
        '',
        '<Prompt variant="banner" src="prompts/d.md" deeplink />',
      ].join('\n'),
    )

    expect(usages.map((usage) => usage.deeplink)).toEqual([false, 'invalid', 'invalid', 'invalid'])
  })

  test('finds a Prompt nested in other components', () => {
    const usages = findPromptUsages(
      ['<If sdk="nextjs">', '  <Prompt variant="banner" src="prompts/a.md" />', '</If>'].join('\n'),
    )

    expect(usages).toEqual([{ line: 2, src: 'prompts/a.md', variant: 'banner', deeplink: undefined }])
  })

  test('skips code examples and comments', () => {
    const usages = findPromptUsages(
      [
        '```mdx',
        '<Prompt variant="banner" src="prompts/fenced.md" />',
        '```',
        '',
        'Use `<Prompt variant="banner" src="prompts/inline.md" />` to add one.',
        '',
        '{/* <Prompt variant="banner" src="prompts/commented.md" /> */}',
      ].join('\n'),
    )

    expect(usages).toEqual([])
  })

  test('leaves src undefined when it is not a string', () => {
    const usages = findPromptUsages('<Prompt variant="banner" src={promptPath} />')

    expect(usages).toEqual([{ line: 1, src: undefined, variant: 'banner', deeplink: undefined }])
  })
})
