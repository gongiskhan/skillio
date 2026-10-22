#!/usr/bin/env bash
# Creates the skill this case talks about, so the run has something to find.
set -euo pipefail
mkdir -p "skills/report-writer"
cat > "skills/report-writer/SKILL.md" <<'SKILLIO_FIXTURE'
---
name: report-writer
description: "Writes report writer for the team in the house format. Use when the user asks for report writer."
---

# Report writer

1. Read the input the user gives you.
2. Write the output in the house format: a title, three short sections, a closing line.
3. Keep it under one page.
SKILLIO_FIXTURE
