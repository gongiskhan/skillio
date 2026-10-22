#!/usr/bin/env bash
# Creates the skill this case talks about, so the run has something to find.
set -euo pipefail
mkdir -p "skills/meeting-notes"
cat > "skills/meeting-notes/SKILL.md" <<'SKILLIO_FIXTURE'
---
name: meeting-notes
description: "Writes meeting notes for the team in the house format. Use when the user asks for meeting notes."
---

# Meeting notes

1. Read the input the user gives you.
2. Write the output in the house format: a title, three short sections, a closing line.
3. Keep it under one page.
SKILLIO_FIXTURE
