import { describe, expect, test } from 'vitest'
import {
  buildSynonyms,
  cleanSynonym,
  CURATED_SYNONYMS,
  extractTooltipSynonym,
  isAcronym,
  ONE_WAY_SYNONYMS,
  type TooltipFile,
} from './update-algolia-records'

describe('isAcronym', () => {
  test('accepts capitalized 3-8 char tokens', () => {
    expect(isAcronym('SSO')).toBe(true)
    expect(isAcronym('DKIM')).toBe(true)
    expect(isAcronym('WYSIWYG')).toBe(true)
    expect(isAcronym('OAuth2')).toBe(true)
  })

  test('trims surrounding whitespace before testing', () => {
    expect(isAcronym('  OTP  ')).toBe(true)
  })

  test('rejects lowercase, too-short, too-long, and multi-word tokens', () => {
    expect(isAcronym('sso')).toBe(false) // lowercase start
    expect(isAcronym('AB')).toBe(false) // only 2 chars
    expect(isAcronym('SUPERLONGACRONYM')).toBe(false) // > 8 chars
    expect(isAcronym('Single Sign-On')).toBe(false) // spaces / punctuation
  })
})

describe('cleanSynonym', () => {
  test('strips markdown links down to their text', () => {
    expect(cleanSynonym('Learn more about [DKIM](/glossary/dkim)')).toBe('Learn more about DKIM')
  })

  test('replaces ampersands with "and" and drops commas', () => {
    expect(cleanSynonym('read & write, please')).toBe('read and write please')
  })

  test('collapses whitespace and trims', () => {
    expect(cleanSynonym('  too    many\nspaces  ')).toBe('too many spaces')
  })
})

describe('extractTooltipSynonym', () => {
  test('Format A: **Acronym (Expansion)** where the acronym is on the left', () => {
    expect(
      extractTooltipSynonym(
        '**DKIM (DomainKeys Identified Mail)** is an email authentication method. Learn more about [DKIM](/glossary/dkim).',
      ),
    ).toEqual({ acronym: 'DKIM', expansion: 'DomainKeys Identified Mail' })
  })

  test('Format A: **Expansion (Acronym)** where the acronym is on the right', () => {
    expect(extractTooltipSynonym('A **one-time password (OTP)** is a code that authenticates a user.')).toEqual({
      acronym: 'OTP',
      expansion: 'one-time password',
    })
  })

  test("Format B: **Acronym** stands for 'Expansion'", () => {
    expect(extractTooltipSynonym("**WYSIWYG** stands for 'What You See Is What You Get'. Editors use it.")).toEqual({
      acronym: 'WYSIWYG',
      expansion: 'What You See Is What You Get',
    })
  })

  test('returns null when neither side of the paren is an acronym', () => {
    expect(extractTooltipSynonym('A **personal account (your own space)** belongs to one user.')).toBeNull()
  })

  test('returns null when there is no bold acronym at all', () => {
    expect(extractTooltipSynonym('This tooltip just describes a concept with no acronym.')).toBeNull()
  })

  test('returns the first acronym pair when several are present', () => {
    expect(extractTooltipSynonym('**SSO (Single Sign-On)** relates to **MFA (Multi-Factor Authentication)**.')).toEqual(
      { acronym: 'SSO', expansion: 'Single Sign-On' },
    )
  })
})

describe('buildSynonyms', () => {
  const tooltipFiles: TooltipFile[] = [
    {
      fileName: 'dkim.mdx',
      content: '**DKIM (DomainKeys Identified Mail)** is an email authentication method.',
    },
    { fileName: 'otp.mdx', content: 'A **one-time password (OTP)** is a code.' },
    { fileName: 'WYSIWYG.mdx', content: "**WYSIWYG** stands for 'What You See Is What You Get'." },
  ]

  test('derives a synonym record per tooltip, keyed by lowercased acronym', () => {
    const synonyms = buildSynonyms(tooltipFiles)
    expect(synonyms).toContainEqual({
      objectID: 'tooltip-dkim',
      type: 'synonym',
      synonyms: ['DKIM', 'DomainKeys Identified Mail'],
    })
    expect(synonyms).toContainEqual({
      objectID: 'tooltip-otp',
      type: 'synonym',
      synonyms: ['OTP', 'one-time password'],
    })
    expect(synonyms).toContainEqual({
      objectID: 'tooltip-wysiwyg',
      type: 'synonym',
      synonyms: ['WYSIWYG', 'What You See Is What You Get'],
    })
  })

  test('skips files without an .mdx extension', () => {
    const synonyms = buildSynonyms([{ fileName: 'dkim.txt', content: '**DKIM (DomainKeys Identified Mail)**' }])
    expect(synonyms.find((s) => s.objectID === 'tooltip-dkim')).toBeUndefined()
  })

  test('skips tooltips that contain no acronym pair', () => {
    const synonyms = buildSynonyms([{ fileName: 'slug.mdx', content: 'A slug is a URL-friendly identifier.' }])
    expect(synonyms.find((s) => s.objectID?.startsWith('tooltip-'))).toBeUndefined()
  })

  test('always includes the curated synonyms', () => {
    const synonyms = buildSynonyms([])
    for (const [objectID, expected] of Object.entries(CURATED_SYNONYMS)) {
      expect(synonyms).toContainEqual({ objectID, type: 'synonym', synonyms: expected })
    }
  })

  test('always includes the one-way synonyms', () => {
    const synonyms = buildSynonyms([])
    for (const oneWay of ONE_WAY_SYNONYMS) {
      expect(synonyms).toContainEqual(oneWay)
    }
  })

  test('tooltip IDs are namespaced, so they coexist with curated entries that share an acronym', () => {
    // A tooltip for "SSO" becomes `tooltip-sso`, which does not collide with the curated `sso` key.
    const synonyms = buildSynonyms([{ fileName: 'sso.mdx', content: '**SSO (Server-Side Only)** is made up.' }])
    expect(synonyms).toContainEqual({ objectID: 'tooltip-sso', type: 'synonym', synonyms: ['SSO', 'Server-Side Only'] })
    expect(synonyms).toContainEqual({ objectID: 'sso', type: 'synonym', synonyms: CURATED_SYNONYMS.sso })
  })

  test('the last tooltip wins when two files resolve to the same acronym', () => {
    const synonyms = buildSynonyms([
      { fileName: 'a.mdx', content: '**OTP (one time password)**' },
      { fileName: 'b.mdx', content: '**OTP (one-time passcode)**' },
    ])
    const otp = synonyms.filter((s) => s.objectID === 'tooltip-otp')
    expect(otp).toHaveLength(1)
    expect(otp[0]).toEqual({ objectID: 'tooltip-otp', type: 'synonym', synonyms: ['OTP', 'one-time passcode'] })
  })

  test('emits unique objectIDs', () => {
    const ids = buildSynonyms(tooltipFiles).map((s) => s.objectID)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
