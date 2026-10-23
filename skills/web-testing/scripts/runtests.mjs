#!/usr/bin/env node
// Runs Playwright tests with credentials injected, traces off (traces record
// typed values), repeated to expose flakiness, and records the outcome in
// results.json.
//   node runtests.mjs <repo-dir> --base-url <url> [--run-dir <dir>] [--repeat 3] [--profile name] [--all] [files...]
// Files are paths relative to the repo. --all runs the whole suite once after the repeated run.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveCredentials, knownSecrets, redact } from './lib/secrets.mjs';

const argv = process.argv.slice(2);
const repo = path.resolve(argv[0] || '.');
const opt = (name, def = null) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : def; };
const baseURL = opt('base-url') || process.env.BASE_URL;
const runDir = opt('run-dir') ? path.resolve(opt('run-dir')) : null;
const repeat = Number(opt('repeat', '3'));
const profile = opt('profile', 'default');
const valued = new Set(['--base-url', '--run-dir', '--repeat', '--profile']);
const files = argv.slice(1).filter((a, i, arr) => !a.startsWith('--') && !valued.has(arr[i - 1]));
if (!baseURL) { console.error('--base-url is required'); process.exit(1); }

const storeEntry = (() => {
  try {
    const home = process.env.WEBTEST_HOME || path.join(process.env.HOME, '.webtest');
    const data = JSON.parse(fs.readFileSync(path.join(home, 'credentials.json'), 'utf8'));
    return (data[new URL(baseURL).origin] || {})[profile] || null;
  } catch { return null; }
})();

const env = { ...process.env, BASE_URL: baseURL, PLAYWRIGHT_BASE_URL: baseURL, FORCE_COLOR: '0' };
const c = resolveCredentials(baseURL, profile);
if (c) {
  env.WEBTEST_USERNAME = c.username;
  env.WEBTEST_PASSWORD = c.password;
  if (storeEntry?.envNames?.username) env[storeEntry.envNames.username] = c.username;
  if (storeEntry?.envNames?.password) env[storeEntry.envNames.password] = c.password;
  for (const [k, v] of Object.entries(c.extra || {})) if (/^[A-Z_][A-Z0-9_]*$/.test(k)) env[k] = v;
}
// The saved webtest session is deliberately not passed on: tests must sign in
// on their own (or through the suite's setup project) so they also run in CI.
const secrets = knownSecrets();

function pwRun(extraArgs, label) {
  const jsonOut = path.join(repo, 'test-results', `webtest-${label}.json`);
  fs.mkdirSync(path.dirname(jsonOut), { recursive: true });
  const args = ['playwright', 'test', ...extraArgs, '--reporter=json', '--trace=off'];
  const t0 = Date.now();
  const r = spawnSync('npx', args, { cwd: repo, env: { ...env, PLAYWRIGHT_JSON_OUTPUT_NAME: jsonOut }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const wall = Date.now() - t0;
  let report = null;
  try { report = JSON.parse(fs.readFileSync(jsonOut, 'utf8')); } catch { /* fall through */ }
  if (!report) {
    return { ok: false, error: redact(`${r.stderr || ''}\n${r.stdout || ''}`.trim().split('\n').slice(-25).join('\n'), secrets) };
  }
  const tests = [];
  const visit = (suite, prefix) => {
    for (const s of suite.suites || []) visit(s, [...prefix, s.title].filter(Boolean));
    for (const spec of suite.specs || []) {
      for (const t of spec.tests || []) {
        const results = t.results || [];
        const statuses = results.map((x) => x.status);
        const expectFail = t.expectedStatus === 'failed';
        tests.push({
          file: spec.file, title: [...prefix.slice(1), spec.title].join(' › '),
          outcome: t.status, // expected | unexpected | flaky | skipped
          expectedFailure: expectFail && t.status === 'expected',
          attempts: statuses,
          error: results.find((x) => x.error)?.error?.message?.split('\n').slice(0, 4).join(' ') || null,
          ms: results.reduce((a, x) => a + (x.duration || 0), 0),
        });
      }
    }
  };
  for (const s of report.suites || []) visit(s, [s.title]);
  // Group repeated runs of the same test.
  const byKey = new Map();
  for (const t of tests) {
    const k = `${t.file}::${t.title}`;
    const g = byKey.get(k) || { file: t.file, title: t.title, runs: 0, passes: 0, fails: 0, expectedFailures: 0, ms: 0, error: null };
    g.runs++; g.ms += t.ms;
    if (t.expectedFailure) g.expectedFailures++;
    else if (t.outcome === 'expected') g.passes++;
    else if (t.outcome !== 'skipped') { g.fails++; g.error = g.error || t.error; }
    byKey.set(k, g);
  }
  const groups = [...byKey.values()];
  const flaky = groups.filter((g) => g.fails && g.passes);
  return {
    ok: true,
    durationMs: report.stats?.duration ?? wall,
    tests: groups.length,
    passed: groups.filter((g) => !g.fails && g.passes === g.runs).length,
    failed: groups.filter((g) => g.fails && !g.passes && !g.expectedFailures).length,
    flaky: flaky.length,
    expectedFailures: groups.filter((g) => g.expectedFailures === g.runs).length,
    details: groups.map((g) => ({ ...g, error: g.error && redact(g.error, secrets) })),
  };
}

const repeated = pwRun([...files, `--repeat-each=${repeat}`, '--retries=0', '--workers=2'], 'repeat');
let whole = null;
if (argv.includes('--all')) whole = pwRun(['--retries=0'], 'all');

const summary = (r) => (r.ok
  ? `${r.tests} tests: ${r.passed} passed, ${r.failed} failed, ${r.flaky} flaky, ${r.expectedFailures} known bugs (expected failures) in ${Math.round(r.durationMs / 100) / 10}s`
  : `could not run: ${r.error}`);
console.log(`repeated x${repeat} (${files.length ? files.join(', ') : 'all files'}): ${summary(repeated)}`);
if (repeated.ok) for (const g of repeated.details.filter((d) => d.fails)) console.log(`  ${g.passes ? 'FLAKY' : 'FAIL '} ${g.file} › ${g.title}: ${g.error || ''}`);
if (whole) {
  console.log(`whole suite once: ${summary(whole)}`);
  if (whole.ok) for (const g of whole.details.filter((d) => d.fails)) console.log(`  FAIL  ${g.file} › ${g.title}: ${g.error || ''}`);
}

if (runDir && fs.existsSync(path.join(runDir, 'results.json'))) {
  const rp = path.join(runDir, 'results.json');
  const r = JSON.parse(fs.readFileSync(rp, 'utf8'));
  r.tests = r.tests || { dir: null, added: [] };
  r.tests.run = repeated.ok
    ? { repeatEach: repeat, files, passed: repeated.passed, failed: repeated.failed, flaky: repeated.flaky, expectedFailures: repeated.expectedFailures, durationMs: repeated.durationMs, tests: repeated.tests }
    : { repeatEach: repeat, files, error: repeated.error };
  if (whole) r.tests.wholeSuite = whole.ok ? { passed: whole.passed, failed: whole.failed, tests: whole.tests, durationMs: whole.durationMs } : { error: whole.error };
  fs.writeFileSync(rp, JSON.stringify(r, null, 2));
  console.log(`recorded in ${rp}`);
}
process.exit(repeated.ok && !repeated.failed && !repeated.flaky ? 0 : 2);
