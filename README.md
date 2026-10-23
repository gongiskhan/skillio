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

Requirements: Node 18 or later and git. Claude Code 2.1.269 or later for evals, 2.1.283 or later for the prompt audits. Optional: Python 3 with PyYAML for skill-creator's scripts, `zip` for packaging. Without Claude Code (in another editor, say), the linter, overlap and suite checks, skill-creator and packaging still work; `node scripts/skillio.mjs tools` shows what this machine can run.

## Use

Talk to Claude normally; the skills trigger on what you ask.

| You say | Skill | What happens |
| --- | --- | --- |
| "Make a skill that turns meeting notes into action items", "turn what we just did into a skill" | building-skills | Runs skill-creator (interview, draft, test runs, review viewer), then lints and validates, writes a trigger suite with near misses and held-out cases, writes output cases with `claude plugin eval init`'s interview, runs them with `claude plugin eval`, gets an independent review and packages the result |
| "Check my release-notes skill", "is this SKILL.md ready to publish?" | checking-skills | Runs the linter, `claude plugin validate` and `details`, `/skill-doctor`, skill-creator's validator, description overlap with your installed skills, `/claude-api prompt-audit` (plus `/doctor prompt-audit` for skills in a project), the eval suite against a no-skill baseline, and a fresh-eyes reviewer agent; writes one report with the reason behind every finding |
| "My skill never triggers on X", "make it leaner", "act on the check report" | improving-skills | Gathers evidence (eval runs, transcripts, a prompt audit, real-use notes), diagnoses each failure, snapshots, turns failures into cases, changes one thing at a time and keeps it only if it beats the snapshot on held-out cases |
| "Test this app https://...", "is the app working after the deploy?", "test PR 123 against localhost:3000" | web-testing | Drives user journeys in a real browser with Playwright, records video and step screenshots, judges each step from the screenshots, reports bugs with that evidence, then turns verified journeys into tests in the project's suite and runs them. Handles test logins without the password entering the conversation |

You can also call them directly: `/skillio:building-skills`, `/skillio:checking-skills`, `/skillio:improving-skills`, `/skillio:web-testing`.

web-testing is not a skill about skills. It lives here because it was built and measured with Skillio, and it is the worked example of the whole loop: [docs/web-testing.md](docs/web-testing.md) has the numbers.

The CLI behind them works on its own:

```bash
node scripts/skillio.mjs tools
node scripts/skillio.mjs lint path/to/skill --target claude-ai
node scripts/skillio.mjs check path/to/plugin --strict
node scripts/skillio.mjs audit path/to/skill --scope both
node scripts/skillio.mjs collisions path/to/skill
node scripts/skillio.mjs trigger-cases path/to/plugin --skill my-skill --from trigger-set.json
node scripts/skillio.mjs eval-init path/to/plugin
node scripts/skillio.mjs run-evals path/to/plugin --trust --tag trigger --ablation none
node scripts/skillio.mjs package path/to/skill
```

Run it with no arguments for the full list.

## What's inside

```text
skills/
  building-skills/     skill-creator first, then lint, evals, review, packaging
  checking-skills/     every check in one report, plus the review rubric
  improving-skills/    diagnosis table, tuning-loop rules
  web-testing/         browser testing with screenshot and video evidence, then Playwright tests
agents/skill-reviewer.md   reads a skill cold and scores it on ten dimensions
hooks/hooks.json           lints a skill after every Write or Edit inside it
scripts/skillio.mjs        the CLI; scripts/lib/ has the linter, eval tools, reports
docs/guide.md              what makes a good skill, explained, with plain-words summaries
docs/principles.md         one section per check: what, why, in plain words, how to fix
scripts/lib/claude.mjs     every call into Claude Code, with the fallbacks
vendor/                    open-source skills about skills, pinned by commit
evals/                     trigger suites for all four skills, with skill-creator and browser decoys
test/                      unit tests and deliberately broken fixtures
```

## Design decisions

**Claude Code's tools first.** Validation, context cost, evals, the eval-authoring interview, prompt audits and `/skill-doctor` all come from Claude Code, so they judge a skill the way Claude Code will load it. Skillio runs each one where it fits (the hook even validates a SKILL.md after every edit) and adds what they don't check. Without Claude Code it falls back to the checks that don't need it and says what wasn't covered.

**skill-creator does the drafting; plugin eval does the measuring.** skill-creator is Anthropic's tool for writing skills and is good at it. Its description optimiser, though, tests a description by installing it as a slash command, not by loading it as a skill; in one measured case it scored 17% recall for a description that real skill loading triggered every time. `claude plugin eval` loads skills the way a session does, runs each case with and without the plugin, and works in CI, so it's the suite of record.

**skill-creator is preferred, not required.** If the skill-creator plugin is installed, building-skills uses it, since Claude Code keeps it updated; otherwise it uses the pinned copy in `vendor/` (the same content today). It isn't declared as a dependency: that would install a second skill competing for every request about skills, and the marketplace name differs between setups.

**Trust is asked, never assumed.** Evals run a plugin's hooks and scripts on your machine as you. `run-evals` passes `--trust-plugin` only with `--trust`, and the skills add that after you say yes, which is Claude Code's own rule for eval runs.

**Third-party skills live in `vendor/`, not `skills/`.** Everything under `skills/` becomes a skill, and six more skills about skills would compete with these for the same requests. In `vendor/` they are read when a Skillio skill needs them and never fight for triggering. See [vendor/README.md](vendor/README.md).

**Decoys make routing testable.** If a rival skill will compete for the same requests (skill-creator, the Claude app's built-in document skills, a browser skill), a decoy with its description is installed next to the skill under test in every eval case. A should-fire case then passes only if Claude picks your skill over the rival.

**Held-out cases decide.** Trigger cases tagged `held-out` are written after the description and never used to tune it. The linter flags descriptions that copy eval prompts, and fails outright when the copied prompt is held out.

**Working files stay outside the thing being worked on.** Drafts, eval runs, reports and snapshots go to a `<name>-workspace/` folder beside the skill or plugin, so nothing ends up packaged with a skill or committed to a plugin repo.

**Eval runs are isolated.** `run-evals` strips the messaging variables a parent session can pass to child sessions and turns off the Chrome extension for them, so an eval run can't touch your real browser or post into your conversation.

**No dependencies.** The CLI is plain Node, so the hook runs on every edit without an install step and nothing is fetched at run time.

**Explanations by default.** Every finding links to its section in `docs/principles.md`, and the skills report what, why and the plain-words version. Ask for terse output and they drop it.

## Skillio's own evals

Skillio is tested with its own tools. `evals/` holds 60 trigger cases across the three skills (35 should-fire, 25 near misses, 11 held out), generated from `evals/sets/*.json`, with a decoy carrying skill-creator's exact description installed next to them.

| Skill | Should fire (tuning) | Should fire (held out) | Near misses that stayed quiet |
| --- | --- | --- | --- |
| building-skills | 30/30 runs | 9/9 | 27/27 |
| checking-skills | 23/27 | 3/6 | 24/24 |
| improving-skills | 20/27 | 6/6 | 24/24 |

No false fires anywhere, and building-skills beat the skill-creator decoy in every run. The first run scored much lower, and the transcripts showed why: the eval runs had inherited a cloud session's environment, and some cases pointed at skills that didn't exist in the empty test folder. Both were fixed in the tooling and the cases, not in the descriptions. Two description rewrites were then measured against the originals and neither beat the noise, so the originals stayed. The remaining misses are small requests ("how good is my skill?") that Claude handles itself after reading the SKILL.md; say "use Skillio" or call the skill by name when you want the full treatment. The details are in [evals/RESULTS.md](evals/RESULTS.md).

Run them with `npm run evals:trigger` (tuning cases) and `npm run evals:held-out`. The full suite is 180 short sessions, about $11.

## Learning

Start with [docs/guide.md](docs/guide.md): what a skill is mechanically, why the description is a routing rule, what belongs in the body, how evals work and how to improve without fooling yourself. Every section ends with an "In simple terms" summary. [docs/principles.md](docs/principles.md) explains each check on its own.

## Credits

Skillio vendors and builds on work by others, each under its own license: Anthropic's [skill-creator](https://github.com/anthropics/skills) and [plugin-dev](https://github.com/anthropics/claude-plugins-official) (Apache-2.0), Jesse Vincent's [superpowers writing-skills](https://github.com/obra/superpowers) (MIT), softaworks' [skill-judge](https://github.com/softaworks/agent-toolkit) (MIT), Eoghan Henn's [task-observer](https://github.com/rebelytics/one-skill-to-rule-them-all) (CC-BY-4.0), and the [Agent Skills](https://github.com/agentskills/agentskills) specification and guides (CC-BY-4.0).

Skillio's own code is MIT. Contributing: see [AGENTS.md](AGENTS.md).
