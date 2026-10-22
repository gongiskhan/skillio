// Frontmatter fields, split by where they work.
//
// SPEC_FIELDS: the Agent Skills open standard (agentskills.io). These are the
// only fields the Claude app and the API accept on upload; anything else makes
// the upload fail.
// CLAUDE_CODE_FIELDS: extra fields Claude Code reads (code.claude.com/docs/en/skills).
// They are fine in a Claude Code plugin and break portability elsewhere.

export const SPEC_FIELDS = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools']);

export const CLAUDE_CODE_FIELDS = new Set([
  'when_to_use', 'argument-hint', 'arguments', 'disable-model-invocation', 'user-invocable',
  'disallowed-tools', 'model', 'effort', 'context', 'agent', 'background', 'hooks', 'paths', 'shell',
  // Older or widely seen keys that Claude Code tolerates; kept here so they are
  // reported as portability issues rather than as unknown fields.
  'version',
]);

const BOOL = v => (typeof v === 'boolean' || /^(yes|no|on|off|true|false|1|0)$/i.test(String(v)) ? null : 'should be true or false.');
const STR_OR_LIST = v => (typeof v === 'string' || (Array.isArray(v) && v.every(x => typeof x === 'string')) ? null : 'should be a string or a list of strings.');

export const FIELD_TYPES = {
  'disable-model-invocation': BOOL,
  'user-invocable': BOOL,
  background: BOOL,
  'allowed-tools': STR_OR_LIST,
  'disallowed-tools': STR_OR_LIST,
  paths: STR_OR_LIST,
  arguments: STR_OR_LIST,
  context: v => (v === 'fork' ? null : 'only accepts "fork".'),
  effort: v => (/^(low|medium|high|xhigh|max)$/.test(String(v)) ? null : 'should be low, medium, high, xhigh or max.'),
  shell: v => (/^(bash|powershell)$/.test(String(v)) ? null : 'should be bash or powershell.'),
  metadata: v => (v && typeof v === 'object' && !Array.isArray(v) ? null : 'should be a map of keys to values.'),
  compatibility: v => (typeof v !== 'string' ? 'should be a string.' : v.length > 500 ? `is ${v.length} characters; the limit is 500.` : null),
  license: v => (typeof v === 'string' ? null : 'should be a string (an SPDX id or a file name).'),
};

// Claude Code truncates description + when_to_use at this length in the skill listing.
export const LISTING_CAP = 1536;
