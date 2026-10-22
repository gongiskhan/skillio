// Works out what a path points at (one skill, a plugin, a marketplace, or a
// folder of skills) and where Skillio keeps its working files for it.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, basename, dirname } from 'node:path';
import { findPluginRoot, readPluginJson } from './evals.mjs';

export function detectTarget(p) {
  const path = resolve(p);
  if (!existsSync(path)) throw new Error(`${p} does not exist`);
  if (statSync(path).isFile()) {
    if (basename(path) === 'SKILL.md') return detectTarget(dirname(path));
    throw new Error(`${p} is a file; point at a skill folder, a plugin folder or a SKILL.md`);
  }
  const hasPlugin = existsSync(join(path, '.claude-plugin', 'plugin.json'));
  const hasMarket = existsSync(join(path, '.claude-plugin', 'marketplace.json'));
  if (hasPlugin) {
    return { kind: 'plugin', path, pluginRoot: path, plugin: readPluginJson(path), skills: pluginSkills(path), marketplace: hasMarket };
  }
  if (existsSync(join(path, 'SKILL.md'))) {
    // Part of a plugin only if the plugin actually loads it (skills/ or a path
    // in plugin.json); a fixture or vendored skill inside a plugin repo is standalone.
    let pluginRoot = findPluginRoot(dirname(path));
    if (pluginRoot && !pluginSkills(pluginRoot).includes(path)) pluginRoot = null;
    return { kind: 'skill', path, pluginRoot, plugin: pluginRoot ? readPluginJson(pluginRoot) : null, skills: [path] };
  }
  if (hasMarket) {
    const m = JSON.parse(readFileSync(join(path, '.claude-plugin', 'marketplace.json'), 'utf8'));
    const roots = (m.plugins ?? [])
      .map(e => (typeof e.source === 'string' ? resolve(path, e.source) : null))
      .filter(r => r && existsSync(r));
    return { kind: 'marketplace', path, pluginRoot: null, plugins: roots, skills: roots.flatMap(pluginSkills) };
  }
  const skills = skillDirsUnder(path, 3);
  if (skills.length) return { kind: 'skills-dir', path, pluginRoot: null, skills };
  throw new Error(`${p} has no SKILL.md, no .claude-plugin/ and no skills below it`);
}

export function pluginSkills(root) {
  const out = new Set();
  const pj = readPluginJson(root) ?? {};
  const add = dir => { if (existsSync(join(dir, 'SKILL.md'))) out.add(resolve(dir)); };
  const scan = dir => {
    if (!existsSync(dir)) return;
    add(dir);
    for (const e of readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) add(join(dir, e.name));
  };
  scan(join(root, 'skills'));
  const extra = pj.skills ? (Array.isArray(pj.skills) ? pj.skills : [pj.skills]) : [];
  for (const s of extra) if (typeof s === 'string') scan(resolve(root, s));
  if (!existsSync(join(root, 'skills')) && !extra.length) add(root);
  return [...out];
}

function skillDirsUnder(dir, depth) {
  const out = [];
  const walk = (d, n) => {
    if (existsSync(join(d, 'SKILL.md'))) { out.push(d); return; }
    if (n >= depth) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules' || e.name.endsWith('-workspace')) continue;
      walk(join(d, e.name), n + 1);
    }
  };
  walk(dir, 0);
  return out;
}

// Working files live next to the thing being worked on, never inside it, so
// they are not packaged with a skill or committed to a plugin repo. This is
// the same "<name>-workspace" convention skill-creator uses.
export function workspaceFor(target, skillDir) {
  if (target.pluginRoot) {
    const name = target.plugin?.name ?? basename(target.pluginRoot);
    const base = join(dirname(target.pluginRoot), `${name}-workspace`);
    return skillDir ? join(base, basename(skillDir)) : base;
  }
  const dir = skillDir ?? target.path;
  return join(dirname(dir), `${basename(dir)}-workspace`);
}

export function timestamp(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
