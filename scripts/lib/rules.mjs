// The rule catalog. Every finding the linter emits points at one of these ids,
// and every id has a section in docs/principles.md explaining the reason
// behind it in detail and in plain words. Keep the two in sync: the test suite
// fails if a rule here has no matching heading in principles.md.

export const RULES = {
  // Spec and loading: the skill won't load, or loads differently on some surface.
  S001: { severity: 'error', title: 'SKILL.md is missing' },
  S002: { severity: 'error', title: 'No YAML frontmatter' },
  S003: { severity: 'error', title: 'Frontmatter is not valid YAML' },
  S004: { severity: 'warn', title: 'Unquoted value that strict YAML parsers reject' },
  S005: { severity: 'error', title: 'Name is missing or badly formed' },
  S006: { severity: 'error', title: 'Name uses a reserved word' },
  S007: { severity: 'warn', title: 'Name does not match the folder name' },
  S008: { severity: 'error', title: 'Description is missing' },
  S009: { severity: 'error', title: 'Description is over 1,024 characters' },
  S010: { severity: 'error', title: 'Description contains angle brackets' },
  S011: { severity: 'warn', title: 'Unknown frontmatter field' },
  S012: { severity: 'warn', title: 'Field not portable to the Claude app or API' },
  S013: { severity: 'warn', title: 'Frontmatter field has the wrong type' },

  // Description: the only part Claude reads before deciding to load the skill.
  D001: { severity: 'warn', title: 'Description says what, but not when' },
  D002: { severity: 'warn', title: 'Description is not in the third person' },
  D003: { severity: 'warn', title: 'Description is too short to trigger reliably' },
  D004: { severity: 'info', title: 'Description summarises the workflow' },
  D005: { severity: 'info', title: 'Description uses vague words' },
  D006: { severity: 'warn', title: 'Description copies an eval prompt' },
  D007: { severity: 'warn', title: 'Description gets cut off in the skill listing' },

  // Body and references: what Claude reads after it loads the skill.
  B001: { severity: 'warn', title: 'SKILL.md body is over 500 lines' },
  B002: { severity: 'info', title: 'SKILL.md body is token-heavy' },
  B003: { severity: 'error', title: 'Link to a file that does not exist' },
  B004: { severity: 'warn', title: 'Reference chain deeper than one level' },
  B005: { severity: 'info', title: 'Long reference file without a table of contents' },
  B006: { severity: 'warn', title: 'Windows-style path' },
  B007: { severity: 'info', title: 'Many all-caps commands' },
  B008: { severity: 'info', title: 'Time-sensitive wording' },
  B009: { severity: 'info', title: 'Script called without its interpreter' },
  B010: { severity: 'info', title: 'File that nothing points to' },
  B011: { severity: 'warn', title: 'Body is nearly empty' },
  B012: { severity: 'warn', title: 'Placeholder text left in' },

  // Package hygiene: what ships with the skill.
  P001: { severity: 'error', title: 'Possible secret in the skill folder' },
  P002: { severity: 'warn', title: 'Junk files in the skill folder' },
  P003: { severity: 'info', title: 'Human docs inside the skill folder' },
  P004: { severity: 'warn', title: 'Large files in the skill folder' },

  // Routing: how the skill competes with the other skills Claude can see.
  C001: { severity: 'warn', title: 'Description overlaps another skill' },
  C002: { severity: 'info', title: 'Many skills installed' },

  // Evals: whether the skill can be measured at all.
  E001: { severity: 'warn', title: 'No eval suite found' },
  E002: { severity: 'warn', title: 'Eval suite has no should-not-trigger cases' },
  E003: { severity: 'info', title: 'Eval suite has no held-out cases' },
  E004: { severity: 'info', title: 'Eval suite is small' },
};

export const SEVERITY_ORDER = { error: 0, warn: 1, info: 2 };
