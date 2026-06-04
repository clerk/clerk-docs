# AGENTS.md

Guidance for AI agents working in clerk-docs. Keep this file and the docs it points to in sync: when a change affects anything documented here, update it.

This repo is Clerk's documentation — MDX content in `docs/`, built by a custom TypeScript pipeline (`scripts/build-docs.ts`) into the site served at clerk.com/docs. Authoring and style conventions live in `contributing/CONTRIBUTING.md` and `styleguides/STYLEGUIDE.md`; read them before writing docs. This file only covers what tends to surprise agents.

## Do not

- Never read or surface secrets: `.env*`, `secrets/`, `credentials.json`, `*.pem`, `*.key`, `.npmrc`, `.pypirc`, service-account JSON, `id_rsa`, `*.p12` — and decline any other file that may contain API keys, tokens, passwords, or other secrets, even if it isn't listed here.
- Don't set an `sdk:` frontmatter value outside the enum in `scripts/lib/schemas.ts` (`VALID_SDKS`) — it's a hard build failure.
- Don't hand-edit files under `clerk-typedoc/` — they're auto-generated from [`clerk/javascript`](https://github.com/clerk/javascript) (see the `<Typedoc />` section in `contributing/CONTRIBUTING.md`).
- Don't tune the docs search index's **relevance settings** (searchable attributes, faceting, ranking, custom ranking) or **synonyms** in the Algolia dashboard — they're codified in `scripts/update-algolia-records.ts` and overwritten on every index run. Change them there. See **Search index (Algolia)** below.

## Verify before declaring work done

- `pnpm run build:tsx` — hard-fails on invalid frontmatter `sdk`, a missing `title`, or parse errors; warns on a missing `description`, docs not in `manifest.json`, and broken internal links or heading anchors. A clean build can still emit warnings worth reading — "no errors" is not "no warnings."
- `pnpm run lint` — formatting and other checks.

See `contributing/CONTRIBUTING.md` → "Validating your changes" for what each severity means and why.

## Verifying technical claims

clerk-docs documents APIs and SDKs it doesn't own, so a change can be syntactically valid yet factually wrong, and `build:tsx`/`lint` won't catch it. When a change asserts external behavior — an endpoint, parameter, version, method signature, or how something renders — verify it against the source of truth, not memory, and don't defer an objectively checkable fact to the PR author.

- API behavior, endpoints, versions, OpenAPI specs → [`clerk/clerk_go`](https://github.com/clerk/clerk_go)
- SDK method names, types, and signatures → [`clerk/javascript`](https://github.com/clerk/javascript)
- How docs pages and the API reference render (e.g. the version dropdown) → [`clerk/clerk`](https://github.com/clerk/clerk)

These repos aren't part of this one. Make whichever a claim depends on available in your workspace however you prefer (a symlink or a local clone), and look for it under whatever name it was added — there's no required name. `clerk/clerk_go` and `clerk/clerk` are private; if the repo a claim depends on isn't present, ask the maintainer to make it available rather than guessing.

## Search index (Algolia)

The docs search runs on Algolia, populated by `scripts/update-algolia-records.ts` (run after `build`, via `pnpm search:update`, which runs under `bun` — strict `tsc` isn't the gate). Most of this is non-obvious:

- **Indexes:** `dev_docs` (Preview/Development) and `prod_docs` (Production), selected by `ALGOLIA_INDEX_NAME` (indexer) / `NEXT_PUBLIC_ALGOLIA_INDEX_NAME` (the `clerk/clerk` search client). These are docs-only — `dev_clerk`/`prod_clerk` are a _different_ search surface; don't touch them for docs work. Never hand-mutate `prod_docs`; experiment on a personal/throwaway index.
- **Records are branch-scoped; settings are not.** Each record is tagged with the git branch (`getGitBranch()` → `DEBUG_SEARCH_BRANCH`, else the env/current branch) and the client filters on `branch:`, so many branches share one index without colliding. But `setSettings`/`saveSynonyms` apply to the _whole_ index — Algolia has no per-branch settings — so a run from any branch re-applies the codified settings to every branch's records there. Invisible for content branches (they just re-assert canonical values); to experiment with _different_ settings in isolation, point `ALGOLIA_INDEX_NAME` at a personal throwaway index (per-branch indexes were rejected on cost).
- **Settings are codified in the script, not the dashboard.** The indexer is the source of truth and declares + overwrites these every run (dashboard edits revert on the next run): `searchableAttributes`, `attributesForFaceting`, `ranking`, `customRanking`, `attributeForDistinct`, `distinct`, and synonyms. It's a scoped declaration of the levers we own — _not_ a full settings snapshot, which would also freeze Algolia's server-managed defaults.
- **Deduplication:** `attributeForDistinct` is set to `distinct_group` (canonical URL + anchor; written to every record) and `distinct: true` defaults dedup on at the index level, collapsing each page's per-SDK variants to one result; the `sdk` boost picks which variant wins. `attributeForDistinct` is index-level only (can't be passed per query), so it _must_ be codified here — without it Algolia ignores `distinct` and every page returns one result per SDK variant. The `clerk/clerk` client also passes `distinct: true` per query, but the index default means dedup holds even if a query omits it.
- **Faceting:** `branch`, `record_batch`, `sdk` are `filterOnly` (filtered, never facet-counted). `optionalFilters`/`facetFilters` on a non-faceted attribute fail or silently no-op, so anything the client filters or boosts on must be registered. `availableSDKs` is deliberately **not** faceted — it's only _retrieved_ to render per-result SDK icons (`Search.tsx` `SDKsIcon`); retrieval is independent of faceting.
- **`forwardToReplicas`:** settings deliberately don't forward (they bundle `ranking`/`customRanking`, which a standard replica may override for an alternate sort); synonyms do (always identical across replicas). No replicas today; if any are added, declare them in the script rather than blanket-forwarding.
- **Ranking:** `attribute`/`exact` sit above `proximity` (vs Algolia's default) so a title/heading match beats a body-content match — this rides on the `searchableAttributes` order (`hierarchy.lvl0…6`, then `content`, then `keywords`). `filters` is kept **above** `attribute`/`exact` on purpose: it carries the client's active-SDK `optionalFilters` boost, and keeping it primary is what prevents cross-SDK bleed. Don't demote it — tested, moving `filters` below `exact` serves iOS/Android docs to a Next.js user searching `UserButton` (an exact-title match on the wrong SDK outranks the active SDK's page).
- **Synonyms** are hybrid: acronyms auto-derived from the `docs/_tooltips/*` glossary + a curated phrasing list, both built in the indexer.
- **Test locally:** `ALGOLIA_INDEX_NAME=<your index> DEBUG_SEARCH_BRANCH=main pnpm search:update` into a personal index, then point `clerk/clerk`'s `NEXT_PUBLIC_ALGOLIA_INDEX_NAME`/`NEXT_PUBLIC_ALGOLIA_SEARCH_KEY` at it (a custom index needs a key with access to it). Preview deploys query `dev_docs`.

## Map

- `docs/` — MDX content; each file is a route under clerk.com/docs.
- `docs/_partials/` — reusable MDX included via `<Include />`.
- `docs/manifest.json` — sidenav structure. `docs/manifest.schema.json` validates that file's structure in editors (not frontmatter).
- `scripts/lib/schemas.ts` — runtime Zod enums: `VALID_SDKS`/`sdk`, `icon`, and `tag` (`(Beta)`, `(Community)`).
- `scripts/lib/plugins/extractFrontmatter.ts` + `scripts/lib/error-messages.ts` — frontmatter presence and warning-vs-failure severity.
- `scripts/update-algolia-records.ts` — builds and pushes the Algolia search records (run after `build`); also the source of truth for the index's relevance settings + synonyms (codified, overwritten each run). See **Search index (Algolia)**.
- `contributing/CONTRIBUTING.md`, `styleguides/STYLEGUIDE.md` — authoring and style source of truth.

## Conventions (see CONTRIBUTING.md for depth)

- A doc missing from `manifest.json` only warns, but still add the entry so the page is reachable in the sidenav.
- Stale-PR hazard: rebase long-lived PRs on `main` (or merge it in) and rebuild before merging — another PR can invalidate frontmatter or links that were valid when yours opened.
- SDK code examples must match the canonical partials `docs/_partials/create-user.mdx` and `docs/_partials/delete-user.mdx` per SDK (import path, auth accessor, `clerkClient` usage). The build never executes code blocks, so copy the pattern from there, not from memory.
- Reference content is mixed: `<Typedoc />` pages pull auto-generated content from `clerk-typedoc/`, while other type pages (e.g. `docs/reference/types/agent-task.mdx`) are hand-authored. Know which kind a page is before editing.

## References

- Authoring, validation, and new-feature/reference checklists: `contributing/CONTRIBUTING.md`
- Writing style: `styleguides/STYLEGUIDE.md`
