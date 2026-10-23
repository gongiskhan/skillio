// Credential store and redaction. Secrets live outside the model's view:
// the store is a 0600 file, scripts read it directly, and nothing here ever
// prints a password. Everything that writes text runs it through redact().
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const HOME = process.env.WEBTEST_HOME || path.join(os.homedir(), '.webtest');
const STORE = path.join(HOME, 'credentials.json');
const SESSIONS = path.join(HOME, 'sessions');

function ensureHome() {
  fs.mkdirSync(HOME, { recursive: true, mode: 0o700 });
  fs.mkdirSync(SESSIONS, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(HOME, 0o700); } catch { /* best effort */ }
}

function readStore() {
  try { return JSON.parse(fs.readFileSync(STORE, 'utf8')); } catch { return {}; }
}

function writeStore(data) {
  ensureHome();
  fs.writeFileSync(STORE, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.chmodSync(STORE, 0o600);
}

export const originKey = (url) => new URL(url).origin;
const hostSlug = (url) => new URL(url).host.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase();

export function mask(value) {
  if (!value) return '';
  const s = String(value);
  if (s.includes('@')) { const [u, d] = s.split('@'); return `${u.slice(0, 1)}***@${d}`; }
  return s.length <= 3 ? '***' : `${s.slice(0, 1)}***${s.slice(-1)}`;
}

export function saveCredentials(url, profile, creds) {
  const data = readStore();
  const key = originKey(url);
  data[key] = data[key] || {};
  data[key][profile] = { ...creds, savedAt: new Date().toISOString() };
  writeStore(data);
}

export function forget(url) {
  const data = readStore();
  delete data[originKey(url)];
  writeStore(data);
  for (const f of fs.existsSync(SESSIONS) ? fs.readdirSync(SESSIONS) : []) {
    if (f.startsWith(sessionSlug(url))) fs.rmSync(path.join(SESSIONS, f));
  }
}

// Resolution order: env vars (per host, then generic), then the store.
export function resolveCredentials(url, profile = 'default') {
  const slug = hostSlug(url);
  const env = process.env;
  const pick = (...names) => names.map((n) => env[n]).find(Boolean);
  const envUser = pick(`WEBTEST_${slug}_USERNAME`, env.WEBTEST_ORIGIN && env.WEBTEST_ORIGIN !== originKey(url) ? '' : 'WEBTEST_USERNAME');
  const envPass = pick(`WEBTEST_${slug}_PASSWORD`, env.WEBTEST_ORIGIN && env.WEBTEST_ORIGIN !== originKey(url) ? '' : 'WEBTEST_PASSWORD');
  if (envPass) return { username: envUser || '', password: envPass, extra: {}, source: 'env' };
  const entry = (readStore()[originKey(url)] || {})[profile];
  if (entry && entry.password) return { username: entry.username || '', password: entry.password, extra: entry.extra || {}, source: 'store' };
  return null;
}

function sessionSlug(url) {
  return new URL(url).host.replace(/[^a-zA-Z0-9.-]/g, '_');
}

export function sessionPath(url, profile = 'default') {
  return path.join(SESSIONS, `${sessionSlug(url)}__${profile}.json`);
}

export function sessionInfo(url, profile = 'default') {
  const p = sessionPath(url, profile);
  if (!fs.existsSync(p)) return { exists: false };
  const ageHours = (Date.now() - fs.statSync(p).mtimeMs) / 3.6e6;
  return { exists: true, path: p, ageHours: Math.round(ageHours * 10) / 10 };
}

export function saveSessionFile(url, profile, state) {
  ensureHome();
  const p = sessionPath(url, profile);
  fs.writeFileSync(p, JSON.stringify(state), { mode: 0o600 });
  return p;
}

// Every secret we know about, longest first so overlapping values redact cleanly.
export function knownSecrets() {
  const out = new Set();
  const data = readStore();
  for (const origin of Object.values(data)) {
    for (const prof of Object.values(origin)) {
      if (prof.password) out.add(String(prof.password));
      for (const v of Object.values(prof.extra || {})) if (typeof v === 'string' && v.length >= 6) out.add(v);
    }
  }
  for (const [k, v] of Object.entries(process.env)) {
    if (/^WEBTEST_.*(PASSWORD|TOKEN|SECRET)$/.test(k) && v) out.add(v);
  }
  return [...out].filter((s) => s.length >= 4).sort((a, b) => b.length - a.length);
}

export function redact(text, secrets = knownSecrets()) {
  if (text == null) return text;
  let s = String(text);
  for (const secret of secrets) s = s.split(secret).join('••••••');
  return s;
}

// Parses KEY=VALUE files (.env style) or JSON into {url, username, password, extra}.
export function parseCredentialFile(content) {
  const trimmed = content.trim();
  let fields = {};
  if (trimmed.startsWith('{')) {
    fields = JSON.parse(trimmed);
  } else {
    for (const line of trimmed.split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*[=:]\s*(.*)\s*$/.exec(line);
      if (!m || line.trim().startsWith('#')) continue;
      fields[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  const find = (re) => {
    const k = Object.keys(fields).find((key) => re.test(key));
    return k ? { key: k, value: fields[k] } : null;
  };
  const user = find(/(^|_)(user(name)?|email|login)$/i);
  const pass = find(/(^|_)(pass(word)?|pwd)$/i);
  const url = find(/^(url|origin|base_?url|site)$/i);
  const extra = {};
  for (const [k, v] of Object.entries(fields)) {
    if (![user?.key, pass?.key, url?.key].includes(k)) extra[k] = v;
  }
  return {
    url: url?.value || null,
    username: user?.value || '',
    password: pass?.value || '',
    envNames: { username: user?.key || null, password: pass?.key || null },
    extra,
  };
}
