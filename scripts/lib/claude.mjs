// Claude Code integration: find the CLI, know what this version can do, and
// run it cleanly. Everything here degrades to "not available" instead of
// failing, because Skillio's static checks have to work where Claude Code
// isn't installed (an editor like Cursor, a CI job without it). Callers skip
// what needs Claude Code and say so once.
//
// SKILLIO_CLAUDE=off makes Skillio behave as if Claude Code were absent.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, relative, resolve, sep, dirname } from 'node:path';
import { homedir } from 'node:os';

// Versions where each tool first shipped.
export const MIN = { eval: '2.1.269', promptAudit: '2.1.283' };

export function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

// Variables a parent Claude Code session passes to anything it spawns. Left
// in, they let a child session reach the parent's messaging channel, and in
// cloud sessions they tell the child it is a remote session, where Claude
// believes it can't create skills (measured on one eval case: 1 of 3 runs
// fired with them, 3 of 3 without). Child sessions should look like a fresh
// local session, so every session variable goes, except the ones that pick
// the model provider and carry credentials.
const KEEP_ENV = /^CLAUDE_CODE_(USE_|OAUTH|API_KEY|PROVIDER|.*AUTH|CLIENT_|.*CERT|.*PROXY|SKIP_BEDROCK|SKIP_VERTEX|SKIP_FOUNDRY|MAX_OUTPUT)/;
const DROP_ENV = ['CLAUDECODE', 'CLAUDE_PID', 'CLAUDE_EFFORT', 'CLAUDE_AFTER_LAST_COMPACT', 'CLAUDE_AUTO_BACKGROUND_TASKS', 'CLAUDE_CHROME_PERMISSION_MODE'];

export function cleanEnv(base = process.env, { keepSession = false } = {}) {
  const env = { ...base };
  for (const k of Object.keys(env)) {
    if (/^(CCR_|SESSION_INGRESS|CLAUDE_SESSION_)/.test(k)) delete env[k];
    else if (k.startsWith('CLAUDE_CODE_') && !KEEP_ENV.test(k)) delete env[k];
    else if (!keepSession && DROP_ENV.includes(k)) delete env[k];
  }
  env.CLAUDE_CODE_ENABLE_CFC = '0'; // no Chrome extension in child sessions
  return env;
}

let cached;

// What the installed Claude Code can do. One `claude --version` call, cached.
export function claudeInfo() {
  if (cached) return cached;
  const none = { found: false, version: null, can: { validate: false, details: false, eval: false, promptAudit: false, skillDoctor: false } };
  if (/^(off|0|false|no)$/i.test(process.env.SKILLIO_CLAUDE ?? '')) return (cached = { ...none, reason: 'SKILLIO_CLAUDE=off' });
  const r = spawnSync('claude', ['--version'], { encoding: 'utf8', env: cleanEnv(), timeout: 20000 });
  const version = r.status === 0 ? (r.stdout.match(/\d+\.\d+\.\d+/) ?? [null])[0] : null;
  if (!version) return (cached = { ...none, reason: 'the claude command is not installed here' });
  const atLeast = min => compareVersions(version, min) >= 0;
  return (cached = {
    found: true,
    version,
    can: { validate: true, details: true, skillDoctor: true, eval: atLeast(MIN.eval), promptAudit: atLeast(MIN.promptAudit) },
  });
}

export function resetClaudeInfo() { cached = undefined; }

function claude(args, opts = {}) {
  return spawnSync('claude', args, { encoding: 'utf8', env: cleanEnv(), maxBuffer: 64 * 1024 * 1024, ...opts });
}

// --- claude plugin validate ---------------------------------------------------------
//
// Exit codes: 0 pass, 1 fail, 2 the validator itself broke. A 2 says nothing
// about the skill, so it is reported as a validator error, never as a finding.

export function validate(path, { strict = false, profile = null, cwd } = {}) {
  const args = ['plugin', 'validate', path, '--json'];
  if (strict) args.push('--strict');
  if (profile) args.push('--profile', profile);
  const r = claude(args, { cwd: cwd ?? (existsSync(path) && !path.endsWith('.json') ? path : dirname(path)), timeout: 120000 });
  if (r.error) return { exit: null, validatorError: r.error.message };
  let json = null;
  try { json = JSON.parse(r.stdout); } catch {}
  if (r.status === 2 || !json) return { exit: r.status, validatorError: (r.stderr || r.stdout).trim().slice(0, 1500) || `exit ${r.status}` };
  return { exit: r.status, json };
}

const inside = (file, dir) => { const rel = relative(dir, file); return rel && !rel.startsWith('..') && !rel.startsWith(sep) || resolve(file) === resolve(dir); };

// Turn the JSON report into Skillio findings (id V000). componentsOnly drops
// manifest and directory-listing findings, for a folder that is not itself
// the thing being checked (a temporary wrapper, a skill's parent folder).
// only: keep component findings (skills, agents, commands) for files inside
// this folder; the manifest stays unless componentsOnly, because a broken
// manifest stops every skill in the plugin from loading.
export function validateFindings(v, label, { componentsOnly = false, only = null, profile = null } = {}) {
  const findings = [];
  const add = (sev, file, msg) => findings.push({ id: 'V000', severity: sev, title: `claude plugin validate (${label})`, file, message: msg });
  if (v.validatorError) return findings;
  const contents = (v.json.contents ?? []).filter(b => !only || (b.file && inside(b.file, only)));
  const blocks = [componentsOnly ? null : v.json.manifest, ...contents].filter(Boolean);
  for (const b of blocks) {
    const file = b.file ? relative(process.cwd(), b.file) : null;
    for (const e of b.errors ?? []) add('error', file, `${e.path ? e.path + ': ' : ''}${e.message}`);
    for (const w of b.warnings ?? []) add('warn', file, `${w.path ? w.path + ': ' : ''}${w.message}`);
  }
  if (!componentsOnly) {
    for (const f of v.json.directory?.findings ?? []) {
      // Without --profile directory these never fail validation, so they are
      // notes; with it they are what the plugin directory would refuse.
      const sev = profile ? (f.severity === 'error' ? 'error' : 'warn') : (f.severity === 'error' ? 'warn' : 'info');
      add(sev, f.file, `[plugin directory] ${f.title}: ${f.fix ?? f.message}`);
    }
  }
  return findings;
}

// --- claude plugin details ------------------------------------------------------------
//
// Claude Code's own estimate of what a plugin costs in context: always-on (the
// listing every session pays) and on-invoke (paid each time a component fires).

export function pluginDetails(pluginDir, name) {
  const r = claude(['--plugin-dir', pluginDir, 'plugin', 'details', name], { cwd: pluginDir, timeout: 60000 });
  if (r.status !== 0) return null;
  return parseDetails(r.stdout);
}

export function parseDetails(text) {
  const tok = s => {
    if (!s) return null;
    const m = s.match(/([<~]?)\s*([\d.]+)\s*(k?)/i);
    if (!m) return null;
    return Math.round(parseFloat(m[2]) * (m[3] ? 1000 : 1));
  };
  const always = text.match(/Always-on:\s*([^\n]*?)\s*tok/);
  const components = [];
  const table = text.split(/Per-component[^\n]*\n/)[1];
  if (table) {
    for (const line of table.split('\n').slice(1)) {
      const m = line.match(/^\s{2}(\S+)\s{2,}(\S+(?:\s\S+)?)\s{2,}(\S+(?:\s\S+)?)\s*$/);
      if (m) components.push({ name: m[1], alwaysOn: tok(m[2]), onInvoke: tok(m[3]), raw: [m[2], m[3]] });
    }
  }
  return { alwaysOn: always ? tok(always[1]) : null, components, text: text.trim() };
}

// --- skill-creator ---------------------------------------------------------------------
//
// The installed skill-creator plugin is kept up to date by Claude Code; the
// copy in vendor/ is pinned. Same content today, so prefer the installed one
// and fall back to the pinned copy. Skillio doesn't declare it as a
// dependency: installing it adds a second skill that competes for every
// request about skills, and the marketplace name differs between setups.

export function skillCreator(pluginRoot, { lookupAvailable = false } = {}) {
  const vendored = join(pluginRoot, 'vendor', 'skill-creator');
  const info = claudeInfo();
  if (info.found) {
    const r = claude(['plugin', 'list', '--json'], { timeout: 30000 });
    try {
      const list = JSON.parse(r.stdout);
      const hit = list.find(p => /^skill-creator@/.test(p.id) && p.enabled !== false && p.installPath);
      const dir = hit && join(hit.installPath, 'skills', 'skill-creator');
      if (dir && existsSync(join(dir, 'SKILL.md'))) return { source: 'plugin', id: hit.id, path: dir };
    } catch {}
  }
  const res = { source: 'vendored', path: vendored, installId: null };
  if (info.found && lookupAvailable) {
    const r = claude(['plugin', 'list', '--available', '--json'], { timeout: 60000 });
    try { res.installId = JSON.parse(r.stdout).available?.find(p => p.name === 'skill-creator')?.pluginId ?? null; } catch {}
  }
  return res;
}

// --- prompt audits ---------------------------------------------------------------------
//
// /claude-api prompt-audit <path>: instructions written for older models in a
//   skill, agent or prompt, with a proposed diff. Scoped to the path.
// /doctor prompt-audit: the whole setup Claude Code loads for a project
//   (CLAUDE.md files, rules, skills, agents) for outdated or conflicting
//   instructions.
// Both are model calls on the user's account (well under a dollar each on the
// default model, measured). They run read-only: no Write, Edit or Bash beyond
// git history.

const AUDIT_TOOLS = ['Read', 'Glob', 'Grep', 'Bash(git log:*)', 'Bash(git blame:*)', 'Bash(git show:*)'];

export function gitRoot(dir) {
  let d = resolve(dir);
  for (;;) {
    if (existsSync(join(d, '.git'))) return d;
    const up = dirname(d);
    if (up === d) return null;
    d = up;
  }
}

export function promptAudit({ scope, path, cwd, model, timeoutMs = 15 * 60 * 1000 }) {
  const info = claudeInfo();
  if (!info.can.promptAudit) return { skipped: info.found ? `needs Claude Code ${MIN.promptAudit} or later (found ${info.version})` : info.reason };
  const prompt = scope === 'setup' ? '/doctor prompt-audit' : `/claude-api prompt-audit ${path}`;
  const args = ['-p', prompt, '--output-format', 'json', '--allowedTools', ...AUDIT_TOOLS];
  if (scope === 'setup' && existsSync(join(homedir(), '.claude'))) args.push('--add-dir', join(homedir(), '.claude'));
  if (model) args.push('--model', model);
  const r = claude(args, { cwd, timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.error) return { error: r.error.code === 'ETIMEDOUT' ? `timed out after ${Math.round(timeoutMs / 60000)} min` : r.error.message };
  let j;
  try { j = JSON.parse(r.stdout); } catch { return { error: (r.stderr || r.stdout).trim().slice(0, 1000) || `exit ${r.status}` }; }
  const text = String(j.result ?? '').trim();
  if (j.is_error || !text) return { error: text || j.subtype || 'no result', costUsd: j.total_cost_usd };
  if (/^(Unknown (skill|command)|.*is not a (known|valid) (skill|command))/i.test(text)) return { skipped: `this Claude Code has no ${scope === 'setup' ? '/doctor prompt-audit' : '/claude-api prompt-audit'}` };
  return { text, costUsd: j.total_cost_usd ?? null, prompt };
}

// --- /skill-doctor ---------------------------------------------------------------------
//
// Every skill Claude Code actually loads for this user (including ones synced
// from the Claude app, which have no files here), with context cost and use
// counts. Non-interactive mode prints it without a model call.

export function skillDoctor() {
  if (!claudeInfo().found) return null;
  const r = claude(['-p', '/skill-doctor'], { timeout: 90000, stdio: ['ignore', 'pipe', 'pipe'] });
  return r.status === 0 && /skill/i.test(r.stdout) ? r.stdout.trim() : null;
}
