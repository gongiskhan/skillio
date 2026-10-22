#!/usr/bin/env node
// Refreshes vendor/ from upstream. Each source is pinned by commit in
// vendor/sources.json; run this to move to the latest commit, review the diff
// with git, and commit it as one "update vendored skills" change.
//
//   node scripts/sync-vendor.mjs            update every source
//   node scripts/sync-vendor.mjs skill-judge  update one
//
// Nothing here runs vendored code. Skillio's skills read these files as
// reference material, so updating them changes guidance, not behaviour of
// Skillio's own scripts. Review the diff before committing anyway.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, cpSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = join(ROOT, 'vendor');
const MANIFEST = join(VENDOR, 'sources.json');

export const SOURCES = [
  {
    name: 'skill-creator', repo: 'anthropics/skills', license: 'Apache-2.0',
    copy: [['skills/skill-creator', '.']],
    use: 'The builder. building-skills follows its workflow for drafting, test runs, the review viewer and benchmarks.',
  },
  {
    name: 'superpowers-writing-skills', repo: 'obra/superpowers', license: 'MIT',
    copy: [['skills/writing-skills', '.'], ['LICENSE', 'LICENSE']],
    use: 'TDD for skills: baseline pressure tests, matching the form of guidance to the failure, closing rationalisations.',
  },
  {
    name: 'skill-judge', repo: 'softaworks/agent-toolkit', license: 'MIT',
    copy: [['skills/skill-judge/SKILL.md', 'SKILL.md'], ['skills/skill-judge/README.md', 'README.md'], ['LICENSE', 'LICENSE']],
    use: 'A scoring rubric for skill design (knowledge delta, freedom, anti-patterns). The skill-reviewer agent uses parts of it.',
  },
  {
    name: 'plugin-dev', repo: 'anthropics/claude-plugins-official', license: 'Apache-2.0',
    copy: [
      ['plugins/plugin-dev/agents/skill-reviewer.md', 'agents/skill-reviewer.md'],
      ['plugins/plugin-dev/agents/plugin-validator.md', 'agents/plugin-validator.md'],
      ['plugins/plugin-dev/skills/skill-development', 'skills/skill-development'],
      ['plugins/plugin-dev/skills/plugin-structure', 'skills/plugin-structure'],
      ['plugins/plugin-dev/skills/hook-development', 'skills/hook-development'],
      ['plugins/plugin-dev/LICENSE', 'LICENSE'],
    ],
    use: 'Anthropic\'s plugin-development guides and reviewer agents, for skills that ship inside plugins with hooks.',
  },
  {
    name: 'task-observer', repo: 'rebelytics/one-skill-to-rule-them-all', license: 'CC-BY-4.0',
    copy: [['SKILL.md', 'SKILL.md'], ['references', 'references'], ['scripts', 'scripts'], ['LICENSE.txt', 'LICENSE.txt'], ['README.md', 'README.md'], ['USER-GUIDE.md', 'USER-GUIDE.md']],
    use: 'An always-on observer that logs corrections from real sessions and turns them into skill improvements. improving-skills borrows its method; install it separately to run it.',
  },
  {
    name: 'agentskills-docs', repo: 'agentskills/agentskills', license: 'CC-BY-4.0',
    copy: [['docs/specification.mdx', 'specification.mdx'], ['docs/skill-creation', 'skill-creation'], ['docs/LICENSE', 'LICENSE']],
    use: 'The Agent Skills open standard and its authoring, evaluation and description-optimisation guides.',
  },
];

function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr.trim()}`);
  return r.stdout.trim();
}

function main() {
  const only = process.argv[2];
  const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {};
  const tmp = mkdtempSync(join(tmpdir(), 'skillio-vendor-'));
  try {
    for (const s of SOURCES) {
      if (only && s.name !== only) continue;
      const clone = join(tmp, s.name);
      git(['clone', '-q', '--depth', '1', `https://github.com/${s.repo}.git`, clone]);
      const commit = git(['rev-parse', 'HEAD'], clone);
      const dest = join(VENDOR, s.name);
      rmSync(dest, { recursive: true, force: true });
      mkdirSync(dest, { recursive: true });
      for (const [from, to] of s.copy) {
        cpSync(join(clone, from), join(dest, to), { recursive: true, filter: p => !/(__pycache__|\.pyc$|node_modules)/.test(p) });
      }
      manifest[s.name] = { repo: `https://github.com/${s.repo}`, commit, license: s.license, synced: new Date().toISOString().slice(0, 10), use: s.use };
      console.log(`${s.name}: ${s.repo}@${commit.slice(0, 12)}`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
  console.log('Updated vendor/sources.json. Review with: git diff --stat vendor/');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
