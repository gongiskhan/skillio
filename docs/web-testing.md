# web-testing

`skills/web-testing` tests a running web app in a real browser and proves what it found. It drives user journeys with Playwright, records a video per journey and a screenshot per step, judges each step from the screenshots, and reports bugs with that evidence. Given a repo, it then turns the verified journeys into tests in the project's own suite and runs them.

It is not a skill about skills. It lives in Skillio because it was built with skill-creator and measured and improved with Skillio, so it doubles as a worked example of the whole loop.

## Using it

Ask in plain words: "test this app https://...", "is the app working after the deploy?", "test PR 123 against localhost:3000", or pass on a user's complaint with the URL.

- **Where to run it.** In Claude Code, in the app's repo (a worktree if the main checkout is the one you deploy from). With a repo it reads the commit, range or PR (`scripts/changes.mjs`) and the existing suite (`scripts/suite.mjs`), so new tests follow the suite's conventions and skip what it already covers. With only a URL it produces evidence and no test files.
- **What it needs.** Node, and Playwright with Chromium where the scripts run; its first step (`journey.mjs doctor`) prints the install command if either is missing. A machine that can reach the URL: from a cloud sandbox, `localhost` is the sandbox.
- **Logins.** It never asks for a password in the chat first. `scripts/creds.mjs` takes a credentials file without showing the values, copies env vars under other names, or opens a browser window for you to sign in and keeps only the session. Use a test account.
- **Writes.** Journeys may create data, production included, unless you say otherwise. Everything it creates carries a `webtest-` tag, and it stops to ask before spending money, deleting data it didn't create, or anything that reaches other people.
- **Cost.** About $1 to $1.60 per run on Opus 5.5 at high effort, 5 to 12 minutes. Run it on demand after a change; the Playwright tests it leaves behind are what belong in a nightly run.
- **The Claude app.** Package it with `node scripts/skillio.mjs package skills/web-testing`. Whether the app's sandbox has Chromium and can reach your site is untested; the doctor step says so in one line.

## How it was measured

Behaviour was measured on six cases: a small shop app with a five-commit history, an existing Playwright suite and 13 seeded bugs (URL only, one commit, a commit range with env credentials, a release check of the clean app, a login with no credentials), plus a production smoke test of a real site. Each case ran with and without the skill in isolated sessions. Code graded everything with a right answer (evidence exists, the password never entered the context, every "seen" step was opened, tests pass three times on the correct app, mutation score on the seeded bugs, known bugs pinned with `test.fail()`, the suite green as delivered). A stronger model reviewed what needs reading (claims backed by artefacts, no claimed coverage that didn't happen, verdicts that match the screenshots, test quality, and a blind mapping of reported bugs onto the catalogue).

| | With the skill | Plain Opus 5.5 |
| --- | --- | --- |
| Shared checks passed, mean of 3 runs per case | 97% | 73% |
| Shared checks passed in all 3 runs | 95% | 66% |
| Seeded bugs found (in scope, 18 runs) | 21 of 21 | 20 of 21 |
| Runs with a report and screenshots | 15 of 15 | 0 of 15 |
| Repo runs that left the suite green | 9 of 9 | 1 of 9 |
| Password read into the context (runs with a credentials file or env vars) | 0 of 9 | 3 of 9 |
| Cost per run | $1.10 | $0.57 |

Bug finding is close; what the skill adds is proof, honesty about scope, credential hygiene and tests that keep the suite green.

One improving-skills pass followed. The static check, the prompt audit and the independent reviewer found, among smaller things, that re-running a journey carried its old "pass" verdicts onto the new screenshots, which no eval had caught. After the fixes, the production smoke test went from 81% to 95% over three runs, with no overclaimed coverage in any run (four of four, against one of three before).

## Triggering

`evals/trigger-web-testing/` holds 46 cases from `evals/sets/web-testing.json`: 26 should fire, 20 near misses (unit tests, load and security testing, scraping, filling in a form, fixing a failing spec), 23 held out. A decoy with a browser-automation skill's description sits next to it in every case. Measured under the skill's earlier name `testing-web-apps`: 32 of 36 tuning runs fired, 31 and 33 of 42 held-out runs on two runs, and no near miss fired. A description rewrite aimed at the misses scored 34 of 42, inside the noise, so the original stayed. Not yet re-measured under the new name.

The misses that remain: a passed-on user complaint makes Claude look for code to read before reaching for a browser, and a "be a new user" walkthrough sometimes goes to the browser decoy.

## Not in this repo

The behaviour lab (the fixture app with its seeded bugs, the case runner, the grader and the reviewing judge) is a separate project. It is large and specific to this one skill, so it stays out of a plugin people install.

## Known gaps

- Steps marked "seen" after the agent looked at a strip of several screenshots rather than each file: honest, but not verifiable. The planned fix is a `seenVia` field naming the sheet, accepted by the validator and the grader.
- Certificate errors are ignored on every target, so an expired certificate on a production site isn't reported. Turning the check on breaks every site behind a TLS-inspecting proxy, which is the more common case.
