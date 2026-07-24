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
- **Only clerk/clerk indexes from Vercel.** The clerk/clerk-docs repo is a public read-only mirror of this folder, synced on every clerk/clerk main commit, so its Vercel project builds the same commits — two concurrent indexing runs raced the stale-record cleanup and emptied prod search on 2026-07-07. The mirror's `vercel.json` buildCommand doesn't run `search:update`, and the script's repo guard (`main()`) exits early on any Vercel build not from `clerk/clerk`. Don't re-add the step to the mirror.
- **Stale-record cleanup is time-guarded.** Records are stamped with `indexed_at` at push time; the cleanup only deletes another batch's records when they predate the run by `STALE_RECORD_GRACE_MS` (`isStaleRecord`), so a concurrent run's fresh push is spared. Removed-page leftovers can linger up to that window before a later run cleans them — that's intentional; don't "fix" it by deleting on batch alone.
- **Orphan-branch sweep (`ALGOLIA_ORPHAN_SWEEP`).** The cleanup above is own-branch-scoped, so records under retired branch values would otherwise accumulate forever (DOCS-11871). A second, gated GC pass sweeps records whose `branch` isn't in `INDEX_LIVE_BRANCHES` (hardcoded per-index allowlist — change it only by reviewed PR). Modes: unset/`off` (default — pass never runs), `dry` (logs a per-branch candidate histogram, deletes nothing), `on` (deletes, same explicit-objectID path as the cleanup). Guards: the same `isStaleRecord` grace window; a hard abort above `ALGOLIA_ORPHAN_SWEEP_MAX` (default 50,000 — the env var can only lower it); indexes without an allowlist entry are skipped entirely. The allowlist is the _only_ protection for the legacy `core-1`/`core-2` archive records (they predate `indexed_at`) — never remove a branch from it without confirming its query client is gone. **Preview builds are code-limited to `dry`** (`effectiveSweepMode`): an `on` sweep during any `DEBUG_SEARCH_BRANCH` preview run would delete colleagues' >30-min-old `dev_docs` test branches, so the indexer downgrades `on` to `dry` when `VERCEL_ENV` is `preview`. Run supervised `dev_docs` cleanups locally instead (`ALGOLIA_INDEX_NAME=dev_docs DEBUG_SEARCH_BRANCH=main ALGOLIA_ORPHAN_SWEEP=on pnpm search:update`), where `VERCEL_ENV` is unset. `on` as a standing setting belongs on Production only.
- **Refreshing the archived `core-1`/`core-2` records (rare).** The frozen branches' builds don't run `search:update` — and never usefully could: they build as _preview_ deployments, so their indexer wrote to `dev_docs`, not the `prod_docs` records the archive clients read. If frozen content ever changes and its `prod_docs` records need refreshing, run the branch's own indexer manually and supervised from a checkout of that frozen branch: `ALGOLIA_INDEX_NAME=prod_docs DEBUG_SEARCH_BRANCH=core-1 pnpm search:update` (after that branch's docs build). Its own-branch GC only touches `branch:core-1`, and a single manual run has no concurrent writer to race. The sweep never interferes — `core-1`/`core-2` are allowlisted.
- **Records are branch-scoped; settings are not.** Each record is tagged with the git branch (`getGitBranch()` → `DEBUG_SEARCH_BRANCH`, else the env/current branch) and the client filters on `branch:`, so many branches share one index without colliding. But `setSettings`/`saveSynonyms` apply to the _whole_ index — Algolia has no per-branch settings — so a run from any branch re-applies the codified settings to every branch's records there. Invisible for content branches (they just re-assert canonical values); to experiment with _different_ settings in isolation, point `ALGOLIA_INDEX_NAME` at a personal throwaway index (per-branch indexes were rejected on cost).
- **Settings are codified in the script, not the dashboard.** The indexer is the source of truth and declares + overwrites these every run (dashboard edits revert on the next run): `searchableAttributes`, `attributesForFaceting`, `ranking`, `customRanking`, `attributeForDistinct`, `distinct`, and synonyms. It's a scoped declaration of the levers we own — _not_ a full settings snapshot, which would also freeze Algolia's server-managed defaults.
- **Deduplication:** `attributeForDistinct` is set to `distinct_group` (canonical URL + anchor; written to every record) and `distinct: true` defaults dedup on at the index level, collapsing each page's per-SDK variants to one result; the `sdk` boost picks which variant wins. `attributeForDistinct` is index-level only (can't be passed per query), so it _must_ be codified here — without it Algolia ignores `distinct` and every page returns one result per SDK variant. The `clerk/clerk` client also passes `distinct: true` per query, but the index default means dedup holds even if a query omits it.
- **Faceting:** `branch`, `record_batch`, `sdk` are `filterOnly` (filtered, never facet-counted). `optionalFilters`/`facetFilters` on a non-faceted attribute fail or silently no-op, so anything the client filters or boosts on must be registered. `availableSDKs` is deliberately **not** faceted — it's only _retrieved_ to render per-result SDK icons (`Search.tsx` `SDKsIcon`); retrieval is independent of faceting.
- **`forwardToReplicas`:** settings deliberately don't forward (they bundle `ranking`/`customRanking`, which a standard replica may override for an alternate sort); synonyms do (always identical across replicas). No replicas today; if any are added, declare them in the script rather than blanket-forwarding.
- **Ranking:** `attribute`/`exact` sit above `proximity` (vs Algolia's default) so a title/heading match beats a body-content match — this rides on the `searchableAttributes` order (`hierarchy.lvl0…6`, then `content`, then `keywords`). `filters` is kept **above** `attribute`/`exact` on purpose: it carries the client's active-SDK `optionalFilters` boost, and keeping it primary is what prevents cross-SDK bleed. Don't demote it — tested, moving `filters` below `exact` serves iOS/Android docs to a Next.js user searching `UserButton` (an exact-title match on the wrong SDK outranks the active SDK's page).
- **Universal records carry every current SDK key.** Non-SDK-scoped pages are written with `sdk: [all VALID_SDKS]` (`recordSDK`), not null. Because `filters` ranks above `attribute`/`exact` (previous bullet), a record matching zero of the client's `sdk:` boosts structurally loses to _any_ boosted record that matches the query — exact-title universal pages ("How Clerk works") were buried under body-content matches from SDK-scoped pages (DOCS-11910). Full-list parity makes universal records tie the active SDK's own records on `filters`, so the win falls through to `attribute`/`exact`, where title matches belong. Don't revert them to null, and don't reach for a client-side `availableSDKs:all` boost instead — tested and rejected (a second filter SDK-scoped records can't match buries strong other-SDK matches on broad queries like "vue").
- **Synonyms** are hybrid: acronyms auto-derived from the `docs/_tooltips/*` glossary + a curated phrasing list, both built in the indexer.
- **Test locally:** `ALGOLIA_INDEX_NAME=<your index> DEBUG_SEARCH_BRANCH=main pnpm search:update` into a personal index, then point `clerk/clerk`'s `NEXT_PUBLIC_ALGOLIA_INDEX_NAME`/`NEXT_PUBLIC_ALGOLIA_SEARCH_KEY` at it (a custom index needs a key with access to it). Preview deploys query `dev_docs`.
- **Regression suite — the required gate for relevance changes.** `pnpm search:regression --index <name>` replays every ranking promise shipped PRs have advertised (`scripts/search-regression-queries.ts` — each entry cites its source PR) against a live index, mirroring the client's query shape. Before merging ANY change to relevance settings, synonyms, the SDK boost, or `search.rank`/`search.keywords` frontmatter: index the candidate branch into a personal index, run the suite green, and add golden entries for any new rankings the PR advertises. `--audit` is the corpus-wide safety net (every page queried by its own title, 99% pass-rate gate — ambiguous reference titles like `list()` legitimately fail). The suite asserts the live index's settings match the codified ones before trusting results (settings propagate asynchronously after `setSettings` — stale settings produce convincing-but-wrong rankings); it needs the indexer's `ALGOLIA_APP_ID`/`ALGOLIA_API_KEY` env. Keep golden assertions loose ("URL in top N", never exact orderings) so ordinary content drift doesn't produce false alarms.

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

## Skills

Skill files live in `.agents/skills/<skill-name>/SKILL.md`. Read the relevant one before working in its area.

- `.agents/skills/migrate-branch-to-clerk/SKILL.md` — running `scripts/migrate-clerk-docs-to-clerk.ts` to migrate a branch/PR into the `clerk/clerk` monorepo, re-run semantics, and what to do at each conflict tier.

## References

- Authoring, validation, and new-feature/reference checklists: `contributing/CONTRIBUTING.md`
- Writing style: `styleguides/STYLEGUIDE.md`
