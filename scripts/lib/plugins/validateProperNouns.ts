// Flags lowercase occurrences of Clerk feature proper nouns (eg "organization
// domains", "membership requests") in visible prose. Enforces the styleguide's
// "Capitalize Clerk feature proper nouns" rule: Clerk product and feature names
// are proper nouns and should be capitalized consistently.
//
// The rule's exceptions (generic usage, bold Dashboard UI labels, component-
// rendered text, code) make a bare word list unenforceable — "billing
// information" and "your organization's directory service" are correct as
// lowercase. So this check only matches collocations that unambiguously refer
// to the Clerk feature, and skips the node types the styleguide exempts. It is
// deliberately biased toward false negatives: an occurrence it cannot classify
// with certainty is left alone rather than flagged.

import { Node, Position } from 'unist'
import type { VFile } from 'vfile'
import yaml from 'yaml'
import { type BuildConfig } from '../config'
import { type Manifest } from '../manifest'
import { safeError, type WarningsSection } from '../error-messages'

type ProperNounRule = {
  // Matches every casing of the collocation, correct ones included, so
  // `correct` gets to decide. Must use the `g` flag (matchAll) — `i` makes the
  // casing variants reachable. Words are separated with `\s+`, not a literal
  // space, so soft-wrapped prose ("organization\ndomains") can't slip through.
  matcher: RegExp
  // The casing(s) the styleguide prescribes, tested against the
  // whitespace-normalized match. Words that are not part of the proper noun
  // (eg "domain" in "Organization domain") accept either case.
  correct: RegExp
  // Canonical (singular) form; the reported expectation re-adds the plural "s"
  // when the match was plural.
  expected: string
}

// Only collocations where the phrase itself proves the Clerk feature is meant.
// Bare "organization"/"billing"/"plan"/"role"/"permission"/"feature"/
// "subscription" are NOT matched — standalone they are usually generic ("your
// organization's directory service", "billing information", "the Hobby plan").
const PROPER_NOUN_RULES: ProperNounRule[] = [
  { matcher: /\bagent\s+tasks?\b/gi, correct: /^Agent Tasks?$/, expected: 'Agent Task' },
  { matcher: /\bmembership\s+requests?\b/gi, correct: /^Membership Requests?$/, expected: 'Membership Request' },
  { matcher: /\brole\s+sets?\b/gi, correct: /^Role Sets?$/, expected: 'Role Set' },
  { matcher: /\borganization\s+ids?\b/gi, correct: /^Organization IDs?$/, expected: 'Organization ID' },
  { matcher: /\bactive\s+organizations?\b/gi, correct: /^[Aa]ctive Organizations?$/, expected: 'active Organization' },
  { matcher: /\borganization\s+domains?\b/gi, correct: /^Organization [Dd]omains?$/, expected: 'Organization domain' },
  {
    matcher: /\borganization\s+invitations?\b/gi,
    correct: /^Organization [Ii]nvitations?$/,
    expected: 'Organization invitation',
  },
  {
    matcher: /\borganization\s+memberships?\b/gi,
    correct: /^Organization [Mm]emberships?$/,
    expected: 'Organization membership',
  },
  {
    matcher: /\borganization\s+profiles?\b/gi,
    correct: /^Organization [Pp]rofiles?$/,
    expected: 'Organization profile',
  },
  {
    matcher: /\borganization\s+switchers?\b/gi,
    correct: /^Organization [Ss]witchers?$/,
    expected: 'Organization switcher',
  },
  { matcher: /\borganization\s+slugs?\b/gi, correct: /^Organization [Ss]lugs?$/, expected: 'Organization slug' },
  { matcher: /\bclerk\s+billing\b/gi, correct: /^Clerk Billing$/, expected: 'Clerk Billing' },
  { matcher: /\bclerk\s+organizations?\b/gi, correct: /^Clerk Organizations?$/, expected: 'Clerk Organization' },
]

export type ProperNounViolation = {
  // The offending phrase with internal whitespace collapsed, so a soft-wrapped
  // match reads naturally in the error message.
  found: string
  expected: string
  index: number
  // Raw length of the match in the source text (soft wraps included), for
  // position reporting.
  length: number
}

export const findProperNounViolations = (text: string): ProperNounViolation[] => {
  const violations: ProperNounViolation[] = []

  for (const rule of PROPER_NOUN_RULES) {
    for (const match of text.matchAll(rule.matcher)) {
      const found = match[0].replace(/\s+/g, ' ')

      if (rule.correct.test(found) === false) {
        // Keep the match's plural form in the expectation — "membership
        // requests" should read as "Membership Requests", not the singular.
        // Case-insensitive, so an all-caps "REQUESTS" still counts as plural.
        const expected = /s$/i.test(found) && !rule.expected.endsWith('s') ? `${rule.expected}s` : rule.expected

        violations.push({ found, expected, index: match.index, length: match[0].length })
      }
    }
  }

  return violations
}

// Frontmatter titles and manifest nav titles are raw strings that support a
// slice of markdown, so the body-prose node-type exemptions have to be applied
// textually here: mask inline code (`...`) and bold Dashboard UI labels
// (**...**) before matching. The mask uses a non-whitespace placeholder so a
// masked span can't splice its neighbors into a phantom collocation.
const maskExemptSpans = (text: string): string =>
  text
    // Backslash-escaped backticks and asterisks render as literal characters,
    // not delimiters — the surrounding text stays visible to readers, so it
    // must stay visible to the matcher. Neutralize each escape pair (including
    // \\, so an escaped backslash can't turn the next character into a fake
    // escape) with same-length placeholder characters before delimiter
    // matching; scanning left to right resolves odd/even backslash runs.
    .replace(/\\([\\`*])/g, '##')
    // Code spans can be delimited by a run of backticks of any length
    // (``role set``), so match the opening run and require the same run to
    // close it. Both runs must be maximal (the lookarounds): mismatched runs
    // like ```x`` don't form a code span and stay visible text.
    .replace(/(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g, (span) => '#'.repeat(span.length))
    .replace(/\*\*[^*]+\*\*/g, (span) => '#'.repeat(span.length))

// Node types whose text the styleguide exempts (or that carry no visible prose):
// - code / inlineCode: code keeps its own casing.
// - strong: bold text mirrors Clerk Dashboard UI labels exactly, even when the
//   Dashboard uses lowercase (eg **Create role set**).
// - yaml: frontmatter is handled separately below — only its `title` and
//   `description` values are visible prose.
// - mdxjsEsm / mdx*Expression: embedded JavaScript, not prose.
const SKIPPED_NODE_TYPES = new Set([
  'code',
  'inlineCode',
  'strong',
  'yaml',
  'mdxjsEsm',
  'mdxFlowExpression',
  'mdxTextExpression',
])

// Refine a text node's position to the exact match inside it, so the reported
// line/column points at the offending words rather than the whole node. Start
// and end are each derived from their own offset, so a match that soft-wraps
// across lines still ends on the right line.
const matchPosition = (node: Node, value: string, index: number, length: number): Position | undefined => {
  if (node.position === undefined) return undefined

  const pointAt = (offset: number) => {
    const before = value.slice(0, offset)
    const linesBefore = before.split('\n')
    const line = (node.position?.start.line ?? 1) + linesBefore.length - 1
    const column =
      linesBefore.length === 1
        ? (node.position?.start.column ?? 1) + before.length
        : (linesBefore[linesBefore.length - 1]?.length ?? 0) + 1

    return { line, column }
  }

  return { start: pointAt(index), end: pointAt(index + length) }
}

export const validateProperNouns =
  (config: BuildConfig, filePath: string, section: WarningsSection, options?: { skip?: boolean }) =>
  () =>
  (tree: Node, vfile: VFile) => {
    // Generated docs (eg the API error pages built from clerk_go's error
    // definitions) quote upstream copy verbatim — hand-edits here are forbidden
    // and would be reverted by the next refresh, so casing fixes belong in the
    // upstream repo and those files are skipped.
    if (options?.skip === true) return

    const visit = (node: Node) => {
      if (SKIPPED_NODE_TYPES.has(node.type)) return

      if (node.type === 'text' && 'value' in node && typeof node.value === 'string') {
        for (const violation of findProperNounViolations(node.value)) {
          safeError(
            config,
            vfile,
            filePath,
            section,
            'feature-proper-noun-not-capitalized',
            [violation.found, violation.expected],
            matchPosition(node, node.value, violation.index, violation.length),
          )
        }
      }

      if ('children' in node && Array.isArray(node.children)) {
        for (const child of node.children as Node[]) {
          visit(child)
        }
      }
    }

    visit(tree)

    // Frontmatter `title` and `description` render as the page's h1 and meta
    // description, so they are visible prose too — the rest of the frontmatter
    // (hrefs, sdk lists, ...) is not.
    const root = tree as Node & { children?: Node[] }
    const frontmatterNode = root.children?.find((child) => child.type === 'yaml')

    if (frontmatterNode !== undefined && 'value' in frontmatterNode && typeof frontmatterNode.value === 'string') {
      let frontmatter: unknown
      try {
        frontmatter = yaml.parse(frontmatterNode.value)
      } catch {
        // Unparseable frontmatter is reported by extractFrontmatter.
        return
      }

      if (frontmatter === null || typeof frontmatter !== 'object') return

      for (const key of ['title', 'description'] as const) {
        const value = (frontmatter as Record<string, unknown>)[key]
        if (typeof value !== 'string') continue

        for (const violation of findProperNounViolations(maskExemptSpans(value))) {
          safeError(
            config,
            vfile,
            filePath,
            section,
            'feature-proper-noun-not-capitalized',
            [violation.found, violation.expected, `the frontmatter ${key}`],
            frontmatterNode.position,
          )
        }
      }
    }
  }

// The manifests' nav titles render in the sidenav, so they follow the same
// rule. They never pass through the remark pipeline, so they get their own
// walk, reporting on the manifest's vfile like the other manifest checks.
export const validateManifestProperNouns = (config: BuildConfig, manifest: Manifest, vfile: VFile) => {
  const check = (items: Manifest) => {
    for (const item of items) {
      for (const violation of findProperNounViolations(maskExemptSpans(item.title))) {
        safeError(config, vfile, String(vfile.path), 'docs', 'feature-proper-noun-not-capitalized', [
          violation.found,
          violation.expected,
          `the manifest title "${item.title}"`,
        ])
      }

      if ('items' in item && Array.isArray(item.items)) {
        check(item.items)
      }
    }
  }

  check(manifest)
}
