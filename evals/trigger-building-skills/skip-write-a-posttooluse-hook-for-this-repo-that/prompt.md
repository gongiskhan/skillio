---
description: "Should not invoke building-skills"
tags: [trigger, should-not-fire, skill:building-skills, tuning, building-skills:tuning]
max_turns: 4
allowed_tools: [Read, Glob, Grep, Skill]
---

write a PostToolUse hook for this repo that runs prettier on every file Claude edits
