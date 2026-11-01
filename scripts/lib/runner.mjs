// A skill's own evaluation runner.
//
// Some skills are measured by a script that ships with them instead of by
// claude plugin eval cases: a policy skill that a program reads and replays,
// for example, whose answers are compared with labelled cases. Such a skill
// declares the script in its frontmatter:
//
//   jv-eval-runner: evals/run.mjs
//
// run-evals then runs `node <runner> --split tuning|held-out|all` from the
// skill folder instead of claude plugin eval. The contract with the runner:
//
//   exit 0   agreement on the split is at or above the runner's own threshold
//   exit 1   agreement is below it
//   other    the runner failed; there is no number to compare
//
// and it prints a line `<split> agreement: 87%` (or a fraction, `0.87`) on
// stdout, and may write RESULTS.md next to itself with the same line.
//
// A skill with disable-model-invocation: true is never picked by Claude, so
// trigger evals mean nothing for it and are skipped.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, isAbsolute, normalize, sep } from 'node:path';
import { parseFrontmatter } from './frontmatter.mjs';

export const RUNNER_FIELD = 'jv-eval-runner';
const TRIGGER_TAGS = new Set(['trigger', 'should-fire', 'should-not-fire']);

// The runner a skill declares, or null when it declares none. A declared
// runner that can't be used comes back with `error` set, so callers can say why.
export function evalRunner(skillDir) {
  const md = join(skillDir, 'SKILL.md');
  if (!existsSync(md)) return null;
  const data = parseFrontmatter(readFileSync(md, 'utf8')).data ?? {};
  const value = data[RUNNER_FIELD];
  if (value === undefined || value === null) return null;
  const dmi = data['disable-model-invocation'];
  const modelInvoked = !(dmi === true || /^(yes|on|true|1)$/i.test(String(dmi ?? '')));
  const runner = typeof value === 'string' ? value.trim() : '';
  const bad = why => ({ runner, modelInvoked, error: `${RUNNER_FIELD}: ${why}` });
  if (!runner) return bad('should be a path relative to the skill folder, such as evals/run.mjs.');
  const rel = normalize(runner);
  if (isAbsolute(runner) || rel === '..' || rel.startsWith(`..${sep}`)) return bad(`"${runner}" must be a path inside the skill folder.`);
  const path = join(skillDir, rel);
  if (!existsSync(path) || !statSync(path).isFile()) return bad(`"${runner}" does not exist in ${skillDir}.`);
  return { runner: rel, path, modelInvoked };
}

// True when every tag asks for trigger cases only.
export function wantsTrigger(tags = []) {
  return tags.length > 0 && tags.every(t => TRIGGER_TAGS.has(t));
}

// The runner's split for a set of run-evals tags: `held-out` and
// `<skill>:held-out` mean held-out, `tuning` and `<skill>:tuning` mean tuning,
// anything else (output, no tag) means all cases.
export function splitFor(tags = []) {
  const split = t => (/(^|:)held-?out$/.test(t) ? 'held-out' : /(^|:)tuning$/.test(t) ? 'tuning' : null);
  const found = new Set(tags.map(split).filter(Boolean));
  return found.size === 1 ? [...found][0] : 'all';
}

// Agreement on a split, as a fraction, from runner output or RESULTS.md.
// Takes the line for the split ("held-out agreement: 87%") before a bare
// "agreement: 0.87"; null when neither is there.
export function agreementFor(text, split) {
  if (!text) return null;
  const read = re => {
    const m = text.match(re);
    if (!m) return null;
    const n = Number(m[1]);
    return m[2] === '%' || n > 1 ? n / 100 : n;
  };
  const name = split.replace('-', '-?');
  return read(new RegExp(`^\\W*${name}\\s+agreement\\W*[:=]\\s*(\\d+(?:\\.\\d+)?)\\s*(%)?`, 'im'))
    ?? read(/^\W*agreement\W*[:=]\s*(\d+(?:\.\d+)?)\s*(%)?/im);
}

export const asPct = n => (n == null ? 'n/a' : `${Math.round(n * 1000) / 10}%`);

// Whether to keep a change, decided the way improving-skills decides with
// Skillio's own held-out score: only the held-out split decides, the change
// must not fall below the runner's threshold, and with a before run it must
// beat it by more than the noise (percentage points). keep is true, false or
// null (no decision possible).
export function heldOutDecision(after, before = null, { noise = 0 } = {}) {
  if (after.split !== 'held-out') return { keep: null, line: 'No decision: only the held-out split decides whether a change is kept (run with --tag held-out).' };
  if (after.exit !== 0 && after.exit !== 1) return { keep: null, line: `No decision: the runner failed (exit ${after.exit}); see run.log.` };
  if (after.exit === 1) return { keep: false, line: `Revert: held-out agreement ${asPct(after.agreement)} is below the runner's threshold (exit 1).` };
  if (!before) return { keep: true, line: `Held-out agreement ${asPct(after.agreement)} meets the runner's threshold. Pass --baseline <before run> to decide whether a change beats it.` };
  if (before.split !== 'held-out') return { keep: null, line: 'No decision: the baseline run is not a held-out run.' };
  if (after.agreement == null || before.agreement == null) return { keep: null, line: 'No decision: a run printed no held-out agreement.' };
  const gain = after.agreement - before.agreement;
  if (gain > noise / 100) return { keep: true, line: `Keep: held-out agreement rose from ${asPct(before.agreement)} to ${asPct(after.agreement)}.` };
  return { keep: false, line: `Revert: held-out agreement went from ${asPct(before.agreement)} to ${asPct(after.agreement)}, which does not beat the before run by more than the noise (${noise} point(s)).` };
}
