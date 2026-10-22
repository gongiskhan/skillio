#!/usr/bin/env bash
# Creates the skill this case talks about, so the run has something to find.
set -euo pipefail
mkdir -p "skills/invoice"
cat > "skills/invoice/SKILL.md" <<'SKILLIO_FIXTURE'
---
name: invoice
description: "Writes invoice for the team in the house format. Use when the user asks for invoice."
---

# Invoice

1. Read the input the user gives you.
2. Write the output in the house format: a title, three short sections, a closing line.
3. Keep it under one page.
SKILLIO_FIXTURE
