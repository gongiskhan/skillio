# Review rubric

The skill-reviewer agent scores a skill on these ten dimensions, 0 to 3 each, with evidence quoted from the files. Code already checked the mechanical rules (limits, links, frontmatter); this rubric is for what needs reading. It draws on Anthropic's authoring guide, skill-creator's writing guidance, skill-judge's dimensions (vendor/skill-judge) and lessons from measured skills.

## Contents

- Scores
- The ten dimensions
- Failure patterns to name
- Output format

## Scores

- **3**: nothing to improve that would change behaviour.
- **2**: works; one improvement would help.
- **1**: a real problem Claude will hit in normal use.
- **0**: broken or missing.

## The ten dimensions

1. **Knowledge delta.** Does each section tell Claude something it doesn't already know: house rules, templates, thresholds, tool quirks, domain decisions, the order that matters? Explanations of general concepts (what a PDF is, how to write clean code) are cost without benefit. Quote the paragraph that adds least.
2. **Trigger design.** Does the description say what and when, in the words users type, in third person, with the main use case first? Would a near miss fire it? Does it name or out-scope the obvious rival skill? Does it avoid summarising the procedure?
3. **Scope.** One job, done well? A skill that does three unrelated things triggers badly and loads text that most runs don't need.
4. **Freedom matched to fragility.** Exact commands, scripts and templates where a mistake is costly or the format is fixed; goals and judgment where many answers are fine. Over-constraint on creative work and vagueness on fragile steps both score low.
5. **Procedure quality.** For multi-step work: a clear sequence, a checklist Claude can copy, validation before irreversible steps (plan, validate, execute), and a feedback loop (run the validator, fix, re-run).
6. **Reasons over rules.** Do instructions explain why? A wall of MUST and NEVER without reasons generalises badly; one hard limit with its reason is fine.
7. **Progressive disclosure.** Is SKILL.md an overview with the essentials, and is detail in reference files that are linked directly from it with a line saying when to read each? Is anything loaded every time that only some runs need?
8. **Scripts and resources.** Do bundled scripts handle their own errors with messages Claude can act on, avoid magic numbers, declare their dependencies, and get called with their interpreter? Are templates and examples real, not placeholders?
9. **Failure handling.** What happens with a missing input, a bad file, an unreachable service, an ambiguous request? The skill should say: ask one plain question, report what wasn't found, never invent data or credentials.
10. **Safety and hygiene.** No secrets, no client data, no surprising behaviour (anything the user would object to if it were described to them), no destructive steps without confirmation, MCP tools named in full (`Server:tool`).

## Failure patterns to name

Call these out by name when you see them; they make findings quick to understand.

- **The tutorial**: teaches Claude what it already knows.
- **The dump**: everything in SKILL.md, nothing in references.
- **Orphan references**: files that exist but nothing says when to read them.
- **The checkbox procedure**: steps with no reason, so Claude can't adapt when a step doesn't fit.
- **The vague warning**: "be careful with X" without saying what careful means.
- **The invisible skill**: a description that never says when to use it.
- **Freedom mismatch**: rigid where it should be loose, or loose where it must be exact.
- **The over-engineered skill**: machinery (agents, loops, config) a three-paragraph skill would do better.
- **Memorised prompts**: the description quotes test prompts instead of describing the intent.

## Output format

Return Markdown in this shape, and nothing before it:

```markdown
# Review: <skill name>

Overall: <one sentence verdict>. Score <sum>/30.

| Dimension | Score | Evidence |
| --- | --- | --- |
| Knowledge delta | 2 | "..." (SKILL.md:40) explains CSV basics Claude knows |
...

## Top issues
1. **<pattern or dimension>** (file:line). What is wrong. Why it matters. Fix: <concrete change>.
2. ...

## What works
- One to three things worth keeping, with where they are.
```

Quote the skill's own text as evidence. A finding without a quote or a line number is an opinion.
