---
description: "Should not invoke web-testing"
tags: [trigger, should-not-fire, skill:web-testing, tuning, web-testing:tuning]
max_turns: 4
allowed_tools: [Read, Glob, Grep, Skill]
---

why does my playwright test fail with "strict mode violation: getByRole('button') resolved to 2 elements"? the line is await page.getByRole('button').click()
