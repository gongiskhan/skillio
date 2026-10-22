#!/usr/bin/env node
// Skillio command line. Every skill in this plugin calls this script for the
// deterministic parts of its job, so the same checks run whether Claude, a
// hook, CI or a person starts them.
//
//   node skillio.mjs <command> [args]       (run with no args for help)

import { existsSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync, appendFileSync, readdirSync } from 'node:fs';
import { join, resolve, basename, dirname, relative } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { lintSkill, finding } from './lib/lint.mjs';
import { detectTarget, workspaceFor, timestamp } from './lib/target.mjs';
import { inventory, compare, listingSize, defaultRoots } from './lib/collisions.mjs';
import { suiteSummary, writeTriggerCases, writeDecoy, listDecoys, readResults, triggerMetrics, listCases, classify, evalDir, readPluginJson, pct, lookupCase } from './lib/evals.mjs';
import { renderFindings, terminalFindings, counts, verdict, PLUGIN_ROOT } from './lib/report.mjs';

const HELP = `Skillio: tools for building, checking and improving Agent Skills.

Usage: node skillio.mjs <command> [options]

Static checks (free, no model calls)
  lint <path...>            Lint skills. --target claude-code|claude-ai|portable, --json
  collisions <path>         Compare a skill's description with every installed skill
  inventory                 List the skills Claude Code would see, and the listing size
  check <path>              Everything static: lint, collisions, eval-suite health,
                            claude plugin validate, skill-creator's validator.
                            Writes a report to the workspace. --target, --json, --no-claude

Evals (each run is a real model call on your account)
  evals <path>              Show the eval suite for a skill or plugin and what it covers
  trigger-cases <path> --skill <name> --from <file.json> [--runs n] [--overwrite]
                            Turn a trigger set ([{query, should_trigger, held_out}], the
                            format skill-creator exports) into claude plugin eval cases
  decoy <path> --name <n> --description <text>
                            Add a decoy: a stand-in skill with a rival's description that
                            run-evals installs beside the skill under test
  run-evals <path> [--tag t]... [--case glob] [--runs n] [-j n] [--max-cost usd]
            [--ablation none|with-without] [--model m] [--judge-model m] [--publish]
            [--allow-tools t...] [--label name] [--dry-run]
                            Run claude plugin eval isolated from your browser and
                            messaging, results into the workspace, then summarise
  results <aggregate-result.json> [--path <plugin-or-skill>]
                            Summarise a finished run: trigger recall, false fires, pass^k

Working files
  workspace <path>          Print the workspace folder for a skill or plugin
  snapshot <skill> [--label l]  Copy a skill into the workspace before changing it
  observe <skill> "<note>"  Log a real-use observation (a correction, a miss)
  observe <skill> --list    Show logged observations
  package <skill> [--out dir] [--force]
                            Zip a skill for upload to the Claude app (.zip and .skill)
`;

// --- tiny argv parser ------------------------------------------------------------

function parseArgs(argv) {
  const pos = [], opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-j') { opts.concurrency = argv[++i]; continue; }
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const [k, inline] = a.slice(2).split('=');
    const key = k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const multi = ['tag', 'decoy', 'allowTools', 'root'];
    if (inline !== undefined) { set(key, inline); continue; }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) { opts[key] = true; continue; }
    if (key === 'allowTools') { while (argv[i + 1] && !argv[i + 1].startsWith('--')) set(key, argv[++i]); continue; }
    set(key, argv[++i]);
    function set(kk, v) { if (multi.includes(kk)) (opts[kk] ??= []).push(v); else opts[kk] = v; }
  }
  return { pos, opts };
}

const out = s => process.stdout.write(s.endsWith('\n') ? s : s + '\n');
process.stdout.on('error', e => { if (e.code === 'EPIPE') process.exit(0); throw e; });
const fail = (msg, code = 1) => { process.stderr.write(`skillio: ${msg}\n`); process.exit(code); };

// --- lint ------------------------------------------------------------------------

function evalPromptsFor(target, skillDir, skillName) {
  const prompts = [];
  if (target.pluginRoot) {
    const s = suiteSummary(target.pluginRoot, skillName);
    for (const c of s.cases) if (c.cls.kind) prompts.push({ name: c.rel, prompt: c.prompt, heldOut: c.cls.heldOut });
  }
  const own = join(skillDir, 'evals');
  if (existsSync(own)) {
    for (const c of listCases(own)) prompts.push({ name: c.rel, prompt: c.prompt, heldOut: c.tags.includes('held-out') });
    const ej = join(own, 'evals.json');
    if (existsSync(ej)) {
      try { for (const e of JSON.parse(readFileSync(ej, 'utf8')).evals ?? []) prompts.push({ name: `evals.json#${e.id}`, prompt: e.prompt, heldOut: false }); } catch {}
    }
  }
  return prompts;
}

function lintTarget(target, opts) {
  const results = [];
  for (const dir of target.skills) {
    const quick = lintSkill(dir, { target: opts.target });
    const prompts = evalPromptsFor(target, dir, quick.info.name ?? basename(dir));
    const r = prompts.length ? lintSkill(dir, { target: opts.target, evalPrompts: prompts }) : quick;
    for (const f of r.findings) f.skill = basename(dir);
    results.push(r);
  }
  return results;
}

function cmdLint(pos, opts) {
  if (!pos.length) fail('lint needs a path');
  let all = [];
  const summaries = [];
  for (const p of pos) {
    const target = detectTarget(p);
    for (const r of lintTarget(target, opts)) {
      all = all.concat(r.findings);
      summaries.push({ skill: r.info.name ?? r.info.folder, dir: r.info.dir, bodyLines: r.info.bodyLines, findings: r.findings.length });
    }
  }
  const c = counts(all);
  if (opts.json) out(JSON.stringify({ counts: c, skills: summaries, findings: all }, null, 2));
  else {
    out(all.length ? terminalFindings(all) : 'No findings.');
    out(`\n${summaries.length} skill(s): ${c.error} error(s), ${c.warn} warning(s), ${c.info} note(s).`);
  }
  process.exit(c.error ? 1 : 0);
}

// --- collisions / inventory ---------------------------------------------------------

function collisionFindings(target, opts) {
  const findings = [];
  const roots = opts.root ? opts.root.map(r => ({ path: resolve(r), source: 'extra', depth: 6 })) : defaultRoots();
  const exclude = target.pluginRoot ? [target.pluginRoot] : target.skills;
  const installed = inventory(roots, { exclude });
  const own = target.skills.map(d => inventory([{ path: d, source: 'target', depth: 0 }])[0]).filter(Boolean);
  const results = [];
  for (const s of own) {
    // Siblings in the same plugin compete too.
    const siblings = own.filter(o => o !== s);
    const hits = compare(s, [...siblings, ...installed], { threshold: 0.25, top: 5 });
    results.push({ skill: s.name, hits: hits.map(h => ({ name: h.other.name, source: h.other.source, path: h.other.path, score: +h.score.toFixed(2), shared: h.shared.slice(0, 8) })) });
    for (const h of hits) {
      const severity = h.score >= 0.35 ? 'warn' : 'info';
      findings.push(finding('C001', `"${s.name}" and "${h.other.name}" (${h.other.source}) share ${h.shared.slice(0, 6).join(', ')} (similarity ${h.score.toFixed(2)}). When a request fits both, Claude picks on wording alone; say in each description what the other one is for, and test the routing with a trigger case.`, { skill: s.name, severity }));
    }
  }
  const size = listingSize([...installed, ...own]);
  if (size.tokens > 2000) {
    findings.push(finding('C002', `${size.count} model-invocable skills put about ${size.tokens} tokens of descriptions in front of Claude every session (${size.chars} characters). Claude Code budgets the listing at about 1% of the context window and shortens descriptions beyond it, so descriptions late in the list may lose their trigger words. Run /skill-doctor to find skills you never use.`, {}));
  }
  return { findings, results, installed: installed.length, size };
}

function cmdCollisions(pos, opts) {
  if (!pos[0]) fail('collisions needs a path');
  const target = detectTarget(pos[0]);
  const r = collisionFindings(target, opts);
  if (opts.json) return out(JSON.stringify(r, null, 2));
  out(`Compared against ${r.installed} installed skill(s).`);
  for (const s of r.results) {
    out(`\n${s.skill}:`);
    if (!s.hits.length) out('  no overlapping descriptions above 0.25');
    for (const h of s.hits) out(`  ${h.score.toFixed(2)}  ${h.name} [${h.source}]  shared: ${h.shared.join(', ')}`);
  }
  out(`\nListing: ${r.size.count} model-invocable skills, about ${r.size.tokens} tokens.`);
}

function cmdInventory(pos, opts) {
  const roots = opts.root ? opts.root.map(r => ({ path: resolve(r), source: 'extra', depth: 6 })) : defaultRoots();
  const all = inventory(roots);
  const size = listingSize(all);
  if (opts.json) return out(JSON.stringify({ size, skills: all }, null, 2));
  for (const s of all.sort((a, b) => a.source.localeCompare(b.source) || a.name.localeCompare(b.name))) {
    out(`${s.source.padEnd(9)} ${s.name.padEnd(36)} ${String(s.description.length).padStart(5)} chars${s.modelInvocable ? '' : '  (manual only)'}`);
  }
  out(`\n${all.length} skills; ${size.count} model-invocable, about ${size.tokens} tokens of listing.`);
}

// --- eval suite health ---------------------------------------------------------------

function suiteFindings(target, skillDir, skillName) {
  const findings = [];
  let summary = null;
  if (target.pluginRoot) summary = suiteSummary(target.pluginRoot, skillName);
  else if (existsSync(join(skillDir, 'evals'))) {
    const cases = listCases(join(skillDir, 'evals')).map(c => ({ ...c, cls: classify(c, skillName, null) }));
    summary = {
      dir: join(skillDir, 'evals'), total: cases.length, cases,
      shouldFire: cases.filter(c => c.cls.kind === 'should-fire').length,
      shouldNotFire: cases.filter(c => c.cls.kind === 'should-not-fire').length,
      heldOut: cases.filter(c => c.cls.heldOut).length,
      output: cases.filter(c => c.cls.output && !c.cls.kind).length,
      problems: cases.flatMap(c => c.problems.map(p => `${c.rel}: ${p}`)),
    };
  }
  const hasCreatorEvals = existsSync(join(skillDir, 'evals', 'evals.json'));
  if (!summary || summary.cases.length === 0) {
    findings.push(finding('E001', `No claude plugin eval cases mention ${skillName}${hasCreatorEvals ? ' (skill-creator\'s evals/evals.json exists, but plugin eval does not read it)' : ''}. Without cases, "it works" means "it worked the time I tried it". Building-skills can generate a trigger suite and output cases.`, { skill: skillName }));
    return { findings, summary };
  }
  if (summary.shouldFire && !summary.shouldNotFire) {
    findings.push(finding('E002', `${summary.shouldFire} should-fire case(s) and no should-not-fire case. A description that fires on everything passes every should-fire case; near misses are what catch it.`, { skill: skillName }));
  }
  if (summary.shouldFire + summary.shouldNotFire >= 6 && !summary.heldOut) {
    findings.push(finding('E003', 'No case is tagged held-out. Every trigger case has been seen while tuning the description, so the trigger score can no longer tell a better description from an overfitted one.', { skill: skillName }));
  }
  const trig = summary.shouldFire + summary.shouldNotFire;
  if (trig > 0 && trig < 10) {
    findings.push(finding('E004', `${trig} trigger case(s). Anthropic's skill-creator works with about 20 (8 to 10 each way); with fewer, one flaky run moves the score by 10 points or more.`, { skill: skillName }));
  }
  for (const p of summary.problems) findings.push(finding('E001', `Eval case problem: ${p}`, { skill: skillName, severity: 'warn' }));
  return { findings, summary };
}

function cmdEvals(pos, opts) {
  if (!pos[0]) fail('evals needs a path');
  const target = detectTarget(pos[0]);
  for (const dir of target.skills) {
    const name = lintSkill(dir).info.name ?? basename(dir);
    const { summary } = suiteFindings(target, dir, name);
    out(`\n${name}`);
    if (!summary) { out('  no eval suite'); continue; }
    out(`  suite: ${summary.dir}`);
    out(`  ${summary.cases.length} case(s): ${summary.shouldFire} should-fire, ${summary.shouldNotFire} should-not-fire, ${summary.heldOut} held-out, ${summary.output} output`);
    for (const c of summary.cases) out(`  - ${c.rel}  [${c.tags.join(', ')}]  graders: ${c.graders.map(g => `${g.name}:${g.type}`).join(', ')}`);
    for (const p of summary.problems) out(`  ! ${p}`);
  }
}

// --- external validators ------------------------------------------------------------

function hasClaude() {
  const r = spawnSync('claude', ['--version'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

// Builds a throwaway plugin in the workspace that claude plugin validate and
// claude plugin eval can load: a copy of the plugin (or a bare skill wrapped
// in one), plus any decoy skills from the eval folder installed beside it.
const COPY_SKIP = /(^|\/)(\.git|node_modules|__pycache__|\.DS_Store)(\/|$)|(^|\/)evals\/results(\/|$)|-workspace(\/|$)/;

export function buildWrapper(target, ws, { withDecoys = true } = {}) {
  const root = join(ws, 'skillio', 'wrapper');
  rmSync(root, { recursive: true, force: true });
  let evalsRoot;
  if (target.pluginRoot) {
    cpSync(target.pluginRoot, root, { recursive: true, filter: src => !COPY_SKIP.test(relative(target.pluginRoot, src)) });
    const pj = readPluginJson(root) ?? {};
    evalsRoot = join(root, typeof pj.experimental?.evals === 'string' ? pj.experimental.evals : 'evals');
  } else {
    const name = basename(target.path);
    mkdirSync(join(root, '.claude-plugin'), { recursive: true });
    cpSync(target.path, join(root, 'skills', name), { recursive: true, filter: src => !COPY_SKIP.test(relative(target.path, src)) });
    const pj = { name: `${name}-wrapper`, version: '0.0.0', description: `Temporary wrapper Skillio builds to validate and evaluate ${name}` };
    if (existsSync(join(target.path, 'evals'))) pj.experimental = { evals: `skills/${name}/evals` };
    writeFileSync(join(root, '.claude-plugin', 'plugin.json'), JSON.stringify(pj, null, 2) + '\n');
    evalsRoot = join(root, 'skills', name, 'evals');
  }
  const installed = [];
  if (withDecoys) {
    for (const d of listDecoys(evalsRoot)) {
      let name = d.name;
      if (existsSync(join(root, 'skills', name))) name += '-rival';
      cpSync(d.dir, join(root, 'skills', name), { recursive: true });
      installed.push(name);
    }
  }
  return { root, decoys: installed };
}

function runValidate(dir, file) {
  const r = spawnSync('claude', ['plugin', 'validate', file ?? dir, '--json'], { encoding: 'utf8', cwd: dir });
  try { return JSON.parse(r.stdout); } catch { return { success: r.status === 0, raw: (r.stdout + r.stderr).trim().slice(0, 2000) }; }
}

// componentsOnly: the target was wrapped in a throwaway plugin, so findings
// about that plugin's manifest or directory listing are about the wrapper,
// not the skill, and are dropped.
function validateFindings(v, label, { componentsOnly = false } = {}) {
  const findings = [];
  const add = (sev, file, msg) => findings.push({ id: 'V000', severity: sev, title: `claude plugin validate (${label})`, file, message: msg });
  if (v.raw) add(v.success ? 'info' : 'error', null, v.raw);
  const blocks = [componentsOnly ? null : v.manifest, ...(v.contents ?? [])].filter(Boolean);
  for (const b of blocks) {
    for (const e of b.errors ?? []) add('error', relative(process.cwd(), b.file ?? ''), `${e.path ? e.path + ': ' : ''}${e.message}`);
    for (const w of b.warnings ?? []) add('warn', relative(process.cwd(), b.file ?? ''), `${w.path ? w.path + ': ' : ''}${w.message}`);
  }
  for (const f of componentsOnly ? [] : v.directory?.findings ?? []) {
    add(f.severity === 'error' ? 'warn' : 'info', f.file, `[directory listing] ${f.title}: ${f.fix ?? f.message}`);
  }
  return findings;
}

function creatorValidate(skillDir) {
  const script = join(PLUGIN_ROOT, 'vendor', 'skill-creator', 'scripts', 'quick_validate.py');
  if (!existsSync(script)) return null;
  const r = spawnSync('python3', ['-I', script, skillDir], { encoding: 'utf8' });
  if (r.error) return { skipped: 'python3 not found' };
  const text = (r.stdout + r.stderr).trim();
  if (/No module named 'yaml'/.test(text)) return { skipped: 'PyYAML missing (pip install pyyaml)' };
  return { ok: r.status === 0, text };
}

// --- check ----------------------------------------------------------------------------

function cmdCheck(pos, opts) {
  if (!pos[0]) fail('check needs a path');
  const target = detectTarget(pos[0]);
  const surface = opts.target ?? 'claude-code';
  const ran = [];
  let findings = [];

  const lint = lintTarget(target, { target: surface });
  for (const r of lint) findings = findings.concat(r.findings);
  ran.push(['Skillio lint', `${lint.length} skill(s), ${lint.reduce((n, r) => n + r.findings.length, 0)} finding(s)`]);

  const col = collisionFindings(target, opts);
  findings = findings.concat(col.findings);
  ran.push(['Description overlap', `compared with ${col.installed} installed skill(s); listing about ${col.size.tokens} tokens`]);

  const suites = [];
  for (const r of lint) {
    const name = r.info.name ?? r.info.folder;
    const s = suiteFindings(target, r.info.dir, name);
    findings = findings.concat(s.findings);
    suites.push({ skill: name, summary: s.summary ? { cases: s.summary.cases.length, shouldFire: s.summary.shouldFire, shouldNotFire: s.summary.shouldNotFire, heldOut: s.summary.heldOut, output: s.summary.output } : null });
  }
  ran.push(['Eval suite health', suites.map(s => `${s.skill}: ${s.summary ? `${s.summary.shouldFire} fire / ${s.summary.shouldNotFire} near-miss / ${s.summary.heldOut} held-out / ${s.summary.output} output` : 'none'}`).join('; ')]);

  const ws = workspaceFor(target, target.kind === 'skill' ? target.path : null);
  const version = opts.claude === false ? null : hasClaude();
  if (version) {
    if (target.pluginRoot && target.kind === 'plugin') {
      const v = runValidate(target.pluginRoot, target.marketplace ? join(target.pluginRoot, '.claude-plugin', 'plugin.json') : null);
      findings = findings.concat(validateFindings(v, 'plugin'));
      if (target.marketplace) findings = findings.concat(validateFindings(runValidate(target.pluginRoot), 'marketplace'));
      ran.push(['claude plugin validate', v.success === false ? 'failed' : 'passed']);
    } else if (target.kind === 'skill') {
      const root = target.pluginRoot ? null : buildWrapper(target, ws, { withDecoys: false }).root;
      const v = runValidate(target.pluginRoot ?? root, target.pluginRoot ? join(target.pluginRoot, '.claude-plugin', 'plugin.json') : null);
      findings = findings.concat(validateFindings(v, target.pluginRoot ? 'enclosing plugin' : 'skill', { componentsOnly: !target.pluginRoot }));
      ran.push(['claude plugin validate', `${v.success === false ? 'failed' : 'passed'} (${target.pluginRoot ? 'enclosing plugin' : 'temporary wrapper plugin'})`]);
    }
  } else {
    ran.push(['claude plugin validate', opts.claude === false ? 'skipped (--no-claude)' : 'skipped (claude CLI not found)']);
  }

  for (const r of lint) {
    const cv = creatorValidate(r.info.dir);
    if (!cv) continue;
    if (cv.skipped) { ran.push([`skill-creator quick_validate (${r.info.folder})`, `skipped: ${cv.skipped}`]); continue; }
    ran.push([`skill-creator quick_validate (${r.info.folder})`, cv.ok ? 'passed' : `failed: ${cv.text}`]);
    if (!cv.ok) findings.push({ id: 'V001', severity: surface === 'claude-code' ? 'info' : 'error', title: 'skill-creator validator', skill: r.info.folder, message: `${cv.text}${surface === 'claude-code' ? ' (this validator applies the Claude app upload rules; ignore it if the skill only ships in Claude Code)' : ''}` });
  }

  const seen = new Set();
  findings = findings.filter(f => { const k = `${f.id}|${f.skill ?? ''}|${f.file ?? ''}|${f.message}`; if (seen.has(k)) return false; seen.add(k); return true; });
  const c = counts(findings);
  const evalsMissing = suites.some(s => !s.summary || !s.summary.cases);
  const name = target.plugin?.name ?? (lint[0]?.info.name ?? basename(target.path));
  const stamp = timestamp();
  const dir = join(ws, 'skillio', 'checks', stamp);
  mkdirSync(dir, { recursive: true });
  const docs = relative(dir, join(PLUGIN_ROOT, 'docs', 'principles.md'));
  const md = [
    `# Skillio check: ${name}`,
    '',
    `${new Date().toISOString().slice(0, 16).replace('T', ' ')} · ${target.kind} at ${target.path} · surface: ${surface}${version ? ` · ${version}` : ''}`,
    '',
    `**Verdict.** ${verdict(c, { evalsMissing })} ${c.error} error(s), ${c.warn} warning(s), ${c.info} note(s).`,
    '',
    '## What ran',
    '',
    ...ran.map(([k, v]) => `- **${k}**: ${v}`),
    '',
    '## Findings',
    '',
    findings.length ? renderFindings(findings, { docsBase: docs }) : 'None.',
    '## Not covered by static checks',
    '',
    '- Whether the skill fires on real phrasing and stays quiet on near misses: run the trigger suite (`run-evals --tag trigger --ablation none`).',
    '- Whether output is better than Claude without the skill: run the output cases with the baseline arm.',
    '- Judgement calls on content (knowledge Claude already has, freedom vs fragility, examples): the skill-reviewer agent.',
    '- Usage and context cost in your real setup: `/skill-doctor` in an interactive session.',
    '',
  ].join('\n');
  writeFileSync(join(dir, 'report.md'), md);
  writeFileSync(join(dir, 'report.json'), JSON.stringify({ name, target: target.path, kind: target.kind, surface, counts: c, ran, suites, collisions: col.results, findings }, null, 2));
  if (opts.json) out(JSON.stringify({ report: join(dir, 'report.md'), counts: c, ran, findings }, null, 2));
  else {
    out(`Skillio check: ${name} (${target.kind}, surface ${surface})`);
    for (const [k, v] of ran) out(`  ${k}: ${v}`);
    out('');
    out(findings.length ? terminalFindings(findings) : 'No findings.');
    out(`\n${verdict(c, { evalsMissing })} ${c.error} error(s), ${c.warn} warning(s), ${c.info} note(s).`);
    out(`Report: ${join(dir, 'report.md')}`);
  }
  process.exit(c.error ? 1 : 0);
}

// --- eval authoring and running -----------------------------------------------------------

// Where trigger cases go: the plugin's eval dir, or <skill>/evals for a
// standalone skill (skill-creator's packager leaves evals/ out of the upload,
// so the cases travel with the skill without shipping to users).
function evalsRootFor(target) {
  if (target.pluginRoot) return evalDir(target.pluginRoot);
  if (target.kind === 'skill') return join(target.path, 'evals');
  fail('point at a plugin folder or a skill folder');
}

function cmdTriggerCases(pos, opts) {
  if (!pos[0] || !opts.from) fail('trigger-cases <path> --skill <name> --from <file.json>');
  const target = detectTarget(pos[0]);
  const items = JSON.parse(readFileSync(resolve(opts.from), 'utf8'));
  if (!Array.isArray(items)) fail('--from must hold a JSON array of {query, should_trigger, held_out?}');
  const skill = opts.skill ?? lintSkill(target.skills[0]).info.name;
  const root = evalsRootFor(target);
  mkdirSync(root, { recursive: true });
  const written = writeTriggerCases(root, skill, items, { runs: opts.runs, overwrite: !!opts.overwrite });
  out(`Wrote ${written.length} case(s) under ${root}:`);
  for (const w of written) out(`  ${relative(root, w)}`);
  const fire = items.filter(i => (i.should_trigger ?? i.shouldTrigger) === true).length;
  out(`${fire} should-fire, ${items.length - fire} should-not-fire, ${items.filter(i => i.held_out ?? i.heldOut).length} held-out.`);
}

function cmdDecoy(pos, opts) {
  if (!pos[0] || !opts.name || !opts.description) fail('decoy <path> --name <name> --description <text>');
  const target = detectTarget(pos[0]);
  const dir = writeDecoy(evalsRootFor(target), opts.name, opts.description);
  out(`Decoy written to ${dir}. run-evals installs it next to the skill under test in every case, the way a rival is installed on a real machine.`);
}

// Variables a parent Claude Code session passes to anything it spawns. Left
// in, they let eval runs reach the parent's messaging channel, and in cloud
// sessions they tell the child it is a remote session, where Claude believes
// it can't create skills (measured: 1 of 3 runs fired with them, 3 of 3
// without). Eval runs should look like a fresh local session.
const STRIP_ENV = [
  'CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_MESSAGING_TOKEN', 'SESSION_INGRESS_URL', 'CLAUDE_SESSION_INGRESS_TOKEN_FILE',
  'CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE', 'CLAUDE_CODE_REMOTE_SESSION_ID', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_SESSION_ID',
  'CCR_SESSION_PROFILE', 'CCR_SETTINGS_JSON_OVERLAY',
];

function cmdRunEvals(pos, opts) {
  if (!pos[0]) fail('run-evals needs a path');
  const target = detectTarget(pos[0]);
  const ws = workspaceFor(target, target.kind === 'skill' ? target.path : null);
  if (!target.pluginRoot && target.kind !== 'skill') fail('run-evals needs a plugin or a skill');
  const evalsHere = target.pluginRoot ? evalDir(target.pluginRoot) : join(target.path, 'evals');
  let pluginDir = target.pluginRoot;
  let decoys = [];
  if (!target.pluginRoot || listDecoys(evalsHere).length) {
    ({ root: pluginDir, decoys } = buildWrapper(target, ws));
  }
  const stamp = timestamp();
  const outDir = join(ws, 'skillio', 'evals', stamp + (opts.label ? `-${opts.label}` : ''));
  mkdirSync(outDir, { recursive: true });
  const args = ['plugin', 'eval', pluginDir, '--output-dir', outDir, '--report', join(outDir, 'report.html'), '--trust-plugin'];
  if (!opts.publish) args.push('--no-publish');
  for (const t of opts.tag ?? []) args.push('--tag', t);
  if (opts.case) args.push('--case', opts.case);
  if (opts.runs) args.push('--runs', String(opts.runs));
  args.push('--concurrency', String(opts.concurrency ?? 4));
  args.push('--max-cost-usd', String(opts.maxCost ?? 10));
  if (opts.ablation) args.push('--ablation', opts.ablation);
  if (opts.model) args.push('--model', opts.model);
  if (opts.judgeModel) args.push('--judge-model', opts.judgeModel);
  if (opts.threshold) args.push('--threshold', String(opts.threshold));
  if (opts.allowTools?.length) args.push('--allow-tools', ...opts.allowTools);
  const env = { ...process.env, CLAUDE_CODE_ENABLE_CFC: '0' };
  for (const k of STRIP_ENV) delete env[k];
  writeFileSync(join(outDir, 'command.txt'), `claude ${args.map(a => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}\n`);
  if (opts.dryRun) { out(readFileSync(join(outDir, 'command.txt'), 'utf8')); return; }
  if (decoys.length) out(`Decoys installed beside the skill under test: ${decoys.join(', ')}`);
  out(`Running: claude ${args.join(' ')}`);
  out(`Results: ${outDir}`);
  const child = spawn('claude', args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = join(outDir, 'run.log');
  child.stdout.on('data', d => { process.stdout.write(d); appendFileSync(log, d); });
  child.stderr.on('data', d => { process.stderr.write(d); appendFileSync(log, d); });
  child.on('close', code => {
    const agg = join(outDir, 'aggregate-result.json');
    if (existsSync(agg)) {
      const summary = summarise(agg, target);
      writeFileSync(join(outDir, 'summary.md'), summary);
      out('\n' + summary);
    } else {
      out(`\nNo aggregate-result.json in ${outDir}; see run.log.`);
    }
    process.exit(code ?? 1);
  });
}

function summarise(aggPath, target) {
  const res = readResults(aggPath);
  const lines = [`# Eval summary`, '', `${aggPath}`, ''];
  lines.push(`Overall score ${res.overallScore ?? 'n/a'}${res.meanDelta != null ? `, mean delta vs no plugin ${res.meanDelta}` : ''}. Cost $${res.costUsd?.toFixed?.(2) ?? '?'}, ${Math.round(res.durationSeconds ?? 0)} s${res.partial ? `. PARTIAL RUN (${res.partialReason})` : ''}.`, '');
  const pluginRoot = target.pluginRoot;
  for (const dir of target.skills) {
    const name = lintSkill(dir).info.name ?? basename(dir);
    const plugin = pluginRoot ? readPluginJson(pluginRoot)?.name : `${basename(dir)}-wrapper`;
    const casesDir = pluginRoot ? evalDir(pluginRoot) : join(dir, 'evals');
    const index = new Map(listCases(casesDir).map(c => [c.name, { ...c, cls: classify(c, name, plugin) }]));
    const m = triggerMetrics(res, index);
    if (!m.train.cases && !m.heldOut.cases && !m.negative.cases) continue;
    lines.push(`## ${name}: triggering`, '');
    lines.push(`- Should fire, tuning set: ${m.train.runsCorrect}/${m.train.runs} runs fired (${pct(m.train.runsCorrect, m.train.runs)}); ${m.train.allRunsCorrect}/${m.train.cases} cases fired every run (pass^k).`);
    lines.push(`- Should fire, held out: ${m.heldOut.runsCorrect}/${m.heldOut.runs} runs fired (${pct(m.heldOut.runsCorrect, m.heldOut.runs)}); ${m.heldOut.allRunsCorrect}/${m.heldOut.cases} cases every run.`);
    lines.push(`- Should not fire: ${m.negative.runsCorrect}/${m.negative.runs} runs stayed quiet (${pct(m.negative.runsCorrect, m.negative.runs)}); ${m.negative.cases - m.negative.allRunsCorrect} case(s) fired at least once.`);
    const misses = [...m.train.misses.map(x => `tuning ${x}`), ...m.heldOut.misses.map(x => `held-out ${x}`), ...m.negative.misses.map(x => `false fire ${x}`)];
    if (misses.length) lines.push(`- Misses: ${misses.join('; ')}`);
    lines.push('');
  }
  const allIndex = new Map();
  for (const dir of target.skills) {
    const name = lintSkill(dir).info.name ?? basename(dir);
    const plugin = pluginRoot ? readPluginJson(pluginRoot)?.name : `${basename(dir)}-wrapper`;
    const casesDir = pluginRoot ? evalDir(pluginRoot) : join(dir, 'evals');
    for (const c of listCases(casesDir)) {
      const cls = classify(c, name, plugin);
      const prev = allIndex.get(c.dir);
      if (!prev || cls.kind) allIndex.set(c.dir, { ...c, cls });
    }
  }
  const other = res.cases.filter(c => { const info = lookupCase(allIndex, c); return !info || !info.cls.kind; });
  if (other.length) {
    lines.push('## Output cases', '');
    for (const c of other) lines.push(`- ${c.name}: ${c.runsPassed}/${c.runs} runs passed${c.baselineRuns ? `, baseline ${c.baselinePassed}/${c.baselineRuns}` : ''}${c.delta != null ? `, delta ${c.delta}` : ''}${c.errors ? `, ${c.errors} run error(s)` : ''}`);
    lines.push('');
  }
  lines.push('Read the transcripts in the HTML report before changing anything: a score says that something failed, the transcript says why.');
  return lines.join('\n');
}

function cmdResults(pos, opts) {
  if (!pos[0]) fail('results <aggregate-result.json> [--path <plugin-or-skill>]');
  const target = detectTarget(opts.path ?? process.cwd());
  out(summarise(resolve(pos[0]), target));
}

// --- working files ----------------------------------------------------------------------

function cmdWorkspace(pos) {
  const target = detectTarget(pos[0] ?? '.');
  out(workspaceFor(target, target.kind === 'skill' ? target.path : null));
}

function cmdSnapshot(pos, opts) {
  const target = detectTarget(pos[0] ?? fail('snapshot needs a skill path'));
  if (target.kind !== 'skill') fail('snapshot takes one skill folder');
  const ws = workspaceFor(target, target.path);
  const dest = join(ws, 'skillio', 'snapshots', timestamp() + (opts.label ? `-${opts.label}` : ''), basename(target.path));
  cpSync(target.path, dest, { recursive: true });
  out(dest);
}

function cmdObserve(pos, opts) {
  const target = detectTarget(pos[0] ?? fail('observe needs a skill path'));
  const ws = workspaceFor(target, target.kind === 'skill' ? target.path : null);
  const file = join(ws, 'skillio', 'observations.md');
  if (opts.list || !pos[1]) {
    out(existsSync(file) ? readFileSync(file, 'utf8') : 'No observations logged yet.');
    return;
  }
  mkdirSync(dirname(file), { recursive: true });
  if (!existsSync(file)) writeFileSync(file, `# Observations: ${basename(target.path)}\n\nReal-use notes: corrections, misses, wrong triggers. Each one is a candidate eval case before it is a fix.\n\n`);
  appendFileSync(file, `- ${new Date().toISOString().slice(0, 10)} ${pos.slice(1).join(' ').replace(/\s+/g, ' ').trim()}\n`);
  out(`Logged to ${file}`);
}

function cmdPackage(pos, opts) {
  const target = detectTarget(pos[0] ?? fail('package needs a skill path'));
  if (target.kind !== 'skill') fail('package takes one skill folder');
  const r = lintSkill(target.path, { target: 'claude-ai' });
  const errs = r.findings.filter(f => f.severity === 'error');
  if (errs.length && !opts.force) {
    out(terminalFindings(errs));
    fail(`${errs.length} error(s) would break the upload. Fix them, or pass --force.`);
  }
  const name = r.info.name ?? basename(target.path);
  const outDir = resolve(opts.out ?? join(workspaceFor(target, target.path), 'skillio', 'dist'));
  mkdirSync(outDir, { recursive: true });
  const zip = join(outDir, `${name}.zip`);
  rmSync(zip, { force: true });
  const z = spawnSync('zip', ['-r', '-X', '-q', zip, basename(target.path), '-x', '*/evals/*', '*/.DS_Store', '*/__pycache__/*', '*/node_modules/*', '*.pyc', '*/.git/*'], { cwd: dirname(target.path), encoding: 'utf8' });
  if (z.error || z.status !== 0) fail(`zip failed: ${z.error?.message ?? z.stderr}`);
  cpSync(zip, join(outDir, `${name}.skill`));
  out(`${zip}\n${join(outDir, `${name}.skill`)}`);
  out('Upload the .zip as a custom skill in the Claude app, or open the .skill file there and save it.');
}

// --- main ---------------------------------------------------------------------------------

const [cmd, ...rest] = process.argv.slice(2);
const { pos, opts } = parseArgs(rest);
if (opts.claude === undefined && rest.includes('--no-claude')) opts.claude = false;
const commands = {
  lint: cmdLint, collisions: cmdCollisions, inventory: cmdInventory, check: cmdCheck, evals: cmdEvals,
  'trigger-cases': cmdTriggerCases, decoy: cmdDecoy, 'run-evals': cmdRunEvals, results: cmdResults,
  workspace: cmdWorkspace, snapshot: cmdSnapshot, observe: cmdObserve, package: cmdPackage,
};
if (!cmd || cmd === 'help' || cmd === '--help' || !commands[cmd]) {
  out(HELP);
  process.exit(cmd && !['help', '--help'].includes(cmd) ? 1 : 0);
}
try {
  commands[cmd](pos, opts);
} catch (e) {
  fail(e.message);
}
