# Skill principles

One section per check Skillio runs. Each says what the check looks for, why it matters (with the source when there is one), the same thing in plain words, and how to fix it. The linter's messages link here, so this file doubles as a reference you can learn from one finding at a time. For the bigger picture, read [guide.md](guide.md).

Sources, cited by short name below:

- **Authoring guide**: Anthropic, [Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices).
- **Claude Code docs**: [Skills](https://code.claude.com/docs/en/skills), [Plugins](https://code.claude.com/docs/en/plugins/manifest-reference), [Plugin evals](https://code.claude.com/docs/en/plugin-evals).
- **Spec**: the [Agent Skills specification](https://agentskills.io/specification), vendored in `vendor/agentskills-docs`.
- **skill-creator**: Anthropic's skill for writing skills, vendored in `vendor/skill-creator`.
- **writing-skills**: obra/superpowers, vendored in `vendor/superpowers-writing-skills`.

## Contents

- Spec and loading: S001 to S013
- Description: D001 to D007
- Body and references: B001 to B012
- Package hygiene: P001 to P004
- Routing: C001, C002
- Evals: E001 to E004
- External validators: V000, V001

## Spec and loading

These decide whether the skill loads at all, and whether it loads the same way everywhere it's used.

### S001 SKILL.md is missing

**What it checks.** The folder has a file named exactly `SKILL.md`.

**Why it matters.** A skill is defined by that file. Claude Code, the Claude app and the API all look for it by name; a `skill.md` or `README.md` is ignored.

**In plain words.** No SKILL.md, no skill.

**How to fix.** Create `SKILL.md` with frontmatter (`name`, `description`) and instructions.

### S002 No YAML frontmatter

**What it checks.** SKILL.md starts with a `---` line, a block of YAML, and a closing `---` line.

**Why it matters.** The frontmatter holds the name and description, the only parts Claude sees before deciding to use the skill. Claude Code requires it to start on the first line.

**In plain words.** The skill's label is missing, so nothing knows what it's for.

**How to fix.** Start the file with `---`, then `name:` and `description:`, then `---`.

### S003 Frontmatter is not valid YAML

**What it checks.** The frontmatter parses.

**Why it matters.** When it doesn't parse, the name and description you wrote are lost: the skill either fails to load or loads without them, and `claude plugin validate ~/.claude/skills` is the documented way to find such files.

**In plain words.** The label is smudged, so Claude reads the wrong thing or nothing.

**How to fix.** Read the error's line number. Usual causes: a tab for indentation, an unclosed quote, a colon inside an unquoted value.

### S004 Unquoted value that strict YAML parsers reject

**What it checks.** A plain (unquoted) value containing `: ` or ` #`.

**Why it matters.** `description: Use when: the user...` is invalid YAML. Some loaders forgive it; strict parsers (PyYAML, the Spec's reference validator, Claude app uploads) reject the file, and ` #` silently cuts the rest of the value off as a comment. The skill works on one surface and fails on another.

**In plain words.** It works on your machine and breaks on upload.

**How to fix.** Quote the value, or use a folded block: `description: >-` with the text indented on the next lines.

### S005 Name is missing or badly formed

**What it checks.** `name` exists and is 1 to 64 characters of lowercase letters, digits and single hyphens, not starting or ending with a hyphen.

**Why it matters.** The Spec and the authoring guide set these rules, and the Claude app and API enforce them on upload. Claude Code falls back to the folder name, which hides the problem until you upload.

**In plain words.** The name has to be short, lowercase and dash-separated, or some places won't accept it.

**How to fix.** Use the folder name, lowercase with hyphens. The authoring guide prefers gerunds: `processing-pdfs`, `reviewing-contracts`.

### S006 Name uses a reserved word

**What it checks.** The name contains "anthropic" or "claude".

**Why it matters.** Both words are reserved by the Claude app and API, which reject such names. They also read as official, which a personal skill isn't.

**In plain words.** Those two words are taken.

**How to fix.** Rename to describe the task, not the model.

### S007 Name does not match the folder name

**What it checks.** `name` equals the folder name.

**Why it matters.** The Spec requires it. In Claude Code the `name` becomes the command (`/plugin:name`), so a mismatch means the command and the folder you edit have different names, which confuses everyone looking for the file.

**In plain words.** The label on the box should match the box.

**How to fix.** Rename one of them.

### S008 Description is missing

**What it checks.** `description` exists and is not empty.

**Why it matters.** The description is the only text Claude reads when deciding whether a skill is relevant. Without it, Claude Code uses the first line of the body, which is rarely written to trigger anything, and the Claude app rejects the upload.

**In plain words.** Claude can't pick a tool it can't describe.

**How to fix.** Write one or two sentences: what the skill does, and when to use it.

### S009 Description is over 1,024 characters

**What it checks.** Length of `description`.

**Why it matters.** The Spec and the Claude app cap it at 1,024 characters and reject longer ones. Long descriptions also crowd the skill listing every session pays for.

**In plain words.** Too long to fit on the label.

**How to fix.** Cut repeated synonyms and long trigger-phrase lists first. Keep the main use case and the boundary with rival skills.

### S010 Description contains angle brackets

**What it checks.** `<` or `>` in the description.

**Why it matters.** The authoring guide forbids XML tags in the name and description, and uploads reject them; angle brackets look like tags to the parser that builds the skill listing.

**In plain words.** Brackets confuse the system that reads the label.

**How to fix.** Write "less than", or use parentheses.

### S011 Unknown frontmatter field

**What it checks.** Keys that neither the Spec nor Claude Code reads.

**Why it matters.** Claude Code ignores unknown fields without a warning, so a misspelt `allowed_tools` or a made-up `triggers:` does nothing while looking like configuration. The Claude app's upload rejects any field outside the Spec.

**In plain words.** That setting isn't connected to anything.

**How to fix.** Fix the spelling, or move custom data under `metadata:`, which every surface accepts and ignores.

### S012 Field not portable to the Claude app or API

**What it checks.** Claude Code fields (`when_to_use`, `disable-model-invocation`, `context`, `model`, `paths` and others) in a skill meant for the Claude app or API.

**Why it matters.** The Claude app and API accept only the Spec's fields: `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools`. An upload with anything else fails.

**In plain words.** Claude Code understands that setting; the Claude app refuses the file because of it.

**How to fix.** For a skill that ships to both, keep Claude Code fields out, or keep two builds. Put trigger text in `description`, not `when_to_use`.

### S013 Frontmatter field has the wrong type

**What it checks.** Booleans that aren't booleans, `context` other than `fork`, `effort` outside its values, lists that aren't lists.

**Why it matters.** Claude Code reads these fields to change behaviour. A value it can't read is ignored silently, so `disable-model-invocation: "sometimes"` leaves the skill auto-invocable.

**In plain words.** The setting is there but filled in wrong, so it's ignored.

**How to fix.** Use the type in the message.

## Description

The description is a routing rule. It sits in Claude's context in every session, next to every other skill's description, and Claude picks a skill from that list on wording alone. Most skills that "don't work" are skills that never load.

### D001 Description says what, but not when

**What it checks.** The description has no trigger clause: "Use when...", "Use this whenever...", "when the user...".

**Why it matters.** The authoring guide asks for both what the skill does and when to use it. Claude matches requests against situations; a list of capabilities ("generates test plans") is matched less reliably than a situation ("use when the user asks for a test plan, QA checklist or regression suite").

**In plain words.** Tell Claude when to reach for it, not only what it is.

**How to fix.** Add a sentence naming the situations, words, inputs and file types that should trigger it.

### D002 Description is not in the third person

**What it checks.** "I can", "you can", "lets you" and similar.

**Why it matters.** The description is injected into Claude's system prompt. The authoring guide says a shifting point of view there causes discovery problems; "Processes Excel files" reads as a fact about a tool, "I can help you with Excel" reads as someone talking.

**In plain words.** Describe the tool, don't have it introduce itself.

**How to fix.** "Extracts...", "Builds...", "Use when the user...".

### D003 Description is too short to trigger reliably

**What it checks.** Under 80 characters.

**Why it matters.** Claude tends to under-trigger skills (skill-creator says so and recommends descriptions that are "a little bit pushy"). A short description has few words for a request to match.

**In plain words.** Too few clues for Claude to recognise when it's needed.

**How to fix.** Name the task, the inputs, the outputs and the words users actually type.

### D004 Description summarises the workflow

**What it checks.** Step language in the description ("first... then...", "step 1").

**Why it matters.** writing-skills reports that an agent reading a workflow summary in the description may follow the summary instead of loading the skill, and skip everything the summary left out.

**In plain words.** The label shouldn't be a short version of the instructions, or Claude follows the short version.

**How to fix.** Keep purpose and triggers in the description; keep the steps in the body.

### D005 Description uses vague words

**What it checks.** "Helps with", "various", "stuff", "etc.", "and more".

**Why it matters.** Vague words match everything and nothing. They raise false fires and add no trigger signal.

**In plain words.** "Helps with documents" could mean anything.

**How to fix.** Replace with the concrete tasks and nouns.

### D006 Description copies an eval prompt

**What it checks.** Six or more consecutive words shared between the description and a trigger case's prompt.

**Why it matters.** Pasting a missed prompt into the description makes that case pass and tells you nothing about the next phrasing. The Spec's description guide calls it overfitting. In one measured skill, quoting missed prompts took the tuning set to 20 of 20 while new wordings stayed at 4 of 6. If the copied prompt is in the held-out set, the held-out score is no longer an independent test, so that case is an error.

**In plain words.** You taught it the answers to the test.

**How to fix.** Describe the intent behind the prompt in general words. Pick descriptions by held-out score.

### D007 Description gets cut off in the skill listing

**What it checks.** `description` plus `when_to_use` over 1,536 characters.

**Why it matters.** Claude Code truncates each skill's entry in the listing at 1,536 characters, so the end never reaches Claude. The listing as a whole is budgeted at about 1% of the context window.

**In plain words.** The end of the label is cut off before Claude reads it.

**How to fix.** Put the main use case first and trim the rest.

## Body and references

After the skill fires, Claude reads SKILL.md in full, then whatever it points to. Everything in the body costs tokens on every use.

### B001 SKILL.md body is over 500 lines

**What it checks.** Body length.

**Why it matters.** The authoring guide and skill-creator both say to keep SKILL.md under 500 lines and move detail into reference files. Long bodies are followed less closely and load material most runs don't need.

**In plain words.** The manual is too long to follow every time.

**How to fix.** Keep the workflow and the essentials in SKILL.md; move references, examples and edge cases into files linked with a line saying when to read each.

### B002 SKILL.md body is token-heavy

**What it checks.** Roughly 5,000 tokens or more in the body.

**Why it matters.** The body loads in full every time the skill fires. Skills share the context window with the conversation and the task.

**In plain words.** Every use pays for every word.

**How to fix.** Same as B001; also cut explanations of things Claude already knows.

### B003 Link to a file that does not exist

**What it checks.** Links and paths in SKILL.md (and links in the files it references) that don't resolve, including case mismatches like `FORMS.md` versus `forms.md`.

**Why it matters.** Claude follows the path, fails, and either guesses or wastes turns searching. Case mismatches work on macOS and Windows and fail on Linux, where the Claude app and API run skills. Anthropic's own pdf skill in the public anthropics/skills repo refers to FORMS.md and REFERENCE.md while the files are lowercase.

**In plain words.** The instructions point to a page that isn't there.

**How to fix.** Fix the path or add the file. If the path is only an example in prose, put it in a code block.

### B004 Reference chain deeper than one level

**What it checks.** A file linked from SKILL.md links on to another local file that SKILL.md doesn't link.

**Why it matters.** The authoring guide: keep references one level deep, because Claude may only preview files reached through other files (reading the first lines instead of the whole file), so it gets partial information.

**In plain words.** Don't hide important pages behind other pages.

**How to fix.** Link every reference file directly from SKILL.md.

### B005 Long reference file without a table of contents

**What it checks.** A reference file over 100 lines with no contents list at the top.

**Why it matters.** The authoring guide recommends a table of contents for reference files over 100 lines: if Claude previews only the top of the file, it still sees everything that is there and can read the part it needs.

**In plain words.** Put a contents page at the front of long documents.

**How to fix.** Add a "Contents" list of the sections.

### B006 Windows-style path

**What it checks.** Backslashes in file paths.

**Why it matters.** Forward slashes work everywhere; backslashes only on Windows. The authoring guide's checklist includes "no Windows-style paths".

**In plain words.** Use `/` in paths.

**How to fix.** Replace `\` with `/`.

### B007 Many all-caps commands

**What it checks.** Eight or more MUST, NEVER, ALWAYS, CRITICAL, IMPORTANT.

**Why it matters.** skill-creator calls all-caps rules a yellow flag: current models follow reasons better than volume, and a skill where everything is CRITICAL has no priorities. A hard limit with its reason works; a wall of capitals generalises badly to cases the author didn't foresee.

**In plain words.** Shouting everything means nothing stands out. Explain why instead.

**How to fix.** Keep capitals for the one or two real hard limits, each with its reason. Rewrite the rest as explanations.

### B008 Time-sensitive wording

**What it checks.** "As of 2025", "currently", "the latest version", "recently released".

**Why it matters.** Skills outlive the moment they were written. The authoring guide says to avoid time-sensitive information, or to keep it in a clearly marked "old patterns" section.

**In plain words.** "New" stops being new; the skill keeps saying it.

**How to fix.** State the fact without a date, or say which version it applies to.

### B009 Script called without its interpreter

**What it checks.** Instructions to run `scripts/x.sh` or `scripts/x.py` by bare path.

**Why it matters.** writing-skills notes that some packagers drop the executable bit, so a bare path fails with "Permission denied". Naming the interpreter also tells Claude what the script needs.

**In plain words.** Say "python3 scripts/x.py", not just "scripts/x.py".

**How to fix.** Prefix with `bash`, `python3` or `node`.

### B010 File that nothing points to

**What it checks.** Files in the skill folder never mentioned by SKILL.md or the files it links.

**Why it matters.** Claude only reads files it's told about. An unmentioned file is never used, or is found by accident and used at the wrong time. Either way it ships with the skill and costs upload size.

**In plain words.** A page in the binder that the instructions never mention.

**How to fix.** Mention it with a line saying when to use it, or delete it.

### B011 Body is nearly empty

**What it checks.** Fewer than five non-empty lines after the frontmatter.

**Why it matters.** If the description triggers the skill, Claude loads instructions that say almost nothing, and does what it would have done anyway.

**In plain words.** The label promises a manual that isn't there.

**How to fix.** Write the procedure, or reconsider whether this should be a skill.

### B012 Placeholder text left in

**What it checks.** TODO, TBD, FIXME, XXX, lorem ipsum.

**Why it matters.** Claude reads everything in the body as instruction. "TODO: add error handling" gets read as a task.

**In plain words.** Notes to yourself become orders to Claude.

**How to fix.** Finish the section or remove the placeholder.

## Package hygiene

Everything in the skill folder ships with the skill: uploaded, shared, installed, scanned.

### P001 Possible secret in the skill folder

**What it checks.** API keys, tokens, private keys and hard-coded passwords.

**Why it matters.** Skills are shared and uploaded; Anthropic scans uploaded skills and org admins review them. A key in a skill is a leaked key.

**In plain words.** Don't ship your keys inside the toolbox.

**How to fix.** Read credentials from the environment or a secret store at run time, and rotate any key that was committed.

### P002 Junk files in the skill folder

**What it checks.** `.DS_Store`, `__pycache__`, `node_modules`, `.env`, logs.

**Why it matters.** They ship with the skill, bloat uploads and can leak local data (`.env` especially).

**In plain words.** Clean the box before you send it.

**How to fix.** Delete them and add them to `.gitignore`.

### P003 Human docs inside the skill folder

**What it checks.** README, CHANGELOG, INSTALL or CONTRIBUTING at the skill's root.

**Why it matters.** Everything in the folder is there for Claude, and Claude reads only what SKILL.md points to. A README written for people ships with every install without being read, or gets read by accident and adds noise to the task.

**In plain words.** Notes for people go next to the skill, not inside it.

**How to fix.** Move them beside the skill folder (or to the plugin's root), unless SKILL.md tells Claude to read them.

### P004 Large files in the skill folder

**What it checks.** Files over 2 MB, or more than 8 MB in total.

**Why it matters.** Uploads to the Claude app have size limits, and every install copies the folder.

**In plain words.** Heavy boxes are slow to ship.

**How to fix.** Fetch large assets at run time, compress them, or keep only what the skill uses.

## Routing

### C001 Description overlaps another skill

**What it checks.** Word overlap between this skill's description and every other skill Claude Code would load (personal, project, plugins), plus siblings in the same plugin. Above 0.35 is a warning, 0.25 to 0.35 a note.

**Why it matters.** When two descriptions fit a request, Claude picks on wording, and the choice can flip between runs. The usual report is "it used the wrong skill". The check is lexical, so it misses synonyms and flags shared jargon; treat it as a list of rivals to test against, not a verdict.

**In plain words.** Two tools with similar labels: Claude may grab the wrong one.

**How to fix.** Say in each description what the other is for. Add a decoy trigger case so the boundary stays tested.

### C002 Many skills installed

**What it checks.** Total size of every model-invocable skill's listing entry.

**Why it matters.** Every installed skill's description sits in context in every session. Claude Code budgets the listing at about 1% of the context window and shortens entries beyond it, so trigger words late in long descriptions can disappear.

**In plain words.** Too many labels on the shelf, so some get trimmed.

**How to fix.** Run `/skill-doctor` to find skills you never use, and turn them off or set `disable-model-invocation: true` on skills you only run by name.

## Evals

### E001 No eval suite found

**What it checks.** `claude plugin eval` cases that test this skill.

**Why it matters.** The authoring guide: create evaluations before writing extensive documentation. Without cases, a change can't be told apart from an improvement, and "it works" means it worked once. skill-creator's `evals/evals.json` doesn't count here: plugin eval doesn't read it.

**In plain words.** Untested means you're hoping, not knowing.

**How to fix.** Build a trigger set and output cases (building-skills, step 3).

### E002 Eval suite has no should-not-trigger cases

**What it checks.** Should-fire cases exist and near misses don't.

**Why it matters.** A description that fires on everything passes every should-fire case. Only near misses (requests that share words with the skill but need something else) catch an over-broad description. skill-creator: "the most valuable ones are the near-misses".

**In plain words.** You tested that it answers, not that it stays quiet when it should.

**How to fix.** Add 8 to 10 near misses with `max: 0` Skill graders.

### E003 Eval suite has no held-out cases

**What it checks.** No case tagged `held-out`.

**Why it matters.** Every case you looked at while editing the description is a tuning case. A held-out set (the Spec's guide suggests about 40%) is the only measure of whether the description generalises.

**In plain words.** Keep some questions back for the real exam.

**How to fix.** Write 6 to 10 new prompts after the description is final; tag them `held-out`; don't tune on them.

### E004 Eval suite is small

**What it checks.** Fewer than 10 trigger cases.

**Why it matters.** With 3 runs per case and few cases, one flaky run moves the score by 10 points or more, so real changes and noise look alike.

**In plain words.** Too few questions to tell luck from skill.

**How to fix.** Grow to about 20 (8 to 10 each way), as skill-creator does.

## External validators

### V000 claude plugin validate

**What it checks.** Claude Code's own loader checks: the manifest, component frontmatter, paths, hooks and MCP entries, plus the plugin directory's listing checks (README, license, icon).

**Why it matters.** It's the authoritative answer to "will Claude Code load this". The directory checks only matter if you submit the plugin to Anthropic's directory.

**In plain words.** Claude Code's own inspection.

**How to fix.** Follow the message; `claude plugin validate <path>` shows the full text.

### V001 skill-creator validator

**What it checks.** skill-creator's `quick_validate.py`: the Claude app's upload rules (allowed fields, name format, description length, no angle brackets).

**Why it matters.** It's stricter than Claude Code. Failing it doesn't matter for a skill that only lives in Claude Code; it does for one you'll upload.

**In plain words.** The Claude app's inspection.

**How to fix.** Follow the message, or ignore it for Claude Code-only skills.
