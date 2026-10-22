---
description: "Should invoke building-skills"
tags: [trigger, should-fire, skill:building-skills, tuning, building-skills:tuning]
max_turns: 4
allowed_tools: [Read, Glob, Grep, Skill]
---

here's what we just did for the invoice reconciliation: pull the Stripe payouts CSV, match each payout to the invoices in the Xero export, flag anything off by more than 1 EUR, then write the mismatches to the finance sheet. turn that into a reusable skill please
