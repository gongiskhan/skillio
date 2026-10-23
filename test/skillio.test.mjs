// Run with: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { parseFrontmatter, parseYamlSubset } from '../scripts/lib/frontmatter.mjs';
import { lintSkill, sharedSpan } from '../scripts/lib/lint.mjs';
import { RULES } from '../scripts/lib/rules.mjs';
import { principles } from '../scripts/lib/report.mjs';
import { similarity } from '../scripts/lib/collisions.mjs';
import { writeTriggerCases, writeDecoy, listDecoys, listCases, classify, readResults, triggerMetrics } from '../scripts/lib/evals.mjs';
import { detectTarget, workspaceFor } from '../scripts/lib/target.mjs';
import { buildWrapper } from '../scripts/lib/wrapper.mjs';
import { compareVersions, cleanEnv, parseDetails, validateFindings, claudeInfo } from '../scripts/lib/claude.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIX = join(ROOT, 'test', 'fixtures');
const CLI = join(ROOT, 'scripts', 'skillio.mjs');
const tmp = () => mkdtempSync(join(tmpdir(), 'skillio-test-'));
const NO_CLAUDE = { ...process.env, SKILLIO_CLAUDE: 'off' };
const HAS_CLAUDE = claudeInfo().found;
const ids = r => new Set(r.findings.map(f => f.id));

function badSkillCopy() {
  const dir = join(tmp(), 'bad-skill');
  cpSync(join(FIX, 'bad-skill'), dir, { recursive: true });
  // Created here rather than committed: a .DS_Store breaks the plugin directory
  // checks, and a key-shaped string trips GitHub's push protection.
  writeFileSync(join(dir, '.DS_Store'), 'x');
  writeFileSync(join(dir, 'references', 'env.txt'), `export ANTHROPIC_API_KEY=${'sk-ant-' + 'api03-' + 'a1B2c3D4e5'.repeat(4)}\n`);
  return dir;
}

test('frontmatter parser handles the shapes real skills use', () => {
  const y = parseYamlSubset([
    'name: x',
    'description: >-',
    '  Folded text',
    '  continues here.',
    'literal: |',
    '  line one',
    '  line two',
    'list: [a, "b, c", \'d\']',
    'block:',
    '  - one',
    '  - two',
    'map:',
    '  k: v',
    '  n: 3',
    'flag: true',
    'wrapped: plain value that',
    '  wraps onto the next line',
    'quoted: "a \\"q\\" b"',
  ].join('\n'));
  assert.equal(y.description, 'Folded text continues here.');
  assert.equal(y.literal, 'line one\nline two\n');
  assert.deepEqual(y.list, ['a', 'b, c', 'd']);
  assert.deepEqual(y.block, ['one', 'two']);
  assert.deepEqual(y.map, { k: 'v', n: 3 });
  assert.equal(y.flag, true);
  assert.equal(y.wrapped, 'plain value that wraps onto the next line');
  assert.equal(y.quoted, 'a "q" b');
});

test('frontmatter parser reports broken YAML instead of guessing', () => {
  const r = parseFrontmatter('---\nname: x\ndescription: "unterminated\n---\nbody\n');
  assert.ok(r.errors.length > 0);
  const r2 = parseFrontmatter('---\nname: x\n');
  assert.equal(r2.hasFrontmatter, false);
  assert.ok(r2.unterminated);
});

test('a well-formed skill lints clean', () => {
  const r = lintSkill(join(FIX, 'good-skill'));
  assert.deepEqual(r.findings, []);
  assert.equal(r.info.name, 'good-skill');
});

test('the bad fixture trips the rules it was built to trip', () => {
  const r = lintSkill(badSkillCopy());
  const got = ids(r);
  for (const id of ['S004', 'S005', 'S006', 'S007', 'S010', 'S011', 'S013', 'D001', 'D002', 'D003', 'D005', 'B003', 'B004', 'B006', 'B007', 'B008', 'B009', 'B010', 'B012', 'P001', 'P002', 'P003']) {
    assert.ok(got.has(id), `expected ${id}; got ${[...got].join(', ')}`);
  }
  const caseMismatch = r.findings.find(f => f.id === 'B003' && /FORMS\.md/.test(f.message));
  assert.ok(caseMismatch, 'case mismatch FORMS.md vs forms.md is reported');
  assert.equal(caseMismatch.severity, 'error');
});

test('portable target flags Claude Code-only fields', () => {
  const dir = join(tmp(), 'cc-only');
  mkdirSync(dir);
  writeFileSync(join(dir, 'SKILL.md'), '---\nname: cc-only\ndescription: Formats release notes from merged pull requests. Use when the user asks for release notes or a changelog entry.\ndisable-model-invocation: true\n---\n\n# Release notes\n\nOne.\nTwo.\nThree.\nFour.\nFive.\n');
  assert.ok(!ids(lintSkill(dir, { target: 'claude-code' })).has('S012'));
  assert.ok(ids(lintSkill(dir, { target: 'claude-ai' })).has('S012'));
});

test('description copying an eval prompt is caught, held-out copies are errors', () => {
  const dir = join(tmp(), 'overfit');
  mkdirSync(dir);
  writeFileSync(join(dir, 'SKILL.md'), '---\nname: overfit\ndescription: Builds board summaries. Use when someone says my manager wants the q3 numbers turned into the usual board summary.\n---\n\n# x\n\nOne.\nTwo.\nThree.\nFour.\nFive.\n');
  const prompts = [{ name: 'c1', prompt: 'my manager wants the Q3 numbers turned into the usual board summary, thanks', heldOut: true }];
  const f = lintSkill(dir, { evalPrompts: prompts }).findings.find(x => x.id === 'D006');
  assert.ok(f);
  assert.equal(f.severity, 'error');
  assert.equal(sharedSpan('alpha beta gamma delta', 'zeta eta theta', 6), null);
});

test('every rule has a section in principles.md with a plain-words line', () => {
  const p = principles();
  for (const id of [...Object.keys(RULES), 'V000', 'V001']) {
    assert.ok(p.has(id), `principles.md has no section for ${id}`);
    assert.ok(p.get(id).plain, `${id} has no "In plain words." paragraph`);
  }
});

test('description similarity ranks real competitors above unrelated skills', () => {
  const creator = 'Create new skills, modify and improve existing skills, and measure skill performance.';
  const writing = 'Use when creating new skills, editing existing skills, or verifying skills work before deployment';
  const pdf = 'Use this skill whenever the user wants to do anything with PDF files, merging, splitting, watermarks.';
  assert.ok(similarity(creator, writing).score > 0.35);
  assert.ok(similarity(creator, pdf).score < 0.1);
});

test('trigger cases round-trip through the plugin-eval format', () => {
  const root = join(tmp(), 'plug');
  mkdirSync(join(root, '.claude-plugin'), { recursive: true });
  writeFileSync(join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'plug' }));
  const written = writeTriggerCases(join(root, 'evals'), 'hello', [
    { query: 'please greet the new hire warmly, she started today', should_trigger: true },
    { query: 'write a regex for ISO dates in my logs', should_trigger: false, held_out: true },
  ]);
  assert.equal(written.length, 2);
  const cases = listCases(join(root, 'evals')).map(c => ({ ...c, cls: classify(c, 'hello', 'plug') }));
  const fire = cases.find(c => c.cls.kind === 'should-fire');
  const skip = cases.find(c => c.cls.kind === 'should-not-fire');
  assert.ok(fire && skip);
  assert.ok(skip.cls.heldOut);
  assert.ok(!fire.cls.heldOut);
  const g = skip.graders[0];
  assert.equal(g.max, 0);
  assert.equal(g.arm, 'both');
  assert.ok(new RegExp(g.input_match).test('{"skill":"plug:hello"}'));
  assert.ok(!new RegExp(g.input_match).test('{"skill":"plug:hello-world"}'));
});

test('results are read from the Skill grader, not the run score', () => {
  const root = join(tmp(), 'plug');
  mkdirSync(join(root, '.claude-plugin'), { recursive: true });
  writeFileSync(join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'plug' }));
  writeTriggerCases(join(root, 'evals'), 'hello', [{ query: 'please greet the new hire warmly, she started today', name: 'fire-a', should_trigger: true }]);
  const agg = join(root, 'agg.json');
  const run = passed => ({ score: 0.5, passed: false, graders: [{ name: 'skill-fired', passed }, { name: 'other', passed: false }] });
  writeFileSync(agg, JSON.stringify({ cases: [{ name: 'fire-a', dir: 'evals/trigger-hello/fire-a', arms: { with: [run(true), run(true), run(false)] }, aggregates: { score: 0.5 } }], aggregates: { overallScore: 0.5 } }));
  const index = new Map(listCases(join(root, 'evals')).map(c => [c.name, { ...c, cls: classify(c, 'hello', 'plug') }]));
  const m = triggerMetrics(readResults(agg), index);
  assert.equal(m.train.runs, 3);
  assert.equal(m.train.runsCorrect, 2);
  assert.equal(m.train.allRunsCorrect, 0);
});

test('workspaces sit beside the skill or plugin, never inside it', () => {
  const t = detectTarget(join(FIX, 'good-skill'));
  assert.equal(workspaceFor(t, t.path), join(FIX, 'good-skill-workspace'));
  const p = detectTarget(ROOT);
  assert.equal(p.kind, 'plugin');
  assert.equal(p.skills.length, 3);
  assert.ok(workspaceFor(p).endsWith('skillio-workspace'));
  assert.ok(!workspaceFor(p).startsWith(ROOT + '/'));
});

test('the hook reports errors every time and warnings once', () => {
  const dir = badSkillCopy();
  const state = tmp();
  const run = () => spawnSync('node', [join(ROOT, 'scripts', 'hook-lint.mjs')], {
    input: JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: join(dir, 'SKILL.md') }, cwd: dir }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PLUGIN_DATA: state },
  });
  const first = run();
  assert.equal(first.status, 2);
  assert.match(first.stderr, /ERROR S005/);
  assert.match(first.stderr, /WARN/);
  const second = run();
  assert.equal(second.status, 2);
  assert.match(second.stderr, /ERROR S005/);
  assert.doesNotMatch(second.stderr, /WARN/);
});

test('the hook stays silent outside skills and when switched off', () => {
  const outside = spawnSync('node', [join(ROOT, 'scripts', 'hook-lint.mjs')], { input: JSON.stringify({ tool_input: { file_path: join(tmp(), 'notes.md') } }), encoding: 'utf8' });
  assert.equal(outside.status, 0);
  const off = spawnSync('node', [join(ROOT, 'scripts', 'hook-lint.mjs')], { input: JSON.stringify({ tool_input: { file_path: join(badSkillCopy(), 'SKILL.md') } }), encoding: 'utf8', env: { ...process.env, SKILLIO_HOOK: 'off' } });
  assert.equal(off.status, 0);
});

test('check writes a report next to the skill and exits non-zero on errors', () => {
  const dir = badSkillCopy();
  const r = spawnSync('node', [CLI, 'check', dir, '--no-claude', '--json', '--root', tmp()], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  const out = JSON.parse(r.stdout);
  assert.ok(existsSync(out.report));
  assert.ok(out.report.startsWith(join(dirname(dir), 'bad-skill-workspace')));
  const md = readFileSync(out.report, 'utf8');
  assert.match(md, /In plain words:/);
});

test('package refuses broken skills and zips good ones without evals', () => {
  const bad = spawnSync('node', [CLI, 'package', badSkillCopy()], { encoding: 'utf8' });
  assert.notEqual(bad.status, 0);
  const good = join(tmp(), 'good-skill');
  cpSync(join(FIX, 'good-skill'), good, { recursive: true });
  mkdirSync(join(good, 'evals', 'case'), { recursive: true });
  writeFileSync(join(good, 'evals', 'case', 'prompt.md'), 'x');
  const r = spawnSync('node', [CLI, 'package', good], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const zip = r.stdout.split('\n')[0];
  const list = spawnSync('unzip', ['-l', zip], { encoding: 'utf8' }).stdout;
  assert.match(list, /good-skill\/SKILL\.md/);
  assert.doesNotMatch(list, /evals/);
});

test("Skillio's own skills lint clean", () => {
  for (const name of readdirSync(join(ROOT, 'skills'))) {
    const r = lintSkill(join(ROOT, 'skills', name));
    assert.deepEqual(r.findings.map(f => `${f.id} ${f.message}`), [], name);
  }
});

test('decoys are skill folders the wrapper installs beside the plugin under test', () => {
  const root = join(tmp(), 'plug');
  mkdirSync(join(root, '.claude-plugin'), { recursive: true });
  mkdirSync(join(root, 'skills', 'hello'), { recursive: true });
  writeFileSync(join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'plug', version: '0.0.1' }));
  writeFileSync(join(root, 'skills', 'hello', 'SKILL.md'), '---\nname: hello\ndescription: Greets people. Use when the user asks for a greeting.\n---\n\n# Hello\n');
  writeDecoy(join(root, 'evals'), 'greeter', 'Writes welcome messages. Use when the user wants to welcome someone.');
  writeTriggerCases(join(root, 'evals'), 'hello', [{ query: 'please greet the new hire warmly, she started today', should_trigger: true }]);
  assert.equal(listDecoys(join(root, 'evals')).length, 1);
  assert.equal(listCases(join(root, 'evals')).length, 1, 'a decoy is not a case');
  const wrapper = join(dirname(root), 'plug-workspace', 'skillio', 'wrapper');
  const r = spawnSync('node', [CLI, 'run-evals', root, '--dry-run'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes(wrapper), 'dry run names the wrapper');
  assert.doesNotMatch(r.stdout, /--trust-plugin/, 'trust is never assumed');
  assert.match(r.stdout, /--judge-model sonnet/);
  const trusted = spawnSync('node', [CLI, 'run-evals', root, '--dry-run', '--trust'], { encoding: 'utf8' });
  assert.match(trusted.stdout, /--trust-plugin/);
  assert.ok(!existsSync(wrapper), 'dry run writes nothing');
  const built = buildWrapper(detectTarget(root), join(dirname(root), 'plug-workspace'));
  assert.deepEqual(built.decoys, ['greeter']);
  assert.ok(existsSync(join(wrapper, 'skills', 'hello', 'SKILL.md')));
  assert.ok(existsSync(join(wrapper, 'skills', 'greeter', 'SKILL.md')));
  const bad = spawnSync('node', [CLI, 'run-evals', root, '--max-cots', '5', '--dry-run'], { encoding: 'utf8' });
  assert.notEqual(bad.status, 0, 'unknown flags are refused, not ignored');
});

test('trigger cases carry per-skill tuning and held-out tags, and fixtures become scaffolds', () => {
  const ev = join(tmp(), 'evals');
  writeTriggerCases(ev, 'hello', [
    { query: 'check my greeter skill', should_trigger: true, fixture: 'greeter' },
    { query: 'a held out wording', should_trigger: true, held_out: true },
  ]);
  const cases = listCases(ev);
  const withFixture = cases.find(c => /check-my/.test(c.name));
  assert.ok(withFixture.tags.includes('hello:tuning'));
  assert.ok(cases.find(c => c.tags.includes('hello:held-out')));
  const script = readFileSync(join(withFixture.dir, 'fixture.sh'), 'utf8');
  assert.match(script, /skills\/greeter\/SKILL\.md/);
  const sh = spawnSync('bash', [join(withFixture.dir, 'fixture.sh')], { cwd: tmp(), encoding: 'utf8' });
  assert.equal(sh.status, 0, sh.stderr);
  assert.match(readFileSync(join(withFixture.dir, 'case.yaml'), 'utf8'), /scaffold_script: fixture\.sh/);
});

test('workspace works for a skill that does not exist yet', () => {
  const p = join(tmp(), 'new-skill');
  const r = spawnSync('node', [CLI, 'workspace', p], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), join(dirname(p), 'new-skill-workspace'));
});

test('version gates and the child-session environment', () => {
  assert.equal(compareVersions('2.1.283', '2.1.269'), 1);
  assert.equal(compareVersions('2.1.269', '2.1.269'), 0);
  assert.equal(compareVersions('2.1.99', '2.1.269'), -1);
  const env = cleanEnv({ CLAUDECODE: '1', CCR_SESSION: 'x', CLAUDE_CODE_ENTRYPOINT: 'remote', CLAUDE_CODE_OAUTH_TOKEN: 't', CLAUDE_CODE_USE_BEDROCK: '1', PATH: '/bin' });
  assert.equal(env.CLAUDECODE, undefined);
  assert.equal(env.CCR_SESSION, undefined);
  assert.equal(env.CLAUDE_CODE_ENTRYPOINT, undefined);
  assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, 't', 'credentials stay');
  assert.equal(env.CLAUDE_CODE_USE_BEDROCK, '1', 'provider choice stays');
  assert.equal(env.CLAUDE_CODE_ENABLE_CFC, '0', 'no browser in child sessions');
});

test('plugin details output is parsed into always-on and on-invoke tokens', () => {
  const d = parseDetails(['Projected token cost', '  Always-on:   ~757 tok   added to every session', '', 'Per-component (rounded)',
    '  component         always-on  on-invoke', '  building-skills        ~220      ~3.5k', '  notes                   ~40       < 20', '', '  On-invoke cost is paid each time a skill or agent fires.'].join('\n'));
  assert.equal(d.alwaysOn, 757);
  assert.deepEqual(d.components.map(c => [c.name, c.alwaysOn, c.onInvoke]), [['building-skills', 220, 3500], ['notes', 40, 20]]);
});

test('validator findings can be narrowed to one skill in a shared folder', () => {
  const json = {
    manifest: { file: '/x/.claude-plugin/plugin.json', errors: [{ path: 'name', message: 'bad name' }], warnings: [] },
    contents: [
      { file: '/x/skills/mine/SKILL.md', errors: [{ path: 'frontmatter', message: 'broken' }], warnings: [] },
      { file: '/x/skills/other/SKILL.md', errors: [{ path: 'frontmatter', message: 'also broken' }], warnings: [] },
    ],
    directory: { findings: [{ severity: 'error', title: 'README missing', file: 'README.md', fix: 'add one' }] },
  };
  const mine = validateFindings({ exit: 1, json }, 'skill', { only: '/x/skills/mine' });
  assert.deepEqual(mine.map(f => f.message), ['name: bad name', 'frontmatter: broken', '[plugin directory] README missing: add one']);
  assert.equal(mine.at(-1).severity, 'warn', 'directory listing checks only warn without --profile');
  const comp = validateFindings({ exit: 1, json }, 'skill', { componentsOnly: true, only: '/x/skills/mine' });
  assert.deepEqual(comp.map(f => f.message), ['frontmatter: broken']);
  const prof = validateFindings({ exit: 1, json }, 'plugin', { profile: 'directory' });
  assert.equal(prof.at(-1).severity, 'error');
  assert.deepEqual(validateFindings({ exit: 2, validatorError: 'boom' }, 'x'), [], 'a broken validator is not a finding');
});

test('without Claude Code, tools and check fall back quietly to the static checks', () => {
  const t = spawnSync('node', [CLI, 'tools', '--json'], { encoding: 'utf8', env: NO_CLAUDE });
  assert.equal(t.status, 0);
  const info = JSON.parse(t.stdout);
  assert.equal(info.claude.found, false);
  assert.equal(info.skillCreator.source, 'vendored');
  const good = join(tmp(), 'good-skill');
  cpSync(join(FIX, 'good-skill'), good, { recursive: true });
  const r = spawnSync('node', [CLI, 'check', good, '--json', '--root', tmp()], { encoding: 'utf8', env: NO_CLAUDE });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.ok(out.ran.some(([k, v]) => k === 'Claude Code checks' && /not run/.test(v)));
  assert.ok(!out.findings.some(f => f.id === 'V000'));
  assert.ok(!out.findings.some(f => f.severity === 'error'), 'a missing tool is never an error');
  const ev = spawnSync('node', [CLI, 'run-evals', good, '--trust'], { encoding: 'utf8', env: NO_CLAUDE });
  assert.notEqual(ev.status, 0);
  assert.match(ev.stderr, /need Claude Code/);
  const au = spawnSync('node', [CLI, 'audit', good], { encoding: 'utf8', env: NO_CLAUDE });
  assert.equal(au.status, 0);
  assert.match(au.stdout, /not run/);
});

test('results warn when the plugin never loaded', () => {
  const dir = tmp();
  const agg = join(dir, 'aggregate-result.json');
  writeFileSync(agg, JSON.stringify({ partial: false, suite: { plugins: [{ name: 'p', problem: { code: 'will_not_load' } }] }, cases: [], aggregates: {} }));
  writeFileSync(join(dir, 'run.log'), '⚠ case out-1 cannot pass with the granted tools: file_exists needs Write\n');
  const r = spawnSync('node', [CLI, 'results', agg, '--path', join(FIX, 'good-skill')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Read this first/);
  assert.match(r.stdout, /will_not_load/);
  assert.match(r.stdout, /cannot pass with the granted tools/);
});

test('with Claude Code, a skill is validated in place and a broken sibling is not its problem', { skip: !HAS_CLAUDE && 'claude not installed' }, () => {
  const parent = tmp();
  cpSync(join(FIX, 'good-skill'), join(parent, 'good-skill'), { recursive: true });
  mkdirSync(join(parent, 'broken'));
  writeFileSync(join(parent, 'broken', 'SKILL.md'), '---\nname: broken\ndescription: "unterminated\n---\n');
  const r = spawnSync('node', [CLI, 'check', join(parent, 'good-skill'), '--json', '--root', tmp()], { encoding: 'utf8' });
  const out = JSON.parse(r.stdout);
  assert.ok(out.ran.some(([k, v]) => k === 'claude plugin validate' && /^passed/.test(v)), JSON.stringify(out.ran));
  const b = spawnSync('node', [CLI, 'check', join(parent, 'broken'), '--json', '--root', tmp()], { encoding: 'utf8' });
  assert.equal(b.status, 1);
});

test('with Claude Code, the hook validates a plugin manifest after it is edited', { skip: !HAS_CLAUDE && 'claude not installed' }, () => {
  const root = join(tmp(), 'plug');
  mkdirSync(join(root, '.claude-plugin'), { recursive: true });
  writeFileSync(join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'plug', hooks: 5 }));
  const r = spawnSync('node', [join(ROOT, 'scripts', 'hook-lint.mjs')], {
    input: JSON.stringify({ tool_input: { file_path: join(root, '.claude-plugin', 'plugin.json') }, cwd: root }),
    encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_DATA: tmp() },
  });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /ERROR V000/);
});
