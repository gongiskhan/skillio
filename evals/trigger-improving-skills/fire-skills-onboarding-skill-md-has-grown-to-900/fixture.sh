#!/usr/bin/env bash
# Creates the skill this case talks about, so the run has something to find.
set -euo pipefail
mkdir -p "skills/onboarding"
cat > "skills/onboarding/SKILL.md" <<'SKILLIO_FIXTURE'
---
name: onboarding
description: "Writes onboarding for the team in the house format. Use when the user asks for onboarding."
---

# Onboarding

1. Read the input the user gives you.
2. Write the output in the house format: a title, three short sections, a closing line.
3. Keep it under one page.
SKILLIO_FIXTURE
