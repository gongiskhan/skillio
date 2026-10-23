---
description: "Should not invoke web-testing (held out)"
tags: [trigger, should-not-fire, skill:web-testing, held-out, web-testing:held-out]
max_turns: 4
allowed_tools: [Read, Glob, Grep, Skill]
---

three of our playwright tests have been flaky in github actions since we moved to node 22, make them stable
