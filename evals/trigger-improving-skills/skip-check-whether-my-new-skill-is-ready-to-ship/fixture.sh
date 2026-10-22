#!/usr/bin/env bash
# Creates the skill this case talks about, so the run has something to find.
set -euo pipefail
mkdir -p "skills/expense-reports"
cat > "skills/expense-reports/SKILL.md" <<'SKILLIO_FIXTURE'
---
name: expense-reports
description: "Writes expense reports for the team in the house format. Use when the user asks for expense reports."
---

# Expense reports

1. Read the input the user gives you.
2. Write the output in the house format: a title, three short sections, a closing line.
3. Keep it under one page.
SKILLIO_FIXTURE
