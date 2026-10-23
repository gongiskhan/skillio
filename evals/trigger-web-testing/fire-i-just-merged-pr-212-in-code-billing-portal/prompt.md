---
description: "Should invoke web-testing"
tags: [trigger, should-fire, skill:web-testing, tuning, web-testing:tuning]
max_turns: 4
allowed_tools: [Read, Glob, Grep, Skill]
---

I just merged PR #212 in ~/code/billing-portal, it changed the invoice filters. test it against localhost:3000 and add playwright tests for whatever it touched
