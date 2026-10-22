// Finds the other skills Claude would see next to this one, and how much
// their descriptions overlap with it. Two skills with similar descriptions
// compete for the same requests, and Claude picks between them on wording
// alone, so overlap is the usual cause of "it fired the wrong skill".

import { readdirSync, readFileSync, existsSync, statSync, realpathSync } from 'node:fs';
import { join, resolve, basename, dirname } from 'node:path';
import { homedir } from 'node:os';
import { parseFrontmatter } from './frontmatter.mjs';
import { LISTING_CAP } from './fields.mjs';

const STOP = new Set(`a an the and or but if then else of to in on at by for with from into onto as is are was were be been being this that these those it its
  use used uses using when whenever user users ask asks asked asking wants want need needs needed claude any all each every
  such like e.g eg i.e ie etc also do does doing done make makes making help helps including include includes via about over under more most
  should would could can will may might must not no yes than so very just only other another some your you their they them his her we our
  even explicitly mention mentions mentioned say says said request requests task tasks work working something things thing way ways`.split(/\s+/));

export function stem(w) {
  if (w.length > 5 && w.endsWith('ing')) {
    const base = w.slice(0, -3);
    return /([b-df-hj-np-tv-z])\1$/.test(base) ? base.slice(0, -1) : base;
  }
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 4 && w.endsWith('es') && !w.endsWith('ses')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  return w;
}

export function terms(text) {
  const out = new Map();
  // "Use this skill when..." is boilerplate; "skill" as a topic word is not.
  const cleaned = String(text).toLowerCase().replace(/\b(this|the|a|that) skill\b/g, ' ');
  for (const raw of cleaned.replace(/[^a-z0-9à-ÿ\s-]/g, ' ').split(/[\s-]+/)) {
    if (raw.length < 3 || STOP.has(raw)) continue;
    const t = stem(raw);
    out.set(t, (out.get(t) ?? 0) + 1);
  }
  return out;
}

export function similarity(a, b) {
  const ta = terms(a), tb = terms(b);
  let dot = 0, na = 0, nb = 0;
  for (const [, v] of ta) na += v * v;
  for (const [, v] of tb) nb += v * v;
  for (const [k, v] of ta) if (tb.has(k)) dot += v * tb.get(k);
  if (!na || !nb) return { score: 0, shared: [] };
  const shared = [...ta.keys()].filter(k => tb.has(k));
  return { score: dot / Math.sqrt(na * nb), shared };
}

function readSkill(skillMd, source) {
  try {
    const fm = parseFrontmatter(readFileSync(skillMd, 'utf8'));
    const d = fm.data ?? {};
    const dir = dirname(skillMd);
    const description = typeof d.description === 'string' ? d.description.trim() : '';
    const whenToUse = typeof d.when_to_use === 'string' ? d.when_to_use.trim() : '';
    const disabled = d['disable-model-invocation'] === true || /^(yes|on|true|1)$/i.test(String(d['disable-model-invocation'] ?? ''));
    return { name: typeof d.name === 'string' ? d.name : basename(dir), dir, path: skillMd, source, description, whenToUse, modelInvocable: !disabled };
  } catch {
    return null;
  }
}

function findSkillFiles(root, maxDepth) {
  const out = [];
  const walk = (d, depth) => {
    let ents;
    try { ents = readdirSync(d, { withFileTypes: true }); } catch { return; }
    if (ents.some(e => e.isFile() && e.name === 'SKILL.md')) out.push(join(d, 'SKILL.md'));
    if (depth >= maxDepth) return;
    for (const e of ents) {
      if (!e.isDirectory() && !e.isSymbolicLink()) continue;
      if (['node_modules', '.git', '__pycache__', 'evals', 'results', 'data'].includes(e.name) || e.name.endsWith('-workspace')) continue;
      const p = join(d, e.name);
      try { if (!statSync(p).isDirectory()) continue; } catch { continue; }
      walk(p, depth + 1);
    }
  };
  walk(root, 0);
  return out;
}

// Where Claude Code looks for skills. The plugin cache can hold several
// versions of one plugin; we keep one entry per name + description.
export function defaultRoots(cwd = process.cwd()) {
  const home = homedir();
  return [
    { path: join(home, '.claude', 'skills'), source: 'personal', depth: 4 },
    { path: join(cwd, '.claude', 'skills'), source: 'project', depth: 2 },
    { path: join(home, '.claude', 'plugins', 'cache'), source: 'plugin', depth: 7 },
    { path: join(home, '.claude', 'plugins', 'marketplaces'), source: 'marketplace', depth: 6, onlyIfInstalled: true },
  ];
}

export function inventory(roots = defaultRoots(), { exclude = [] } = {}) {
  const seen = new Set();
  const out = [];
  const excludeReal = new Set(exclude.map(p => { try { return realpathSync(p); } catch { return resolve(p); } }));
  for (const r of roots) {
    if (r.onlyIfInstalled) continue; // marketplace clones are not loaded unless installed
    if (!existsSync(r.path)) continue;
    for (const f of findSkillFiles(r.path, r.depth)) {
      let real;
      try { real = realpathSync(dirname(f)); } catch { real = dirname(f); }
      if ([...excludeReal].some(x => real === x || real.startsWith(x + '/'))) continue;
      const s = readSkill(f, r.source);
      if (!s || !s.description) continue;
      const key = s.name + '\u0000' + s.description;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s);
    }
  }
  return out;
}

export function listingSize(skills) {
  let chars = 0;
  for (const s of skills) {
    if (!s.modelInvocable) continue;
    const text = s.description + (s.whenToUse ? ' ' + s.whenToUse : '');
    chars += s.name.length + 4 + Math.min(text.length, LISTING_CAP);
  }
  return { chars, tokens: Math.round(chars / 4), count: skills.filter(s => s.modelInvocable).length };
}

export function compare(target, others, { threshold = 0.3, top = 5 } = {}) {
  const text = target.description + (target.whenToUse ? ' ' + target.whenToUse : '');
  return others
    .filter(o => o.path !== target.path && o.modelInvocable)
    .map(o => ({ other: o, ...similarity(text, o.description + (o.whenToUse ? ' ' + o.whenToUse : '')) }))
    .filter(r => r.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, top);
}
