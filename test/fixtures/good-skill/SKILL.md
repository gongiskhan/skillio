---
name: good-skill
description: Converts quarterly sales spreadsheets into the board summary format used by the finance team, with totals checked by a script. Use when the user asks for a board summary, quarterly numbers for the board, or a finance summary from an .xlsx or .csv export, even if they don't say "board".
---

# Board summaries

Board summaries follow the finance team's template, which Claude can't guess: four sections in a fixed order, figures rounded to thousands, and every total reconciled against the source.

## Steps

1. Run `python3 scripts/check_totals.py <file>` and stop if it reports a mismatch; a summary with wrong totals is worse than none.
2. Fill the template in [references/template.md](references/template.md), keeping the section order.
3. If a figure is missing from the source, write "not in source" instead of estimating it.
