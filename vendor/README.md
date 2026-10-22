# Vendored skills

Open-source skills and guides about writing skills, copied here so Skillio's skills can read them at a pinned version. They are reference material: nothing in Skillio executes vendored code except skill-creator's own scripts (its validator, benchmark aggregator, review viewer and packager), which building-skills runs the way skill-creator documents.

They sit in `vendor/`, not in `skills/`, on purpose. Anything under `skills/` is loaded as a skill, and six more skills about skills would compete with Skillio's three for the same requests ("make me a skill" would match skill-creator, writing-skills, skill-development and building-skills). Kept here, they are read when a Skillio skill needs them and never fight for triggering.

`sources.json` records the upstream commit of each. `node scripts/sync-vendor.mjs` pulls the latest; review the diff before committing.

| Folder | Upstream | License | What Skillio uses it for |
| --- | --- | --- | --- |
| `skill-creator/` | [anthropics/skills](https://github.com/anthropics/skills/tree/main/skills/skill-creator) | Apache-2.0 | The builder. building-skills follows its interview, drafting, with/without-skill runs, grading, benchmark and review viewer. Its description optimiser is used for ideas only, because its trigger test installs the description as a slash command instead of loading it as a skill. |
| `superpowers-writing-skills/` | [obra/superpowers](https://github.com/obra/superpowers/tree/main/skills/writing-skills) | MIT | Test-driven skill writing: watch an agent fail without the skill first, write the minimum that fixes it, close loopholes. Its "match the form to the failure" table drives how improving-skills words a fix. |
| `skill-judge/` | [softaworks/agent-toolkit](https://github.com/softaworks/agent-toolkit/tree/main/skills/skill-judge) | MIT | A 120-point rubric for skill design. The skill-reviewer agent borrows its knowledge-delta and freedom-calibration dimensions and its failure patterns. |
| `plugin-dev/` | [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/plugin-dev) | Apache-2.0 | Anthropic's guides for plugin structure, hooks and skill development, plus its skill-reviewer and plugin-validator agent prompts. Read when a skill ships inside a plugin with hooks or agents. |
| `task-observer/` | [rebelytics/one-skill-to-rule-them-all](https://github.com/rebelytics/one-skill-to-rule-them-all) | CC-BY-4.0, by Eoghan Henn and contributors | An always-on skill that logs corrections during real work and turns them into skill updates in a weekly review. improving-skills uses the method in a lighter form (`skillio observe`); install the original if you want it running in every session. |
| `agentskills-docs/` | [agentskills/agentskills](https://github.com/agentskills/agentskills/tree/main/docs) | CC-BY-4.0 | The Agent Skills open standard (the format the Claude app, the API and other agents accept) and its guides on best practices, scripts, evaluating skills and optimising descriptions. |

The licenses travel with each folder. Apache-2.0 and MIT allow copying with the notice kept; CC-BY-4.0 allows it with attribution, which this table and the folders' own license files provide. None of these files were modified.
