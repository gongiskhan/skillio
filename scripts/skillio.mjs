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
import { detectTarget, workspaceFor, timestamp, pluginSkills } from './lib/target.mjs';
import { inventory, compare, listingSize, defaultRoots } from './lib/collisions.mjs';
import { suiteSummary, writeTriggerCases, writeDecoy, listDecoys, readResults, triggerMetrics, listCases, classify, evalDir, readPluginJson, pct, lookupCase } from './lib/evals.mjs';
import { renderFindings, terminalFindings, counts, verdict, PLUGIN_ROOT } from './lib/report.mjs';
import { buildWrapper } from './lib/wrapper.mjs';
import { claudeInfo, cleanEnv, validate, validateFindings, pluginDetails, skillCreator, promptAudit, skillDoctor, gitRoot, MIN } from './lib/claude.mjs';

const HELP = `Skillio: tools for building, checking and improving Agent Skills.

Usage: node skillio.mjs <command> [options]

  tools [--json]            What this machine can run: Claude Code version and which of
                            its tools are usable, where skill-creator is, python, zip.
                            Without Claude Code the static checks still work.

Static checks (free, no model calls)
  lint <path...>            Lint skills. --target claude-code|claude-ai|portable, --json
  collisions <path>         Compare a skill's description with every installed skill
  inventory                 List the skills Claude Code would see, and the listing size
  check <path>              Everything static: lint, collisions, eval-suite health,
                            claude plugin validate and details, /skill-doctor,
                            skill-creator's validator. Writes a report to the workspace.
                            --target, --json, --strict, --for-directory, --no-claude

Model calls (each one is billed to your account)
  audit <path> [--scope skill|setup|both] [--model m]
                            /claude-api prompt-audit on the skill or plugin (instructions
                            written for older models); setup adds /doctor prompt-audit
                            for the project's whole configuration. Read-only.
  evals <path>              Show the eval suite for a skill or plugin and what it covers
  trigger-cases <path> --skill <name> --from <file.json> [--into dir] [--runs n] [--overwrite]
                            Turn a trigger set ([{query, should_trigger, held_out}], the
                            format skill-creator exports) into claude plugin eval cases
  decoy <path> --name <n> --description <text>
                            Add a decoy: a stand-in skill with a rival's description that
                            run-evals installs beside the skill under test
  eval-init <path> [--bare name]
                            Author output cases with claude plugin eval init's interview
  run-evals <path> --trust [--tag t]... [--case glob] [--runs n] [-j n] [--max-cost usd]
            [--ablation none|with-without] [--model m] [--judge-model m] [--threshold x]
            [--allow-tools t...] [--scaffold] [--evals-from dir] [--label name] [--publish]
            [--dry-run]
                            Run claude plugin eval isolated from your browser and
                            messaging, results into the workspace, then summarise.
                            --trust only after the user says they trust the plugin.
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
  const read = dirs => dirs.map(d => inventory([{ path: d, source: 'target', depth: 0 }])[0]).filter(Boolean);
  const own = read(target.skills);
  // Siblings in the same plugin compete too, even when only one skill is checked.
  const family = target.pluginRoot ? read(pluginSkills(target.pluginRoot)).map(f => ({ ...f, source: 'same plugin' })) : own;
  const results = [];
  for (const s of own) {
    const siblings = family.filter(o => o.path !== s.path);
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
    out(`${s.source.padEnd(9)} ${s.name.padEnd(36)} ${String(s.description.length).padStart(5)} chars${s.modelInvocable ? '' : '  (manual only)'}  ${s.dir}`);
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

// --- Claude Code validators -----------------------------------------------------------

// Runs claude plugin validate on whatever the target is, the way Claude Code
// will load it. A bare skill is validated through its parent folder (the
// validator checks the skills, agents and commands in a directory), keeping
// only the findings for files inside the skill.
function validateTarget(target, ws, { profile = null, strict = false } = {}) {
  const runs = [];
  const run = (path, label, o = {}) => {
    const v = validate(path, { strict, profile: o.allowProfile ? profile : null });
    const findings = validateFindings(v, label, { ...o, profile: o.allowProfile ? profile : null });
    // When only part of the folder is ours (a skill's parent folder, a
    // wrapper), the exit code also covers the rest; judge by our findings.
    const failed = v.exit === 1 && (o.only || o.componentsOnly ? findings.some(f => f.severity === 'error') : true);
    runs.push({ label, v, findings, failed });
  };
  const pj = root => join(root, '.claude-plugin', 'plugin.json');
  if (target.kind === 'plugin') {
    // With a marketplace.json beside it, validating the folder checks the
    // marketplace; the plugin manifest needs its own pass.
    // Every mode also checks the plugin's skills, agents and commands.
    run(target.marketplace ? pj(target.pluginRoot) : target.pluginRoot, 'plugin', { allowProfile: true });
    if (target.marketplace) run(target.pluginRoot, 'marketplace');
  } else if (target.kind === 'skill' && target.pluginRoot) {
    const hasMarket = existsSync(join(target.pluginRoot, '.claude-plugin', 'marketplace.json'));
    run(hasMarket ? pj(target.pluginRoot) : target.pluginRoot, 'enclosing plugin', { only: target.path });
  } else if (target.kind === 'skill') {
    const parent = dirname(target.path);
    if (existsSync(join(parent, '.claude-plugin'))) {
      run(buildWrapper(target, ws, { withDecoys: false }).root, 'skill', { componentsOnly: true });
    } else {
      run(parent, 'skill', { componentsOnly: true, only: target.path });
    }
  } else if (target.kind === 'marketplace') {
    run(target.path, 'marketplace');
    for (const pr of target.plugins) run(pj(pr), basename(pr), { allowProfile: true });
  } else {
    run(target.path, 'skills folder', { componentsOnly: true });
  }
  const findings = runs.flatMap(r => r.findings);
  const broken = runs.filter(r => r.v.validatorError);
  const failed = runs.some(r => r.failed);
  const errs = findings.filter(f => f.severity === 'error').length;
  let summary = failed ? `failed (${errs} error(s))` : 'passed';
  if (strict) summary += ' with --strict';
  if (profile) summary += `, --profile ${profile}`;
  if (broken.length) summary += `; validator error on ${broken.map(r => r.label).join(', ')}: ${broken[0].v.validatorError.split('\n')[0]}`;
  return { findings, summary, failed };
}

// Claude Code's own context-cost estimate for the target.
function detailsFor(target, ws) {
  if (target.pluginRoot) {
    const name = target.plugin?.name ?? readPluginJson(target.pluginRoot)?.name;
    const d = name ? pluginDetails(target.pluginRoot, name) : null;
    if (d && target.kind === 'skill') d.focus = lintSkill(target.path).info.name ?? basename(target.path);
    return d;
  }
  if (target.kind === 'skill') {
    const w = buildWrapper(target, ws, { withDecoys: false });
    return pluginDetails(w.root, `${basename(target.path)}-wrapper`);
  }
  return null;
}

function detailsLine(d) {
  const rows = d.focus ? d.components.filter(c => c.name === d.focus) : d.components;
  const t = x => (/^[~<]/.test(x) ? x : `~${x}`);
  const parts = rows.map(c => `${c.name} ${t(c.raw[0])} always, ${t(c.raw[1])} when it fires`);
  return `${d.focus ? '' : `about ${d.alwaysOn} tokens in every session; `}${parts.join('; ')}`;
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
  let skillDoctorText = null;

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
  const cc = opts.claude === false ? { found: false, reason: '--no-claude' } : claudeInfo();
  const version = cc.found ? `Claude Code ${cc.version}` : null;
  let details = null;
  if (cc.found) {
    const v = validateTarget(target, ws, { profile: opts.forDirectory ? 'directory' : null, strict: !!opts.strict });
    findings = findings.concat(v.findings);
    ran.push(['claude plugin validate', v.summary]);
    details = detailsFor(target, ws);
    if (details) ran.push(['claude plugin details', detailsLine(details)]);
    skillDoctorText = skillDoctor();
    if (skillDoctorText) {
      const rows = skillDoctorText.split('\n').filter(l => /^\s{2}\S+(\s{2,}\S+){3,}/.test(l) && !/^\s{2}skill\s/.test(l));
      ran.push(['/skill-doctor', `${rows.length} skill(s) loaded in your setup; usage table in the report`]);
    } else {
      ran.push(['/skill-doctor', 'no output from this Claude Code version (run it in a session; some versions show it in /plugin, Stats tab)']);
    }
  } else {
    // Static checks above ran without Claude Code; say once what didn't.
    ran.push(['Claude Code checks', `not run (${cc.reason}): validation, context cost, /skill-doctor, evals and prompt audits need it`]);
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
  const name = target.kind === 'skill' ? (lint[0]?.info.name ?? basename(target.path)) : target.plugin?.name ?? basename(target.path);
  const stamp = timestamp();
  const dir = join(ws, 'skillio', 'checks', stamp);
  mkdirSync(dir, { recursive: true });
  const docs = join(PLUGIN_ROOT, 'docs', 'principles.md');
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
    ...(details ? ['## Context cost (claude plugin details)', '', 'Always-on is paid in every session, whether or not the skill fires; on-invoke each time it fires.', '', '```text', details.text, '```', ''] : []),
    ...(skillDoctorText ? ['## Skills loaded in your setup (/skill-doctor)', '', '```text', skillDoctorText, '```', ''] : []),
    '## Not covered by static checks',
    '',
    '- Whether the skill fires on real phrasing and stays quiet on near misses: run the trigger suite (`run-evals --tag trigger --ablation none`).',
    '- Whether output is better than Claude without the skill: run the output cases with the baseline arm.',
    '- Instructions written for older models, and conflicts with the rest of the setup: `skillio audit` (a model call).',
    '- Judgement calls on content (knowledge Claude already has, freedom vs fragility, examples): the skill-reviewer agent.',
    '- How the skill is used day to day: `/skill-doctor` counts uses over time; run it again after a week of real work.',
    '',
  ].join('\n');
  writeFileSync(join(dir, 'report.md'), md);
  writeFileSync(join(dir, 'report.json'), JSON.stringify({ name, target: target.path, kind: target.kind, surface, claude: cc.found ? cc.version : null, counts: c, ran, suites, collisions: col.results, contextCost: details ? { alwaysOn: details.alwaysOn, components: details.components } : null, findings }, null, 2));
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
  const root = opts.into ? resolve(opts.into) : evalsRootFor(target);
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

const RUN_EVAL_OPTS = new Set(['tag', 'case', 'runs', 'concurrency', 'maxCost', 'maxCostUsd', 'ablation', 'model', 'judgeModel', 'threshold', 'allowTools', 'publish', 'label', 'dryRun', 'scaffold', 'evalsFrom', 'trust']);

function cmdRunEvals(pos, opts) {
  if (!pos[0]) fail('run-evals needs a path');
  const unknown = Object.keys(opts).filter(k => !RUN_EVAL_OPTS.has(k));
  if (unknown.length) fail(`run-evals doesn't know ${unknown.map(k => '--' + k.replace(/[A-Z]/g, c => '-' + c.toLowerCase())).join(', ')}; run skillio with no arguments for the options`);
  const cc = claudeInfo();
  if (!opts.dryRun && !cc.can.eval) {
    fail(cc.found ? `evals need Claude Code ${MIN.eval} or later for claude plugin eval (found ${cc.version}); update with \`claude update\`` : `evals need Claude Code (${cc.reason}). The static checks (skillio check) work without it.`);
  }
  // plugin eval loads the plugin and runs its hooks, scripts and eval suite as
  // the user. Its own rule: trust is the user's call, never the agent's, so
  // run-evals passes --trust-plugin only when told to.
  if (!opts.dryRun && !opts.trust) {
    fail('evals load this plugin and run its hooks, scripts and eval cases on this machine as you. Ask the user whether they trust it; on an explicit yes, add --trust.');
  }
  const target = detectTarget(pos[0]);
  if (!target.pluginRoot && target.kind !== 'skill') fail('run-evals needs a plugin or a skill');
  const ws = workspaceFor(target, target.kind === 'skill' ? target.path : null);
  const evalsFrom = opts.evalsFrom ? resolve(opts.evalsFrom) : null;
  const evalsHere = evalsFrom ?? (target.pluginRoot ? evalDir(target.pluginRoot) : join(target.path, 'evals'));
  if (!existsSync(evalsHere)) fail(`no eval cases at ${evalsHere}`);
  const cases = listCases(evalsHere);
  const needsWrapper = !target.pluginRoot || listDecoys(evalsHere).length > 0 || !!evalsFrom;

  const stamp = timestamp();
  const outDir = join(ws, 'skillio', 'evals', stamp + (opts.label ? `-${opts.label}` : ''));
  const pluginDirShown = needsWrapper ? join(ws, 'skillio', 'wrapper') : target.pluginRoot;
  const tags = [...(opts.tag ?? [])];
  const skillName = target.kind === 'skill' ? (lintSkill(target.path).info.name ?? basename(target.path)) : null;
  if (target.kind === 'skill' && target.pluginRoot && !tags.length && !opts.case) {
    // One skill inside a plugin: don't pay for the sibling skills' cases.
    tags.push(`skill:${skillName}`);
  }
  const args = ['plugin', 'eval', pluginDirShown, '--output-dir', outDir, '--report', join(outDir, 'report.html')];
  if (opts.trust) args.push('--trust-plugin');
  if (!opts.publish) args.push('--no-publish');
  for (const t of tags) args.push('--tag', t);
  if (opts.case) args.push('--case', opts.case);
  if (opts.runs) args.push('--runs', String(opts.runs));
  args.push('--concurrency', String(opts.concurrency ?? 4));
  args.push('--max-cost-usd', String(opts.maxCost ?? opts.maxCostUsd ?? 10));
  if (opts.ablation) args.push('--ablation', opts.ablation);
  if (opts.model) args.push('--model', opts.model);
  // llm graders: plugin eval's default judge is haiku, and its own authoring
  // guide says small judges miss nuance. Only llm graders use it, so trigger
  // suites cost the same.
  args.push('--judge-model', opts.judgeModel ?? 'sonnet');
  if (opts.threshold) args.push('--threshold', String(opts.threshold));
  if (opts.scaffold) args.push('--scaffold');
  if (opts.allowTools?.length) args.push('--allow-tools', ...opts.allowTools);
  const command = `claude ${args.map(a => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`;

  const scaffolded = cases.filter(c => existsSync(join(c.dir, 'case.yaml')) && /scaffold_script/.test(readFileSync(join(c.dir, 'case.yaml'), 'utf8')));
  if (scaffolded.length && !opts.scaffold) {
    out(`Note: ${scaffolded.length} case(s) set up their workspace with a scaffold script, which plugin eval runs only with --scaffold (it runs as you, so pass it only for suites you wrote). Without it those cases start empty.`);
  }
  if (tags.length && target.kind === 'skill' && target.pluginRoot && !opts.tag) out(`Running only cases tagged skill:${skillName}.`);
  if (opts.dryRun) { out(command); return; }

  let decoys = [];
  let pluginDir = target.pluginRoot;
  if (needsWrapper) ({ root: pluginDir, decoys } = buildWrapper(target, ws, { evalsFrom }));
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'command.txt'), command + '\n');
  if (decoys.length) out(`Decoys installed beside the skill under test: ${decoys.join(', ')}`);
  out(`Running: ${command}`);
  out(`Results: ${outDir}`);
  const child = spawn('claude', args, { env: cleanEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
  const log = join(outDir, 'run.log');
  child.stdout.on('data', d => { process.stdout.write(d); appendFileSync(log, d); });
  child.stderr.on('data', d => { process.stderr.write(d); appendFileSync(log, d); });
  child.on('error', e => fail(`could not start claude: ${e.message}. Is Claude Code ${MIN.eval} or later installed?`));
  child.on('close', code => {
    const agg = join(outDir, 'aggregate-result.json');
    if (existsSync(agg)) {
      const warnings = runWarnings(agg, log, { ablation: opts.ablation });
      const summary = (warnings.length ? ['# Read this first', '', ...warnings.map(w => `- ${w}`), '', ''].join('\n') : '') + summarise(agg, target, evalsFrom);
      writeFileSync(join(outDir, 'summary.md'), summary);
      out('\n' + summary);
    } else {
      out(`\nNo aggregate-result.json in ${outDir}; see run.log.`);
    }
    if (code === 2) out('Exit 2: a partial run (cost ceiling hit or credential rejected). Don\'t compare its numbers with a full run.');
    process.exit(code ?? 1);
  });
}

// Problems that make a run's numbers meaningless, from plugin eval's own
// result file and log. Its authoring guide names them: a plugin entry with one
// of these problem codes means the with-plugin arm ran without the plugin, and
// "cannot pass with the granted tools" means a file grader can never pass.
const LOAD_PROBLEMS = new Set(['manifest_invalid', 'disabled_by_default', 'will_not_load']);

function runWarnings(aggPath, logPath, { ablation } = {}) {
  const warnings = [];
  let raw = null;
  try { raw = JSON.parse(readFileSync(aggPath, 'utf8')); } catch { return warnings; }
  const plugins = raw.suite?.plugins ?? [];
  if (!plugins.length) warnings.push('No plugin was loaded for this run (suite.plugins is empty): the with-plugin arm ran without it, so these numbers say nothing about the skill. Check the path and the manifest.');
  for (const p of plugins) {
    const probs = [p.problem, ...(p.problems ?? [])].filter(Boolean).map(x => (typeof x === 'string' ? x : x.code ?? x.kind ?? JSON.stringify(x)));
    for (const code of probs) {
      if (LOAD_PROBLEMS.has(code)) warnings.push(`Plugin ${p.name} reported ${code}: the with-plugin arm ran without it. Fix that before reading any score.`);
    }
  }
  if (logPath && existsSync(logPath)) {
    for (const line of readFileSync(logPath, 'utf8').split('\n')) {
      if (/cannot pass with the granted tools/.test(line)) warnings.push(`${line.replace(/^[^\w⚠]*/, '').trim()} (grant the tool in the case's allowed_tools or with --allow-tools, then rerun that case)`);
    }
  }
  if (raw.partial) warnings.push(`Partial run (${raw.partialReason ?? 'cost ceiling or credential'}): don't compare these numbers with a full run.`);
  return [...new Set(warnings)];
}

function summarise(aggPath, target, evalsFrom = null) {
  const res = readResults(aggPath);
  const lines = [`# Eval summary`, '', `${aggPath}`, ''];
  lines.push(`Overall score ${res.overallScore ?? 'n/a'}${res.meanDelta != null ? `, mean delta vs no plugin ${res.meanDelta}` : ''}. Cost $${res.costUsd?.toFixed?.(2) ?? '?'}, ${Math.round(res.durationSeconds ?? 0)} s${res.partial ? `. PARTIAL RUN (${res.partialReason})` : ''}.`, '');
  const pluginRoot = target.pluginRoot;
  for (const dir of target.skills) {
    const name = lintSkill(dir).info.name ?? basename(dir);
    const plugin = pluginRoot ? readPluginJson(pluginRoot)?.name : `${basename(dir)}-wrapper`;
    const casesDir = evalsFrom ?? (pluginRoot ? evalDir(pluginRoot) : join(dir, 'evals'));
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
    const casesDir = evalsFrom ?? (pluginRoot ? evalDir(pluginRoot) : join(dir, 'evals'));
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
  const agg = resolve(pos[0]);
  const warnings = runWarnings(agg, join(dirname(agg), 'run.log'));
  if (warnings.length) out(['# Read this first', '', ...warnings.map(w => `- ${w}`), ''].join('\n'));
  out(summarise(agg, target));
}

// --- Claude Code tools: what's here, prompt audits, eval authoring ------------------------

function cmdTools(pos, opts) {
  const cc = claudeInfo();
  const sc = skillCreator(PLUGIN_ROOT, { lookupAvailable: true });
  const py = spawnSync('python3', ['-c', 'import yaml'], { encoding: 'utf8' });
  const python = py.error ? 'missing' : py.status === 0 ? 'ok' : 'no-pyyaml';
  const zip = !spawnSync('zip', ['-v'], { encoding: 'utf8' }).error;
  const res = { claude: { found: cc.found, version: cc.version, reason: cc.reason ?? null }, can: cc.can, minVersions: MIN, skillCreator: sc, python, zip };
  if (opts.json) return out(JSON.stringify(res, null, 2));
  const yes = (b, why) => (b ? 'yes' : `no${why ? ` (${why})` : ''}`);
  if (cc.found) {
    out(`Claude Code ${cc.version}`);
    out(`  validation            claude plugin validate               ${yes(cc.can.validate)}`);
    out(`  context cost          claude plugin details                ${yes(cc.can.details)}`);
    out(`  evals                 claude plugin eval, eval init        ${yes(cc.can.eval, `needs ${MIN.eval}`)}`);
    out(`  prompt audits         /claude-api and /doctor prompt-audit ${yes(cc.can.promptAudit, `needs ${MIN.promptAudit}`)}`);
    out(`  usage                 /skill-doctor                        ${yes(cc.can.skillDoctor)}`);
  } else {
    out(`Claude Code: not available (${cc.reason}).`);
    out('  Works without it: lint, collisions, inventory, eval-suite health, trigger-case generation, snapshots, packaging, skill-creator and its scripts.');
    out('  Needs it: claude plugin validate and details, evals, prompt audits, /skill-doctor.');
  }
  out(sc.source === 'plugin'
    ? `skill-creator: installed plugin ${sc.id} at ${sc.path}`
    : `skill-creator: Skillio's pinned copy at ${sc.path}${sc.installId ? ` (install the plugin to get updates: /plugin install ${sc.installId})` : ''}`);
  out(`python3 with PyYAML: ${python === 'ok' ? 'yes' : python === 'missing' ? 'no python3 (skill-creator\'s scripts and validator need it)' : 'no PyYAML (pip install pyyaml)'}`);
  out(`zip: ${yes(zip, 'packaging for the Claude app needs it')}`);
}

// The project a path belongs to, for /doctor prompt-audit: the nearest folder
// up with a .git, a .claude folder or a CLAUDE.md; else the path itself.
function projectRoot(p) {
  let d = existsSync(p) && !p.endsWith('.md') ? resolve(p) : dirname(resolve(p));
  for (let cur = d; ; ) {
    if (['.git', '.claude', 'CLAUDE.md', 'AGENTS.md'].some(n => existsSync(join(cur, n))) && basename(cur) !== '.claude') return cur;
    const up = dirname(cur);
    if (up === cur) return d;
    cur = up;
  }
}

function cmdAudit(pos, opts) {
  const scope = opts.scope ?? (opts.setup ? 'both' : 'skill');
  if (!['skill', 'setup', 'both'].includes(scope)) fail('--scope is skill, setup or both');
  const p = resolve(pos[0] ?? '.');
  const target = detectTarget(p);
  const cc = claudeInfo();
  if (!cc.can.promptAudit) {
    out(`Prompt audits not run: ${cc.found ? `they need Claude Code ${MIN.promptAudit} or later (found ${cc.version})` : cc.reason}.`);
    return;
  }
  const ws = workspaceFor(target, target.kind === 'skill' ? target.path : null);
  const dir = join(ws, 'skillio', 'audits', timestamp());
  mkdirSync(dir, { recursive: true });
  const root = gitRoot(target.path) ?? dirname(target.path);
  const jobs = [];
  // One call for the whole target: a skill folder, or a plugin (its skills,
  // agents and commands), or a folder of skills.
  if (scope !== 'setup') jobs.push({ scope: 'skill', cwd: root, path: relative(root, target.path) || '.', file: 'prompt-audit.md', label: `/claude-api prompt-audit ${relative(root, target.path) || '.'}` });
  if (scope !== 'skill') jobs.push({ scope: 'setup', cwd: projectRoot(target.path), file: 'setup-audit.md', label: '/doctor prompt-audit' });
  let total = 0;
  for (const j of jobs) {
    out(`Running ${j.label} in ${j.cwd} (a model call on your account)...`);
    const r = promptAudit({ scope: j.scope, path: j.path, cwd: j.cwd, model: opts.model });
    if (r.skipped || r.error) { out(`  ${r.skipped ? 'skipped' : 'failed'}: ${r.skipped ?? r.error}`); continue; }
    total += r.costUsd ?? 0;
    const file = join(dir, j.file);
    writeFileSync(file, `<!-- ${j.label}, run by skillio audit in ${j.cwd}, ${new Date().toISOString().slice(0, 16)}, $${(r.costUsd ?? 0).toFixed(2)} -->\n\n${r.text}\n`);
    out(`  saved to ${file} ($${(r.costUsd ?? 0).toFixed(2)})\n`);
    out(r.text);
    out('');
  }
  out(`Audit cost: $${total.toFixed(2)}. Proposed diffs are suggestions; nothing was changed.`);
}

function cmdEvalInit(pos, opts) {
  const target = detectTarget(pos[0] ?? '.');
  if (!target.pluginRoot && target.kind !== 'skill') fail('eval-init takes a plugin or a skill folder');
  const skillName = target.kind === 'skill' ? (lintSkill(target.path).info.name ?? basename(target.path)) : null;
  const cwd = target.kind === 'skill' && !target.pluginRoot ? target.path : target.pluginRoot;
  const evalArgs = target.kind === 'skill' && !target.pluginRoot ? ['--eval-dir', 'evals'] : [];
  const cli = `node "${join(PLUGIN_ROOT, 'scripts', 'skillio.mjs')}"`;
  const notes = [
    '',
    '## Skillio notes for this interview',
    '',
    '- Use it for output cases: what the skill produces. Triggering is covered by Skillio\'s trigger suite (`trigger-cases`), with more near misses and a held-out split.',
    `- Add \`tags: [output${skillName ? `, skill:${skillName}` : ', skill:<skill-name>'}]\` to the frontmatter of every prompt.md you write, so \`run-evals --tag output\` and Skillio's summaries find the cases.`,
    `- Pilot with \`${cli} run-evals ${target.kind === 'skill' ? target.path : target.pluginRoot} --case <name> --runs 1 --trust\` (add \`--allow-tools ...\` when a case needs them) instead of \`claude plugin eval .\`: it also works for a skill outside a plugin, keeps the report local and gives the runs a clean environment. Ask the trust question first, exactly as the interview says.`,
    '- run-evals uses `--judge-model sonnet` unless you pass another, as the interview recommends.',
  ].join('\n');
  const cc = claudeInfo();
  if (!cc.can.eval) {
    out(`claude plugin eval init isn't available (${cc.found ? `needs Claude Code ${MIN.eval}` : cc.reason}). Write output cases by hand from ${join(PLUGIN_ROOT, 'skills', 'building-skills', 'references', 'eval-suite.md')}, section "Output cases and graders".`);
    return;
  }
  if (opts.bare) {
    const r = spawnSync('claude', ['plugin', 'eval', 'init', '--bare', String(opts.bare), ...evalArgs], { cwd, encoding: 'utf8', env: cleanEnv() });
    out((r.stdout + r.stderr).trim());
    process.exit(r.status ?? 1);
  }
  if (process.stdin.isTTY && process.stdout.isTTY && !process.env.CLAUDECODE) {
    // A person at a terminal: the real interview, run by Claude Code.
    const r = spawnSync('claude', ['plugin', 'eval', 'init', ...evalArgs], { cwd, stdio: 'inherit', env: cleanEnv() });
    out(notes);
    process.exit(r.status ?? 1);
  }
  // Inside a session there is no terminal for the interview, so Claude Code
  // prints it for the session's Claude to conduct. The session variables stay
  // so it can tell.
  const r = spawnSync('claude', ['plugin', 'eval', 'init', ...evalArgs], { cwd, encoding: 'utf8', env: { ...process.env, CLAUDECODE: process.env.CLAUDECODE ?? '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  out((r.stdout + r.stderr).trim());
  out(notes);
}

// --- working files ----------------------------------------------------------------------

function cmdWorkspace(pos) {
  const p = resolve(pos[0] ?? '.');
  let target;
  try { target = detectTarget(p); } catch {
    // A skill that doesn't exist yet: its workspace still goes beside it.
    out(join(dirname(p), `${basename(p)}-workspace`));
    return;
  }
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
  tools: cmdTools, lint: cmdLint, collisions: cmdCollisions, inventory: cmdInventory, check: cmdCheck, audit: cmdAudit, evals: cmdEvals,
  'trigger-cases': cmdTriggerCases, decoy: cmdDecoy, 'eval-init': cmdEvalInit, 'run-evals': cmdRunEvals, results: cmdResults,
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
