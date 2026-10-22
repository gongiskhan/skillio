#!/usr/bin/env bash
# Creates the skill this case talks about, so the run has something to find.
set -euo pipefail
mkdir -p "skills/contracts-pt"
cat > "skills/contracts-pt/SKILL.md" <<'SKILLIO_FIXTURE'
---
name: contracts-pt
description: "Writes contracts pt for the team in the house format. Use when the user asks for contracts pt."
---

# Contracts pt

1. Read the input the user gives you.
2. Write the output in the house format: a title, three short sections, a closing line.
3. Keep it under one page.
SKILLIO_FIXTURE
