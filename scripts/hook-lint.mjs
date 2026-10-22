#!/usr/bin/env node
// PostToolUse hook: after Claude writes or edits a file inside a skill folder,
// lint that skill and tell Claude about problems while it is still editing.
//
// Errors go to Claude every time (exit 2 + stderr, the documented way to show a
// PostToolUse hook's message to Claude). Warnings go once: the hook remembers
// what it last reported for each skill, so the same warning doesn't come back
// on every edit. Notes (info) never interrupt; `skillio check` shows them.
//
// Off switch: SKILLIO_HOOK=off in the environment.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, basename, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';

if (process.env.SKILLIO_HOOK === 'off') process.exit(0);

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { input += d; });
process.stdin.on('end', async () => {
  let event;
  try { event = JSON.parse(input); } catch { process.exit(0); }
  const file = event?.tool_input?.file_path ?? event?.tool_input?.path;
  if (!file || typeof file !== 'string') process.exit(0);
  const abs = resolve(event.cwd ?? process.cwd(), file);
  if (/\/(node_modules|vendor|\.git)\//.test(abs) || /-workspace\//.test(abs) || /\/test\/fixtures\//.test(abs)) process.exit(0);

  // The skill this file belongs to: the nearest folder (up to 3 levels) with a SKILL.md.
  let dir = basename(abs) === 'SKILL.md' ? dirname(abs) : null;
  if (!dir) {
    let d = dirname(abs);
    for (let i = 0; i < 3 && !dir; i++) {
      if (existsSync(join(d, 'SKILL.md'))) dir = d;
      const up = dirname(d);
      if (up === d) break;
      d = up;
    }
  }
  if (!dir) process.exit(0);

  let lintSkill;
  try { ({ lintSkill } = await import('./lib/lint.mjs')); } catch { process.exit(0); }
  let result;
  try { result = lintSkill(dir, { target: 'claude-code' }); } catch (e) { process.exit(0); }

  const errors = result.findings.filter(f => f.severity === 'error');
  const warns = result.findings.filter(f => f.severity === 'warn');

  const stateDir = process.env.CLAUDE_PLUGIN_DATA ? join(process.env.CLAUDE_PLUGIN_DATA, 'hook-state') : join(tmpdir(), 'skillio-hook-state');
  const key = createHash('sha1').update(dir).digest('hex').slice(0, 16);
  const stateFile = join(stateDir, key + '.json');
  let previous = [];
  try { previous = JSON.parse(readFileSync(stateFile, 'utf8')); } catch {}
  const sig = f => `${f.id}|${f.file ?? ''}|${f.message}`;
  const newWarns = warns.filter(w => !previous.includes(sig(w)));
  try { mkdirSync(stateDir, { recursive: true }); writeFileSync(stateFile, JSON.stringify(warns.map(sig))); } catch {}

  const show = [...errors, ...newWarns].slice(0, 8);
  if (!show.length) process.exit(0);
  const name = result.info.name ?? basename(dir);
  const lines = [`Skillio lint for skill "${name}" after this edit:`];
  for (const f of show) lines.push(`- ${f.severity.toUpperCase()} ${f.id} ${f.file ?? ''}${f.line ? ':' + f.line : ''}: ${f.message}`);
  const more = errors.length + newWarns.length - show.length;
  if (more > 0) lines.push(`- and ${more} more; run the Skillio check for the full list.`);
  lines.push(errors.length ? 'Fix the errors before moving on; the skill may not load or upload as written.' : 'Warnings are reported once; fix them or note why they are fine.');
  process.stderr.write(lines.join('\n') + '\n');
  process.exit(2);
});
