---
name: web-testing
description: Tests a running web app in a real browser and proves what it found. It drives user journeys with Playwright, records video and step screenshots, judges each step from the screenshots, reports bugs with that evidence, then turns verified journeys into Playwright tests in the project's suite and runs them. Use it whenever someone wants to know if a web app or site works or looks right, wants it walked through like a real user would (before a demo, launch or release, or after a deploy), or passes on a report that something is broken, wrong or slow and wants it looked at. Any URL (production, staging, localhost), feature, commit, range or PR. Prefer it over general browser automation whenever the point is checking that a site behaves correctly, even if nobody says "test" or "Playwright". Also for handing over test logins safely. Not for unit tests, load or security testing, scraping, or filling in a form on someone's behalf.
---

# Testing web apps

The goal is evidence a person can check in a minute, plus automated tests that keep checking after you leave. An agent saying "it works" is worth little; a screenshot next to a verdict, and a test that fails when the feature breaks, are worth a lot. Every claim in your final answer should point at one of those.

The work has six stages. Do them in order:

```
1 Set up    → 2 Scope    → 3 Credentials → 4 Journeys + vision review
→ 5 Report  → 6 Tests (only when a repo is given) → deliver
```

Size the work to the request before you start, because a thorough run where a quick one was asked for wastes the person's time and money as surely as a sloppy one wastes their trust:

| Request sounds like | Do | Aim to finish in |
| --- | --- | --- |
| "quick check", "is X up", a smoke test after a deploy | snapshots of the main pages at desktop and mobile, one or two core journeys | about 5 minutes |
| "test this app", "QA before release", a URL with no other context | 3 to 6 journeys on the core flows plus page snapshots | 10 to 15 minutes |
| a commit, range or PR | the changed features in depth, one neighbouring flow, then tests | 10 to 20 minutes |

Go deeper only when what you find calls for it (a bug in a core flow deserves a second look; a clean marketing page doesn't). Work with the harness as it is: if you need something it can't do, such as another browser engine, say so in the answer instead of rewriting the scripts.

All scripts are in `scripts/` next to this file. Call them by full path. They print compact text meant for you to read, and they never print a password.

## 1. Set up

Run `node <skill>/scripts/journey.mjs doctor`. If Playwright or Chromium is missing, it prints the install command; run it in the project, or in a scratch folder when there is no project, then run the scripts from that same folder, because they look for Playwright where they are run from. If no browser can run in this environment (some hosted sandboxes block it, or block the target's domain), say so in one sentence and suggest where it will work (Claude Code or a machine that can reach the URL). Don't fall back to guessing from page source.

Pick a run directory: `webtest-runs/<YYYYMMDD-HHMM>/` inside the repo (add `webtest-runs/` to `.gitignore` if it isn't there) or inside the current folder when there is no repo. Everything for this run goes there: journeys, evidence, `results.json`, `report.html`.

Localhost only works when you run on the same machine as the app. From a cloud sandbox, `localhost` is the sandbox itself.

## 2. Scope

Decide what to test before touching the browser, and write it in two or three sentences in `results.json` → `scope` later.

**A URL and nothing else.** This run produces evidence only, no test files (tests need a repo to live in; say so at the end and offer to add them if they point you at one). Start with `journey.mjs snapshot <url> --out <run>/snap`, which saves a screenshot, the accessibility tree and a JSON file with console errors, failed requests and load time, and prints the same. From the navigation and the main calls to action, pick the three to six journeys a real user of this app depends on most (sign-up or sign-in, the core task, payment or checkout, a form that sends something). Add a snapshot of each top-level page so broken pages, console errors and dead assets are caught cheaply. Check one key page at the `mobile` viewport.

**A repo with a commit, range or PR.** Run `node <skill>/scripts/changes.mjs <repo> <ref>` (accepts a sha, `a..b`, `since:<ref>`, `pr:<n>` or a PR URL). It lists commits, files, paths and UI text the change introduced, plus the diff. Map the change to the screens a user would touch, and test those first: the happy path, the validation and error paths the diff adds, and one journey through a neighbouring flow the change could have broken. Read the diff for what the code intends (messages, limits, rules) so your checks assert the intended behaviour, not whatever the page happens to show.

**A repo with no ref.** Treat it like a URL-only run for breadth, but you may add tests.

In every repo case, also run `node <skill>/scripts/suite.mjs <repo>`. It lists the existing end-to-end specs, what each visits and which locators it uses, the env var names the tests read for credentials, the config, `baseURL` and scripts. You will use it twice: to avoid re-testing what is already covered, and to write new tests in the same conventions.

If the request is ambiguous in a way that changes the work (which environment, which feature), ask one short question. Otherwise state your scope in one line and start.

## 3. Credentials

If the journeys need a login, read [references/credentials.md](references/credentials.md) before asking for anything. In short: run `node <skill>/scripts/creds.mjs status <url>` first, since a saved session or stored credentials may already exist. Never ask for a password in the chat as the first option, never print one, and never read a credentials file with `cat` or a file viewer, because whatever you read lands in the conversation. Import files with `creds.mjs import`, which stores them without showing you the values. Inside journeys, use the `creds` object the harness passes in.

If no credentials are available and you can't get them, test everything that doesn't need a login. Run each journey that does need one up to the sign-in screen, so it leaves a screenshot and a manifest, and mark it `blocked` with the reason; a journey that never ran disappears from `results.json` at the next `report.mjs init`. Don't go looking for credentials elsewhere: not in other folders, not in other processes' environments, not in the app's source. Credentials reach you through the user, so ask them.

The app belongs to the user. If it stops responding mid-run, record that (it may be a finding in itself) and tell the user; don't restart or reconfigure a server you didn't start.

## 4. Journeys and vision review

A journey is a small ES module the harness runs. Write one file per journey in `<run>/journeys/`:

```js
export const title = 'Apply a coupon in the cart';
export default async function ({ page, step, check, creds, session, tag }) {
  await step('Sign in', async () => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(creds.username);
    await page.getByLabel('Password').fill(creds.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/account');
    await session.save();               // later runs and tests can reuse the login
  }, { expect: 'Account page greets the user by name' });

  await step('Apply SAVE10', async () => {
    await page.goto('/cart');
    await page.getByLabel('Coupon code').fill('SAVE10');
    await page.getByRole('button', { name: 'Apply' }).click();
    await check('total drops by 10%', async () => {
      const t = await page.getByTestId('total').textContent();
      return t === '€48.60' || `total is ${t}`;   // a string means "failed, here is why"
    });
  }, { expect: 'Discount row shows −€5.40 and total €48.60' });
}
```

Run it: `node <skill>/scripts/journey.mjs run <run>/journeys/<file>.mjs --base-url <origin> --run-dir <run>`. Add `--viewport mobile` for a phone-sized run and `--fresh` to ignore a saved session. Each step saves a screenshot and an accessibility snapshot; each journey records a video and a `manifest.json` with console errors, failed requests and every write the app received. The console summary lists the screenshot path per step.

How to write good journeys:

- Drive the page the way a user does: role, label and visible-text locators, real clicks and typing. Read the accessibility snapshot to find the names rather than guessing.
- Put a `check` on every fact you will later claim: totals, counts, messages, the URL after a redirect, that a change persisted after a reload. A check that returns `false` or a string, or throws, fails; failed checks don't stop the journey, so you see the later steps too. Returning nothing counts as a pass (so checks built on `expect` work), which means any other check must end with `return`. A step whose action throws ends the journey with a screenshot of where it got stuck.
- Include the unhappy paths users hit: invalid input, an empty state, a wrong code, the back button after submitting.
- Saved sessions keep server-side state between runs (a cart from the last run is still there). Make journeys start from a known state or check relative changes.
- Journeys may create data on any environment, production included, unless the user says otherwise; on production, say in your scope line that journeys will create tagged test data. Two habits keep that safe: put the `tag` value (`webtest-…`) into any name, message or record you create so it can be found and cleaned up, and stop to ask before anything that spends real money, deletes an account or data you didn't create, or, outside the user's own machine, reaches other people (an email, an in-app message, a public post, a form the site's staff receive). The report lists every write the app received.

**Vision review.** After a run, open the screenshots and look at them. This catches what checks can't: overlapping elements, a button hidden under a banner, broken images, unreadable text, an error toast, a layout that falls apart on mobile. You don't need to view every screenshot. View every screenshot of a step that failed, every step whose `expect` is visual, and the final screen of each journey. Steps fully covered by passing checks can be judged from the checks. Record what you actually saw, not what you expected to see. If a screenshot shows something you can't explain, mark the step `unclear` and say why.

A passing check proves only what it tests. Text in the DOM is not text on screen: scroll-triggered sections, animations and lazy loading often leave it invisible. So when a step's `expect` is about what a user sees, the screenshot decides, and a screenshot proves only what is in its frame. If the `expect` covers more than the frame shows (sections below the fold, the rest of a tour or list), take more screenshots or narrow the verdict to what you saw.

When something fails, re-run that journey once under a new id (`--id <id>-rerun`), so the failed run keeps its screenshots and video as evidence. If it passes the second time, it's flaky behaviour, worth a `minor` finding of its own. If it fails again, it's a bug, unless the failure could come from where you are rather than from the app: a 502, a TLS or DNS error, or a proxy or bot-check page on a remote site is often your network, not theirs. Check it by a second route (another tool that fetches URLs, or `curl` from a different network if you have one). If you can't confirm it, report it as "couldn't reach from here" with the evidence, not as a bug in their site.

## 5. Report

1. `node <skill>/scripts/report.mjs init <run> --url <url> [--repo <path>] [--changeset "commit:<sha>"]` creates `results.json` from the manifests (re-run it after more journeys; it keeps verdicts you already wrote).
2. Fill in `results.json` by editing the file: per step `seen` (true only if you opened that screenshot in this run; a pass you did not look at is a guess), `verdict` (`pass`, `fail`, `unclear`) and `observed` (required unless it passed); per journey `status` and `why`; then `findings`, `scope` and a plain two-or-three-sentence `summary`. The schema and severity scale are in [references/results-schema.md](references/results-schema.md).
3. `node <skill>/scripts/report.mjs build <run>` validates and writes `report.html`. If validation fails, fix `results.json`; the checks exist so that no step is marked passed without evidence. Use `--inline` when the report will be sent somewhere without the evidence folder.

A finding is something a user would notice or that breaks a rule the product states (in the UI, the diff or the docs). Every finding names the page, the step, the screenshot, and what you expected versus what happened. Don't report style preferences as bugs. Don't omit a real bug because it's outside the requested scope; report it as found along the way.

## 6. Tests (only when a repo is given)

Read [references/writing-tests.md](references/writing-tests.md) first. The essentials:

- Turn each verified journey into one or more Playwright tests, in the suite's own test directory, language and style, using its `baseURL` and the env var names it already uses for credentials. If the repo has no Playwright setup yet, add a minimal `playwright.config` with `baseURL` from `BASE_URL`, and say so.
- Skip what the suite already covers. If a journey only repeats an existing test, don't add a test; list it under `tests.skippedAsCovered`. Extend an existing spec file when the new test belongs with it.
- Assert outcomes, not presence: the total is €48.60, the message reads "Changes saved.", the name is still there after a reload. A test that only checks that something is visible usually passes when the feature is broken.
- A bug you found becomes a test of the correct behaviour marked `test.fail()` with a comment naming the finding id, so the suite stays green today and the test flips to "unexpectedly passed" when someone fixes the bug.
- Run them: `node <skill>/scripts/runtests.mjs <repo> --base-url <url> --run-dir <run> --all <new or changed spec files>`. It injects credentials, turns traces off (traces record typed passwords), runs the new tests three times to catch flakiness, then the whole suite once to make sure nothing else broke, and records the result in `results.json`. Fix flaky tests by waiting on the condition that matters (`expect(...).toHaveText`, `waitForURL`, a response), never with fixed sleeps.
- List each added or extended file under `tests.added` in `results.json`, then rebuild the report.
- Don't commit unless asked; leave the files in the working tree and say where they are.

## Deliver

1. Run `node <skill>/scripts/creds.mjs scrub <run> <repo>/test-results <any new test files>` and fix anything it finds before sharing. It looks for every stored secret in the outputs.
2. Send or point to `report.html` (and the run folder, which has the videos). Build the report even when the run was blocked early (no login, app down): `report.mjs init` picks up page snapshots too, so the pages you did check are still evidence.
3. Reply in a few sentences: the verdict, the findings that matter most with severity, what tests were added and how their run went, and anything blocked and why.

Write the reply from `results.json` and the files in the run folder, not from memory of the run. If you measured or read something with your own command (file sizes, timings, headers, a line of the site's code), save that output in the run folder before you quote it. Say something works only if a step with a `pass` verdict shows it, and name a feature as checked only if a journey actually exercised it; a link you followed is not a form you opened. Everything else is "not checked". If a step is `unclear`, say so rather than rounding it up to a pass. Don't generalise from a sample: "the links work" needs every link followed; otherwise give the count ("the 6 nav links I followed work; 11 script-driven links weren't clicked"). A bug you say you reproduced needs its own journey or file in the run folder. This matters more than polish: the reason this skill exists is that agents tend to report things they meant to do as things they did.
