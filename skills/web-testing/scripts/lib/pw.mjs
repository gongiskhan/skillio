// Finds a usable Playwright install without forcing a local npm install.
// Order: the project in the current directory, then the global npm root.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const SETUP_HINT =
  'Playwright is not installed where this command can find it. It looks in the folder you run it from\n' +
  '(and the folders above it), then in the global npm packages. Either, in the folder you run the scripts from:\n' +
  '  npm i -D @playwright/test && npx playwright install chromium\n' +
  'or once for every folder:\n' +
  '  npm i -g playwright && npx playwright install chromium\n' +
  'then run this command again from that same folder.';

function candidates() {
  const dirs = [process.cwd()];
  try {
    dirs.push(execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim());
  } catch { /* npm missing is fine */ }
  return dirs;
}

export async function loadPlaywright() {
  if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
    for (const p of ['/opt/pw-browsers', path.join(process.env.HOME || '', '.cache/ms-playwright')]) {
      if (p && fs.existsSync(p)) { process.env.PLAYWRIGHT_BROWSERS_PATH = p; break; }
    }
  }
  for (const dir of candidates()) {
    const req = createRequire(path.join(dir, 'noop.js'));
    for (const name of ['playwright', '@playwright/test', 'playwright-core']) {
      try {
        const mod = req(name);
        if (mod.chromium) return mod;
      } catch { /* try next */ }
    }
    // global root case: packages live directly inside it
    for (const name of ['playwright', '@playwright/test', 'playwright-core']) {
      const p = path.join(dir, name);
      if (fs.existsSync(p)) {
        try { const mod = createRequire(path.join(p, 'noop.js'))(p); if (mod.chromium) return mod; } catch { /* next */ }
      }
    }
  }
  const err = new Error(SETUP_HINT);
  err.code = 'NO_PLAYWRIGHT';
  throw err;
}

export const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  mobile: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  tablet: { width: 820, height: 1180, isMobile: true, hasTouch: true },
};

export function viewportOptions(name = 'desktop') {
  const m = /^(\d+)x(\d+)$/.exec(name);
  if (m) return { viewport: { width: Number(m[1]), height: Number(m[2]) } };
  const v = VIEWPORTS[name] || VIEWPORTS.desktop;
  const { width, height, ...rest } = v;
  return { viewport: { width, height }, ...rest };
}

export function originOf(url) {
  return new URL(url).origin;
}

export function isLocal(url) {
  const h = new URL(url).hostname;
  return h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' || h.endsWith('.local') || h.endsWith('.localhost');
}
