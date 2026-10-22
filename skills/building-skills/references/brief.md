# Skill brief

Fill this in with the user before drafting anything bigger than a small personal skill. Claude knows the skill format already; what it can't guess is the context, the real examples and what "done" means. Most of a brief is those three. Write it to the workspace as `brief.md`.

```markdown
# Skill brief: <name, gerund form, e.g. comparing-carrier-quotes>

## Goal
What the user gets, in one sentence, and why it's worth a skill
(how long the task takes today, how often it happens).

## Users and surface
Who triggers it and how they talk. Claude Code, the Claude app, the API, or several.
Models they may use. Constraints: network, packages, connectors available.

## When it should fire
10 real phrasings, casual, with file names and context.
10 near misses that must not fire, and what should handle each one instead.
Known rival skills (built-in document skills, browser automation, other plugins).

## Inputs
File types and sizes. Example inputs (anonymised) and where they are.
What to do when an input is missing: ask one plain question, then continue.

## Output
Format, template, sections in order, file naming.
Who reads it next and what they do with it.

## What Claude can't know
House style, templates, thresholds, approved wording, banned phrases, domain rules.
Never invent a figure; say "not found in the source". Cite where each figure came from.

## Deterministic parts (scripts/)
Parsing, arithmetic, reconciliation, validation of the output file.

## Data and secrets
No credentials or real client data in the skill folder. Privacy rules for the inputs.

## Evals (written before the body)
Trigger set, held-out set, output cases with code graders first, baseline arm on.

## Done when
Trigger and output targets (see eval-suite.md), reviewer findings resolved,
and for the Claude app, a manual smoke test passed.
```

The acceptance numbers in eval-suite.md are starting points. Set real ones with whoever pays for a mistake: a skill that drafts a client email needs a different bar from one that renames files.
