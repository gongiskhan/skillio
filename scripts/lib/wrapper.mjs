import { existsSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync } from 'node:fs';
import { join, basename, relative } from 'node:path';
import { readPluginJson, listDecoys } from './evals.mjs';

// Builds a throwaway plugin in the workspace that claude plugin validate and
// claude plugin eval can load: a copy of the plugin (or a bare skill wrapped
// in one), plus any decoy skills from the eval folder installed beside it.
const COPY_SKIP = /(^|\/)(\.git|node_modules|__pycache__|\.DS_Store)(\/|$)|(^|\/)evals\/results(\/|$)|-workspace(\/|$)/;

export function buildWrapper(target, ws, { withDecoys = true, evalsFrom = null } = {}) {
  const root = join(ws, 'skillio', 'wrapper');
  rmSync(root, { recursive: true, force: true });
  let evalsRoot;
  if (target.pluginRoot) {
    cpSync(target.pluginRoot, root, { recursive: true, filter: src => !COPY_SKIP.test(relative(target.pluginRoot, src)) });
    const pj = readPluginJson(root) ?? {};
    evalsRoot = join(root, typeof pj.experimental?.evals === 'string' ? pj.experimental.evals : 'evals');
  } else {
    const name = basename(target.path);
    mkdirSync(join(root, '.claude-plugin'), { recursive: true });
    cpSync(target.path, join(root, 'skills', name), { recursive: true, filter: src => !COPY_SKIP.test(relative(target.path, src)) });
    const pj = { name: `${name}-wrapper`, version: '0.0.0', description: `Temporary wrapper Skillio builds to validate and evaluate ${name}` };
    if (existsSync(join(target.path, 'evals'))) pj.experimental = { evals: `skills/${name}/evals` };
    writeFileSync(join(root, '.claude-plugin', 'plugin.json'), JSON.stringify(pj, null, 2) + '\n');
    evalsRoot = join(root, 'skills', name, 'evals');
  }
  if (evalsFrom) {
    // A suite kept outside the skill (a check's starter suite): swap it in.
    rmSync(evalsRoot, { recursive: true, force: true });
    cpSync(evalsFrom, evalsRoot, { recursive: true });
    if (!target.pluginRoot) {
      const pjPath = join(root, '.claude-plugin', 'plugin.json');
      const pj = JSON.parse(readFileSync(pjPath, 'utf8'));
      pj.experimental = { evals: relative(root, evalsRoot) };
      writeFileSync(pjPath, JSON.stringify(pj, null, 2) + '\n');
    }
  }
  const installed = [];
  if (withDecoys) {
    for (const d of listDecoys(evalsRoot)) {
      let name = d.name;
      if (existsSync(join(root, 'skills', name))) name += '-rival';
      cpSync(d.dir, join(root, 'skills', name), { recursive: true });
      installed.push(name);
    }
  }
  return { root, decoys: installed };
}

