import slugify from '@sindresorhus/slugify'

const slugifyMemo = new Map<string, string>()

// Strips one or more trailing numeric suffixes (e.g. "-2", "-2-3") so we can
// group a heading with its already-disambiguated variants under a single key.
const TRAILING_NUMBER_SUFFIX = /(?:-\d+?)+?$/

const memoizedSlugify = (string: string) => {
  let result = slugifyMemo.get(string)
  if (result === undefined) {
    result = slugify(string)
    slugifyMemo.set(string, result)
  }
  return result
}

// Reimplementation of `@sindresorhus/slugify`'s own `slugifyWithCounter`, kept
// in sync with it but split into two layers for performance:
//
//   1. The pure, expensive transform (`slugify` -> transliterate, decamelize,
//      build a fresh RegExp, run several replaces) is wrapped in
//      `memoizedSlugify`, whose cache lives at module scope and is never reset.
//   2. The cheap, stateful disambiguation counter (`occurrences`) lives here,
//      per instance, and is cleared by `reset()` between pages.
//
// The library bundles these together: its `countable` calls `slugify(string,
// options)` on *every* invocation, and its only state is the counter. Because
// it accepts per-call `options`, it can't safely key a transform cache on the
// input string alone, and `reset()` (called once per page) would wipe such a
// cache anyway. The docs build slugifies the same heading text over and over —
// repeated headings, shared partials included across many pages, multiple
// passes over the tree — so memoizing the transform globally turns nearly all
// of that work into O(1) map lookups, while we still get fresh per-page anchor
// numbering from the counter. That separation is what makes this meaningfully
// faster than calling the exported `slugifyWithCounter` directly.
export function slugifyWithCounter() {
  const occurrences = new Map<string, number>()

  const countable = (heading: string) => {
    if (!heading || heading.trim() === '') return ''

    let slugifiedHeading = memoizedSlugify(heading)
    // Bail before recording so empties don't consume counter slots: upstream
    // returns '' here, leaving `occurrences` untouched, so a later empty slug
    // is still the "first" rather than picking up `-2`, `-3`, ...
    if (!slugifiedHeading) return ''

    // How many times the "base" slug (with any trailing -N stripped) has been
    // seen. Lets us treat a family like `foo`, `foo-2`, `foo-3` as one group,
    // which matters when an author writes both `## Foo` and `## Foo 2` (the
    // latter slugifies to `foo-2`) and we need to avoid colliding with the
    // counter-generated `foo-2`.
    const numberless = occurrences.get(slugifiedHeading.replace(TRAILING_NUMBER_SUFFIX, '')) || 0
    // How many times we've already emitted this exact slug (undefined = first).
    const counter = occurrences.get(slugifiedHeading)
    // Record this occurrence: first sighting -> 1, otherwise bump the count.
    occurrences.set(slugifiedHeading, typeof counter === 'number' ? counter + 1 : 1)
    // The updated count for this slug; this is the suffix appended below to
    // disambiguate a repeat (e.g. the 2nd `foo` becomes `foo-2`).
    const newCounter = occurrences.get(slugifiedHeading) || 2
    if (newCounter >= 2 || numberless > 2) {
      slugifiedHeading = `${slugifiedHeading}-${newCounter}`
    }

    return slugifiedHeading
  }

  countable.reset = () => {
    occurrences.clear()
  }

  return countable
}
