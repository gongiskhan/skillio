# Changelog

## 0.2.0 (2026-10-23)

Uses Claude Code's own tools wherever they fit, and falls back cleanly without them.

- `skillio tools`: which Claude Code tools this machine can run (validate, details, plugin eval and its interview, prompt audits, `/skill-doctor`), where skill-creator is, python and zip. Every skill starts with it.
- `claude plugin validate` now validates a bare skill in place through its folder (no wrapper plugin), reports validator crashes (exit 2) as such, and takes `--strict` and `--for-directory` (`--profile directory`) from `skillio check`.
- `claude plugin details` in every check: always-on and on-invoke context cost.
- `skillio audit`: `/claude-api prompt-audit` on a skill or plugin, and with `--scope both` `/doctor prompt-audit` on the project's whole setup. Read-only, results in the workspace. Used by checking-skills and improving-skills.
- `skillio eval-init`: `claude plugin eval init`'s authoring interview for output cases, interactive in a terminal and printed for Claude inside a session, with Skillio's tagging and pilot notes.
- `run-evals` passes `--trust-plugin` only with `--trust`, after the user says yes (Claude Code's own rule); defaults LLM judges to Sonnet; puts "Read this first" at the top of the summary when the plugin didn't load or a grader can't pass with the tools granted; checks the Claude Code version.
- The edit hook runs `claude plugin validate` after SKILL.md edits and after edits to a plugin's manifest, marketplace, hooks, agents or commands.
- building-skills uses the installed skill-creator plugin when there is one, else the pinned copy.
- Without Claude Code (`SKILLIO_CLAUDE=off` to simulate), checks run the static parts, report one "not run" line and never fail for a missing tool.
- Docs: the tool map in docs/guide.md now covers every Claude Code tool, why the validators disagree, and a CI recipe in the eval guide.
- Skill descriptions are unchanged, so the trigger results in evals/RESULTS.md still apply.

## 0.1.0 (2026-10-22)

First version.

- Three skills: `building-skills` (skill-creator plus lint, a plugin-eval trigger suite with near misses, held-out cases and decoys, a baseline, review and packaging), `checking-skills` (every static check, the eval suite, an independent reviewer, one report) and `improving-skills` (evidence, diagnosis, one change at a time, re-measure against held-out cases).
- `skill-reviewer` agent with a ten-dimension rubric.
- `skillio` CLI: 42 static checks, each explained in docs/principles.md (including description overlap with installed skills and eval-suite health), wrapped `claude plugin validate`, trigger-case generation from skill-creator's eval-set format, decoys, isolated `claude plugin eval` runs with trigger metrics (tuning, held-out, false fires, pass^k), snapshots, an observation log and packaging for the Claude app.
- PostToolUse hook that lints a skill after every edit: errors every time, warnings once.
- Vendored, pinned by commit: skill-creator, superpowers writing-skills, skill-judge, Anthropic's plugin-dev guides and reviewer agents, task-observer, and the Agent Skills spec and guides.
- docs/guide.md: what makes a good skill, with a plain-words summary per section.
