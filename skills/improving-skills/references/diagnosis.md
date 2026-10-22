# Diagnosis

## Contents

- Triggering failures
- Execution failures
- Output failures
- Cost failures
- When the eval is the problem

For each failure: what you see, how to confirm the cause, and the fix that matches it. Confirm before fixing; the same symptom often has two causes with opposite fixes.

## Triggering failures

**Doesn't fire on real phrasing.** The `tool_used: Skill` indicator fails on should-fire cases.
Confirm: is the prompt substantive? Claude skips skills for requests it can do alone ("read this PDF"), so a trivial prompt is a bad case, not a bad description. If the prompt is fine, compare its words with the description's: users say "board summary", the description says "executive reporting deck".
Fix: add the user's vocabulary for the intent, the inputs (file types, systems) and the situations. Put the main use case first, since Claude Code cuts long listings. Make it a little pushy ("use this whenever..., even if they don't say X"), because Claude tends to under-trigger.

**Fires on near misses.**
Confirm: which words of the near miss match the description? Usually a broad noun ("documents", "data", "files").
Fix: narrow the noun, and add what the skill does not cover with the skill that does ("not for editing existing Word files; use docx for that").

**Loses to another skill** (a decoy case fails, or the user sees the wrong skill load).
Confirm: `skillio collisions <path>` shows the overlap score and the shared words.
Fix: draw the boundary in both descriptions when you own both; otherwise make yours specific enough to win on its cases and say when to prefer it. Keep the decoy case so the boundary stays tested.

**Fires on tuning prompts, misses held-out ones.** Overfitting.
Confirm: the description contains phrases from tuning prompts (lint rule D006).
Fix: replace quoted phrasing with the intent it stands for. Pick the description by held-out score, not tuning score.

## Execution failures

**Loads, then skips a step.**
Confirm in the transcript: did Claude read the step and decide against it (it says why), never get to it (the step is late in a long body), or follow a reference file that contradicts it?
Fix: give the reason; move the step earlier or into a checklist Claude copies into its task list; remove the contradiction. Repeating the rule in capitals rarely helps.

**Breaks a rule under pressure** (time pressure, a user pushing, a long task).
Confirm: the transcript shows the rationalisation ("this is a simple case, so...").
Fix: state the rule firmly with its reason, list the rationalisations you saw as red flags, and test with a pressure scenario. `${CLAUDE_PLUGIN_ROOT}/vendor/superpowers-writing-skills/references/bulletproofing.md` covers this form in depth.

**Reads files it shouldn't, or reads everything.**
Confirm: the transcript shows reads of every reference file up front.
Fix: say when each reference is needed ("read forms.md only when the PDF has form fields"), and keep references one level deep.

**Guesses when input is missing.**
Fix: tell it what to do: ask one plain question and continue, or report "not found in the source". Never let it invent credentials, figures or file contents.

## Output failures

**Wrong shape** (sections missing, extra preamble, buried answer).
Fix: show the output as a template with its parts in order. Prohibition lists ("don't add a summary") make shape problems worse.

**Inconsistent across runs.**
Confirm: diff two runs' outputs; find where they diverge.
Fix: the instruction at that point allows several readings. Pin it with an example, a template slot or a script.

**Wrong numbers, broken files.**
Fix: move parsing, arithmetic and validation into a script that prints specific errors, and make the skill run it and fix what it reports before finishing (validate, fix, re-run).

**Correct but not better than plain Claude** (delta near zero with the skill firing).
Fix: find what the skill adds that Claude lacks (house rules, templates, domain decisions). If nothing, the skill may not need to exist; say so.

## Cost failures

**Long runs, high tokens.**
Confirm: the transcript shows exploration the skill could have prevented, or a body full of material most runs don't use.
Fix: move rarely needed material to references, bundle a script for work every run repeats (skill-creator's tip: if every test run wrote the same helper, ship it), and cut explanations of things Claude knows.

## When the eval is the problem

Before changing the skill, rule out the eval:

- The grader checks the wrong thing (a regex that matches the prompt echo, a file grader pointed at `files` instead of contents).
- The expectation is wrong (requiring a report from a run that should stop and ask).
- The case leaks the answer (fixture names that reveal the bug).
- The environment, not the skill, failed (network errors from the sandbox, missing tools without `--allow-tools`).

Fix the eval, re-grade, and note it in the changelog with the old result kept visible.

The environment can fail too. Eval runs started from a cloud Claude Code session once inherited variables that made Claude say it couldn't create skills; `skillio run-evals` strips them now, but if a transcript shows Claude refusing something a normal session does, check the environment before the skill. Changing an expectation is fine; hiding that you did is not.
