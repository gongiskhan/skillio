// Reads and writes `claude plugin eval` suites, with Skillio's conventions for
// trigger testing layered on top of the official format:
//
//   evals/<group>/<case>/prompt.md        frontmatter + the user prompt
//   evals/<group>/<case>/graders/*.md     one grader per file
//
// Tags Skillio uses (plain plugin-eval tags, so --tag filtering works):
//   trigger        any case that measures whether a skill fires
//   should-fire    the skill must be invoked
//   should-not-fire the skill must not be invoked (a near miss)
//   held-out       written after the description, never used to tune it
//   output         a case that grades what the skill produced
//   skill:<name>   which skill the case is about

import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { join, relative, basename, resolve } from 'node:path';
import { parseFrontmatter, parseYamlSubset } from './frontmatter.mjs';

export function findPluginRoot(start) {
  let d = resolve(start);
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(d, '.claude-plugin', 'plugin.json'))) return d;
    const up = resolve(d, '..');
    if (up === d) break;
    d = up;
  }
  return null;
}

export function readPluginJson(root) {
  try { return JSON.parse(readFileSync(join(root, '.claude-plugin', 'plugin.json'), 'utf8')); } catch { return null; }
}

export function evalDir(pluginRoot) {
  const pj = readPluginJson(pluginRoot);
  const custom = pj?.experimental?.evals;
  return join(pluginRoot, typeof custom === 'string' && !custom.includes('..') ? custom : 'evals');
}

export function listCases(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  const walk = d => {
    const ents = readdirSync(d, { withFileTypes: true });
    const names = ents.map(e => e.name);
    if (names.includes('prompt.md') || names.includes('case.yaml')) {
      out.push(readCase(d, dir));
      return;
    }
    for (const e of ents) {
      if (!e.isDirectory()) continue;
      if (['results', 'mocks', 'decoys', 'node_modules', '.git'].includes(e.name)) continue;
      walk(join(d, e.name));
    }
  };
  walk(dir);
  return out;
}

export function readCase(caseDir, root) {
  const c = { dir: caseDir, rel: relative(root, caseDir), name: basename(caseDir), tags: [], prompt: '', graders: [], problems: [] };
  if (existsSync(join(caseDir, 'case.yaml'))) {
    try {
      const y = parseYamlSubset(readFileSync(join(caseDir, 'case.yaml'), 'utf8'));
      if (y.name) c.name = y.name;
      if (Array.isArray(y.tags)) c.tags.push(...y.tags.map(String));
      if (y.execution?.prompt) c.prompt = String(y.execution.prompt);
      for (const g of y.graders ?? []) c.graders.push({ ...g, name: g.name ?? 'grader' });
    } catch (e) { c.problems.push(`case.yaml: ${e.message}`); }
  }
  if (existsSync(join(caseDir, 'prompt.md'))) {
    const fm = parseFrontmatter(readFileSync(join(caseDir, 'prompt.md'), 'utf8'));
    if (fm.errors.length) c.problems.push(`prompt.md: ${fm.errors[0]}`);
    const d = fm.data ?? {};
    if (d.name) c.name = String(d.name);
    if (Array.isArray(d.tags)) c.tags = [...new Set([...c.tags, ...d.tags.map(String)])];
    c.prompt = fm.body.trim() || c.prompt;
    c.frontmatter = d;
  }
  const gdir = join(caseDir, 'graders');
  if (existsSync(gdir)) {
    for (const f of readdirSync(gdir).filter(f => f.endsWith('.md')).sort()) {
      const fm = parseFrontmatter(readFileSync(join(gdir, f), 'utf8'));
      if (fm.errors.length) { c.problems.push(`graders/${f}: ${fm.errors[0]}`); continue; }
      c.graders.push({ ...(fm.data ?? {}), name: f.replace(/\.md$/, ''), criteria: fm.body.trim() || undefined });
    }
  }
  return c;
}

// Does a tool_used grader's input_match select this skill? Claude Code encodes
// the Skill tool input as JSON like {"skill":"plugin:name"}.
function graderTargetsSkill(g, skill, plugin) {
  if (g.type !== 'tool_used' || g.tool !== 'Skill') return false;
  if (!g.input_match) return true;
  let re;
  try { re = new RegExp(g.input_match); } catch { return false; }
  const forms = [`{"skill":"${skill}"}`, `{"skill": "${skill}"}`];
  if (plugin) forms.push(`{"skill":"${plugin}:${skill}"}`, `{"skill": "${plugin}:${skill}"}`);
  return forms.some(f => re.test(f));
}

export function classify(c, skill, plugin) {
  const tags = new Set(c.tags);
  const skillGraders = c.graders.filter(g => graderTargetsSkill(g, skill, plugin));
  const aboutSkill = tags.has(`skill:${skill}`) || skillGraders.length > 0;
  let kind = null;
  if (skillGraders.some(g => Number(g.max) === 0)) kind = 'should-not-fire';
  else if (skillGraders.length) kind = 'should-fire';
  else if (aboutSkill && tags.has('should-not-fire')) kind = 'should-not-fire';
  else if (aboutSkill && tags.has('should-fire')) kind = 'should-fire';
  return {
    aboutSkill,
    kind,
    heldOut: tags.has('held-out') || tags.has('heldout'),
    output: tags.has('output') || c.graders.some(g => g.type !== 'tool_used' || g.tool !== 'Skill'),
  };
}

export function suiteSummary(pluginRoot, skill) {
  const plugin = readPluginJson(pluginRoot)?.name;
  const dir = evalDir(pluginRoot);
  const cases = listCases(dir).map(c => ({ ...c, cls: classify(c, skill, plugin) }));
  const mine = skill ? cases.filter(c => c.cls.aboutSkill) : cases;
  const count = pred => mine.filter(pred).length;
  return {
    dir,
    plugin,
    total: cases.length,
    cases: mine,
    shouldFire: count(c => c.cls.kind === 'should-fire'),
    shouldNotFire: count(c => c.cls.kind === 'should-not-fire'),
    heldOut: count(c => c.cls.heldOut),
    output: count(c => c.cls.output && !c.cls.kind),
    problems: mine.flatMap(c => c.problems.map(p => `${c.rel}: ${p}`)),
  };
}

// --- writing trigger cases ------------------------------------------------------

export function slugify(s, max = 48) {
  return String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/, '') || 'case';
}

function yamlString(s) {
  return JSON.stringify(String(s));
}

// items: [{ query|prompt, should_trigger, held_out?, name? }]  (skill-creator's
// trigger eval set format, plus held_out). Returns the case directories written.
export function writeTriggerCases(evalsRoot, skill, items, opts = {}) {
  const group = join(evalsRoot, opts.group ?? `trigger-${skill}`);
  const written = [];
  const used = new Set();
  for (const it of items) {
    const prompt = String(it.query ?? it.prompt ?? '').trim();
    if (!prompt) continue;
    const fire = it.should_trigger ?? it.shouldTrigger ?? it.fire;
    if (typeof fire !== 'boolean') throw new Error(`item "${prompt.slice(0, 40)}" needs should_trigger: true or false`);
    const held = Boolean(it.held_out ?? it.heldOut);
    let name = slugify(it.name ?? `${fire ? 'fire' : 'skip'}-${prompt}`);
    while (used.has(name)) name += '-x';
    used.add(name);
    const dir = join(group, name);
    if (existsSync(dir) && !opts.overwrite) continue;
    mkdirSync(join(dir, 'graders'), { recursive: true });
    // `<skill>:tuning` and `<skill>:held-out` exist because --tag matches any
    // tag: they are the only way to run one skill's tuning cases without its
    // held-out cases (or the other way round) in a plugin with several skills.
    const tags = ['trigger', fire ? 'should-fire' : 'should-not-fire', `skill:${skill}`, held ? 'held-out' : 'tuning', `${skill}:${held ? 'held-out' : 'tuning'}`];
    const fmLines = [
      '---',
      `description: ${yamlString(`${fire ? 'Should' : 'Should not'} invoke ${skill}${held ? ' (held out)' : ''}`)}`,
      `tags: [${tags.join(', ')}]`,
      `max_turns: ${opts.maxTurns ?? 4}`,
      'allowed_tools: [Read, Glob, Grep, Skill]',
    ];
    if (opts.runs) fmLines.push(`runs: ${opts.runs}`);
    fmLines.push('---', '', prompt, '');
    writeFileSync(join(dir, 'prompt.md'), fmLines.join('\n'));
    const match = `'"skill"\\s*:\\s*"(?:[\\w-]+:)?${skill}"'`;
    const grader = fire
      ? ['---', 'type: tool_used', 'tool: Skill', `input_match: ${match}`, '---', '']
      : ['---', 'type: tool_used', 'tool: Skill', `input_match: ${match}`, 'min: 0', 'max: 0', 'arm: both', '---', ''];
    writeFileSync(join(dir, 'graders', fire ? 'skill-fired.md' : 'skill-not-fired.md'), grader.join('\n'));
    if (it.fixture) writeFixture(dir, name, it.fixture);
    written.push(dir);
  }
  return written;
}

// A fixture is a skill the prompt talks about ("check my release-notes
// skill"). Runs start in an empty folder, so without it Claude searches, finds
// nothing and gives up before deciding whether to load a skill, which measures
// the empty folder rather than the description. The scaffold script creates
// skills/<name>/SKILL.md in the run's workspace; plugin eval runs it only with
// --scaffold, as the user.
export function writeFixture(caseDir, caseName, fixture) {
  const f = typeof fixture === 'string' ? { name: fixture } : fixture;
  const name = slugify(f.name);
  const words = name.replace(/-/g, ' ');
  const description = f.description ?? `Writes ${words} for the team in the house format. Use when the user asks for ${words}.`;
  const skillMd = [
    '---', `name: ${name}`, `description: ${JSON.stringify(description)}`, '---', '',
    `# ${words[0].toUpperCase()}${words.slice(1)}`, '',
    '1. Read the input the user gives you.',
    '2. Write the output in the house format: a title, three short sections, a closing line.',
    '3. Keep it under one page.', '',
  ].join('\n');
  const script = [
    '#!/usr/bin/env bash',
    '# Creates the skill this case talks about, so the run has something to find.',
    'set -euo pipefail',
    `mkdir -p "skills/${name}"`,
    `cat > "skills/${name}/SKILL.md" <<'SKILLIO_FIXTURE'`,
    skillMd.trimEnd(),
    'SKILLIO_FIXTURE',
    '',
  ].join('\n');
  writeFileSync(join(caseDir, 'fixture.sh'), script);
  writeFileSync(join(caseDir, 'case.yaml'), `schema_version: "1.1"\nname: ${caseName}\ncontext:\n  scaffold_script: fixture.sh\n`);
}

// A decoy is a skill folder under <evals>/decoys/ that copies a rival's
// description. Plugin eval can't load the plugin under test plus an extra
// plugin from inside its own eval folder, so run-evals copies the plugin into
// the workspace and adds every decoy as a sibling skill: in every case of the
// run the rival is "installed", the way it would be on a real machine.
export function writeDecoy(evalsRoot, decoyName, description) {
  const dir = join(evalsRoot, 'decoys', decoyName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${decoyName}\ndescription: ${yamlString(description)}\n---\n\nThis is an eval decoy standing in for a rival skill. Reply that the ${decoyName} decoy was used, then stop.\n`);
  return dir;
}

export function listDecoys(evalsRoot) {
  const dir = join(evalsRoot, 'decoys');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isDirectory() && existsSync(join(dir, e.name, 'SKILL.md')))
    .map(e => ({ name: e.name, dir: join(dir, e.name) }));
}

// --- reading results ------------------------------------------------------------

// Pulls per-case pass rates out of aggregate-result.json (the file --json writes).
// The schema adds fields over time, so this reads defensively.
export function readResults(path) {
  const r = JSON.parse(readFileSync(path, 'utf8'));
  const cases = (r.cases ?? []).map(c => {
    const withRuns = c.arms?.with ?? c.runs ?? [];
    const withoutRuns = c.arms?.without ?? [];
    const passed = run => {
      if (typeof run.passed === 'boolean') return run.passed;
      if (Array.isArray(run.graders)) return run.graders.every(g => g.passed !== false && g.pass !== false);
      if (typeof run.score === 'number') return run.score >= 1;
      return false;
    };
    return {
      name: c.name,
      dir: c.dir ?? null,
      tags: c.tags ?? [],
      runResults: withRuns.map(r => ({ passed: passed(r), graders: (r.graders ?? []).map(g => ({ name: g.name, passed: g.passed })) })),
      score: c.aggregates?.score ?? null,
      delta: c.aggregates?.delta ?? null,
      runs: withRuns.length,
      runsPassed: withRuns.filter(passed).length,
      errors: withRuns.filter(x => x.error || x.aborted).length,
      baselineRuns: withoutRuns.length,
      baselinePassed: withoutRuns.filter(passed).length,
      raw: c,
    };
  });
  return {
    partial: r.partial ?? false,
    partialReason: r.partialReason ?? null,
    overallScore: r.aggregates?.overallScore ?? null,
    meanDelta: r.aggregates?.meanDelta ?? null,
    costUsd: r.costUsd ?? null,
    durationSeconds: r.durationSeconds ?? null,
    claudeVersion: r.claudeVersion ?? null,
    cases,
  };
}

// Trigger metrics: recall on should-fire (training and held-out separately),
// false fires on should-not-fire, and pass^k (every run correct).
export function lookupCase(caseIndex, rc) {
  if (rc.dir) {
    for (const c of caseIndex.values()) if (c.dir.endsWith('/' + rc.dir) || c.dir.endsWith(rc.dir.replace(/^[^/]+\//, '/'))) return c;
  }
  return caseIndex.get(rc.name) ?? null;
}

// A trigger run is correct when its Skill grader passed. Other graders in the
// same case (output checks) don't change whether the skill fired.
function triggerCorrect(rc, info) {
  const names = new Set(info.graders.filter(g => g.type === 'tool_used' && g.tool === 'Skill').map(g => g.name));
  return rc.runResults.map(r => {
    const g = r.graders.find(x => names.has(x.name));
    return g ? g.passed === true : r.passed;
  });
}

export function triggerMetrics(results, caseIndex) {
  const groups = { train: [], heldOut: [], negative: [] };
  for (const rc of results.cases) {
    const info = lookupCase(caseIndex, rc);
    if (!info || !info.cls.kind) continue;
    const correct = triggerCorrect(rc, info);
    const t = { ...rc, runs: correct.length, runsPassed: correct.filter(Boolean).length };
    if (info.cls.kind === 'should-not-fire') groups.negative.push(t);
    else (info.cls.heldOut ? groups.heldOut : groups.train).push(t);
  }
  const sum = list => ({
    cases: list.length,
    runs: list.reduce((n, c) => n + c.runs, 0),
    runsCorrect: list.reduce((n, c) => n + c.runsPassed, 0),
    allRunsCorrect: list.filter(c => c.runs > 0 && c.runsPassed === c.runs).length,
    misses: list.filter(c => c.runsPassed < c.runs).map(c => `${c.name} (${c.runsPassed}/${c.runs})`),
  });
  return { train: sum(groups.train), heldOut: sum(groups.heldOut), negative: sum(groups.negative) };
}

export function pct(a, b) {
  return b ? `${Math.round((100 * a) / b)}%` : 'n/a';
}

export function isDir(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}
