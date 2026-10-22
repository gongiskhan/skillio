# Skillio

A Claude Code plugin for working on Agent Skills. It builds skills with Anthropic's skill-creator and then measures them the way real sessions load them, checks skills with every validator that exists plus an independent reviewer, and improves them from evidence instead of guesses. It lints every SKILL.md as you edit it, and explains each finding, so working with it is also a way to learn what makes a skill good.

## Install

In Claude Code:

```text
/plugin marketplace add gongiskhan/skillio
/plugin install skillio@skillio
```

Or from a shell:

```bash
claude plugin marketplace add gongiskhan/skillio
claude plugin install skillio@skillio
```

The repository is private, so the machine needs git access to it (`gh auth login`, or an SSH key on the GitHub account). To work on Skillio itself without installing, load the working copy for one session: `claude --plugin-dir ~/path/to/skillio`.

Requirements: Claude Code 2.1.269 or later (for `claude plugin eval`), Node 18 or later, git. Optional: Python 3 with PyYAML for skill-creator's scripts, `zip` for packaging.

## Use

Talk to Claude normally; the skills trigger on what you ask.

| You say | Skill | What happens |
| --- | --- | --- |
| "Make a skill that turns meeting notes into action items", "turn what we just did into a skill" | building-skills | Runs skill-creator (interview, draft, test runs, review viewer), then lints, writes a trigger suite with near misses and held-out cases, runs it with `claude plugin eval`, gets an independent review and packages the result |
| "Check my release-notes skill", "is this SKILL.md ready to publish?" | checking-skills | Runs the linter, `claude plugin validate`, skill-creator's validator, description overlap with your installed skills, the eval suite against a no-skill baseline, and a fresh-eyes reviewer agent; writes one report with the reason behind every finding |
| "My skill never triggers on X", "make it leaner", "act on the check report" | improving-skills | Gathers evidence, diagnoses each failure, snapshots, turns failures into cases, changes one thing at a time and keeps it only if it beats the snapshot on held-out cases |

You can also call them directly: `/skillio:building-skills`, `/skillio:checking-skills`, `/skillio:improving-skills`.

The CLI behind them works on its own:

```bash
node scripts/skillio.mjs lint path/to/skill --target claude-ai
node scripts/skillio.mjs check path/to/plugin
node scripts/skillio.mjs collisions path/to/skill
node scripts/skillio.mjs trigger-cases path/to/plugin --skill my-skill --from trigger-set.json
node scripts/skillio.mjs run-evals path/to/plugin --tag trigger --ablation none
node scripts/skillio.mjs package path/to/skill
```

Run it with no arguments for the full list.

## What's inside

```text
skills/
  building-skills/     skill-creator first, then lint, evals, review, packaging
  checking-skills/     every check in one report, plus the review rubric
  improving-skills/    diagnosis table, tuning-loop rules
agents/skill-reviewer.md   reads a skill cold and scores it on ten dimensions
hooks/hooks.json           lints a skill after every Write or Edit inside it
scripts/skillio.mjs        the CLI; scripts/lib/ has the linter, eval tools, reports
docs/guide.md              what makes a good skill, explained, with plain-words summaries
docs/principles.md         one section per check: what, why, in plain words, how to fix
vendor/                    open-source skills about skills, pinned by commit
evals/                     Skillio's own trigger suite, with a skill-creator decoy
test/                      unit tests and deliberately broken fixtures
```

## Design decisions

**skill-creator does the drafting; plugin eval does the measuring.** skill-creator is Anthropic's tool for writing skills and is good at it. Its description optimiser, though, tests a description by installing it as a slash command, not by loading it as a skill; in one measured case it scored 17% recall for a description that real skill loading triggered every time. `claude plugin eval` loads skills the way a session does, runs each case with and without the plugin, and works in CI, so it's the suite of record.

**Third-party skills live in `vendor/`, not `skills/`.** Everything under `skills/` becomes a skill, and six more skills about skills would compete with these three for the same requests. In `vendor/` they are read when a Skillio skill needs them and never fight for triggering. See [vendor/README.md](vendor/README.md).

**Decoys make routing testable.** If a rival skill will compete for the same requests (skill-creator, the Claude app's built-in document skills, a browser skill), a decoy with its description is installed next to the skill under test in every eval case. A should-fire case then passes only if Claude picks your skill over the rival.

**Held-out cases decide.** Trigger cases tagged `held-out` are written after the description and never used to tune it. The linter flags descriptions that copy eval prompts, and fails outright when the copied prompt is held out.

**Working files stay outside the thing being worked on.** Drafts, eval runs, reports and snapshots go to a `<name>-workspace/` folder beside the skill or plugin, so nothing ends up packaged with a skill or committed to a plugin repo.

**Eval runs are isolated.** `run-evals` strips the messaging variables a parent session can pass to child sessions and turns off the Chrome extension for them, so an eval run can't touch your real browser or post into your conversation.

**No dependencies.** The CLI is plain Node, so the hook runs on every edit without an install step and nothing is fetched at run time.

**Explanations by default.** Every finding links to its section in `docs/principles.md`, and the skills report what, why and the plain-words version. Ask for terse output and they drop it.

## Skillio's own evals

Skillio is tested with its own tools. `evals/` holds 60 trigger cases across the three skills (35 should-fire, 25 near misses, 11 held out), generated from `evals/sets/*.json`, with a decoy carrying skill-creator's exact description installed next to them.

RESULTS_PLACEHOLDER

Run them with `npm run evals:trigger` (about 180 short sessions, a few dollars).

## Learning

Start with [docs/guide.md](docs/guide.md): what a skill is mechanically, why the description is a routing rule, what belongs in the body, how evals work and how to improve without fooling yourself. Every section ends with an "In simple terms" summary. [docs/principles.md](docs/principles.md) explains each check on its own.

## Credits

Skillio vendors and builds on work by others, each under its own license: Anthropic's [skill-creator](https://github.com/anthropics/skills) and [plugin-dev](https://github.com/anthropics/claude-plugins-official) (Apache-2.0), Jesse Vincent's [superpowers writing-skills](https://github.com/obra/superpowers) (MIT), softaworks' [skill-judge](https://github.com/softaworks/agent-toolkit) (MIT), Eoghan Henn's [task-observer](https://github.com/rebelytics/one-skill-to-rule-them-all) (CC-BY-4.0), and the [Agent Skills](https://github.com/agentskills/agentskills) specification and guides (CC-BY-4.0).

Skillio's own code is MIT. Contributing: see [AGENTS.md](AGENTS.md).
