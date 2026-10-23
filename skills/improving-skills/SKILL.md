---
name: improving-skills
description: Improves an existing skill from evidence - diagnoses why it misses requests it should handle, fires on ones it shouldn't, gets loaded and then ignored, or gives inconsistent or wrong output, using eval results, transcripts, check reports and corrections from real use - then changes one thing at a time and re-measures against held-out cases so gains are real. Use when the user wants to improve, fix, tune, debug, evolve, shorten or optimise a skill or its description, make a skill trigger more reliably, act on a check report or feedback, extend a skill to cover a new case, or asks why a skill doesn't trigger or behave as expected.
---

# Improving skills

Most skill edits are guesses: someone sees one bad run, adds a sentence in capitals, and moves on. Half the time the sentence fixes nothing and the other half it breaks a case nobody re-ran. This skill replaces the guess with a loop: evidence, a hypothesis, one change, a re-measure, keep or revert.

`skillio` below means `node "${CLAUDE_PLUGIN_ROOT}/scripts/skillio.mjs"` (`${CLAUDE_PLUGIN_ROOT}` is Skillio's folder, two levels above this file, if your tool doesn't fill it in). Run `skillio tools` first: re-measuring needs `claude plugin eval`, and without Claude Code you can still diagnose and edit, but say in the report that nothing was re-measured.

## 1. Gather the evidence

Collect what exists before deciding anything; say what is missing.

- The latest check report (`skillio check <path>`) and eval results (`skillio results <aggregate-result.json> --path <path>`). Runs are in the workspace under `skillio/evals/`.
- A prompt audit, `skillio audit <path>` (a model call, read-only): instructions written for older models, such as capitals and MUSTs, "think step by step", workarounds for retired models. They are a common reason a skill is followed too rigidly or not at all. Add `--scope both` for a skill installed in a project or `~/.claude/skills`; Claude Code's `/doctor prompt-audit` then also looks for conflicts with CLAUDE.md, rules and other skills, which a skill-only view can't see.
- Transcripts of the failing runs, in the run's `report.html`. The score says that something failed; the transcript says why.
- Real-use observations: `skillio observe <skill-path> --list`. When the user reports a miss or corrects the skill's output in normal work, log it with `skillio observe <skill-path> "<what happened>"` so it isn't lost between sessions.
- The user's own complaint, in their words.

If there is no eval suite, build the trigger and output cases first (building-skills, step 3). Without them you can't tell an improvement from a change.

## 2. Diagnose

First rule out the eval: a grader that checks the wrong thing, an expectation that is wrong, a case that leaks its answer, or an environment failure (network errors, a tool not granted, Claude saying it can't do something a normal session can). Fixing a skill for a broken grader makes it worse. `references/diagnosis.md`, section "When the eval is the problem", lists the signs.

Then classify each failure before choosing a fix; the same symptom has different causes. The table below is the short version; read `references/diagnosis.md` when a failure doesn't fit a row or the obvious fix didn't work, because it says how to confirm each cause before fixing it.

| Symptom | Usual cause | Fix goes in |
| --- | --- | --- |
| Doesn't fire on real phrasing | Description lacks the user's words or intent | Description |
| Fires on near misses | Description broader than the skill | Description: say what it doesn't cover |
| Loses to another skill | Overlapping descriptions | Both descriptions, plus a decoy case |
| Fires, then Claude ignores a step | Step has no reason, is buried, or competes with a default habit | Body: reason, position, or a checklist slot |
| Output has the wrong shape | Prose rules instead of a template | Body: show the output's parts in order |
| Breaks a rule under pressure | Rule stated softly; rationalisation not countered | Body: firm rule, reason, red-flags list |
| Follows a rule too rigidly, or refuses | Pressure language or instructions written for older models | Body: remove it or replace it with the reason; the prompt audit finds these |
| Contradicts the project's CLAUDE.md or another skill | Conflicting instructions in the setup | Whichever file is wrong; `/doctor prompt-audit` (`--scope both`) finds these |
| Inconsistent across runs | Ambiguous instruction; freedom where it should be exact | Body or a script |
| Wrong numbers or format errors | Arithmetic or parsing done in Claude's head | A script in `scripts/` |
| Slow or expensive | Body loads material most runs don't need | Move it to a reference file, or delete it |

For behaviour problems, read `${CLAUDE_PLUGIN_ROOT}/vendor/superpowers-writing-skills/SKILL.md`, section "Match the Form to the Failure": a firm prohibition fixes a rule broken under pressure but makes a wrong-shape problem worse, where a positive template of the output works.

## 3. Cases, a baseline number and a snapshot

Before changing the skill, make each real failure a case: a missed request becomes a should-fire case, a false fire a near miss, a wrong output an output case with a grader that catches it. These go in the tuning set, since you are about to fix them. Then, if the held-out set lacks this kind of request, add a new held-out case that paraphrases the same intent in different words; that is your test that the fix generalises. Add held-out cases only between rounds, never edit existing ones. A fix without a case can silently break again.

Then measure the current skill with the commands in step 5, labelled `--label before-<change>`. That number is the baseline. If you don't know how much the score moves between identical runs, run it twice: the difference is the noise floor.

Finally `skillio snapshot <skill-path> --label before-<change>` copies the skill into the workspace. The snapshot is for reverting, not for scoring.

## 4. Change one thing

One hypothesis, one change, so the next run tells you which change did what. Prefer, in this order:

1. **Delete** what Claude already knows or what no case needs. Shorter skills are followed more closely.
2. **Explain** a rule Claude ignores, instead of repeating it louder.
3. **Restructure**: move the step, turn prose into a checklist or template, split detail into a reference file.
4. **Script** anything deterministic that keeps going wrong.
5. **Add** new instruction last.

For the description: describe the intent behind missed prompts, never their wording. Copying a missed prompt into the description is overfitting; the linter flags it (D006) and the held-out set exposes it.

A prompt audit's diff hunks are candidate changes, not a batch to apply: take one hunk at a time and measure it like any other change. Deleting dated text usually helps, but "usually" is what the measurement is for.

## 5. Re-measure

Before the first paid run, ask the user one question covering trust and cost: the runs load the plugin and run its hooks and scripts as them, N cases × 3 runs, capped at $10 per call (`--max-cost`). On an explicit yes, pass `--trust` (run-evals won't start without it). Then run the cases the change should affect, filtered to this skill so sibling skills in the same plugin don't add cost and noise:

```bash
# description changes: this skill's tuning cases, one arm (held-out cases stay unread until the end)
skillio run-evals <path> --trust --tag <name>:tuning --ablation none --scaffold --label after-<change>
# body, script or reference changes: output cases, with the baseline arm
skillio run-evals <path> --trust --tag output --allow-tools Write Edit Bash --label after-<change>
```

If the summary opens with "Read this first" (the plugin didn't load, or a grader can't pass with the tools granted), fix that and rerun before comparing anything.

Before keeping a change, run the held-out cases (`--tag <name>:held-out`) and the rest of the suite once. Keep the change only if it beats the before number by more than the noise (`${CLAUDE_PLUGIN_ROOT}/skills/checking-skills/references/reading-results.md` explains how much that is), held-out cases don't drop, and cost didn't jump without a reason. Otherwise copy the snapshot back. If a run stops early (exit code 2: cost cap or a rejected credential) or the claude CLI is missing, say so and don't compare partial numbers.

Log every attempt, kept or not, in `changelog.md` in the workspace (`skillio workspace <path>` prints where): the date, hypothesis, change, before and after numbers, and the decision. Failed attempts are information; they stop the next session trying the same thing.

## 6. Automated tuning, with guard rails

Two tools can propose changes in a loop. Both are useful and both can fool you; `references/tuning-loop.md` has the rules.

- **skill-creator's description optimiser** (skill-creator's "Description Optimization" section; `skillio tools` prints where skill-creator is): generates candidate descriptions from failed trigger queries. Its own trigger test loads the description as a slash command, not as a skill, so its scores are not a measurement; in one measured case it reported 17% recall for a description that real loading triggered every time. Use its candidates as ideas and measure them with `skillio run-evals <path> --trust --tag <name>:tuning --ablation none`.
- **`/claude-api build-eval` and `/claude-api hillclimb`**: Claude Code's own commands for an app that calls the API. build-eval writes the eval set; hillclimb improves the app against it with a train/test split, noise and headroom checks and keep-or-revert rounds. Suggest them when the skill runs inside such an app; for the skill as Claude Code loads it, plugin eval is the measurement.

Whatever loop runs, it must never edit the graders or the held-out cases, and a person approves the final change.

## 7. Evolving from real use

Skills improve best from friction in real work, not from sessions dedicated to "improving the skill". Keep logging observations as they happen. When the same observation shows up twice, turn it into a case and then a fix. If the user wants this to happen automatically in every session, the full version is vendored at `${CLAUDE_PLUGIN_ROOT}/vendor/task-observer` (an always-on skill that logs corrections and runs a weekly review); it installs separately and costs tokens in every session, so recommend it only for heavy skill users.

When the user asks to extend a skill to a new case, treat it like a failure: write the case first, watch it fail, then change the skill.

When the default model changes, re-run `skillio audit` and the trigger suite on the skills the user relies on. Instructions tuned for the previous model are the first to age, and a description that triggered reliably can drift.

## Reporting back

Explain as you go; the user wants to learn why a fix works. For each change: the evidence, the diagnosis, the change, the before and after numbers, and a plain-words line on why it worked or didn't. Finish with what remains open and whether the held-out results support the change.
