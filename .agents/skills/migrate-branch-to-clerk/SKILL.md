---
name: migrate-branch-to-clerk
description: Run and troubleshoot scripts/migrate-clerk-docs-to-clerk.ts, which migrates a clerk-docs feature branch (and its PR) into the clerk/clerk monorepo under clerk-docs/. Use when the user asks to migrate a branch or PR to clerk, re-run a migration, or hit a migration conflict, merge conflict, or "conflict-synced-to-docs" error from the script.
---

# Migrating a clerk-docs branch into clerk/clerk

`scripts/migrate-clerk-docs-to-clerk.ts` moves the current clerk-docs feature branch into the `clerk/clerk` monorepo: it rewrites the branch's history under `clerk-docs/` (git-filter-repo), cherry-picks only the branch's own commits onto the clerk base, pushes a migration branch, opens a clerk PR mirroring the source PR (title, body, draft state, assignees, reviewers), backlinks and closes the source clerk-docs PR.

## Invocation

Run from the clerk-docs repo root, **on the feature branch to migrate** (never `main` unless doing a deliberate full-history import with `--allow-docs-main`):

```sh
pnpm migrate:clerk [options]   # = tsx scripts/migrate-clerk-docs-to-clerk.ts
```

Preconditions the script enforces (don't pre-check manually; it fails fast with hints):

- `git`, `gh` (authenticated), and `git-filter-repo` installed at minimum versions
- push access to `clerk/clerk`, read + comment access to `clerk/clerk-docs`
- clean clerk-docs working tree, branch in sync with origin, not shallow

Common forms:

```sh
# Standard migration (clones clerk to a temp dir — slow but zero-setup)
pnpm migrate:clerk

# Use an existing local clerk checkout (faster; preferred when a conflict is likely)
pnpm migrate:clerk --clerk-path ../clerk

# Preview without any git/GitHub writes (read-only gh calls still run)
pnpm migrate:clerk --dry-run

# Several open PRs for the branch → must disambiguate
pnpm migrate:clerk --pr 1234

# Build the branch locally in the clerk workspace but skip push/PR (requires --clerk-path)
pnpm migrate:clerk --clerk-path ../clerk --local-only
```

Other flags: `--target-branch` (clerk-side branch name; default `<docs-branch>-docs-migration`), `--clerk-base` (default `main`), `--no-merge-main` (skip the pre-migration merge of docs origin/main), `--no-close-source-pr`, `--allow-dirty-docs`, `--debug`. Run `--help` for the full list.

## Create vs update — re-running is safe and expected

The script is idempotent per branch. On each run it looks for the migration branch in clerk:

- **Not found → create mode**: branch from the clerk base, cherry-pick the delta (commits past the branch's merge-base with docs `main`), push, open PR.
- **Found → update mode**: merge the latest clerk base into the migration branch, then cherry-pick only genuinely new docs commits (patch-id via `git cherry`, plus a fingerprint filter — author email + timestamp + subject — that recognizes commits whose patch changed due to a prior conflict resolution, so nothing is ever re-picked into the same conflict).
- **Found but clerk PR is CLOSED/MERGED → aborts** with instructions. Don't force it; the docs branch's job is done or needs a new `--target-branch`.

So the normal workflow for "the docs PR got new commits" is simply: re-run the script.

## Conflict handling — what to do at each tier

Conflicts escalate through three tiers automatically. Match the script's output to the tier:

**Tier 1 — auto-resolved (no action).** Log lines like `Auto-resolved a conflicted delta commit to the docs branch final state`. Safe by construction: it only fires when the clerk side of every conflicted file is a state the docs branch history already contains, so the PR's net diff cannot change.

**Tier 2 — `conflict-synced-to-docs` error (resolve here, in clerk-docs).** Clerk had its own edits to a conflicted file. The script has already:

1. committed clerk's version of the file(s) onto the current docs branch (a `chore(migration): record clerk's state...` commit), and
2. written ordinary `<<<<<<<` conflict markers into the docs working tree, then cleaned up the clerk side.

Do this:

1. Resolve the markers in the listed files in this clerk-docs checkout. A listed file _without_ markers either merged cleanly (review it) or one side deleted it (keep or delete to decide). Conflicted paths that both clerk and the docs branch tip already deleted (e.g. an old commit touching a long-gone `package-lock.json`) are skipped and never listed — there is nothing to resolve, and the re-run auto-resolves them on its own.
2. **Keep the `record clerk's state` commit** — never drop, squash away, or amend it. It anchors clerk's version in docs history; the re-run's auto-resolution depends on it.
3. Commit the resolution on the same branch, push, and re-run the script. It converges unattended.
4. Do **not** open the clerk clone or temp workspace; its side was aborted and is rebuilt from scratch on the re-run.

**Tier 3 — `create-merge-conflict` / `update-merge-conflict` error (resolve in the clerk workspace).** Last resort, only when the conflict can't be represented docs-side (path outside `clerk-docs/`, a binary conflicted file, or the docs repo was dirty/on the wrong branch). The clerk workspace is left conflicted with the filter-repo remote preserved; follow the printed hints — resolve there, push manually (upstream is pre-configured so plain `git push` targets the migration branch), or `git cherry-pick --abort` / `git merge --abort` and re-run.

## Gotchas

- The migrated PR shows **only the branch's own commits**, not the full docs history — that's the delta design, not a bug. Merge commits from the docs branch are dropped (`--no-merges`); their content arrives via the base merge or auto-resolution instead.
- Fewer commits applied than expected (`skippedEmpty` > 0) is normal: auto-resolving one commit to the final file state can make later picks empty.
- `--dry-run` makes zero writes anywhere — including no sync-back commits to the docs repo — but still calls `gh` read-only.
- A failed run may leave temp dirs in `$TMPDIR`: `clerk-migrate-*` (the temp clerk clone) and `clerk-docs-migrate-*` (the filter-repo duplicate). After a tier-2 error both are safe to delete. After a tier-3 error the conflicted workspace and duplicate are preserved _on purpose_ until the conflict is dealt with.
- `--local-only` without `--clerk-path` is rejected: the branch would only exist in a temp clone that gets deleted.

## Changing the script

Tests live in `scripts/migrate-clerk-docs-to-clerk.test.ts` (vitest; includes integration tests that build real git repos in `$TMPDIR` and a multi-run end-to-end lifecycle test). Run them after any change:

```sh
pnpm vitest run scripts/migrate-clerk-docs-to-clerk.test.ts
```
