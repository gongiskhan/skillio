# Skillio's own eval history

Trigger suite: 60 cases from `sets/*.json` (35 should fire, 25 near misses, 11 held out), 3 runs each, `--ablation none`, with a decoy carrying skill-creator's exact description installed beside Skillio's skills in every case. Claude Code 2.1.308, default model, 22 October 2026. Each line is runs that behaved correctly out of runs made.

## Final (descriptions as committed)

| Skill | Should fire, tuning | Should fire, held out | Near misses quiet |
| --- | --- | --- | --- |
| building-skills | 30/30 (100%) | 9/9 (100%) | 27/27 |
| checking-skills | 23/27 (85%) | 3/6 (50%) | 24/24 |
| improving-skills | 20/27 (74%) | 6/6 (100%) | 24/24 |

180 runs, $11.21. building-skills was picked over the skill-creator decoy in every should-fire run.

## How it got there

1. **First run: 73% / 85% / 63% on the tuning sets.** Before touching any description, the transcripts of the misses were read. Two causes, neither of them the descriptions:
   - **Environment.** The suite ran from a cloud Claude Code session, and eval runs inherited variables marking them as remote sessions, where Claude answered "I can't create or change skills from here". Stripping every session variable from the child environment took one such case from 1 of 3 runs to 3 of 3. `run-evals` now does this.
   - **Case design.** Prompts about an existing skill ("check my release-notes skill") ran in an empty folder, so Claude searched, found nothing and stopped before deciding on a skill. One prompt promised a pasted checklist that wasn't there; another said "turn what we just did into a skill" with no prior conversation. Fixes: fixtures (`"fixture"` in the sets, run with `--scaffold`), the checklist in the prompt, the steps in the prompt. Some held-out cases were among those fixed (fixtures added, the missing checklist filled in); none was reworded toward a description.
2. **Descriptions rewritten after three independent reviews** (procedure removed from descriptions, boundaries between the skills added). Measured side by side with the originals on the fixed suite: building 100% both, checking 85% to 78%, improving 74% to 78%. Within noise (two runs out of 27), so not adopted.
3. **A targeted clause** for the remaining misses ("use it even for a quick opinion / a small fix"). Checking 85% to 89%, improving 74% to 67%. Within noise, not adopted.

## What the remaining misses are

Read in the transcripts: for "how good is my skill?" or "this section is missing, fix it", Claude often finds the SKILL.md, reads it and does the job itself without loading a Skillio skill. That matches how skills work: Claude reaches for one when the task looks bigger than it can do alone. Wording didn't move it in two attempts. When you want the full treatment for a small request, say "use Skillio" or call `/skillio:checking-skills` or `/skillio:improving-skills` directly.

The held-out checking cases (3 of 6) are the weakest number and the one to watch with real use.
