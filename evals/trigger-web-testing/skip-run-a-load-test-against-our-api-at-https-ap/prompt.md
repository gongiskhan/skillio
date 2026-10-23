---
description: "Should not invoke web-testing"
tags: [trigger, should-not-fire, skill:web-testing, tuning, web-testing:tuning]
max_turns: 4
allowed_tools: [Read, Glob, Grep, Skill]
---

run a load test against our api at https://api.ekoa.io, I want to know how many requests per second it handles before it falls over
