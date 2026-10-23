# Tuning loops

An automated loop proposes a change, runs the eval, keeps the change if the score rises, and repeats. Anthropic's `/claude-api hillclimb` is a governed version of the idea. Loops find real gains and invent fake ones with equal enthusiasm. These rules keep the fake ones out.

## Contents

- Before the first round
- During the loop
- After the loop
- Which tool for which job

## Before the first round

- **A runnable eval with a baseline number.** No eval, no loop: hill-climbing without a measurement is editing and hoping.
- **Know the noise floor.** Run the unchanged skill twice. If the two runs differ by 5 points, a 3-point gain means nothing. More runs per case or more cases lower the floor.
- **Know the headroom.** If the baseline already passes 95%, there is little to climb and a lot to overfit.
- **Split the cases.** Roughly 60% tuning, 40% held-out, with should-fire and near misses in both. Keep the split fixed during a loop; add new held-out cases only between loops, never move or edit existing ones.
- **Freeze the graders.** The loop can change the skill, never the graders, the cases or the held-out set. A loop that can edit its own grader will improve the grader.
- **Agree a budget and a stopping rule**: a number of rounds, a cost ceiling, or "stop when held-out stops improving".

## During the loop

- One change per round, with a written hypothesis, so each result says something.
- Read the failing transcripts each round, not only the score. When the loop stalls, sort the remaining failures into kinds (didn't fire, skipped a step, wrong output, eval bug) and attack the biggest kind, instead of grinding small wording changes.
- Watch cost per run. A loop that buys points with tokens may produce a skill nobody wants to pay for.

## After the loop

- Choose the version with the best held-out score, which is often not the last one.
- Confirm the winner with a fresh run at more repeats (`--runs 5`) before adopting it.
- Check it still reads well. Loops produce descriptions stuffed with keywords and bodies full of patches. If a person can't follow it, Claude will follow it badly on cases the suite doesn't have.
- A person approves the merge, and the changelog records what the loop tried.

## Which tool for which job

| Job | Tool | Caveat |
| --- | --- | --- |
| Candidate descriptions from failed trigger queries | skill-creator `run_loop.py` | Tests via slash commands, not skill loading; confirm in plugin eval |
| Measuring triggering for real | `skillio run-evals <path> --trust --tag trigger --ablation none` | Claude Code runtime; the Claude app is close but not identical |
| Climbing an API-based eval | `/claude-api hillclimb` (after `/claude-api build-eval`) | For skills run through the API with a scripted harness |
| Reflective prompt optimisation (GEPA, DSPy) | Personal lab only | A SKILL.md is not a DSPy program; borrow the method (reflect on failures, keep the best on held-out cases), not the framework |
