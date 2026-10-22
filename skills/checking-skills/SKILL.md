---
name: checking-skills
description: Checks whether a skill or a plugin's skills are good and ready to ship by running every check available - Skillio's linter, claude plugin validate, description overlap with the other installed skills, the claude plugin eval suite against a no-skill baseline, and an independent review against Anthropic's authoring guidance - then explains each finding and what to fix. Use when the user asks to check, validate, review, audit, lint, test, score or grade a skill, a SKILL.md or a skills plugin, or asks whether a skill is good, well written, safe or ready to publish.
---

# Checking skills

A skill can look fine and still never fire, fire on the wrong requests, or make Claude worse than it is without it. No single tool sees all of that, so this runs all of them and puts the results in one report. Static checks are free and run first; evals cost model calls and run second; a separate reviewer reads the skill last, without having watched it being written.

`skillio` below means `node "${CLAUDE_PLUGIN_ROOT}/scripts/skillio.mjs"`.

## 1. Identify the target

The path can be one skill folder, a plugin, a marketplace repo, or a folder of skills. If the user names a skill instead of a path, find it: `skillio inventory` lists every skill Claude Code loads, with its folder. Skills synced from the Claude app have no folder here; say so if the user means one of those. Settle the surface the skill is meant for (Claude Code, the Claude app or API, or both), because the app and API reject frontmatter fields that Claude Code accepts. When unclear, check for both with `--target portable`.

## 2. Static checks

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/skillio.mjs" check <path> --target <claude-code|claude-ai|portable>
```

This runs, in one pass:

- **Skillio's linter**: the Agent Skills spec limits, description quality, body size, broken and nested references, file-name case mismatches, secrets and junk in the folder.
- **Description overlap**: compares the description with every skill installed for this user and with its siblings in the same plugin. Overlap is the usual cause of "it fired the wrong skill".
- **Eval suite health**: whether cases exist, whether there are near misses and held-out cases, whether the description copies a test prompt.
- **`claude plugin validate`**: Claude Code's own loader checks, plus the plugin directory's listing checks. A bare skill is wrapped in a temporary plugin in the workspace so it can be validated.
- **skill-creator's `quick_validate.py`**: the Claude app's upload rules.
- **`/skill-doctor`**: every skill Claude Code actually loads for this user, with context cost and use counts, in the report when the CLI can run it.

It writes `report.md` and `report.json` to the workspace and prints the path. Each finding names a rule; its full reason is under the same id in `${CLAUDE_PLUGIN_ROOT}/docs/principles.md`.

## 3. Evals

Run the suite if one exists. Static checks can't tell you whether Claude picks the skill on real wording, and only a baseline tells you whether the skill helps at all.

1. **Trust first.** Evals run the plugin's hooks and scripts as the user; plugin eval's own docs say its isolation is not a boundary against the plugin's own code. If the skill is third-party and the user hasn't reviewed it, skip all of section 3 and say why.
2. **Say the cost.** State in one line how many cases and runs it is and the cap (`--max-cost`, $10 by default per call).
3. **Triggering:** `skillio run-evals <path> --tag trigger --ablation none --scaffold`. For one skill inside a plugin, pass the skill's folder; run-evals then keeps to that skill's cases (`skill:<name>`) instead of paying for its siblings'.
4. **Output:** `skillio run-evals <path> --tag output --allow-tools Write Edit Bash` (baseline arm on).
5. Start long suites with Bash `run_in_background` and start section 4 while they run.

If there is no suite, the skill is untested, and a check should still produce a number. Build a starter trigger set without touching the skill: write 10 should-fire prompts, 10 near misses and 4 held-out prompts as building-skills' eval guide (`${CLAUDE_PLUGIN_ROOT}/skills/building-skills/references/eval-suite.md`) describes, convert them into the workspace with `skillio trigger-cases <path> --skill <name> --from <set.json> --into <workspace>/skillio/starter-evals`, and run them with `skillio run-evals <path> --evals-from <workspace>/skillio/starter-evals --ablation none --scaffold`. The cases stay in the workspace; offer to move them into the skill's suite.

Read `references/reading-results.md` before drawing conclusions from the numbers; small suites are noisy and a delta near zero means several different things.

## 4. Independent review

Start the `skill-reviewer` agent from this plugin with the skill path, the surface, the path of the static report and the rubric path, `${CLAUDE_PLUGIN_ROOT}/skills/checking-skills/references/review-rubric.md`. It reads every file in the skill with the rubric in `references/review-rubric.md` and returns scored findings with evidence. It judges what code can't: whether the body teaches Claude anything it doesn't know, whether freedom matches fragility, whether instructions say why, whether failure cases are handled. For a plugin, start one reviewer per skill, in parallel.

## 5. What you can't run

The check includes `/skill-doctor` when the CLI can run it non-interactively; its use counts mean more after a week of real work, so suggest re-running it then. Some versions moved it into the `/plugin` Stats tab; if the report says it was unavailable, point the user there.

## 6. Report

Lead with the verdict in one sentence: ready, ready after small fixes, or not ready. Then:

- What ran and what each found, one line per check, including what was skipped and why.
- The issues that matter, most serious first. For each: what is wrong, where (file and line), why it matters in one or two sentences, the plain-words version, and the fix. The user is learning what makes a good skill, so the why is not optional unless they ask for terse output.
- Eval numbers when they exist: trigger rate on tuning and held-out cases, false fires, output score with and without the skill, cost.
- What none of the checks covered.

Offer the improving-skills workflow for the fixes. Don't edit the skill during a check unless the user asks; a check that quietly changes what it checks can't be trusted.
