#!/usr/bin/env node
// Credential intake and use for web testing. Never prints a password.
//
//   node creds.mjs status <url> [--profile p]          what is available (masked)
//   node creds.mjs import <file> --url <url> [--profile p]
//                                                     read a KEY=VALUE or JSON file into the store
//   node creds.mjs from-env <url> --username-var A --password-var B   copy env vars into the store
//   node creds.mjs set <url> [--profile p] [--username u]
//                                                     hidden prompt in a terminal (user runs it)
//   node creds.mjs login <url> [--profile p]          headed browser: the user signs in, session saved
//   node creds.mjs exec <url> [--profile p] [--as NAME:username,NAME2:password] -- <command...>
//                                                     run a command with credentials in its env, output redacted
//   node creds.mjs scrub <path...> [--fix]            find stored secrets in files (and redact with --fix)
//   node creds.mjs forget <url>
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import {
  resolveCredentials, saveCredentials, sessionInfo, saveSessionFile, parseCredentialFile,
  knownSecrets, redact, mask, forget, originKey, HOME,
} from './lib/secrets.mjs';

const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (name, def = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};
const profile = opt('profile', 'default');
const out = (obj) => console.log(JSON.stringify(obj, null, 2));
const die = (msg, code = 1) => { console.error(msg); process.exit(code); };

function readStoreEntry(url) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(HOME, 'credentials.json'), 'utf8'));
    return (data[originKey(url)] || {})[profile] || null;
  } catch { return null; }
}

async function hiddenPrompt(question) {
  if (!process.stdin.isTTY) die('No terminal available for a hidden prompt. Use "import" with a file or set WEBTEST_USERNAME/WEBTEST_PASSWORD.', 3);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl._writeToOutput = function (s) { if (s.includes(question)) process.stdout.write(s); else process.stdout.write('*'); };
  const answer = await new Promise((r) => rl.question(question, r));
  rl.close();
  process.stdout.write('\n');
  return answer;
}

async function plainPrompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((r) => rl.question(question, r));
  rl.close();
  return answer;
}

if (cmd === 'status') {
  const url = argv[1] || die('usage: status <url>');
  const c = resolveCredentials(url, profile);
  const entry = readStoreEntry(url);
  out({
    origin: originKey(url),
    profile,
    session: sessionInfo(url, profile),
    credentials: c ? { source: c.source, username: mask(c.username), projectEnvNames: entry?.envNames || null } : null,
    store: path.join(HOME, 'credentials.json'),
  });
} else if (cmd === 'import') {
  const file = argv[1] || die('usage: import <file> --url <url>');
  const parsed = parseCredentialFile(fs.readFileSync(file, 'utf8'));
  const url = opt('url') || parsed.url || die('The file has no URL; pass --url <url>.');
  if (!parsed.password) die('No password field found (expected a key like PASSWORD, E2E_PASSWORD or "password").');
  saveCredentials(url, profile, { username: parsed.username, password: parsed.password, envNames: parsed.envNames, extra: parsed.extra });
  out({ stored: true, origin: originKey(url), profile, username: mask(parsed.username), keysRead: [parsed.envNames.username, parsed.envNames.password, ...Object.keys(parsed.extra)].filter(Boolean) });
} else if (cmd === 'from-env') {
  // Copies credentials that already sit in env vars into the store, without printing them.
  const url = argv[1] || die('usage: from-env <url> --username-var NAME --password-var NAME');
  const uVar = opt('username-var'); const pVar = opt('password-var') || die('--password-var is required');
  const password = process.env[pVar];
  if (!password) die(`${pVar} is not set in this environment.`);
  const username = uVar ? (process.env[uVar] || '') : '';
  saveCredentials(url, profile, { username, password, envNames: { username: uVar || null, password: pVar } });
  out({ stored: true, origin: originKey(url), profile, username: mask(username), from: [uVar, pVar].filter(Boolean) });
} else if (cmd === 'set') {
  const url = argv[1] || die('usage: set <url>');
  const username = opt('username') || await plainPrompt(`Username for ${originKey(url)}: `);
  const password = await hiddenPrompt('Password (hidden): ');
  if (!password) die('Empty password, nothing stored.');
  saveCredentials(url, profile, { username, password });
  out({ stored: true, origin: originKey(url), profile, username: mask(username) });
} else if (cmd === 'login') {
  const url = argv[1] || die('usage: login <url>');
  const { loadPlaywright } = await import('./lib/pw.mjs');
  const pw = await loadPlaywright();
  let browser;
  try { browser = await pw.chromium.launch({ headless: false }); } catch {
    die('Cannot open a visible browser here (no display). Use "import" with a credentials file instead, or run this on your own machine.', 4);
  }
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  await page.goto(url);
  console.log('Sign in in the browser window. When you can see the signed-in page, come back here and press Enter.');
  await plainPrompt('');
  const p = saveSessionFile(url, profile, await ctx.storageState());
  await browser.close();
  out({ sessionSaved: true, origin: originKey(url), profile, path: p });
} else if (cmd === 'exec') {
  const url = argv[1] || die('usage: exec <url> -- <command>');
  const sep = argv.indexOf('--');
  if (sep < 0) die('usage: exec <url> [--as NAME:username,...] -- <command>');
  const command = argv.slice(sep + 1);
  const c = resolveCredentials(url, profile);
  const entry = readStoreEntry(url);
  const env = { ...process.env };
  if (c) {
    env.WEBTEST_USERNAME = c.username;
    env.WEBTEST_PASSWORD = c.password;
    if (entry?.envNames?.username) env[entry.envNames.username] = c.username;
    if (entry?.envNames?.password) env[entry.envNames.password] = c.password;
    for (const [k, v] of Object.entries(c.extra || {})) if (/^[A-Z_][A-Z0-9_]*$/.test(k)) env[k] = v;
    for (const pair of (opt('as') || '').split(',').filter(Boolean)) {
      const [name, field] = pair.split(':');
      env[name] = field === 'password' ? c.password : c.username;
    }
  }
  const sess = sessionInfo(url, profile);
  if (sess.exists) env.WEBTEST_STORAGE_STATE = sess.path;
  const secrets = knownSecrets();
  const child = spawn(command[0], command.slice(1), { env, stdio: ['inherit', 'pipe', 'pipe'] });
  child.stdout.on('data', (d) => process.stdout.write(redact(d.toString(), secrets)));
  child.stderr.on('data', (d) => process.stderr.write(redact(d.toString(), secrets)));
  child.on('close', (code) => process.exit(code ?? 1));
} else if (cmd === 'scrub') {
  const fix = argv.includes('--fix');
  const targets = argv.slice(1).filter((a) => a !== '--fix');
  const secrets = knownSecrets();
  const hits = [];
  const walk = (p) => {
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (/node_modules|\.git$/.test(p)) return;
      for (const f of fs.readdirSync(p)) walk(path.join(p, f));
      return;
    }
    // Files over 20 MB (usually videos) are not searched; list them so a clean
    // result is never mistaken for "everything was checked".
    if (st.size > 20 * 1024 * 1024) { notSearched.push(p); return; }
    const buf = fs.readFileSync(p);
    const text = buf.toString('latin1');
    const found = secrets.filter((s) => text.includes(s) || buf.includes(Buffer.from(s, 'utf8')));
    if (!found.length) return;
    const binary = /\.(png|jpe?g|webm|zip|gif|webp)$/i.test(p);
    hits.push({ file: p, count: found.length });
    // Binary files can't be redacted in place; they stay a problem to fix by hand.
    if (fix && !binary) fs.writeFileSync(p, redact(buf.toString('utf8'), secrets));
    else if (fix) notFixed.push(p);
  };
  const notSearched = [], notFixed = [];
  for (const t of targets) if (fs.existsSync(t)) walk(t);
  out({ secretsChecked: secrets.length, filesWithSecrets: hits, fixed: fix && !notFixed.length, notFixed, notSearched,
    ...(notFixed.length ? { todo: 'These binary files contain a stored secret and could not be redacted: delete them or re-record without the secret.' } : {}) });
  process.exit((hits.length && !fix) || notFixed.length ? 1 : 0);
} else if (cmd === 'forget') {
  forget(argv[1] || die('usage: forget <url>'));
  out({ forgotten: true });
} else {
  die('commands: status | import | from-env | set | login | exec | scrub | forget');
}
