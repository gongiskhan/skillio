#!/usr/bin/env node
// results.json scaffolding, validation and the HTML evidence report.
//
//   node report.mjs init  <run-dir> --url <url> [--repo <path>] [--changeset "<kind>:<ref>"]
//        creates or refreshes results.json from evidence/*/manifest.json (keeps verdicts already written)
//   node report.mjs build <run-dir> [--inline]
//        validates results.json and writes report.html (--inline embeds screenshots)
import fs from 'node:fs';
import path from 'node:path';
import { redact, knownSecrets } from './lib/secrets.mjs';

const argv = process.argv.slice(2);
const cmd = argv[0];
const runDir = path.resolve(argv[1] || '.');
const opt = (name, def = null) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : def; };
const resultsPath = path.join(runDir, 'results.json');
const load = () => (fs.existsSync(resultsPath) ? JSON.parse(fs.readFileSync(resultsPath, 'utf8')) : null);

function manifests() {
  const ev = path.join(runDir, 'evidence');
  if (!fs.existsSync(ev)) return [];
  return fs.readdirSync(ev)
    .map((d) => path.join(ev, d, 'manifest.json'))
    .filter((p) => fs.existsSync(p))
    .map((p) => JSON.parse(fs.readFileSync(p, 'utf8')))
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

function snapshots() {
  const out = [];
  const walk = (d) => {
    for (const f of fs.existsSync(d) ? fs.readdirSync(d) : []) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) { if (f !== 'evidence') walk(p); continue; }
      if (!f.endsWith('.json') || f === 'results.json') continue;
      try {
        const j = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (j.kind !== 'snapshot') continue;
        const shot = path.isAbsolute(j.screenshot) ? path.relative(runDir, j.screenshot) : path.relative(runDir, path.resolve(j.screenshot));
        out.push({ url: j.finalUrl || j.requested, status: j.status, viewport: j.viewport || 'desktop', title: j.title, ms: j.ms,
          screenshot: fs.existsSync(path.join(runDir, shot)) ? shot : path.relative(runDir, p).replace(/\.json$/, '.jpg'),
          consoleErrors: j.consoleErrors.length + j.pageErrors.length, failedRequests: j.failedRequests.length, file: path.relative(runDir, p) });
      } catch { /* not a snapshot */ }
    }
  };
  walk(runDir);
  return out;
}

function init() {
  const prev = load() || {};
  const prevJourneys = Object.fromEntries((prev.journeys || []).map((j) => [j.id, j]));
  const url = opt('url') || prev.target?.url;
  if (!url) throw new Error('init needs --url <url> the first time');
  const cs = opt('changeset');
  const journeys = manifests().map((m) => {
    const old = prevJourneys[m.id] || {};
    // Verdicts belong to one run of a journey. When the journey was run again,
    // its screenshots are new and nobody has looked at them yet, so the old
    // seen/verdict/observed values (and the journey status) must not carry over.
    const sameRun = !old.startedAt || old.startedAt === m.startedAt;
    const oldSteps = sameRun ? Object.fromEntries((old.steps || []).map((s) => [s.n, s])) : {};
    if (old.id && !sameRun) console.error(`${m.id}: run again since the last init; its step verdicts were reset`);
    return {
      id: m.id,
      title: m.title,
      startedAt: m.startedAt,
      why: old.why || '',
      status: sameRun ? old.status || null : null,
      video: m.video,
      manifest: path.join('evidence', m.id, 'manifest.json'),
      runStatus: m.status,
      consoleErrors: m.consoleErrors.length + m.pageErrors.length,
      failedRequests: m.failedRequests.length,
      writes: m.writes.length,
      steps: m.steps.map((s) => ({
        n: s.n, title: s.title, expect: s.expect, url: s.url, screenshot: s.screenshot, error: s.error, checks: s.checks,
        seen: oldSteps[s.n]?.seen ?? false,
        observed: oldSteps[s.n]?.observed ?? '',
        verdict: oldSteps[s.n]?.verdict ?? null,
      })),
    };
  });
  const results = {
    schema: 'webtest/1',
    target: {
      url,
      environment: /localhost|127\.0\.0\.1|\.local\b/.test(url) ? 'local' : 'remote',
      repo: opt('repo') ? path.resolve(opt('repo')) : (prev.target?.repo || null),
      changeset: cs ? { kind: cs.split(':')[0], ref: cs.split(':').slice(1).join(':') } : (prev.target?.changeset || null),
    },
    scope: prev.scope || '',
    snapshots: snapshots(),
    journeys,
    findings: prev.findings || [],
    tests: prev.tests ?? null,
    summary: prev.summary || '',
  };
  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
  const pending = journeys.reduce((a, j) => a + j.steps.filter((s) => !s.verdict).length, 0);
  console.log(`results.json: ${journeys.length} journeys, ${pending} steps waiting for a verdict -> ${resultsPath}`);
}

const SEVERITIES = ['critical', 'major', 'minor', 'cosmetic'];

function validate(r) {
  const errors = [];
  const warn = [];
  const exists = (rel) => rel && fs.existsSync(path.join(runDir, rel));
  if (!r) return { errors: ['results.json missing: run "report.mjs init" first'], warn };
  if (!r.summary) errors.push('summary is empty: write two or three plain sentences on what works and what is broken');
  if (!(r.journeys || []).length && !(r.snapshots || []).length) errors.push('nothing was tested: no journeys and no page snapshots in the run folder');
  for (const j of r.journeys || []) {
    if (!['pass', 'fail', 'blocked'].includes(j.status)) errors.push(`journey ${j.id}: status must be pass, fail or blocked`);
    const failed = (j.steps || []).some((s) => s.verdict === 'fail');
    if (failed && j.status === 'pass') errors.push(`journey ${j.id}: a step failed but the journey is marked pass`);
    if (!j.video || !exists(j.video)) warn.push(`journey ${j.id}: no video file`);
    for (const s of j.steps || []) {
      const where = `journey ${j.id} step ${s.n}`;
      if (!['pass', 'fail', 'unclear'].includes(s.verdict)) errors.push(`${where}: verdict must be pass, fail or unclear`);
      if (!s.screenshot || !exists(s.screenshot)) errors.push(`${where}: screenshot file missing`);
      const checked = (s.checks || []).length > 0 && s.checks.every((c) => c.ok);
      if (s.verdict === 'pass' && !s.seen && !checked) errors.push(`${where}: marked pass without viewing the screenshot (seen=false) and without a passing check`);
      if (s.verdict && s.verdict !== 'pass' && !s.observed) errors.push(`${where}: describe what you observed`);
      if (s.error && s.verdict === 'pass') errors.push(`${where}: the step errored but is marked pass`);
    }
  }
  const ids = new Set();
  for (const f of r.findings || []) {
    if (!f.id || ids.has(f.id)) errors.push(`finding ${f.id || '(no id)'}: needs a unique id`);
    ids.add(f.id);
    if (!SEVERITIES.includes(f.severity)) errors.push(`finding ${f.id}: severity must be one of ${SEVERITIES.join(', ')}`);
    if (!f.title) errors.push(`finding ${f.id}: title missing`);
    if (!(f.evidence || []).length) errors.push(`finding ${f.id}: point to at least one screenshot or manifest as evidence`);
    for (const e of f.evidence || []) if (!exists(e)) errors.push(`finding ${f.id}: evidence file not found: ${e}`);
  }
  if (r.tests) {
    for (const t of r.tests.added || []) {
      const repo = r.target?.repo || '.';
      // The run dir usually sits inside the repo (webtest-runs/...): its git root is the repo.
      let root = runDir; while (root !== path.dirname(root) && !fs.existsSync(path.join(root, '.git'))) root = path.dirname(root);
      const candidates = [path.resolve(repo, t.file), path.resolve(runDir, repo, t.file), path.resolve(root, t.file), path.resolve(root, repo, t.file), path.resolve(t.file)];
      if (!candidates.some((c) => fs.existsSync(c))) errors.push(`test file listed but not found: ${t.file} (paths are relative to target.repo)`);
    }
    if ((r.tests.added || []).length && !r.tests.run) errors.push('tests were added but tests.run is empty: run them and record the result');
  }
  return { errors, warn };
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function img(rel, inline) {
  if (!rel) return '';
  const p = path.join(runDir, rel);
  if (!fs.existsSync(p)) return '<div class="noimg">screenshot missing</div>';
  const src = inline ? `data:image/jpeg;base64,${fs.readFileSync(p).toString('base64')}` : esc(rel);
  return `<a href="${inline ? '#' : esc(rel)}" class="shot"><img loading="lazy" src="${src}" alt="screenshot"></a>`;
}

function build() {
  const r = load();
  const { errors, warn } = validate(r);
  if (errors.length) {
    console.error(`results.json needs fixing before the report can be built (${errors.length}):`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  const inline = argv.includes('--inline');
  const sev = Object.fromEntries(SEVERITIES.map((s) => [s, (r.findings || []).filter((f) => f.severity === s).length]));
  const jPass = r.journeys.filter((j) => j.status === 'pass').length;
  const overall = sev.critical || sev.major ? 'bad' : (sev.minor || r.journeys.some((j) => j.status !== 'pass') ? 'warn' : 'good');
  const findings = (r.findings || []).map((f) => `
    <article class="finding sev-${esc(f.severity)}">
      <div class="fhead"><span class="pill ${esc(f.severity)}">${esc(f.severity)}</span><strong>${esc(f.id)} · ${esc(f.title)}</strong></div>
      ${f.page ? `<div class="muted">${esc(f.page)}${f.journey ? ` · journey ${esc(f.journey)}${f.step ? ` step ${esc(f.step)}` : ''}` : ''}</div>` : ''}
      ${f.details ? `<p>${esc(f.details)}</p>` : ''}
      ${f.test ? `<p class="muted">Covered by test: <code>${esc(f.test)}</code></p>` : ''}
      <div class="thumbs">${(f.evidence || []).filter((e) => /\.(jpe?g|png)$/i.test(e)).map((e) => img(e, inline)).join('')}</div>
    </article>`).join('') || '<p class="muted">No problems found.</p>';
  const journeys = r.journeys.map((j) => `
    <details class="journey" ${j.status !== 'pass' ? 'open' : ''}>
      <summary><span class="pill ${j.status === 'pass' ? 'ok' : j.status === 'fail' ? 'major' : 'minor'}">${esc(j.status)}</span> ${esc(j.title)}
        <span class="muted"> · ${j.steps.length} steps${j.consoleErrors ? ` · ${j.consoleErrors} console errors` : ''}${j.failedRequests ? ` · ${j.failedRequests} failed requests` : ''}${j.writes ? ` · ${j.writes} writes` : ''}</span></summary>
      ${j.why ? `<p class="muted">${esc(j.why)}</p>` : ''}
      ${j.video ? `<video controls preload="none" src="${esc(j.video)}"></video>` : ''}
      <ol class="steps">${j.steps.map((s) => `
        <li class="step v-${esc(s.verdict)}">
          ${img(s.screenshot, inline)}
          <div class="stext">
            <div><span class="pill ${s.verdict === 'pass' ? 'ok' : s.verdict === 'fail' ? 'major' : 'minor'}">${esc(s.verdict)}</span> <strong>${esc(s.title)}</strong></div>
            ${s.expect ? `<div><span class="lbl">Expected</span> ${esc(s.expect)}</div>` : ''}
            ${s.observed ? `<div><span class="lbl">Observed</span> ${esc(s.observed)}</div>` : ''}
            ${(s.checks || []).map((c) => `<div class="check ${c.ok ? 'cok' : 'cbad'}">${c.ok ? '✓' : '✗'} ${esc(c.desc)}${c.detail ? ` <span class="muted">(${esc(c.detail)})</span>` : ''}</div>`).join('')}
            ${s.error ? `<div class="err">${esc(s.error)}</div>` : ''}
            <div class="muted small">${esc(s.url || '')}${s.seen ? ' · screenshot reviewed' : ''}</div>
          </div>
        </li>`).join('')}</ol>
    </details>`).join('');
  const t = r.tests;
  const tests = t ? `
    <p>${(t.added || []).length} file(s) added or extended in <code>${esc(t.dir || '')}</code>${t.run ? ` · run ${esc(t.run.repeatEach || 1)}×: <strong>${esc(t.run.passed)}</strong> passed, ${esc(t.run.failed)} failed, ${esc(t.run.flaky || 0)} flaky, ${esc(t.run.expectedFailures || 0)} known bugs · ${Math.round((t.run.durationMs || 0) / 100) / 10}s` : ''}</p>
    <ul>${(t.added || []).map((a) => `<li><code>${esc(a.file)}</code>${a.knownFailure ? ' <span class="pill minor">known bug</span>' : ''}<ul>${(a.titles || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></li>`).join('')}</ul>
    ${(t.skippedAsCovered || []).length ? `<p class="muted">Not duplicated (already covered): ${(t.skippedAsCovered).map((s) => `${esc(s.journey)} → ${esc(s.by)}`).join('; ')}</p>` : ''}`
    : `<p class="muted">${r.target.repo ? 'No tests were added.' : 'No repository was given, so this run produced evidence only. Point it at a repo to add tests.'}</p>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Web test report</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--ink:#1b2130;--muted:#5d6678;--line:#e2e5eb;--ok:#0f7a4f;--okbg:#e3f5ec;--major:#b42318;--majorbg:#fde8e7;--minor:#9a6700;--minorbg:#fff4d6;--crit:#7a0916;--critbg:#f9d4d7;--cos:#475467;--cosbg:#eef0f3}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#11141a;--card:#1a1f28;--ink:#e6e9ef;--muted:#9aa3b2;--line:#2a3140;--okbg:#123326;--majorbg:#3a1614;--minorbg:#352a0d;--critbg:#3d0d14;--cosbg:#252b36;--ok:#4ade80;--major:#f87171;--minor:#fbbf24;--crit:#fca5a5;--cos:#cbd5e1}}
:root[data-theme="dark"]{--bg:#11141a;--card:#1a1f28;--ink:#e6e9ef;--muted:#9aa3b2;--line:#2a3140;--okbg:#123326;--majorbg:#3a1614;--minorbg:#352a0d;--critbg:#3d0d14;--cosbg:#252b36;--ok:#4ade80;--major:#f87171;--minor:#fbbf24;--crit:#fca5a5;--cos:#cbd5e1}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:980px;margin:0 auto;padding:20px 16px 60px}h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:28px 0 10px}
.muted{color:var(--muted)}.small{font-size:12px}code{font-size:13px;background:var(--cosbg);padding:1px 5px;border-radius:5px}
.hero{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;border-left:6px solid var(--ok)}.hero.warn{border-left-color:var(--minor)}.hero.bad{border-left-color:var(--major)}
.stats{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.pill{display:inline-block;padding:1px 9px;border-radius:999px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.02em}
.ok{background:var(--okbg);color:var(--ok)}.major{background:var(--majorbg);color:var(--major)}.minor{background:var(--minorbg);color:var(--minor)}.critical{background:var(--critbg);color:var(--crit)}.cosmetic{background:var(--cosbg);color:var(--cos)}
.finding,.journey{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin:10px 0}
.fhead{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.thumbs{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}.thumbs .shot img{width:220px}
summary{cursor:pointer;font-weight:600}video{width:100%;max-width:640px;border-radius:10px;margin:10px 0;background:#000}
.steps{list-style:none;padding:0;margin:8px 0 0}.step{display:grid;grid-template-columns:minmax(0,260px) minmax(0,1fr);gap:12px;padding:10px 0;border-top:1px solid var(--line)}
.shot img{width:100%;border-radius:8px;border:1px solid var(--line);display:block}.lbl{font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-right:4px}
.snaps{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}.snap{margin:0;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:8px}.snap figcaption{margin-top:6px;font-size:13px}
.check{font-size:13px}.cok{color:var(--ok)}.cbad{color:var(--major)}.err{color:var(--major);font-size:13px;word-break:break-word}.noimg{color:var(--muted);font-size:12px}
@media (max-width:640px){.step{grid-template-columns:1fr}.thumbs .shot img{width:100%}}
</style></head><body><main>
<h1>Web test report</h1>
<div class="muted">${esc(r.target.url)} · ${esc(r.target.environment)}${r.target.changeset ? ` · ${esc(r.target.changeset.kind)} ${esc(r.target.changeset.ref)}` : ''} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC</div>
<section class="hero ${overall}" style="margin-top:14px"><div>${esc(r.summary)}</div>
<div class="stats"><span class="pill ok">${jPass}/${r.journeys.length} journeys pass</span>${SEVERITIES.filter((s) => sev[s]).map((s) => `<span class="pill ${s}">${sev[s]} ${s}</span>`).join('')}</div></section>
${r.scope ? `<h2>Scope</h2><p>${esc(r.scope)}</p>` : ''}
<h2>Findings</h2>${findings}
${(r.snapshots || []).length ? `<h2>Page snapshots</h2><div class="snaps">${r.snapshots.map((p) => `<figure class="snap">${img(p.screenshot, inline)}<figcaption><strong>${esc(p.title || p.url)}</strong><br><span class="muted small">${esc(p.url)} · ${esc(p.viewport)} · HTTP ${esc(p.status)} · ${p.consoleErrors ? `<span class="cbad">${p.consoleErrors} console errors</span>` : 'no console errors'} · ${p.failedRequests ? `<span class="cbad">${p.failedRequests} failed requests</span>` : 'no failed requests'}</span></figcaption></figure>`).join('')}</div>` : ''}
<h2>Journeys</h2>${journeys || '<p class="muted">No journeys were run.</p>'}
<h2>Automated tests</h2>${tests}
</main></body></html>`;
  const outPath = path.join(runDir, 'report.html');
  fs.writeFileSync(outPath, redact(html, knownSecrets()));
  console.log(`report: ${outPath}${inline ? ' (screenshots embedded; videos stay in evidence/)' : ''}`);
  for (const w of warn) console.log(`  note: ${w}`);
}

try {
  if (cmd === 'init') init();
  else if (cmd === 'validate') { const { errors, warn } = validate(load()); console.log(JSON.stringify({ ok: !errors.length, errors, warn }, null, 2)); process.exit(errors.length ? 1 : 0); }
  else if (cmd === 'build') build();
  else { console.error('commands: init <run-dir> --url <url> | validate <run-dir> | build <run-dir> [--inline]'); process.exit(1); }
} catch (e) { console.error(e.message); process.exit(1); }
