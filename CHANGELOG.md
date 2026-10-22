# Changelog

## 0.1.0 (2026-10-22)

First version.

- Three skills: `building-skills` (skill-creator plus lint, a plugin-eval trigger suite with near misses, held-out cases and decoys, a baseline, review and packaging), `checking-skills` (every static check, the eval suite, an independent reviewer, one report) and `improving-skills` (evidence, diagnosis, one change at a time, re-measure against held-out cases).
- `skill-reviewer` agent with a ten-dimension rubric.
- `skillio` CLI: 42 static checks, each explained in docs/principles.md (including description overlap with installed skills and eval-suite health), wrapped `claude plugin validate`, trigger-case generation from skill-creator's eval-set format, decoys, isolated `claude plugin eval` runs with trigger metrics (tuning, held-out, false fires, pass^k), snapshots, an observation log and packaging for the Claude app.
- PostToolUse hook that lints a skill after every edit: errors every time, warnings once.
- Vendored, pinned by commit: skill-creator, superpowers writing-skills, skill-judge, Anthropic's plugin-dev guides and reviewer agents, task-observer, and the Agent Skills spec and guides.
- docs/guide.md: what makes a good skill, with a plain-words summary per section.
