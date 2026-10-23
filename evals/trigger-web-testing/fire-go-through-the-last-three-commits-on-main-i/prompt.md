---
description: "Should invoke web-testing (held out)"
tags: [trigger, should-fire, skill:web-testing, held-out, web-testing:held-out]
max_turns: 4
allowed_tools: [Read, Glob, Grep, Skill]
---

go through the last three commits on main in this repo and make sure the features they added actually work in the browser, server is on :5000
