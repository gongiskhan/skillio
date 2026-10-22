// Static checks for one skill folder. Pure functions over the file system:
// no network, no model calls, fast enough to run from a hook on every edit.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, basename, dirname, relative, resolve, extname, sep } from 'node:path';
import { parseFrontmatter, splitFrontmatter } from './frontmatter.mjs';
import { RULES } from './rules.mjs';
import { SPEC_FIELDS, CLAUDE_CODE_FIELDS, FIELD_TYPES, LISTING_CAP } from './fields.mjs';

const TEXT_EXT = new Set(['.md', '.txt', '.json', '.yaml', '.yml', '.js', '.mjs', '.cjs', '.ts', '.py', '.sh', '.bash', '.zsh', '.html', '.css', '.csv', '.toml', '.ini', '.env', '.xml', '.sql', '']);
const JUNK = [/(^|\/)\.DS_Store$/, /(^|\/)__pycache__(\/|$)/, /(^|\/)node_modules(\/|$)/, /\.pyc$/, /(^|\/)\.env(\.|$)/, /\.log$/, /(^|\/)Thumbs\.db$/];
const HUMAN_DOCS = /^(README|CHANGELOG|INSTALL|INSTALLATION|CONTRIBUTING|QUICK_?REFERENCE)(\.md|\.txt)?$/i;

export function finding(id, message, extra = {}) {
  const rule = RULES[id];
  if (!rule) throw new Error(`unknown rule ${id}`);
  return { id, severity: extra.severity ?? rule.severity, title: rule.title, message, ...extra };
}

export function listFiles(dir, { skipDirs = ['.git', 'node_modules', '__pycache__'] } = {}) {
  const out = [];
  const walk = d => {
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, ent.name);
      if (ent.isDirectory()) {
        if (skipDirs.includes(ent.name)) { out.push({ path: p, rel: relative(dir, p) + '/', size: 0, dirOnly: true }); continue; }
        walk(p);
      } else if (ent.isFile()) {
        out.push({ path: p, rel: relative(dir, p).split(sep).join('/'), size: statSync(p).size });
      }
    }
  };
  walk(dir);
  return out;
}

// target: 'claude-code' (default), 'claude-ai' (also the API), or 'portable' (both).
export function lintSkill(skillDir, opts = {}) {
  const target = opts.target ?? 'claude-code';
  const dir = resolve(skillDir);
  const findings = [];
  const skillMd = join(dir, 'SKILL.md');
  const info = { dir, folder: basename(dir), name: null, description: null, bodyLines: 0, bodyTokens: 0, files: 0, bytes: 0 };

  if (!existsSync(skillMd)) {
    findings.push(finding('S001', `No SKILL.md in ${dir}. A skill is a folder whose SKILL.md starts with name and description frontmatter.`, { file: dir }));
    return { info, findings };
  }
  const text = readFileSync(skillMd, 'utf8');
  const fm = parseFrontmatter(text);
  if (!fm.hasFrontmatter) {
    findings.push(finding('S002', fm.unterminated
      ? 'The frontmatter opens with --- but never closes with a second --- line.'
      : 'SKILL.md must start with a --- line, then name: and description:, then another --- line.', { file: 'SKILL.md', line: 1 }));
  } else if (fm.errors.length) {
    findings.push(finding('S003', fm.errors[0], { file: 'SKILL.md' }));
  }
  const data = fm.data ?? {};
  info.name = typeof data.name === 'string' ? data.name : null;
  info.description = typeof data.description === 'string' ? data.description.trim() : null;
  info.frontmatter = data;

  if (fm.hasFrontmatter) checkYamlStrictness(fm, findings);
  if (fm.hasFrontmatter && !fm.errors.length) checkFrontmatter(data, info, target, findings);
  if (info.description) {
    const whenToUse = typeof data.when_to_use === 'string' ? data.when_to_use.trim() : '';
    checkDescription(info.description, findings, { ...opts, whenToUse: target === 'claude-code' ? whenToUse : '' });
    const listed = info.description.length + (whenToUse ? whenToUse.length + 1 : 0);
    if (listed > LISTING_CAP) {
      findings.push(finding('D007', `description${whenToUse ? ' plus when_to_use' : ''} is ${listed} characters; Claude Code cuts each skill's listing at ${LISTING_CAP}, so the end never reaches Claude. Put the main use case first and trim.`, { file: 'SKILL.md' }));
    }
  }

  const bodyLines = fm.body.split('\n');
  while (bodyLines.length && bodyLines[bodyLines.length - 1].trim() === '') bodyLines.pop();
  info.bodyLines = bodyLines.length;
  info.bodyTokens = Math.round(fm.body.length / 4);
  checkBody(fm, dir, info, findings);

  const files = listFiles(dir);
  info.files = files.filter(f => !f.dirOnly).length;
  info.bytes = files.reduce((n, f) => n + f.size, 0);
  checkPackage(files, dir, findings);
  checkReferences(text, fm, dir, files, findings);
  return { info, findings };
}

// --- frontmatter ------------------------------------------------------------

function checkYamlStrictness(fm, findings) {
  // Lenient parsers (and Claude Code) often accept `description: Use when: x`,
  // but strict YAML (PyYAML, the Agent Skills validator, Claude app uploads)
  // rejects a plain value containing ": " and cuts it at " #".
  const lines = fm.yaml.split('\n');
  lines.forEach((l, i) => {
    const m = l.match(/^([A-Za-z0-9_-]+):\s+(.*)$/);
    if (!m) return;
    const v = m[2].trim();
    if (/^["'|>\[{]/.test(v)) return;
    if (/:\s/.test(v)) findings.push(finding('S004', `"${m[1]}" has an unquoted ": " inside its value. Wrap the value in quotes or use "${m[1]}: >-" with the text on the next lines.`, { file: 'SKILL.md', line: i + 2 }));
    else if (/\s#/.test(v)) findings.push(finding('S004', `"${m[1]}" has " #" inside an unquoted value; YAML treats everything after it as a comment. Quote the value.`, { file: 'SKILL.md', line: i + 2 }));
  });
}

function checkFrontmatter(data, info, target, findings) {
  const name = data.name;
  if (name === undefined || name === null || name === '') {
    findings.push(finding('S005', 'Add a name: field. The Agent Skills spec requires it, and the Claude app and API reject skills without one.', { file: 'SKILL.md', fix: `name: ${slug(info.folder)}` }));
  } else if (typeof name !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) || name.length > 64) {
    findings.push(finding('S005', `name "${name}" must be 1 to 64 characters of lowercase letters, digits and single hyphens, not starting or ending with a hyphen.`, { file: 'SKILL.md', fix: `name: ${slug(String(name))}` }));
  }
  if (typeof name === 'string' && /anthropic|claude/i.test(name)) {
    findings.push(finding('S006', `name "${name}" contains "anthropic" or "claude", which the Claude app and API reserve.`, { file: 'SKILL.md' }));
  }
  if (typeof name === 'string' && name && name !== info.folder) {
    findings.push(finding('S007', `name "${name}" differs from the folder "${info.folder}". The Agent Skills spec requires them to match, and mismatches confuse people looking for the file.`, { file: 'SKILL.md' }));
  }
  const desc = data.description;
  if (desc === undefined || desc === null || String(desc).trim() === '') {
    findings.push(finding('S008', 'Add a description: field. It is the only text Claude sees when deciding whether to load the skill.', { file: 'SKILL.md' }));
  } else {
    const d = String(desc);
    if (d.length > 1024) findings.push(finding('S009', `description is ${d.length} characters; the limit is 1,024. Cut the least distinctive trigger phrases first.`, { file: 'SKILL.md' }));
    if (/[<>]/.test(d)) findings.push(finding('S010', 'description contains < or >. The Claude app and API reject angle brackets in the description (they look like XML tags).', { file: 'SKILL.md' }));
  }
  for (const key of Object.keys(data)) {
    if (SPEC_FIELDS.has(key)) continue;
    if (CLAUDE_CODE_FIELDS.has(key)) {
      if (target !== 'claude-code') {
        findings.push(finding('S012', `"${key}" is a Claude Code field. Uploads to the Claude app or the API only accept ${[...SPEC_FIELDS].join(', ')}; move it out or drop it for that build.`, { file: 'SKILL.md' }));
      }
      continue;
    }
    findings.push(finding('S011', `"${key}" is not a field Claude Code or the Agent Skills spec reads, so it does nothing${target !== 'claude-code' ? ' and makes the Claude app upload fail' : ''}. Put custom data under metadata:.`, { file: 'SKILL.md' }));
  }
  for (const [key, check] of Object.entries(FIELD_TYPES)) {
    if (data[key] === undefined) continue;
    const problem = check(data[key]);
    if (problem) findings.push(finding('S013', `"${key}" ${problem}`, { file: 'SKILL.md' }));
  }
}

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'my-skill';
}

// --- description --------------------------------------------------------------

const WHEN_RE = /\b(use (this|it|when|whenever|for|if|to)|use this skill|when (the )?(user|you|someone|asked|working|creating|editing|reviewing|building)|whenever|trigger(s|ed)? (when|on)|for (requests|tasks|questions) (about|like|that)|activates? when|applies when|invoke when)\b/i;
const FIRST_SECOND = /\b(I can|I will|I'll|I help|I am|I'm|you can|you will|you'll|we can|we will|lets you|let me)\b/i;
const VAGUE = /\b(helps? with|various|stuff|things|etc\.?|and more|general purpose|anything related to|all kinds of)\b/i;
const STEPS = /\b(first[, ].{0,60}\bthen\b|step \d|steps?:|1\)|1\.\s.*2\.\s|then (it|you) (runs?|writes?|creates?))/i;

function checkDescription(desc, findings, opts) {
  if (!WHEN_RE.test(desc) && !(opts.whenToUse && opts.whenToUse.length > 20)) {
    findings.push(finding('D001', 'The description never says when to use the skill. Add a "Use when ..." sentence naming the situations, words and file types that should trigger it.', { file: 'SKILL.md' }));
  }
  const fp = desc.match(FIRST_SECOND);
  if (fp) findings.push(finding('D002', `"${fp[0]}" puts the description in first or second person. Write it in the third person ("Extracts ...", "Use when the user ..."); the description is injected into Claude's system prompt and a shifting point of view hurts discovery.`, { file: 'SKILL.md' }));
  if (desc.length < 80) findings.push(finding('D003', `The description is only ${desc.length} characters. Short descriptions under-trigger: name the task, the inputs, and the words a user would actually type.`, { file: 'SKILL.md' }));
  if (STEPS.test(desc)) findings.push(finding('D004', 'The description reads like a procedure. Say what the skill is for and when to use it; keep the steps in the body, or Claude may follow the summary instead of loading the skill.', { file: 'SKILL.md' }));
  const vg = desc.match(VAGUE);
  if (vg) findings.push(finding('D005', `"${vg[0]}" is vague. Replace it with the concrete tasks, nouns and file types the skill handles.`, { file: 'SKILL.md' }));
  for (const p of opts.evalPrompts ?? []) {
    const span = sharedSpan(desc, p.prompt, 6);
    if (span) {
      findings.push(finding('D006', `The description repeats "${span}" from eval case "${p.name}"${p.heldOut ? ' (a held-out case)' : ''}. Describe the intent instead of quoting test prompts, or the trigger score stops meaning anything.`, { file: 'SKILL.md', severity: p.heldOut ? 'error' : 'warn' }));
    }
  }
}

const STOP = new Set('a an the to of and or in on for with is are be this that it as at by from your you user when use skill'.split(' '));

export function sharedSpan(a, b, n) {
  const wa = words(a), wb = words(b);
  if (wa.length < n || wb.length < n) return null;
  const grams = new Map();
  for (let i = 0; i + n <= wb.length; i++) grams.set(wb.slice(i, i + n).join(' '), i);
  for (let i = 0; i + n <= wa.length; i++) {
    const g = wa.slice(i, i + n);
    if (g.filter(w => !STOP.has(w)).length < 3) continue;
    if (grams.has(g.join(' '))) {
      let j = i + n, k = grams.get(g.join(' ')) + n;
      while (j < wa.length && k < wb.length && wa[j] === wb[k]) { j++; k++; }
      return wa.slice(i, j).join(' ');
    }
  }
  return null;
}

export function words(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9à-ÿ'\s-]/g, ' ').split(/\s+/).filter(Boolean);
}

// --- body ---------------------------------------------------------------------

function checkBody(fm, dir, info, findings) {
  const body = fm.body;
  const lineOf = idx => fm.bodyStartLine + body.slice(0, idx).split('\n').length - 1;
  if (info.bodyLines > 500) {
    findings.push(finding('B001', `The body is ${info.bodyLines} lines. Anthropic's guidance is under 500: move detail into reference files that SKILL.md points to, with a line saying when to read each.`, { file: 'SKILL.md' }));
  }
  if (info.bodyTokens > 5000) {
    findings.push(finding('B002', `The body is roughly ${info.bodyTokens} tokens, all of which load every time the skill triggers. Move material that only some runs need into references.`, { file: 'SKILL.md' }));
  }
  const nonEmpty = body.split('\n').filter(l => l.trim()).length;
  if (nonEmpty < 5) findings.push(finding('B011', `The body has ${nonEmpty} non-empty lines. If the description triggers the skill, Claude gets almost nothing to act on.`, { file: 'SKILL.md' }));

  const inCode = codeRanges(body);
  const outside = (re, cb) => { for (const m of body.matchAll(re)) if (!inCode(m.index)) cb(m); };

  outside(/(?:^|[\s(`'"])((?:[A-Za-z]:)?(?:[\w.-]+\\){1,}[\w.-]+\.\w{1,5})/g, m => {
    findings.push(finding('B006', `"${m[1]}" uses backslashes. Use forward slashes; they work on every platform, backslashes only on Windows.`, { file: 'SKILL.md', line: lineOf(m.index) }));
  });

  const caps = [...body.matchAll(/\b(MUST(?: NOT)?|NEVER|ALWAYS|CRITICAL|IMPORTANT|DO NOT|DON'T|REQUIRED)\b/g)].filter(m => !inCode(m.index));
  if (caps.length >= 8) {
    findings.push(finding('B007', `${caps.length} all-caps commands (MUST, NEVER, ALWAYS...). Current models follow reasons better than volume: keep caps for the one or two true hard limits and explain why for the rest.`, { file: 'SKILL.md' }));
  }

  const timeRe = /\b(as of (?:early |late |mid-)?(?:20\d\d|january|february|march|april|may|june|july|august|september|october|november|december)|currently|the latest version|recently released|new feature|until (?:20\d\d|january|february|march|april|may|june|july|august|september|october|november|december)|before (?:20\d\d))\b/gi;
  outside(timeRe, m => {
    findings.push(finding('B008', `"${m[0]}" will go stale. State the fact without a date, or put dated material in a clearly labelled "old patterns" section.`, { file: 'SKILL.md', line: lineOf(m.index) }));
  });

  for (const m of body.matchAll(/(?:^|[\s`])(\.?\/?scripts\/[\w./-]+\.(?:sh|py|js|mjs|ts|rb))\b/g)) {
    const before = body.slice(Math.max(0, m.index - 24), m.index + 1);
    if (/\b(bash|sh|zsh|python3?|node|npx|deno|bun|tsx|ruby|uv run)\s+(?:-\w+\s+)*[`"]?\$?\{?[\w_]*\}?\/?$/.test(before.trimEnd() + (before.endsWith(' ') ? ' ' : ''))) continue;
    if (/\b(bash|sh|python3?|node|bun|deno|ruby)\s+[^\n]{0,20}$/.test(before)) continue;
    const line = body.split('\n')[lineOf(m.index) - fm.bodyStartLine] ?? '';
    if (/^\s*(\$\s+)?(bash|sh|python3?|node|bun|deno|ruby|uv run|npx)\b/.test(line)) continue;
    if (!/\.(sh|py|js|mjs|ts|rb)\b/.test(m[1])) continue;
    if (!/(run|execute|call|invoke)\b/i.test(line) && !/^\s*(\$\s+)?\.?\/?scripts\//.test(line)) continue;
    findings.push(finding('B009', `"${m[1]}" is run by bare path. Write "bash scripts/x.sh", "python3 scripts/x.py" or "node scripts/x.mjs": some packagers drop the executable bit, and a bare path then fails with "Permission denied".`, { file: 'SKILL.md', line: lineOf(m.index) }));
  }

  const ph = body.match(/\b(TODO|TBD|FIXME|lorem ipsum|XXX)\b/);
  if (ph && !inCode(ph.index)) findings.push(finding('B012', `"${ph[0]}" is still in SKILL.md. Placeholders get read as instructions.`, { file: 'SKILL.md', line: lineOf(ph.index) }));
}

function codeRanges(text) {
  const ranges = [];
  const re = /```[\s\S]*?```|`[^`\n]+`/g;
  for (const m of text.matchAll(re)) ranges.push([m.index, m.index + m[0].length]);
  return idx => ranges.some(([a, b]) => idx >= a && idx < b);
}

// --- links and references ----------------------------------------------------------

export function localLinks(markdown) {
  const out = [];
  // Fenced blocks usually show example layouts, not real references.
  markdown = markdown.replace(/```[\s\S]*?```/g, m => ' '.repeat(m.length));
  const add = (target, index, kind) => {
    let t = target.trim().replace(/^<|>$/g, '');
    if (!t || /^(https?:|mailto:|#|\/\/|data:)/i.test(t)) return;
    if (/\$\{|\$[A-Z_]|~\//.test(t)) return; // variables and home paths are runtime paths
    t = t.split('#')[0].split('?')[0];
    if (!t) return;
    out.push({ target: t, index, kind });
  };
  for (const m of markdown.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) add(m[1], m.index, 'link');
  // Backticked or bare relative paths like `references/api.md` or scripts/run.py.
  for (const m of markdown.matchAll(/(?:^|[\s`'"(])((?:\.\/)?(?:references|reference|scripts|assets|templates|examples|docs|agents)\/[\w./-]*\w)/g)) add(m[1], m.index, 'bare');
  return out;
}

function checkReferences(text, fm, dir, files, findings) {
  const body = fm.body;
  const lineOf = idx => fm.bodyStartLine + body.slice(0, idx).split('\n').length - 1;
  const fileSet = new Set(files.filter(f => !f.dirOnly).map(f => f.rel));
  const dirSet = new Set();
  for (const f of fileSet) { const parts = f.split('/'); for (let i = 1; i < parts.length; i++) dirSet.add(parts.slice(0, i).join('/')); }
  const mentioned = new Set(['SKILL.md']);
  const seen = new Set();
  const reported = new Set();

  const resolveLink = (fromRel, target) => {
    const base = dirname(fromRel);
    const joined = join(base === '.' ? '' : base, target).split(sep).join('/').replace(/^\.\//, '');
    return joined.replace(/\/$/, '');
  };

  const direct = [];
  for (const l of localLinks(body)) {
    const rel = resolveLink('SKILL.md', l.target);
    const key = rel + '@' + l.index;
    if (seen.has(key)) continue;
    seen.add(key);
    if (rel.startsWith('..')) continue; // points outside the skill: shared plugin docs, checked elsewhere
    if (fileSet.has(rel)) { mentioned.add(rel); direct.push(rel); continue; }
    if (dirSet.has(rel)) { for (const f of fileSet) if (f.startsWith(rel + '/')) mentioned.add(f); continue; }
    if (/[*{}<>]/.test(rel)) continue;
    // A bare path only counts as a reference when its folder exists in the skill;
    // otherwise it is usually a path Claude is told to create at run time.
    if (l.kind === 'bare' && !dirSet.has(rel.split('/')[0])) continue;
    if (l.kind === 'bare' && !/\.\w{1,5}$/.test(rel)) continue;
    if (reported.has(rel)) continue;
    reported.add(rel);
    findings.push(finding('B003', `SKILL.md points to "${l.target}", which is not in the skill folder${l.kind === 'bare' ? ' (if it is only an example path, ignore this)' : ''}.`, { file: 'SKILL.md', line: lineOf(l.index), severity: l.kind === 'bare' ? 'warn' : 'error' }));
  }

  // Case mismatches: FORMS.md in the text, forms.md on disk. Works on macOS,
  // fails on Linux (where the Claude app and most CI run).
  const lowerMap = new Map([...fileSet].map(f => [f.toLowerCase(), f]));
  const plain = body.replace(/```[\s\S]*?```/g, ' ');
  for (const m of plain.matchAll(/(?:^|[\s`'"(\/])((?:[\w-]+\/)*[\w-]+\.(?:md|py|sh|js|mjs|ts|json|txt|yaml|yml|html|csv))\b/g)) {
    const t = m[1].replace(/^\.\//, '');
    if (fileSet.has(t) || reported.has(t)) continue;
    const actual = lowerMap.get(t.toLowerCase());
    if (actual) {
      reported.add(t);
      mentioned.add(actual);
      findings.push(finding('B003', `SKILL.md says "${t}" but the file is "${actual}". That works on macOS and Windows, which ignore case, and fails on Linux, where the Claude app and API run skills.`, { file: 'SKILL.md', severity: 'error' }));
    }
  }

  // One level deep: files linked from SKILL.md should not send Claude on to more files
  // that SKILL.md itself never mentions. Claude tends to skim (head -100) nested files.
  for (const rel of new Set(direct)) {
    if (!rel.endsWith('.md')) continue;
    const content = readFileSync(join(dir, rel), 'utf8');
    for (const l of localLinks(content)) {
      let inner = resolveLink(rel, l.target);
      if (!fileSet.has(inner) && !dirSet.has(inner)) {
        const fromRoot = resolveLink('SKILL.md', l.target);
        if (fileSet.has(fromRoot) || dirSet.has(fromRoot)) inner = fromRoot;
      }
      if (inner.startsWith('..') && !existsSync(join(dir, inner))) continue;
      if (fileSet.has(inner)) {
        mentioned.add(inner);
        if (inner.endsWith('.md') && !direct.includes(inner)) {
          findings.push(finding('B004', `${rel} sends Claude on to ${inner}, which SKILL.md does not link. Link every reference file from SKILL.md directly so Claude reads it in full.`, { file: rel }));
        }
      } else if (!dirSet.has(inner) && /\.\w{1,5}$/.test(inner) && !inner.startsWith('..') && l.kind === 'link' && !reported.has(inner)) {
        reported.add(inner);
        findings.push(finding('B003', `${rel} points to "${l.target}", which is not in the skill folder.`, { file: rel }));
      }
    }
    const lines = content.split('\n').length;
    if (lines > 100 && !/^#{1,3}\s*(table of )?contents\b/im.test(content) && !/^\s*[-*]\s*\[[^\]]+\]\(#/m.test(content)) {
      findings.push(finding('B005', `${rel} is ${lines} lines with no table of contents. Claude may preview only the top of a long file; a contents list up front shows it everything that is there.`, { file: rel }));
    }
  }

  // Orphans: files nothing points to never get used (or get used by accident).
  const allText = [text, ...[...mentioned].filter(r => r !== 'SKILL.md' && /\.(md|txt)$/.test(r)).map(r => readFileSync(join(dir, r), 'utf8'))].join('\n');
  const orphans = [];
  for (const f of fileSet) {
    if (mentioned.has(f)) continue;
    if (/(^|\/)(LICENSE|LICENCE|NOTICE)(\.\w+)?$/i.test(f)) continue;
    if (!f.includes('/') && HUMAN_DOCS.test(f)) continue; // reported as P003
    if (f.startsWith('evals/') || /(^|\/)\./.test(f)) continue;
    const name = f.split('/').pop();
    if (allText.includes(f) || allText.includes(name)) continue;
    const dirs = f.split('/').slice(0, -1);
    if (dirs.some((d, i) => {
      const prefix = dirs.slice(0, i + 1).join('/');
      return allText.includes(prefix + '/') || new RegExp('[`\'"\\s(/]' + d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[`\'"\\s)/]').test(allText);
    })) continue;
    orphans.push(f);
  }
  const byDir = new Map();
  for (const f of orphans) {
    const top = f.includes('/') ? f.split('/')[0] + '/' : '';
    if (!byDir.has(top)) byDir.set(top, []);
    byDir.get(top).push(f);
  }
  for (const [top, list] of byDir) {
    if (top && list.length > 3) {
      findings.push(finding('B010', `${list.length} files under ${top} (${list.slice(0, 3).join(', ')}...) are never mentioned by SKILL.md or the files it links. Say when Claude should use them, or remove them.`, { file: top }));
    } else {
      for (const f of list) findings.push(finding('B010', `${f} is never mentioned by SKILL.md or the files it links. Either point to it with a line saying when to use it, or delete it.`, { file: f }));
    }
  }
}

// --- package hygiene ---------------------------------------------------------------

const SECRET_PATTERNS = [
  [/\bsk-ant-[A-Za-z0-9_-]{20,}/, 'an Anthropic API key'],
  [/\bsk-(?:proj-)?[A-Za-z0-9]{32,}/, 'an OpenAI-style API key'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'an AWS access key id'],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}\b/, 'a GitHub token'],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/, 'a Slack token'],
  [/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/, 'a private key'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, 'a Google API key'],
];
const GENERIC_SECRET = /(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token)\s*[:=]\s*["']([^"'\s]{16,})["']/gi;
const PLACEHOLDER = /(example|sample|dummy|test|demo|your|my[_-]|xxx|placeholder|changeme|redacted|\*\*\*|\.\.\.|<|\$\{|process\.env|os\.environ)/i;

function genericSecret(content) {
  for (const m of content.matchAll(GENERIC_SECRET)) {
    const v = m[1];
    if (PLACEHOLDER.test(v)) continue;
    if (!/[a-z]/i.test(v) || !/\d/.test(v)) continue;
    if (new Set(v).size < 10) continue;
    return m;
  }
  return null;
}

function checkPackage(files, dir, findings) {
  const junk = [];
  let docs = [];
  let large = [];
  for (const f of files) {
    if (JUNK.some(re => re.test(f.rel))) { junk.push(f.rel); continue; }
    if (f.dirOnly) continue;
    if (HUMAN_DOCS.test(basename(f.rel)) && !f.rel.includes('/')) docs.push(f.rel);
    if (f.size > 2 * 1024 * 1024) large.push(`${f.rel} (${(f.size / 1048576).toFixed(1)} MB)`);
    const ext = extname(f.rel).toLowerCase();
    if (TEXT_EXT.has(ext) && f.size < 1024 * 1024) {
      const content = readFileSync(f.path, 'utf8');
      let hit = null;
      for (const [re, what] of SECRET_PATTERNS) {
        const m = content.match(re);
        if (m) { hit = { m, what, severity: 'error' }; break; }
      }
      if (!hit) {
        const m = genericSecret(content);
        if (m) hit = { m, what: 'a hard-coded password or key', severity: 'warn' };
      }
      if (hit) {
        const line = content.slice(0, hit.m.index).split('\n').length;
        findings.push(finding('P001', `Looks like ${hit.what}. Skills get shared, uploaded and scanned; keep credentials in the environment or a secret store and read them at run time.`, { file: f.rel, line, severity: hit.severity }));
      }
    }
  }
  if (junk.length) findings.push(finding('P002', `Remove ${junk.slice(0, 5).join(', ')}${junk.length > 5 ? ` and ${junk.length - 5} more` : ''} from the skill folder; it ships with the skill.`, { file: junk[0] }));
  if (docs.length) findings.push(finding('P003', `${docs.join(', ')} is written for people, but everything in the skill folder is there for Claude. Keep human docs (install notes, changelog) next to the skill, not inside it, unless SKILL.md tells Claude to read them.`, { file: docs[0] }));
  const total = files.reduce((n, f) => n + f.size, 0);
  if (large.length || total > 8 * 1024 * 1024) {
    findings.push(finding('P004', `${large.length ? large.join(', ') + '. ' : ''}The folder holds ${(total / 1048576).toFixed(1)} MB. Uploads to the Claude app have size limits, and big assets slow every install.`, { file: large[0]?.split(' ')[0] }));
  }
}
