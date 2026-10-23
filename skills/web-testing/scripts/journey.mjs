#!/usr/bin/env node
// Browser harness for evidence-first web testing.
//
//   node journey.mjs doctor
//   node journey.mjs snapshot <url> --out <dir> [--viewport desktop|mobile|WxH] [--profile p] [--full]
//   node journey.mjs run <journey-file.mjs> --base-url <url> --run-dir <dir> [--id <id>]
//                    [--viewport desktop|mobile|WxH] [--profile p] [--headed] [--fresh]
//
// A journey file is an ES module:
//   export const title = 'Apply a coupon in the cart';
//   export default async function ({ page, step, check, creds, session, tag }) {
//     await step('Open the cart', async () => { await page.goto('/cart'); }, { expect: 'Cart lists one Wool Blanket at €54.00' });
//   }
// Each step saves a screenshot and an accessibility snapshot. A failing step
// is recorded with its screenshot and ends the journey. Output is redacted.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadPlaywright, viewportOptions, originOf, isLocal } from './lib/pw.mjs';
import { resolveCredentials, sessionInfo, saveSessionFile, redact, knownSecrets } from './lib/secrets.mjs';

const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (name, def = null) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : def; };
const flag = (name) => argv.includes(`--${name}`);
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'step';
const pad = (n) => String(n).padStart(2, '0');

function attachWatchers(page, origin, sink) {
  page.on('console', (m) => { if (m.type() === 'error') sink.consoleErrors.push({ text: m.text().slice(0, 500), url: page.url() }); });
  page.on('pageerror', (e) => sink.pageErrors.push({ text: String(e.message || e).slice(0, 500), url: page.url() }));
  page.on('response', (r) => {
    const req = r.request();
    if (r.status() >= 400) sink.failedRequests.push({ method: req.method(), url: r.url().slice(0, 300), status: r.status() });
    if (req.method() !== 'GET' && req.method() !== 'HEAD' && r.url().startsWith(origin)) {
      sink.writes.push({ method: req.method(), url: r.url().slice(0, 300), status: r.status() });
    }
  });
  page.on('requestfailed', (req) => {
    const err = req.failure()?.errorText || '';
    if (/ERR_ABORTED|NS_BINDING_ABORTED/.test(err)) return; // navigation cancelled it, not a server failure
    sink.failedRequests.push({ method: req.method(), url: req.url().slice(0, 300), status: 0, error: err });
  });
}

async function ariaText(page) {
  try { return await page.locator('body').ariaSnapshot({ timeout: 5000 }); } catch (e) { return `(aria snapshot unavailable: ${e.message.split('\n')[0]})`; }
}

async function newContext(browser, { baseURL, viewport, profile, fresh, videoDir }) {
  const opts = { ...viewportOptions(viewport), baseURL, ignoreHTTPSErrors: true };
  if (process.env.WEBTEST_LOCALE) opts.locale = process.env.WEBTEST_LOCALE;
  const sess = sessionInfo(baseURL, profile);
  if (sess.exists && !fresh) opts.storageState = sess.path;
  if (videoDir) opts.recordVideo = { dir: videoDir, size: opts.viewport };
  return { ctx: await browser.newContext(opts), usedSession: sess.exists && !fresh };
}

async function doctor() {
  const report = { node: process.version, playwright: null, chromium: null };
  try {
    const pw = await loadPlaywright();
    report.playwright = 'found';
    const b = await pw.chromium.launch();
    report.chromium = 'launches';
    await b.close();
  } catch (e) {
    report.error = e.message;
  }
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.chromium ? 0 : 1);
}

async function snapshot() {
  const url = argv[1];
  const outDir = opt('out', 'webtest-snapshots');
  if (!url) throw new Error('usage: snapshot <url> --out <dir>');
  fs.mkdirSync(outDir, { recursive: true });
  const pw = await loadPlaywright();
  const browser = await pw.chromium.launch();
  const { ctx, usedSession } = await newContext(browser, { baseURL: originOf(url), viewport: opt('viewport', 'desktop'), profile: opt('profile', 'default'), fresh: flag('fresh') });
  const page = await ctx.newPage();
  const sink = { consoleErrors: [], pageErrors: [], failedRequests: [], writes: [] };
  attachWatchers(page, originOf(url), sink);
  const t0 = Date.now();
  let status = null;
  try {
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    status = res ? res.status() : null;
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  } catch (e) {
    sink.pageErrors.push({ text: `navigation failed: ${e.message.split('\n')[0]}`, url });
  }
  const vp = opt('viewport', 'desktop');
  const pathname = new URL(page.url() || url).pathname;
  const name = `${pathname === '/' ? 'home' : slug(pathname)}${vp === 'desktop' ? '' : `-${slug(vp)}`}`;
  const shot = path.join(outDir, `${name}.jpg`);
  await page.screenshot({ path: shot, type: 'jpeg', quality: 70, fullPage: flag('full') }).catch(() => {});
  const aria = await ariaText(page);
  fs.writeFileSync(path.join(outDir, `${name}.aria.yml`), aria);
  const secrets = knownSecrets();
  const lines = aria.split('\n');
  const challenge = /just a moment|checking your browser|verify you are human|captcha/i.test(await page.title().catch(() => '') + aria.slice(0, 2000));
  const summary = {
    kind: 'snapshot', requested: url, finalUrl: page.url(), status, title: await page.title().catch(() => ''), ms: Date.now() - t0,
    viewport: opt('viewport', 'desktop'), takenAt: new Date().toISOString(),
    usedSavedSession: usedSession, environment: isLocal(url) ? 'local' : 'remote', botChallenge: challenge || undefined,
    screenshot: shot, consoleErrors: sink.consoleErrors, pageErrors: sink.pageErrors, failedRequests: sink.failedRequests,
  };
  // Saved next to the screenshot so the report (and anyone checking) can cite it.
  fs.writeFileSync(path.join(outDir, `${name}.json`), redact(JSON.stringify(summary, null, 2), secrets));
  console.log(redact(JSON.stringify(summary, null, 2), secrets));
  console.log(`\n--- accessibility snapshot (${lines.length} lines${lines.length > 160 ? ', first 160 shown; full file next to the screenshot' : ''}) ---`);
  console.log(redact(lines.slice(0, 160).join('\n'), secrets));
  await ctx.close();
  await browser.close();
}

async function run() {
  const file = argv[1];
  const baseURL = opt('base-url');
  const runDir = opt('run-dir');
  if (!file || !baseURL || !runDir) throw new Error('usage: run <journey.mjs> --base-url <url> --run-dir <dir> [--id id]');
  const mod = await import(pathToFileURL(path.resolve(file)).href);
  const id = opt('id', slug(path.basename(file, path.extname(file))));
  const evDir = path.join(runDir, 'evidence', id);
  fs.rmSync(evDir, { recursive: true, force: true });
  fs.mkdirSync(evDir, { recursive: true });
  const profile = opt('profile', 'default');
  const origin = originOf(baseURL);
  const secrets = knownSecrets();

  const pw = await loadPlaywright();
  const browser = await pw.chromium.launch({ headless: !flag('headed') });
  const { ctx, usedSession } = await newContext(browser, { baseURL, viewport: opt('viewport', 'desktop'), profile, fresh: flag('fresh'), videoDir: evDir });
  const page = await ctx.newPage();
  page.setDefaultTimeout(Number(process.env.WEBTEST_STEP_TIMEOUT || 10000));
  const sink = { consoleErrors: [], pageErrors: [], failedRequests: [], writes: [] };
  attachWatchers(page, origin, sink);

  const steps = [];
  const creds = resolveCredentials(baseURL, profile);
  const tag = `webtest-${Date.now().toString(36)}`;
  const session = {
    async save() { const p = saveSessionFile(baseURL, profile, await ctx.storageState()); return p; },
    used: usedSession,
  };
  let current = null;
  // check(desc, fn): fn passes by returning true or undefined (e.g. a Playwright
  // expect that resolved). false, a string (failure detail) or a throw is a
  // failure. False/string results are retried until WEBTEST_CHECK_TIMEOUT so
  // async UI updates settle; throws are not retried (expect already polls).
  const check = async (desc, fn, { timeout = Number(process.env.WEBTEST_CHECK_TIMEOUT || 3000) } = {}) => {
    let ok = false, detail = null;
    const until = Date.now() + timeout;
    for (;;) {
      try {
        const r = await fn();
        ok = r === undefined || r === true;
        detail = ok ? null : (typeof r === 'string' ? r : `returned ${JSON.stringify(r)}`);
      } catch (e) { ok = false; detail = e.message.split('\n').filter(Boolean).slice(0, 2).join(' '); break; }
      if (ok || Date.now() > until) break;
      await page.waitForTimeout(250);
    }
    const rec = { desc, ok, detail: detail && redact(detail, secrets) };
    if (current) current.checks.push(rec);
    return ok;
  };
  class StepFailed extends Error {}
  const step = async (title, fn, { expect = null, fullPage = false } = {}) => {
    const n = steps.length + 1;
    const rec = { n, title, expect, url: null, screenshot: null, aria: null, ms: 0, ok: true, error: null, checks: [] };
    current = rec;
    const t0 = Date.now();
    try {
      await fn();
      await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
    } catch (e) {
      rec.ok = false;
      rec.error = redact(e.message.split('\n').slice(0, 3).join(' '), secrets);
    }
    rec.ms = Date.now() - t0;
    rec.url = page.url();
    if (rec.ok && rec.checks.some((c) => !c.ok)) { rec.ok = false; rec.checksFailed = true; }
    const base = `${pad(n)}-${slug(title)}`;
    rec.screenshot = path.join('evidence', id, `${base}.jpg`);
    await page.screenshot({ path: path.join(runDir, rec.screenshot), type: 'jpeg', quality: 70, fullPage }).catch(() => { rec.screenshot = null; });
    rec.aria = path.join('evidence', id, `${base}.aria.yml`);
    fs.writeFileSync(path.join(runDir, rec.aria), redact(await ariaText(page), secrets));
    steps.push(rec);
    current = null;
    // An action that threw ends the journey; failed checks are soft so later steps still run.
    if (rec.error) throw new StepFailed(rec.error);
  };

  const t0 = Date.now();
  let status = 'completed';
  let fatal = null;
  try {
    await mod.default({ page, step, check, creds: creds ? { username: creds.username, password: creds.password, extra: creds.extra } : null, session, tag, baseURL, context: ctx });
  } catch (e) {
    status = 'errored';
    if (!(e instanceof StepFailed)) fatal = redact(e.message.split('\n').slice(0, 3).join(' '), secrets);
  }
  const video = page.video();
  await ctx.close();
  await browser.close();
  let videoPath = null;
  if (video) {
    try {
      const raw = await video.path();
      videoPath = path.join('evidence', id, 'video.webm');
      fs.renameSync(raw, path.join(runDir, videoPath));
    } catch { videoPath = null; }
  }
  const manifest = {
    id, title: mod.title || id, file: path.relative(runDir, path.resolve(file)), baseURL, environment: isLocal(baseURL) ? 'local' : 'remote',
    usedSavedSession: usedSession, startedAt: new Date(t0).toISOString(), ms: Date.now() - t0, status, fatal, steps,
    consoleErrors: sink.consoleErrors, pageErrors: sink.pageErrors, failedRequests: sink.failedRequests, writes: sink.writes, video: videoPath, tag,
  };
  fs.writeFileSync(path.join(evDir, 'manifest.json'), redact(JSON.stringify(manifest, null, 2), secrets));

  // Compact console summary for the agent: what to look at next.
  const lines = [`journey ${id}: ${status} in ${manifest.ms} ms${fatal ? ` (journey code error: ${fatal})` : ''}`];
  for (const s of steps) {
    lines.push(`  ${s.ok ? 'ok  ' : 'FAIL'} ${pad(s.n)} ${s.title}${s.expect ? `  | expect: ${s.expect}` : ''}`);
    lines.push(`       screenshot: ${path.join(runDir, s.screenshot || '')}`);
    for (const c of s.checks) lines.push(`       check ${c.ok ? 'ok' : 'FAILED'}: ${c.desc}${c.detail ? ` (${c.detail})` : ''}`);
    if (s.error) lines.push(`       error: ${s.error}`);
  }
  if (sink.consoleErrors.length || sink.pageErrors.length) lines.push(`  console/page errors: ${sink.consoleErrors.length + sink.pageErrors.length} (see manifest)`);
  if (sink.failedRequests.length) lines.push(`  failed requests: ${sink.failedRequests.map((r) => `${r.status} ${r.method} ${r.url}`).slice(0, 5).join('; ')}`);
  if (sink.writes.length) lines.push(`  writes to the app: ${sink.writes.length} (${sink.writes.map((w) => `${w.method} ${new URL(w.url).pathname}`).slice(0, 5).join(', ')})`);
  lines.push(`  video: ${videoPath ? path.join(runDir, videoPath) : 'none'}`);
  lines.push(`  manifest: ${path.join(evDir, 'manifest.json')}`);
  console.log(redact(lines.join('\n'), secrets));
  process.exit(status === 'completed' && steps.every((s) => s.ok) ? 0 : 2);
}

const commands = { doctor, snapshot, run };
if (!commands[cmd]) { console.error('commands: doctor | snapshot <url> | run <journey.mjs>'); process.exit(1); }
commands[cmd]().catch((e) => { console.error(redact(e.message, knownSecrets())); process.exit(1); });
