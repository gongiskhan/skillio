# What makes a good skill

A guide to the ideas behind Skillio's checks. Every section has the detailed explanation first and an "In simple terms" summary at the end, so you can skim the summaries and read the detail where it matters. Rule ids like D006 point to [principles.md](principles.md), which explains each check on its own.

## Contents

1. What a skill is, mechanically
2. The description is a routing rule
3. The body: what Claude reads after it decides
4. References, scripts and assets
5. When a skill is the wrong tool
6. Evals: why and how
7. The lifecycle
8. Improving without fooling yourself
9. Surfaces: Claude Code, the Claude app, the API
10. The tool map
11. Lessons from measured skills
12. Glossary

## 1. What a skill is, mechanically

A skill is a folder with a `SKILL.md`: YAML frontmatter (at least `name` and `description`) and Markdown instructions, optionally with reference files, scripts and assets beside it. What makes skills different from a long prompt is how they load, in three levels:

1. **The listing.** Every installed skill's name and description sits in Claude's context from the start of every session, roughly a hundred words each. This is all Claude knows about the skill when it decides whether to use it.
2. **The body.** When Claude decides the skill is relevant, it calls the Skill tool and the full SKILL.md body enters the context.
3. **Everything else.** Reference files are read only when the body points to them and the task needs them. Scripts are run, and only their output costs tokens, not their code.

This is called progressive disclosure, and it's why a skill can carry a lot of knowledge cheaply: you pay level 1 always, level 2 when it fires, level 3 only for the part a task needs.

One consequence surprises people: Claude only reaches for a skill when the task is more than it can easily do alone. "Read this PDF" may not load a PDF skill however good the description, because Claude can just read it. Skills earn their place on tasks that need knowledge Claude lacks: your templates, your rules, a tricky format, a multi-step procedure.

**In simple terms.** A skill is a labelled binder. Claude sees every label all the time, opens a binder only when its label matches the job, and reads the appendices only when the binder says to. A good skill has a label that gets it opened at the right moments, a binder worth opening, and appendices that cost nothing until needed.

## 2. The description is a routing rule

The description decides whether the skill ever runs. Everything else in the skill is wasted if the description doesn't fire on the requests it should, or fires on ones it shouldn't.

**What and when.** Anthropic's authoring guide asks for both: what the skill does and when to use it. "Generates test plans" describes a capability; "Use when the user asks for a test plan, QA checklist or regression suite, or wants to know what to test before a release" describes the situations Claude will actually face. Claude matches requests against situations. (D001)

**The user's words.** Write it in the vocabulary of the people who'll trigger it. If your users say "board pack", a description about "executive reporting deliverables" won't fire. Include nouns, file types and situations, including ones where users don't name the domain at all ("even if they don't mention Excel").

**Third person.** The description is injected into Claude's system prompt; "Processes Excel files" reads as a fact about a tool, "I can help you" reads as a voice. The authoring guide says the shifting point of view hurts discovery. (D002)

**A little pushy.** Claude tends to under-trigger skills. skill-creator recommends descriptions that are "a little bit pushy": "Make sure to use this whenever the user mentions dashboards, even if they don't ask for a dashboard." (D003)

**Purpose, not procedure.** Don't summarise the steps in the description. obra's writing-skills found that an agent can follow the summary instead of loading the skill, skipping everything the summary left out. (D004)

**Boundaries.** Your skill competes with every other skill in the listing: built-in document skills in the Claude app, browser automation, other plugins. When two descriptions fit a request, Claude picks on wording, and the choice can change from one run to the next. Say what your skill doesn't cover and which skill does, and test it with a decoy (section 6). (C001)

**The listing has a budget.** Claude Code budgets the whole listing at about 1% of the context window and cuts each entry at 1,536 characters, so put the main use case first and don't pad. With many skills installed, trigger words at the end of long descriptions can disappear. (D007, C002)

**Don't memorise the test.** When a should-fire prompt misses, the tempting fix is to paste its wording into the description. The case then passes and the next phrasing still misses. Describe the intent the prompt represents. Held-out cases (section 6) are how you find out whether you've done this. (D006)

**In simple terms.** The description is the label on the binder. Write it in your users' words, say when to grab it, say what it isn't for, and keep the instructions inside the binder. Never write the test answers on the label.

## 3. The body: what Claude reads after it decides

**Only what Claude doesn't know.** Claude already knows what a deductible is, how to write Python and what a pull request is. It doesn't know your template, your thresholds, the order your team does things in, the quirk of your internal API, or which of five approaches you've settled on. Every paragraph should earn its tokens; a paragraph Claude would have written itself costs on every run and teaches nothing. skill-judge calls this the knowledge delta and makes it the most important dimension. (Rubric dimension 1)

**Reasons over rules.** "NEVER use relative imports" gets followed in the cases you imagined. "Use absolute imports: the build tool resolves relative ones differently in tests, which caused the March outage" gets followed in cases you didn't imagine, because Claude can reason from the why. skill-creator calls all-caps MUST and NEVER a yellow flag. Keep capitals for the one or two real hard limits, each with its reason. (B007)

**Freedom matched to fragility.** Anthropic's analogy: a narrow bridge with cliffs on both sides needs guardrails; an open field needs only a direction. Where a mistake is costly or a format is fixed (a migration, a regulated document, a file another system imports), give exact steps, a template or a script. Where many answers are fine (writing, design, analysis), give goals and judgment and let Claude choose.

**Procedures that check themselves.** For multi-step work: a sequence, a checklist Claude can copy into its task list, and a feedback loop (run the validator, fix what it reports, run it again). For risky batch work, Anthropic's plan-validate-execute pattern: write a plan file, check it with a script, only then apply it.

**Match the form to the failure.** Different failures need differently shaped instructions, and the wrong shape makes things worse. obra's writing-skills tested this: when an agent breaks a rule under pressure, a firm prohibition plus a list of the excuses it uses works; when an agent produces the wrong shape of output, a prohibition list made it worse than no guidance at all, and a positive template ("the output is: A, then B, then C") fixed it. A missing element gets a required slot in the template; a conditional behaviour gets a condition on something observable.

**Failure cases.** Say what to do when input is missing, a file is broken or a service is down: ask one plain question, report what wasn't found, never invent a figure or a credential. Silent guessing is the most expensive bug a skill can have, because the output looks fine.

**In simple terms.** The binder should hold what Claude can't know, say why each rule exists, be strict only where mistakes hurt, check its own work, and say what to do when things go wrong.

## 4. References, scripts and assets

**References** hold detail most runs don't need: API docs, variants per framework, long examples. Link each one directly from SKILL.md with a line saying when to read it ("read forms.md only when the PDF has form fields"). Keep them one level deep: Claude may only preview files it reaches through other files, reading the first lines instead of the whole thing. Give files over 100 lines a contents list at the top. (B003, B004, B005, B010)

**Scripts** do what Claude shouldn't do in its head: parsing, arithmetic, reconciliation, validation, file generation. A script runs the same way every time, costs only its output in tokens, and turns a class of mistakes into an error message. Good skill scripts handle their own errors with messages Claude can act on ("column 'Premium' not found; columns are: ..."), declare their dependencies, and are called with their interpreter (`python3 scripts/x.py`) because packagers sometimes drop the executable bit. A useful signal from skill-creator: if every test run writes the same helper, ship that helper. (B009)

**Assets** are things used in the output: templates, fonts, logos. A real template beats a description of a format every time.

**Keep the folder clean.** Everything in it ships with the skill: no secrets, no `.DS_Store`, no README written for people, no large files you don't use. (P001 to P004)

**In simple terms.** Put rarely needed detail in appendices the binder points to directly, put anything mechanical in scripts, ship real templates, and don't pack anything Claude won't use.

## 5. When a skill is the wrong tool

- **Fixed steps on structured input**: a script, a hook or a scheduled job is cheaper and never improvises.
- **Access to a system**: that's a connector (MCP server). The skill can say how to use the connector; it can't replace it.
- **A rule for every session in a project**: AGENTS.md or CLAUDE.md, which load always, not when a description matches.
- **A one-off task**: just do it.
- **Something Claude already does well**: a skill adds tokens and a chance to misfire for no gain. Measure the baseline first.

**In simple terms.** Skills are for know-how that Claude lacks and needs sometimes. Always-on rules, system access and fixed pipelines have better homes.

## 6. Evals: why and how

**Why.** The same prompt can produce different behaviour on different runs. One good run proves little, and an edit that fixes one case can break another. Anthropic's authoring guide says to create evaluations before writing extensive documentation: run Claude on real tasks without the skill, note where it fails, write cases for those gaps, measure the baseline, then write the minimum that closes them.

**Layers.** Split what you check, and push every layer you can to code:

| Layer | Question | Graded by |
| --- | --- | --- |
| Triggering | Does it fire on real phrasing and stay quiet on near misses? | Whether the Skill tool was called |
| Process | Did it run the validator, ask for missing input, use the template? | Tool calls and their order |
| Structure | Right file, sections, columns, required text present, banned text absent? | Code over the file |
| Correctness | Do the figures match the source? | Code against expected values |
| Quality | Is it clear, right in tone, client-ready? | An LLM judge, or a person |
| Value | Time saved, how much people edit the output | Real use, not an eval run |

Output that varies doesn't mean grading has to vary. Most failures (a wrong number, a missing section, the wrong file type) are checkable by code.

**Trigger evals.** About 20 prompts: 8 to 10 that should fire, phrased the many ways real people phrase things (casual, with file names and backstory), and 8 to 10 near misses that share words with the skill but need something else. Near misses matter most: a description that fires on everything passes every should-fire case. Then 6 to 10 held-out prompts, written after the description is final and never used to tune it. When another skill competes for the same requests, a decoy (a stand-in skill with the rival's description) makes the routing decision part of the test. Run trigger cases with only the with-skill arm (`--ablation none`): a skill can't fire without its plugin, so the baseline arm adds cost and no information.

**Output evals.** A few realistic tasks with graders: the cheapest grader that can decide (file exists, regex on contents, tool used, tool order), and an LLM judge only for judgment. Good judge rubrics test one thing each, as PASS if / FAIL if, and allow "can't tell". Judges drift on long text and can't read binary files, so grade files with code. Use a judge other than the model under test when you can, so it isn't marking its own homework.

**Baseline and delta.** Every output case also runs without the skill. The delta is what the skill adds. A delta near zero means one of three things: the skill didn't fire (check the trigger indicator), it fired and Claude already did this well (the skill teaches nothing new, or the graders are too easy), or it helped in ways nothing grades (evidence, safety, consistency). Each has a different fix.

**pass@k and pass^k.** pass@k: at least one of k runs passed, fine when someone will retry. pass^k: all k passed, the honest number for a skill people use once and trust. A 90% per-run rate is only a 73% chance of three good runs in a row; 75% is 42%.

**Noise.** With 3 runs per case, one run is a third of that case's score. Before calling a change an improvement, know how much two runs of the unchanged skill differ (the noise floor), and want the gain to show on the held-out cases too.

**Read the transcripts.** Scores say that something failed. Transcripts say why, and they're where unfair graders, broken fixtures and wrong expectations show up. Anthropic's eval guidance says grading mistakes are among the most common ways an eval is misconfigured.

**Isolation.** Each eval run should see only what a fresh user session would. `claude plugin eval` gives every run an empty home and working folder with only the plugin under test. Skillio also turns off the Chrome extension and messaging for child runs, because early runs in one project could reach the user's real Chrome and one posted a progress message into the live conversation.

**In simple terms.** Test whether the skill gets picked (including when it shouldn't be), test what it produces against plain Claude, check with code wherever there's a right answer, keep some test questions back, run everything more than once, and read what actually happened before believing a number.

## 7. The lifecycle

1. **Brief**: who uses it, how they ask, real examples, near misses, what done means.
2. **Baseline**: run real tasks without a skill and note the failures.
3. **Draft** with skill-creator: the smallest skill that fixes the observed gaps.
4. **Lint**: the cheap mechanical checks, continuously (Skillio's hook does this on every edit).
5. **Eval suite**: trigger set, held-out set, decoys, output cases.
6. **Iterate**: read transcripts, change one thing, re-run.
7. **Independent review**: someone (or an agent) that didn't write it reads it cold.
8. **Ship**: validate, package, and for the Claude app, a manual smoke test there.
9. **Observe**: log misses and corrections from real use.
10. **Improve**: turn repeated observations into cases, then fixes.

Skillio maps onto it: building-skills covers 1 to 8, checking-skills is 4, 5 and 7 on demand, improving-skills is 6, 9 and 10.

**In simple terms.** Find out what Claude gets wrong, write the least that fixes it, prove it with tests, let someone else read it, ship it, and keep notes on what goes wrong in real use.

## 8. Improving without fooling yourself

The loop is: evidence, a hypothesis, one change, a re-measure, keep or revert. Each part guards against a specific way of fooling yourself.

- **Evidence first**, because a single bad run often has a different cause from the one it seems to have (the prompt was trivial, the grader was wrong, the network failed).
- **One change at a time**, so the next run tells you what the change did.
- **Snapshot before changing**, so "better" is measured against the real previous version, and you can go back.
- **Turn failures into cases before fixing**, so the fix stays fixed.
- **Prefer deleting** over adding: shorter skills are followed more closely, and many failures come from instructions that contradict or bury each other.
- **Held-out cases decide**, because the cases you looked at while editing will always improve.
- **Automated loops** (Karpathy's autoresearch pattern, skill-creator's description optimiser, Anthropic's `/claude-api hillclimb`) are fine with guard rails: frozen graders, a fixed train and held-out split, a known noise floor, and a person approving the result. A loop that can edit its own grader will improve the grader.

**In simple terms.** Change one thing, measure it on questions you didn't peek at, keep it only if it really helped, and write down what you tried.

## 9. Surfaces: Claude Code, the Claude app, the API

| | Claude Code | Claude app | API |
| --- | --- | --- | --- |
| Where skills live | `~/.claude/skills`, `.claude/skills`, plugins | Uploaded or provisioned by an org | Uploaded via `/v1/skills` |
| Frontmatter | Spec fields plus Claude Code extras (`when_to_use`, `disable-model-invocation`, `context`, `model`, `paths`...) | Spec fields only | Spec fields only |
| Runtime | Your machine, your tools | A Linux sandbox; can install packages | A Linux sandbox; no network, no runtime installs |
| Competing skills | Your other skills and plugins | Built-in docx, xlsx, pptx, pdf skills and org skills | What you load |
| Automated testing | `claude plugin eval` | None first-party; test in Claude Code, then by hand in the app | Your own harness, or `/claude-api build-eval` |

A skill meant for the app should pass Skillio's lint with `--target claude-ai`, be tested in Claude Code as a proxy, and be smoke-tested in the app before anyone relies on it. Case-sensitive paths matter there: the app runs on Linux.

**In simple terms.** Same skill format, three different homes with different rules. Build and test where testing is easy, then check it in the place it will actually live.

## 10. The tool map

Claude Code ships most of the tools a skill needs. Skillio runs them for you and fills the gaps between them.

| Tool | What it does | Where Skillio uses it |
| --- | --- | --- |
| skill-creator (Anthropic plugin) | Interviews, drafts, runs each test case in a clean subagent with and without the skill, grades assertions with evidence, blind A/B between versions, review viewer, packaging | building-skills step 1. The installed plugin when there is one (`/plugin install skill-creator@...`), else Skillio's pinned copy |
| `claude plugin validate` | Claude Code's loader checks on a plugin, a marketplace, or the skills, agents and commands in any folder (`claude plugin validate .claude/skills`): frontmatter that won't parse, wrong field types, manifest errors. `--strict` fails on warnings, `--json` for CI, `--profile directory` for Anthropic's plugin directory | Every check, and the edit hook after each SKILL.md or manifest edit |
| `/plugin validate` | The same report inside a session | Mentioned to you; Skillio runs the CLI |
| `claude plugin details` | Projected context cost: always-on (the listing) and on-invoke, per component | Every check, in the report |
| `claude plugin eval` | Runs cases several times in isolated sessions, with and without the plugin, scores both, exits non-zero below a threshold (CI) | The suite of record for triggering and output (`skillio run-evals`) |
| `claude plugin eval init` | An interview that proposes cases and graders, writes them, and pilots them with you until the graders score the way you would | Output cases (`skillio eval-init`); Skillio's trigger-case generator covers triggering |
| `claude plugin init <name> --with skills` | Scaffolds a personal plugin in `~/.claude/skills/<name>/` that loads next session | building-skills step 0 |
| `/claude-api prompt-audit <path>` | Finds instructions written for older models in a skill, agent or prompt and proposes a diff | `skillio audit`, in checking and improving |
| `/doctor prompt-audit` | The same for the whole setup Claude Code loads: CLAUDE.md files, rules, skills, including conflicts between them | `skillio audit --scope both` for skills installed in a project or `~/.claude/skills` |
| `/skill-doctor` | Every skill loaded in your real setup, its context cost and use counts | Every check |
| `/claude-api build-eval`, `hillclimb` | Builds an eval for an app that calls the API, then improves the app against it with train/test splits and auto-revert | Suggested for skills that run inside such an app |
| Skillio lint | Spec limits, description quality, references, case mismatches, secrets, eval overfitting | Every check and every edit (hook) |
| writing-skills (obra/superpowers) | Test-driven skill writing, pressure tests, matching the form of guidance to the failure | improving-skills; vendored |
| skill-judge (softaworks) | A 120-point design rubric | The reviewer agent's rubric borrows from it; vendored |
| task-observer (rebelytics) | An always-on skill that logs corrections during real work and proposes skill updates weekly | improving-skills borrows the method; vendored, install separately to run it |
| Agent Skills spec and guides | The open standard and its guides on evaluating and optimising descriptions | Reference; vendored |
| skills-ref (agentskills) | The standard's reference validator; its README says demonstration only | Not used; Skillio's lint covers the same rules |

`skillio tools` shows which of these the current machine can run. Where Claude Code isn't installed (another editor, a CI box without it), Skillio runs what doesn't need it (its linter, overlap and suite checks, skill-creator and its validator, packaging) and the report lists what it couldn't cover.

**Why run several validators.** They disagree, and each disagreement is information. Skillio's test fixture `bad-skill` has the name `Bad_Skill_for_claude` and a description with an unquoted colon. `claude plugin validate` passes it, because Claude Code's loader is lenient: it reads the colon fine and doesn't check name format. skill-creator's validator rejects it, because the Claude app's uploader parses YAML strictly. Skillio's linter flags the name (it breaks the open standard and uses a reserved word) and warns about the colon. A skill only for Claude Code can live with the lenient verdict; one headed for the app has to pass the strict one.

**Why a prompt audit, when there is already a reviewer.** The reviewer scores the skill against an authoring rubric. The audit asks a narrower question: which lines were written for a model that is no longer the one reading them? Pressure language, "think step by step" and workarounds for retired models make current models rigid or even refuse. The two overlap a little and catch different things; the first audit of Skillio itself found five stale commands and two history paragraphs the rubric would not have flagged.

Not worth your time, from the October 2026 research: third-party eval wrappers that `claude plugin eval` now replaces, 1-to-5 Likert judges (use binary checks), hosted eval platforms for work data you can't send out, and community "autoresearch for skills" loops without held-out sets or frozen graders.

**In simple terms.** Claude Code's own tools (skill-creator, validate, details, plugin eval and its interview, the prompt audits, skill-doctor) do the heavy lifting, and they check a skill the way Claude Code will load it. Skillio runs all of them in the right order, adds the checks they don't do, and still works, with less, where Claude Code isn't installed.

## 11. Lessons from measured skills

From building and evaluating a web-app testing skill with plugin eval in October 2026, 40 trigger prompts, 6 output cases, a code grader and a separate judge model:

1. **Measure triggering with real skill loading.** skill-creator's optimiser tests descriptions as slash commands; it scored 17% recall for a description that real loading triggered every time.
2. **Keep a held-out set and never quote it.** Quoting missed prompts gave 20 of 20 on the tuning set and 4 of 6 on new wording.
3. **Test routing against the competition.** A decoy with the rival skill's description makes "did it pick us" measurable.
4. **Code for what has a right answer, a stronger model for what needs reading.** Mutation testing said more about test quality than any judge; the judge caught the one false claim no code could. Reading transcripts found four harness bugs neither did.
5. **Mapping free text to ground truth is a judge task.** Regexes over bug reports gave false positives both ways; a blind mapping by the judge, scored in code, worked.
6. **Isolate every run.** Own port, workspace outside the lab, no connectors, no browser extension, a fixed tool list.
7. **A clean fixture never is.** Both arms found real bugs nobody planted, so scoring has to allow for them.
8. **Fix the expectation when it's wrong**, and keep the old result visible.
9. **The skill's value wasn't finding more bugs.** Plain Opus found most of them. The skill added evidence, honest claims, credential safety and tests that kept the suite green, and the evals had to grade those or they'd have shown a small delta and undersold it.

And one from building Skillio itself: run from inside a cloud Claude Code session, eval runs inherited variables saying they were remote sessions, and there Claude told users it couldn't create skills at all. Building-skills fired in 1 of 3 runs on a plain "make this a skill" request; with those variables stripped, 3 of 3. Only the transcripts showed it; the score alone would have sent the description through pointless rewrites. `skillio run-evals` now strips them. The same transcripts showed a second problem in the cases themselves: prompts like "check my release-notes skill" ran in an empty folder, so Claude searched, found nothing and stopped before choosing a skill. Fixtures that create the skill the prompt mentions fixed that. After both fixes, two careful description rewrites measured within noise of the originals, and the originals stayed (evals/RESULTS.md has the numbers).

**In simple terms.** Test the way it will really be used, keep some tests secret from yourself, check against the real competition, use code where you can and judgment where you must, and grade what the skill is actually for.

## 12. Glossary

- **Assertion**: one yes-or-no check on an output.
- **Baseline**: the same case run without the skill (or with the previous version).
- **Decoy**: a stand-in skill with a rival's description, used to test routing.
- **Delta (Δ)**: score with the skill minus score without it.
- **Grader**: what applies assertions: code, a judge model or a person.
- **Held-out set**: cases never used while tuning; the honest test of generalisation.
- **Knowledge delta**: what the skill tells Claude that Claude didn't know.
- **Near miss**: a request that shares words with the skill but needs something else.
- **Noise floor**: how much the score moves between runs of the same skill.
- **pass@k / pass^k**: at least one of k runs passed / all k passed.
- **Progressive disclosure**: listing, then body, then references, loaded only as needed.
- **Trigger rate**: share of should-fire runs where the skill loaded; false-fire rate is the same for near misses.
