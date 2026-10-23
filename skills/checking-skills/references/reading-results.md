# Reading eval results

Read this before turning eval numbers into conclusions. Agent runs vary from run to run, suites are small, and several different failures produce the same number.

## Contents

- What the numbers mean
- Noise: when a difference is real
- A delta near zero
- Trigger results
- Output results
- Partial runs and run errors
- Read the transcripts

## What the numbers mean

- **Run**: one Claude session on one case. Each case runs 3 times by default.
- **Score**: the weighted share of a run's graders that passed; a case's score is the mean over its runs.
- **WITH / W/OUT / delta**: the same case with the plugin and without it. The delta is what the skill adds.
- **pass@k**: at least one of k runs passed. Fine when someone will retry.
- **pass^k**: all k runs passed. The honest number for a skill people use once and trust. A per-run rate of 90% gives a pass^3 of about 73%; 75% gives about 42%.
- **Indicators**: in two-arm runs, `tool_used: Skill` graders are shown as "plugin-fired" chips and not scored. Use `--ablation none` for trigger suites so they count.

## Noise: when a difference is real

With 3 runs per case, one run is 33 points on that case. With 20 cases, one flipped run moves the suite by about 1.7 points. Before calling a change an improvement:

- The difference should be bigger than what two runs of the unchanged skill differ by. If you don't know that number, run the unchanged skill twice; that is the noise floor.
- It should show up on the held-out cases too, not only the tuning cases.
- For a decision that matters (shipping, a big rewrite), use `--runs 5` on the cases that changed.

## A delta near zero

Three different causes, three different fixes:

1. **The skill didn't fire.** Check the `tool_used: Skill` indicator. If it failed, Claude never loaded the skill, so both arms ran plain Claude. This is a description problem, the most common first finding.
2. **It fired and changed nothing.** The graders measure things Claude already does well without the skill. Either the skill teaches nothing new (a knowledge-delta problem) or the graders are too easy. Drop assertions that pass in both arms.
3. **It fired and helped in ways the graders don't measure.** Evidence, safety, consistency and format often matter more than raw correctness. If that is the skill's value, add graders for it, or the eval will keep underselling the skill.

## Trigger results

- **Missed should-fire on the tuning set**: the description lacks the user's words for this intent, or the prompt is too simple for Claude to bother with a skill. Look at the prompt before changing the description.
- **Missed should-fire on held-out only**: the description fits the tuning prompts but not the intent. Describe the task more generally; don't add the missed wording.
- **False fire on a near miss**: the description is broader than the skill. Say what it does not cover, or name the skill that should handle that case.
- **Lost to a decoy**: the rival's description fits the request better. Make the boundary explicit in both directions.

## Output results

- A grader failing in both arms usually means the grader or the case is wrong. Read one run before blaming the skill.
- High variance (1/3 or 2/3 on a case) means the instructions leave room for different interpretations. Look for the step where runs diverge.
- Cost and time count. A skill that doubles tokens for a few points may not be worth it; say so.

## Partial runs and run errors

- **"Read this first"** at the top of a Skillio summary means the run measured nothing about the skill: plugin eval reported that the plugin didn't load (`suite.plugins` empty, or a `manifest_invalid`, `disabled_by_default` or `will_not_load` problem), or a case "cannot pass with the granted tools" (a file grader with no tool that can write the file). Fix it and rerun before reading any number.
- **Exit code 2** means the run stopped early: the cost ceiling was hit or the credential was rejected. `partial` is true in the results. Don't compare a partial run with a full one; rerun with a higher `--max-cost` or fewer cases.
- **"Reached maximum number of turns"** on a trigger case is normal: the case stops Claude after a few turns because only the first decision matters. It counts as an error in the table but the Skill grader still decides the case.
- **A judge that disagrees with you**: llm graders use Sonnet through `skillio run-evals` unless another model is passed. If you would have scored a run differently, the rubric is not ready; rewrite it as concrete PASS if / FAIL if claims and pilot again.
- **Cases that reference something missing** (a skill, a file, a pasted checklist) measure the empty workspace, not the skill. Look for Claude saying it couldn't find something; add a fixture or put the content in the prompt.

## Read the transcripts

The HTML report shows every run, its tool calls and each grader's verdict and evidence. Read at least the failures. Scores say that something failed; transcripts say why, and they are where harness bugs, unfair graders and wrong expectations show up. Anthropic's eval guidance is blunt about it: grading mistakes are among the most common ways an eval is misconfigured, and you only catch them by reading.
