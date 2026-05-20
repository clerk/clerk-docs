# AGENTS.md

Guidance for AI agents working in clerk-docs. Keep this file and the docs it points to in sync: when a change affects anything documented here, update it.

This repo is Clerk's documentation — MDX content in `docs/`, built by a custom TypeScript pipeline (`scripts/build-docs.ts`) into the site served at clerk.com/docs. Authoring and style conventions live in `contributing/CONTRIBUTING.md` and `styleguides/STYLEGUIDE.md`; read them before writing docs. This file only covers what tends to surprise agents.

## Do not

- Never read or surface secrets: `.env*`, `secrets/`, `credentials.json`, `*.pem`, `*.key`, `.npmrc`, `.pypirc`, service-account JSON, `id_rsa`, `*.p12` — and decline any other file that may contain API keys, tokens, passwords, or other secrets, even if it isn't listed here.
- Don't set an `sdk:` frontmatter value outside the enum in `scripts/lib/schemas.ts` (`VALID_SDKS`) — it's a hard build failure.
- Don't hand-edit files under `clerk-typedoc/` — they're auto-generated from `clerk/javascript` (see the `<Typedoc />` section in `contributing/CONTRIBUTING.md`).

## Verify before declaring work done

- `pnpm run build:tsx` — hard-fails on invalid frontmatter `sdk`, a missing `title`, or parse errors; warns on a missing `description`, docs not in `manifest.json`, and broken internal links or heading anchors. A clean build can still emit warnings worth reading — "no errors" is not "no warnings."
- `pnpm run lint` — formatting and other checks.

See `contributing/CONTRIBUTING.md` → "Validating your changes" for what each severity means and why.

## Map

- `docs/` — MDX content; each file is a route under clerk.com/docs.
- `docs/_partials/` — reusable MDX included via `<Include />`.
- `docs/manifest.json` — sidenav structure. `docs/manifest.schema.json` validates that file's structure in editors (not frontmatter).
- `scripts/lib/schemas.ts` — runtime Zod enums: `VALID_SDKS`/`sdk`, `icon`, and `tag` (`(Beta)`, `(Community)`).
- `scripts/lib/plugins/extractFrontmatter.ts` + `scripts/lib/error-messages.ts` — frontmatter presence and warning-vs-failure severity.
- `contributing/CONTRIBUTING.md`, `styleguides/STYLEGUIDE.md` — authoring and style source of truth.

## Conventions (see CONTRIBUTING.md for depth)

- A doc missing from `manifest.json` only warns, but still add the entry so the page is reachable in the sidenav.
- Stale-PR hazard: rebase long-lived PRs on `main` (or merge it in) and rebuild before merging — another PR can invalidate frontmatter or links that were valid when yours opened.
- SDK code examples must match the canonical partials `docs/_partials/create-user.mdx` and `docs/_partials/delete-user.mdx` per SDK (import path, auth accessor, `clerkClient` usage). The build never executes code blocks, so copy the pattern from there, not from memory.
- Reference content is mixed: `<Typedoc />` pages pull auto-generated content from `clerk-typedoc/`, while other type pages (e.g. `docs/reference/types/agent-task.mdx`) are hand-authored. Know which kind a page is before editing.

## References

- Authoring, validation, and new-feature/reference checklists: `contributing/CONTRIBUTING.md`
- Writing style: `styleguides/STYLEGUIDE.md`
