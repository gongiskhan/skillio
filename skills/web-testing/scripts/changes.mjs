#!/usr/bin/env node
// Summarises what a commit, range or pull request changed, to scope tests.
//   node changes.mjs <repo-dir> <ref> [--diff-lines 400]
// <ref>: a commit sha (tests that commit), "a..b" (a range), "HEAD~3" (that commit),
//        "since:<ref>" (everything after ref up to HEAD), "pr:<number>" or a GitHub PR URL.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const argv = process.argv.slice(2);
const repo = path.resolve(argv[0] || '.');
let ref = argv[1];
const maxLines = Number(argv.includes('--diff-lines') ? argv[argv.indexOf('--diff-lines') + 1] : 400);
const git = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
if (!ref) { console.error('usage: changes.mjs <repo> <commit | a..b | since:ref | pr:N | PR URL>'); process.exit(1); }

let range;
const prMatch = /^pr:(\d+)$/.exec(ref) || /github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/.exec(ref);
if (prMatch) {
  const n = prMatch[1];
  let base = null;
  try {
    const info = JSON.parse(execFileSync('gh', ['pr', 'view', n, '--json', 'baseRefName,headRefName,title'], { cwd: repo, encoding: 'utf8' }));
    console.log(`PR #${n}: ${info.title} (${info.headRefName} -> ${info.baseRefName})`);
    base = info.baseRefName;
  } catch { /* gh not available */ }
  try { git('fetch', '-q', 'origin', `pull/${n}/head:webtest-pr-${n}`); } catch (e) {
    console.error(`Could not fetch PR ${n} (${e.message.split('\n')[0]}). Check out the PR branch and pass a range instead.`);
    process.exit(1);
  }
  if (base) { try { git('fetch', '-q', 'origin', base); } catch { /* use local */ } }
  const mergeBase = git('merge-base', base ? `origin/${base}` : 'HEAD', `webtest-pr-${n}`);
  range = `${mergeBase}..webtest-pr-${n}`;
} else if (ref.startsWith('since:')) {
  range = `${ref.slice(6)}..HEAD`;
} else if (ref.includes('..')) {
  range = ref;
} else {
  const sha = git('rev-parse', ref);
  const parents = git('rev-list', '--parents', '-n', '1', sha).split(' ').slice(1);
  range = parents.length ? `${parents[0]}..${sha}` : sha;
}

const log = git('log', '--format=%h %ad %s', '--date=short', range.includes('..') ? range : `-1`, ...(range.includes('..') ? [] : [range]));
const numstat = range.includes('..') ? git('diff', '--numstat', range) : git('show', '--numstat', '--format=', range);
const diff = range.includes('..') ? git('diff', '--unified=2', range) : git('show', '--unified=2', '--format=', range);

const files = numstat.split('\n').filter(Boolean).map((l) => { const [a, d, f] = l.split('\t'); return { file: f, added: Number(a) || 0, deleted: Number(d) || 0 }; });
const kind = (f) => (/\.(spec|test)\.|\/tests?\/|e2e/.test(f) ? 'test'
  : /\.(css|scss|less)$/.test(f) ? 'style'
  : /(^|\/)(package(-lock)?\.json|pnpm-lock|yarn\.lock)$/.test(f) ? 'deps'
  : /\.(md|txt)$/.test(f) ? 'docs' : 'code');

// Strings in added lines that look like routes, UI labels or API paths: hints for which screens to visit.
const added = diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).join('\n');
const routes = [...new Set([...added.matchAll(/['"`](\/[a-z0-9\-_/:[\]]{2,60})['"`?]/gi)].map((m) => m[1]))].slice(0, 30);
const labels = [...new Set([...added.matchAll(/>([A-Z][A-Za-z ,.'!?-]{3,48})</g)].map((m) => m[1].trim()))].slice(0, 30);

console.log(`range: ${range}`);
console.log(`commits:\n${log.split('\n').map((l) => `  ${l}`).join('\n')}`);
console.log(`files changed (${files.length}):`);
for (const f of files) console.log(`  [${kind(f.file)}] ${f.file} +${f.added} -${f.deleted}`);
if (routes.length) console.log(`paths mentioned in added lines: ${routes.join(', ')}`);
if (labels.length) console.log(`UI text in added lines: ${labels.map((l) => JSON.stringify(l)).join(', ')}`);
const lines = diff.split('\n');
console.log(`\n--- diff (${lines.length} lines${lines.length > maxLines ? `, first ${maxLines} shown; rerun with --diff-lines N for more` : ''}) ---`);
console.log(lines.slice(0, maxLines).join('\n'));
