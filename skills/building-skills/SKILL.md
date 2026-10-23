---
name: building-skills
description: Builds a new Agent Skill, or a Claude Code plugin that ships skills, by running Anthropic's skill-creator and then adding what it leaves out - a lint pass, a claude plugin eval suite with should-fire, near-miss and held-out trigger cases, a no-skill baseline, an independent review and packaging for the Claude app. Use when the user wants to create, write, draft, scaffold or design a skill or SKILL.md, turn a workflow, prompt or conversation into a skill, or start a skills plugin, for Claude Code, the Claude app or the API. Prefer it over calling skill-creator directly when Skillio is installed, since it runs skill-creator as its first step.
---

# Building skills

Skill-creator is good at the creative half: interviewing, drafting, running the draft against test prompts and showing the results. This skill runs it, then adds the half that decides whether the skill holds up in real sessions: measured triggering with real skill loading, near misses, a held-out set, deterministic graders, a fresh-eyes review and a clean package.

Everything below runs through `node "${CLAUDE_PLUGIN_ROOT}/scripts/skillio.mjs"`, written `skillio` from here on. (`${CLAUDE_PLUGIN_ROOT}` is Skillio's folder, two levels above this file, if your tool doesn't fill it in.) The principles behind each check are in `${CLAUDE_PLUGIN_ROOT}/docs/principles.md`; the long-form explanation is `${CLAUDE_PLUGIN_ROOT}/docs/guide.md`.

Start with `skillio tools`. It prints the Claude Code version and which of its tools this machine can run (validation, plugin eval and its authoring interview, prompt audits), and where skill-creator is. Use Claude Code's tools wherever they exist, because they check the skill the way Claude Code will load it. If Claude Code isn't installed (another editor, a bare CI box), skip the steps that need it without discussing it, do everything else, and list what wasn't tested in the final report.

## 0. Settle three things first

Take them from the conversation when you can and ask only for what is missing. Each one changes what you build.

1. **Surface.** Claude Code (a plugin, `~/.claude/skills`, or a project's `.claude/skills`), the Claude app or API (uploaded), or both. The app and API accept only the open-standard frontmatter fields, run skills on Linux with different network and package rules, and can't be tested with `claude plugin eval` directly, so they need a manual smoke test at the end.
2. **Home.** Where the skill lives and whether it joins an existing plugin. `claude plugin init <name> --with skills` scaffolds a new plugin, but always under `~/.claude/skills/<name>/`; for a plugin in a repo, create `.claude-plugin/plugin.json` and `skills/<skill>/SKILL.md` there yourself.
3. **Whether a skill is the right tool.** Fixed steps on structured input are cheaper as a script or a hook. Access to a system is a connector (MCP) job. A rule that must apply in every session belongs in the project's AGENTS.md or CLAUDE.md. A one-off task needs nothing. Say so when it's true; a skill that shouldn't exist is the most expensive kind to maintain.

Then get the workspace path with `skillio workspace <skill-or-plugin-path>`; it works before the skill exists. Drafts, test runs, reports and snapshots go there, never inside the skill folder, because everything in the skill folder ships with the skill. The one exception is a standalone skill's eval cases, which live in `<skill>/evals/`: they travel with the skill, and skill-creator's packager and `skillio package` both leave `evals/` out of the upload.

For anything beyond a small personal skill, fill in `references/brief.md` with the user before drafting. The agent building a skill knows the format; what it lacks is the business context, real examples and a definition of done.

## 1. Draft and test with skill-creator

Read skill-creator's `SKILL.md` in the folder `skillio tools` printed: the installed skill-creator plugin when there is one (Claude Code keeps it updated), otherwise Skillio's pinned copy in `${CLAUDE_PLUGIN_ROOT}/vendor/skill-creator`. If it's the pinned copy, mention once that `/plugin install` with the id `skillio tools` showed keeps it current. Follow its "Creating a skill" and "Running and evaluating test cases" sections. Its scripts run from its own folder, for example `cd <skill-creator folder> && python3 -m scripts.aggregate_benchmark <workspace>/iteration-1 --skill-name <name>`. Use Skillio's workspace path wherever it says `<skill-name>-workspace/`.

Five adjustments while you follow it, each with its reason:

- **Run the baseline before you write much.** Give Claude two or three realistic tasks with no skill and note what it gets wrong. Anthropic's authoring guide calls this evaluation-driven development: the skill should be the smallest thing that fixes the observed gaps, and anything Claude already does well is wasted tokens on every run.
- **Write the description as a routing rule.** Third person, what the skill does and when to use it, in the words users actually type (nouns, file types, situations), a little pushy because Claude tends to under-trigger, and naming the rival it should beat when there is one ("prefer this over general browser automation when..."). Keep the procedure out of it: a description that summarises the steps can be followed instead of the skill being loaded.
- **Hold the body to Skillio's rubric** (`${CLAUDE_PLUGIN_ROOT}/skills/checking-skills/references/review-rubric.md`), which the reviewer in step 5 will score it against; skill-creator's writing guide covers the same ground in prose.
- **Don't use skill-creator's description optimiser as the measurement.** Its `run_loop.py` tests a description by installing it as a slash command, not by loading it as a skill. In one measured case it scored a description at 17% recall that real skill loading triggered every time. Its suggestions are fine as candidates; measure them in step 3.
- **Let the lint hook work.** Skillio's hook lints the skill after every edit and, after each SKILL.md edit, runs `claude plugin validate` on it, so you hear about problems the moment they appear, both Skillio's and Claude Code's own loader's. Fix them as they come.

## 2. Lint and validate

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/skillio.mjs" check <skill-path> --target <claude-code|claude-ai|portable>
```

This runs Skillio's linter, `claude plugin validate` (Claude Code's own loader checks; a bare skill is validated in place, through its folder), `claude plugin details` (what the skill costs in context, always and when it fires), the description overlap with installed skills, and skill-creator's upload validator. Fix every error. Fix warnings unless you can say why one doesn't apply. Each finding names a rule; its reason is under the same id in `docs/principles.md`. The tools disagree on purpose: Claude Code accepts frontmatter that the Claude app's uploader rejects, and neither checks what Skillio's linter checks, so a skill for the app has to pass all three.

## 3. Build the eval suite

Skill-creator's `evals/evals.json` and `claude plugin eval` don't read each other's files. Plugin eval loads the skill the way a real session does, runs every case with and without the plugin, and can run in CI, so it becomes the suite of record. Read `references/eval-suite.md` before writing cases; it has templates, targets and costs.

1. **Trigger set.** About 20 prompts in skill-creator's format, `[{"query": ..., "should_trigger": true|false}]`: 8 to 10 that should fire, phrased the many ways real users phrase them, and 8 to 10 near misses that share words with the skill but need something else. Prompts should be substantive, with file names, context and casual wording; Claude doesn't reach for a skill on one-step requests it can do alone, so trivial prompts measure nothing.
2. **Convert:** `skillio trigger-cases <path> --skill <name> --from <trigger-set.json>`. The file is a JSON array of `{"query": "...", "should_trigger": true|false}`, optionally with `"fixture": "<skill-name>"` when the prompt talks about an existing skill the run should find, and `"held_out": true`. Each case is tagged `<name>:tuning` or `<name>:held-out` so the two sets can run separately.
3. **Held-out set, later.** Once the description is final (step 4), write 6 to 10 new prompts with `"held_out": true` into a separate file, convert them, and run them once with `--tag <name>:held-out`. Don't run or read them while you are still editing the description; they are the only honest test that it generalises rather than memorises the tuning prompts.
4. **Competition.** If another skill will fight for the same requests (the Claude app's built-in docx, xlsx, pptx and pdf skills, a browser skill, skill-creator itself), add a decoy that copies its description with `skillio decoy <path> --name <rival> --description "<its description>"`. run-evals then installs the decoy beside your skill in every case, so a should-fire case only passes if Claude picks your skill over the rival. That makes routing measurable without loading the real rival.
5. **Output cases.** Run `skillio eval-init <path>`. It starts Claude Code's own eval-authoring interview (`claude plugin eval init`); inside a session there is no terminal for it, so it prints the interview for you to conduct with the user, followed by Skillio's notes. Use it for two to four cases that grade what the skill produces, seeded with skill-creator's test prompts. The interview's rules are good ones: grade outcomes rather than which tools ran, code graders before judges, tools follow graders, and calibrate each grader by showing the user its verdicts. Tag the cases `output` and `skill:<name>`. Without Claude Code, write them from the template in `references/eval-suite.md`.
6. **Run.** Before the first run, ask the user one question that covers both trust and cost: evals load the plugin and run its hooks, scripts and cases on their machine as them, and this run is N cases × 3 runs with a cap of $10 (`--max-cost`). Only on an explicit yes, add `--trust`; run-evals refuses to start without it, because Claude Code's own rule is that trusting a plugin is the user's call. With no answer, write the cases and don't run them. Trigger cases first, single arm since a skill can't fire without its plugin:
   `skillio run-evals <path> --trust --tag <name>:tuning --ablation none --scaffold`
   Then output cases with the baseline arm on, granting the tools the cases need to produce files:
   `skillio run-evals <path> --trust --tag output --allow-tools Write Edit Bash`
   `--scaffold` runs the fixture scripts the cases ship with; they run as the user, so pass it only for suites you wrote. Judges default to Sonnet (`--judge-model`), since small judges miss nuance. Suites take minutes; start them with Bash `run_in_background` and keep working. Read the summary's "Read this first" block if there is one: it means the plugin didn't load or a grader can't pass, and the numbers are meaningless until that's fixed.

## 4. Iterate

Read the transcripts in the run's `report.html` before changing anything: the score says that something failed, the transcript says why, and often it's the case, not the skill (a prompt that references a file that isn't there, a missing paste). Change one thing at a time and re-run only the affected tag. Stop when the targets in `references/eval-suite.md` are met or two rounds in a row move nothing; then write and run the held-out set once. If a run stops with exit code 2 (cost cap or credential), don't compare its numbers. For anything beyond small fixes, switch to the improving-skills workflow; it covers diagnosis, noise and keep-or-revert.

## 5. Independent check

Run the checking-skills workflow on the finished skill. Its reviewer is a separate agent that didn't watch the skill being written, so it reads the skill the way Claude will meet it.

## 6. Ship

- **Claude Code plugin:** `skillio check <plugin> --strict` (validation warnings become failures), a README, and a marketplace entry if it's shared. If it will be submitted to Anthropic's plugin directory, add `--for-directory`: it runs `claude plugin validate --profile directory`, the subset of the directory's own submission checks. Set `version` in plugin.json and tag releases with `claude plugin tag` once other people depend on it. To gate a repo's CI on the suite, see "Gating CI" in `references/eval-suite.md`.
- **Personal or project skill:** leave it in place; it loads next session.
- **Claude app or API:** `skillio package <skill-path>` lints for the upload rules and writes a `.zip` and a `.skill`. Then run five to ten real prompts in the app: Claude Code trigger rates are a proxy for the app, which has its own system prompt and its own built-in skills competing. If the skill runs inside an app that calls the API, `/claude-api build-eval` builds an eval for that app; Skillio's suite covers the skill itself.

Record what you measured (scores, cost, open issues) in the workspace, not in the skill folder.

## Reporting back

The user is learning what makes a skill good, so explain while you report. For every decision or problem that matters, give what happened, why it matters in one or two sentences, and the plain-words version. End with the numbers (trigger rates on tuning and held-out sets, false fires, output scores against baseline, cost), what was not tested, and the next step. If the user asks for terse output, drop the explanations.
