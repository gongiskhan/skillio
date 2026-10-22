# Working on Skillio

Instructions for anyone (person or agent) changing this repo.

## Layout

- `skills/` holds the three skills the plugin loads: `building-skills`, `checking-skills`, `improving-skills`. Every folder here becomes a skill, so nothing else goes in it.
- `agents/skill-reviewer.md` is the fresh-eyes reviewer checking-skills starts.
- `hooks/hooks.json` runs `scripts/hook-lint.mjs` after Write and Edit.
- `scripts/skillio.mjs` is the CLI every skill calls; `scripts/lib/` holds its modules. Node only, no dependencies, so it runs from a hook without an install step.
- `docs/principles.md` has one section per lint rule; `docs/guide.md` is the long-form explanation.
- `vendor/` holds third-party skills read as reference. Never edit them in place: run `node scripts/sync-vendor.mjs` to update, review the diff, commit it on its own.
- `evals/` is Skillio's own `claude plugin eval` suite: trigger cases for each skill, generated from `evals/sets/*.json`, plus a decoy of skill-creator in `evals/decoys/`.
- `test/` is the unit test suite; fixtures under `test/fixtures/` are deliberately broken skills.

## Before committing

```bash
npm test                                            # unit tests
node scripts/skillio.mjs lint .                     # Skillio lints its own skills
claude plugin validate .claude-plugin/plugin.json --strict
claude plugin validate .
```

When you change a skill's description, re-run its trigger cases and compare with the last run (results go to `../skillio-workspace/skillio/evals/`):

```bash
node scripts/skillio.mjs run-evals . --tag skill:<name> --ablation none
```

Don't tune descriptions on the `held-out` cases. If they miss, describe the intent better; never paste their wording into a description.

## Rules

- Adding a lint rule means three edits: the rule in `scripts/lib/rules.mjs`, the check in `scripts/lib/lint.mjs`, and a section in `docs/principles.md` with **What it checks**, **Why it matters**, **In plain words** and **How to fix**. The tests fail if the section is missing.
- Messages and docs follow the house style: plain words, no em dashes, sentence-case headings, a reason for every rule.
- No CLAUDE.md and no `.claude/` directory in this repo; agent instructions live here. Both names are in `.gitignore`.
- Commit messages describe the change. No tool attribution or co-author trailers.

## Releasing

`version` in `.claude-plugin/plugin.json` decides when installed copies update: users only get a new version when it changes. Bump it (patch for fixes, minor for new checks or skill changes), commit, then `claude plugin tag --push`. To try changes without releasing, load the working copy for one session: `claude --plugin-dir /path/to/skillio`.
