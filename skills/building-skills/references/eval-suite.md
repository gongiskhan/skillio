# Writing the eval suite

## Contents

- How plugin eval runs a case
- Trigger cases
- Near misses and decoys
- Held-out cases
- Fixtures for prompts about existing skills
- Output cases and graders
- Targets
- Cost and time
- Isolation and trust

## How plugin eval runs a case

`claude plugin eval` reads every folder under the plugin's `evals/` (or `experimental.evals` in plugin.json) that contains a `prompt.md` or `case.yaml`. Each case runs as a fresh `claude -p` child in an empty temporary home and working directory, with only the plugin under test loaded: no user settings, hooks, CLAUDE.md, MCP servers, memory or other plugins. Each case runs 3 times by default, then 3 more times without the plugin (the baseline arm), and the report shows WITH, W/OUT and the delta.

A standalone skill (no plugin around it) keeps its cases in `<skill>/evals/`. Skillio wraps it in a temporary plugin in the workspace when it runs them, and skill-creator's packager leaves `evals/` out of the upload.

## Trigger cases

`skillio trigger-cases` writes these for you from a JSON list. What it writes, so you can edit by hand:

```markdown
<!-- evals/trigger-my-skill/fire-quarterly-report/prompt.md -->
---
description: "Should invoke my-skill"
tags: [trigger, should-fire, skill:my-skill]
max_turns: 4
allowed_tools: [Read, Glob, Grep, Skill]
---

my manager wants the Q3 numbers from ~/Downloads/sales_q3_final.xlsx turned into the usual board summary, can you do it like last quarter
```

```markdown
<!-- evals/trigger-my-skill/fire-quarterly-report/graders/skill-fired.md -->
---
type: tool_used
tool: Skill
input_match: '"skill"\s*:\s*"(?:[\w-]+:)?my-skill"'
---
```

`max_turns: 4` keeps the run short: whether the skill fires is decided in the first turn or two, and the rest of the task costs money without telling you anything about triggering.

In a two-arm run, `tool_used: Skill` graders are reported as indicators, not scored, because the skill can never fire without its plugin. Run trigger cases with `--ablation none`: one arm, half the cost, and the Skill graders count.

## Near misses and decoys

A near miss shares words or topic with the skill but needs something else. It's the only way to catch a description that fires on everything. For a skill that builds board summaries from spreadsheets, "fix the VLOOKUP in column F of my budget" is a near miss; "write a haiku" is not, because no description would fire on it.

The grader for a near miss asserts the skill never ran, scored in both arms:

```markdown
---
type: tool_used
tool: Skill
input_match: '"skill"\s*:\s*"(?:[\w-]+:)?my-skill"'
min: 0
max: 0
arm: both
---
```

When a known skill competes for the same requests, add a decoy: a skill folder under `evals/decoys/<rival>/` whose SKILL.md copies the rival's description. `skillio decoy` writes it. Plugin eval won't load an extra plugin from inside the eval folder alongside the plugin under test (a case's `plugins:` list replaces the plugin under test rather than adding to it), so `skillio run-evals` copies the plugin into the workspace and installs every decoy as a sibling skill. The rival is then present in every case of the run, the way it would be on a real machine, and a should-fire case passes only if Claude picks your skill over it. Typical rivals: the Claude app's built-in docx, xlsx, pptx and pdf skills; a general browser skill; skill-creator itself for anything about skills.

## Held-out cases

Write held-out prompts after the description is final, tag them `held-out` (set `"held_out": true` in the JSON), and never read their results while editing the description. If tuning-set recall climbs and held-out recall doesn't, the description is memorising prompts, not describing a task. Copying a missed prompt's wording into the description is the usual way this happens; the linter flags it (D006).

## Fixtures for prompts about existing skills

Runs start in an empty folder. A prompt like "check my release-notes skill" then sends Claude searching, finding nothing and giving up before it decides whether to load a skill, so the case measures the empty folder. Add `"fixture": "release-notes"` to that item in the trigger set: `trigger-cases` writes a `case.yaml` and a `fixture.sh` that creates `skills/release-notes/SKILL.md` in the run's workspace. Plugin eval runs it only with `--scaffold`, as the user, so pass `--scaffold` to `skillio run-evals` for suites you wrote.

## Output cases and graders

Output cases check what the skill produced. Tag them `output`, keep the baseline arm on, and grade with the cheapest grader that can decide:

| Question | Grader |
| --- | --- |
| Did it create the file? | `file_exists` with a glob, for example `path: "**/*.xlsx"` |
| Does the file contain X / not contain Y? | `regex` with `target: {source: file, path: report.md}` and `match: contains` or `not_contains` |
| Did it run the validation script? | `tool_used` with `tool: Bash` and `input_match: 'validate\.py'` |
| Did it validate before writing? | `tool_order` with `before` and `after` |
| Is the summary accurate, the tone right? | `llm`, one dimension per grader, PASS if / FAIL if |

An `llm` judge passes on two of three votes. Judges drift on long text and refuse binary files such as .pptx or PDF, so grade files with code and keep judges for short, readable outputs. Point a file grader at the file's contents (`target: {source: file, path: ...}`), not at `files`, which is only the list of created paths.

Runs start in an empty folder. If the task needs input files, put them in a `case.yaml` with `context.add_dirs` (read-only fixtures) or a `context.scaffold_script` (runs only with `--scaffold`, as you, so only for suites you wrote). Tools that write (`Write`, `Edit`, `Bash`) need `--allow-tools`; without them no file gets created in either arm and every file grader fails.

A complete output case, `evals/output-my-skill/q3-board-summary/`:

```markdown
<!-- prompt.md -->
---
description: "Board summary from the Q3 export"
tags: [output, skill:my-skill]
max_turns: 25
allowed_tools: [Read, Glob, Grep, Skill, Write, Bash]
---

Turn sales_q3.csv into the usual board summary and save it as board-summary.md.
```

```yaml
# case.yaml
schema_version: "1.1"
name: q3-board-summary
context:
  add_dirs: [inputs]      # inputs/sales_q3.csv sits next to this file
```

```markdown
<!-- graders/file-written.md -->
---
type: file_exists
path: "**/board-summary.md"
---
```

```markdown
<!-- graders/totals-match.md -->
---
type: regex
target: {source: file, path: board-summary.md}
pattern: "Total revenue: 1,284k"
---
```

```markdown
<!-- graders/no-invented-figures.md -->
---
type: llm
focus: {source: file, path: board-summary.md}
---

PASS if every figure in the summary appears in inputs/sales_q3.csv or is a sum of figures there.
FAIL if any figure has no source in the input. Answer FAIL if you can't tell.

Drop any assertion that passes both with and without the skill: it measures Claude, not the skill. Investigate any that fails in both: the case or the grader is usually wrong.

## Targets

Starting points, not standards; agree real ones with whoever owns the outcome.

- Should fire, tuning set: at least 90% of runs fire.
- Should fire, held out: at least 80% of runs fire. A gap of more than 15 points to the tuning set means overfitting.
- Near misses: no case fires in any run.
- Output cases: every deterministic grader passes on every run; the delta against baseline is positive on every case.
- pass^k (every run correct) matters more than the mean for skills people won't retry: 90% per run is only 73% for three runs in a row.

## Cost and time

Each run is a full Claude session on the user's account. Skillio's own 60 trigger cases at 3 runs with `--ablation none` were 180 short sessions: $10.34 and about 6 minutes at concurrency 8. Output cases with the baseline double the runs and are longer. `skillio run-evals` caps a run at $10 unless you pass `--max-cost <usd>`; raise it deliberately for big suites. A run that hits the cap exits with code 2 and its numbers are partial.

## Isolation and trust

`skillio run-evals` unsets the variables a parent session leaks into children (its messaging channel, and in cloud sessions the markers that make a child behave as a remote session, where Claude refuses to create skills) and sets `CLAUDE_CODE_ENABLE_CFC=0`, so eval runs look like a fresh local session and can't drive the user's Chrome or post into the conversation. If a run's transcripts show Claude saying it can't do something a normal session can, suspect the environment before the skill. It passes `--trust-plugin`, which plugin eval requires when there is no terminal to answer its trust prompt. That is fine for skills the user wrote; for third-party plugins, run evals only when the user says so, because a plugin's hooks and scripts run as the user outside the eval sandbox.
