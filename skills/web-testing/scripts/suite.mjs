#!/usr/bin/env node
// Inventory of an existing end-to-end suite, so new tests follow its
// conventions and don't repeat what it already covers.
//   node suite.mjs <repo-dir> [--json]
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || '.');
const asJson = process.argv.includes('--json');
const IGNORE = /(^|\/)(node_modules|\.git|dist|build|\.next|coverage|test-results|playwright-report|webtest-runs)(\/|$)/;

function walk(dir, acc = []) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    const rel = path.relative(root, p);
    if (IGNORE.test(rel)) continue;
    const st = fs.lstatSync(p);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) walk(p, acc); else acc.push(rel);
  }
  return acc;
}

const files = walk(root);
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const pkg = files.includes('package.json') ? JSON.parse(read('package.json')) : {};
const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

const pwConfig = files.find((f) => /^playwright\.config\.(t|j|mj|cj)s$/.test(path.basename(f)) && !f.includes('/node_modules/'));
const cyConfig = files.find((f) => /^cypress\.config\./.test(path.basename(f)));
let framework = null;
if (pwConfig || deps['@playwright/test']) framework = 'playwright';
else if (cyConfig || deps.cypress) framework = 'cypress';
else if (deps.webdriverio) framework = 'webdriverio';

let testDir = null, baseURLExpr = null, storageStateUse = false, setupProject = false;
if (pwConfig) {
  const c = read(pwConfig);
  testDir = /testDir\s*:\s*['"`]([^'"`]+)['"`]/.exec(c)?.[1] || '.';
  testDir = path.join(path.dirname(pwConfig), testDir);
  baseURLExpr = /baseURL\s*:\s*([^,\n]+)/.exec(c)?.[1]?.trim() || null;
  storageStateUse = /storageState/.test(c);
  setupProject = /dependencies\s*:\s*\[|setup/.test(c);
}

const specRe = /\.(spec|test|e2e)\.(t|j|mj|cj)sx?$|\.cy\.(t|j)s$/;
// With a Playwright config, its testDir decides what is end-to-end; anything
// else matching the spec pattern (Jest or Vitest unit tests) is not coverage
// the new browser tests could duplicate.
const inTestDir = (f) => testDir && testDir !== '.' && f.startsWith(path.normalize(testDir).replace(/\/?$/, '/'));
const specs = files.filter((f) => specRe.test(f));
const e2eSpecs = framework === 'playwright' && testDir && testDir !== '.'
  ? specs.filter(inTestDir)
  : specs.filter((f) => /e2e|playwright|cypress|integration|(^|\/)tests?\//i.test(f));

const envNames = new Set();
const inventory = e2eSpecs.map((f) => {
  const src = read(f);
  for (const m of src.matchAll(/process\.env\.([A-Z0-9_]+)/g)) envNames.add(m[1]);
  for (const m of src.matchAll(/Cypress\.env\(['"]([^'"]+)/g)) envNames.add(m[1]);
  const titles = [...src.matchAll(/\b(?:test|it)(?:\.(?:only|skip|fail|fixme))?\(\s*(['"`])(.+?)\1/g)].map((m) => m[2]);
  const gotos = [...new Set([...src.matchAll(/\.(?:goto|visit)\(\s*['"`]([^'"`]+)/g)].map((m) => m[1]))];
  const locators = [...new Set([...src.matchAll(/getBy(Role|Label|Text|TestId|Placeholder)\(\s*['"`]([^'"`]+)['"`](?:\s*,\s*\{\s*name:\s*(?:['"`]([^'"`]+)['"`]|(\/[^/]+\/)))?/g)]
    .map((m) => `${m[1]}:${m[3] || m[4] || m[2]}`))].slice(0, 40);
  return { file: f, titles, gotos, locators, lines: src.split('\n').length };
});

const result = {
  root, framework, config: pwConfig || cyConfig || null, testDir, baseURLExpr, storageStateUse, setupProject,
  language: inventory.some((s) => /\.tsx?$/.test(s.file)) ? 'typescript' : (inventory.length ? 'javascript' : null),
  scripts: Object.fromEntries(Object.entries(pkg.scripts || {}).filter(([k, v]) => /test|e2e|playwright|cypress|start|dev|serve/.test(k + v))),
  envNamesUsedByTests: [...envNames],
  specs: inventory,
};

if (asJson) { console.log(JSON.stringify(result, null, 2)); process.exit(0); }
const out = [];
out.push(`suite: ${framework || 'none found'}${result.config ? ` (config ${result.config})` : ''}`);
if (framework) out.push(`testDir: ${testDir || '?'} | language: ${result.language} | baseURL: ${baseURLExpr || 'not set'} | storageState: ${storageStateUse} | setup project: ${setupProject}`);
out.push(`scripts: ${JSON.stringify(result.scripts)}`);
out.push(`env vars read by tests: ${result.envNamesUsedByTests.join(', ') || 'none'}`);
for (const s of inventory) {
  out.push(`\n${s.file} (${s.lines} lines)`);
  for (const t of s.titles) out.push(`  - ${t}`);
  if (s.gotos.length) out.push(`  visits: ${s.gotos.join(', ')}`);
  if (s.locators.length) out.push(`  uses: ${s.locators.join(' | ')}`);
}
if (!inventory.length) out.push('no end-to-end specs found');
console.log(out.join('\n'));
