// Turns findings into a report a person can learn from: each rule that fired
// gets its plain-words explanation from docs/principles.md, so a check doubles
// as a lesson on why the rule exists.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEVERITY_ORDER } from './rules.mjs';

export const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PRINCIPLES = join(PLUGIN_ROOT, 'docs', 'principles.md');

export function githubAnchor(heading) {
  return heading.trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s/g, '-');
}

let cache = null;
export function principles() {
  if (cache) return cache;
  cache = new Map();
  if (!existsSync(PRINCIPLES)) return cache;
  const text = readFileSync(PRINCIPLES, 'utf8');
  const parts = text.split(/^### /m).slice(1);
  for (const part of parts) {
    const heading = part.split('\n')[0];
    const id = heading.match(/^([A-Z]\d{3})\b/)?.[1];
    if (!id) continue;
    const plain = part.match(/\*\*In plain words\.\*\*\s*([\s\S]*?)(?:\n\s*\n|$)/)?.[1]?.replace(/\s+/g, ' ').trim();
    const why = part.match(/\*\*Why it matters\.\*\*\s*([\s\S]*?)(?:\n\s*\n|$)/)?.[1]?.replace(/\s+/g, ' ').trim();
    cache.set(id, { heading, anchor: githubAnchor(heading), plain, why });
  }
  return cache;
}

export function sortFindings(findings) {
  return [...findings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.id.localeCompare(b.id));
}

export function counts(findings) {
  const c = { error: 0, warn: 0, info: 0 };
  for (const f of findings) c[f.severity]++;
  return c;
}

export function verdict(c, extra = {}) {
  if (c.error) return 'Not ready: fix the errors first.';
  if (extra.evalsMissing) return 'Loads cleanly, but untested: no eval suite measures it yet.';
  if (c.warn) return 'Usable, with warnings worth fixing before you share it.';
  return 'Clean on every static check.';
}

const LABEL = { error: 'Errors', warn: 'Warnings', info: 'Notes' };

export function renderFindings(findings, { docsBase = 'docs/principles.md', explain = true } = {}) {
  const p = principles();
  const lines = [];
  const sorted = sortFindings(findings);
  const explained = new Set();
  for (const sev of ['error', 'warn', 'info']) {
    const group = sorted.filter(f => f.severity === sev);
    if (!group.length) continue;
    lines.push(`### ${LABEL[sev]} (${group.length})`, '');
    for (const f of group) {
      const where = f.skill ? `${f.skill}${f.file ? '/' + f.file : ''}${f.line ? ':' + f.line : ''}` : `${f.file ?? ''}${f.line ? ':' + f.line : ''}`;
      lines.push(`- **${f.id}** ${f.title}${where ? ` (${where})` : ''}. ${f.message}`);
      const doc = p.get(f.id);
      if (explain && doc?.plain && !explained.has(f.id)) {
        explained.add(f.id);
        lines.push(`  In plain words: ${doc.plain} [More](${docsBase}#${doc.anchor})`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

export function terminalFindings(findings) {
  const p = principles();
  const sym = { error: 'ERROR', warn: 'WARN ', info: 'NOTE ' };
  const out = [];
  const explained = new Set();
  for (const f of sortFindings(findings)) {
    const where = `${f.skill ? f.skill + '/' : ''}${f.file ?? ''}${f.line ? ':' + f.line : ''}`;
    out.push(`${sym[f.severity]} ${f.id} ${where ? where + '  ' : ''}${f.message}`);
    const doc = p.get(f.id);
    if (doc?.plain && !explained.has(f.id) && f.severity !== 'info') {
      explained.add(f.id);
      out.push(`       why: ${doc.plain}`);
    }
  }
  return out.join('\n');
}
