#!/usr/bin/env node
// PostToolUse hook: after Claude writes or edits a file inside a skill or a
// plugin, check it and tell Claude about problems while it is still editing.
//
// - Any file in a skill folder: Skillio's linter on that skill.
// - SKILL.md itself: also `claude plugin validate`, which reports what Claude
//   Code's own loader will make of the frontmatter (under a second).
// - A plugin's manifest, marketplace, hooks.json, agents or commands:
//   `claude plugin validate` on the plugin.
// Without Claude Code (another editor, CI) only the linter runs.
//
// Errors go to Claude every time (exit 2 + stderr, the documented way to show a
// PostToolUse hook's message to Claude). Warnings go once: the hook remembers
// what it last reported for each skill or plugin, so the same warning doesn't
// come back on every edit. Notes never interrupt; `skillio check` shows them.
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

  const pluginFile = pluginFileRoot(abs);
  if (pluginFile) return report(await validatePlugin(pluginFile), pluginFile.root);

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
  let findings = result.findings;

  // Claude Code's verdict on the frontmatter, unless the linter already found
  // a frontmatter error Claude has to fix first.
  const frontmatterBroken = findings.some(f => f.severity === 'error' && /^S/.test(f.id));
  if (basename(abs) === 'SKILL.md' && !frontmatterBroken) {
    try {
      const cc = await import('./lib/claude.mjs');
      if (cc.claudeInfo().found) {
        const v = cc.validate(dirname(dir));
        findings = findings.concat(cc.validateFindings(v, 'Claude Code loader', { componentsOnly: true, only: dir }));
      }
    } catch {}
  }
  report({ title: `Skillio lint for skill "${result.info.name ?? basename(dir)}" after this edit:`, findings }, dir);
});

// A plugin-level file and the plugin it belongs to, or null.
function pluginFileRoot(abs) {
  const rel = p => basename(dirname(p));
  let root = null, kind = null;
  if (rel(abs) === '.claude-plugin' && /^(plugin|marketplace)\.json$/.test(basename(abs))) { root = dirname(dirname(abs)); kind = basename(abs, '.json'); }
  else if (basename(abs) === 'hooks.json' && rel(abs) === 'hooks') { root = dirname(dirname(abs)); kind = 'hooks'; }
  else if (/\.md$/.test(abs) && ['agents', 'commands'].includes(rel(abs))) { root = dirname(dirname(abs)); kind = rel(abs); }
  if (!root) return null;
  const hasPlugin = existsSync(join(root, '.claude-plugin', 'plugin.json'));
  const hasMarket = existsSync(join(root, '.claude-plugin', 'marketplace.json'));
  if (!hasPlugin && !hasMarket) return null;
  return { root, kind, hasPlugin, hasMarket };
}

async function validatePlugin({ root, kind, hasPlugin, hasMarket }) {
  let cc;
  try { cc = await import('./lib/claude.mjs'); } catch { process.exit(0); }
  if (!cc.claudeInfo().found) process.exit(0);
  // With both manifests, the folder validates as a marketplace; the plugin
  // manifest needs its own pass.
  const path = kind === 'marketplace' || !hasPlugin ? root : hasMarket ? join(root, '.claude-plugin', 'plugin.json') : root;
  const v = cc.validate(path);
  const findings = cc.validateFindings(v, kind === 'marketplace' ? 'marketplace' : 'plugin')
    .filter(f => !/^\[plugin directory\]/.test(f.message)); // listing advice belongs in skillio check
  return { title: `claude plugin validate for ${basename(root)} after this edit:`, findings };
}

function report({ title, findings }, keyPath) {
  const errors = findings.filter(f => f.severity === 'error');
  const warns = findings.filter(f => f.severity === 'warn');
  const stateDir = process.env.CLAUDE_PLUGIN_DATA ? join(process.env.CLAUDE_PLUGIN_DATA, 'hook-state') : join(tmpdir(), 'skillio-hook-state');
  const key = createHash('sha1').update(keyPath).digest('hex').slice(0, 16);
  const stateFile = join(stateDir, key + '.json');
  let previous = [];
  try { previous = JSON.parse(readFileSync(stateFile, 'utf8')); } catch {}
  const sig = f => `${f.id}|${f.file ?? ''}|${f.message}`;
  const newWarns = warns.filter(w => !previous.includes(sig(w)));
  try { mkdirSync(stateDir, { recursive: true }); writeFileSync(stateFile, JSON.stringify(warns.map(sig))); } catch {}

  const show = [...errors, ...newWarns].slice(0, 8);
  if (!show.length) process.exit(0);
  const lines = [title];
  for (const f of show) lines.push(`- ${f.severity.toUpperCase()} ${f.id} ${f.file ?? ''}${f.line ? ':' + f.line : ''}: ${f.message}`);
  const more = errors.length + newWarns.length - show.length;
  if (more > 0) lines.push(`- and ${more} more; run the Skillio check for the full list.`);
  lines.push(errors.length ? 'Fix the errors before moving on; as written, this may not load or upload.' : 'Warnings are reported once; fix them or note why they are fine.');
  process.stderr.write(lines.join('\n') + '\n');
  process.exit(2);
}
