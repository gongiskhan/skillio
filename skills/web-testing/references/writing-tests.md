# Writing the automated tests

A generated test earns its place only if it would fail when the feature breaks, passes reliably when it works, runs fast and doesn't repeat a test that already exists. Write each one with that in mind.

## Fit the suite you found

Use what `suite.mjs` reported:

- Same folder (`testDir`), language (`.ts` or `.js`), import style and naming as the existing specs. One file per feature (`settings.spec.ts`), or extend the file where related tests already live.
- Relative URLs (`page.goto('/cart')`) so `baseURL` decides the environment. Tests written against production must still run against localhost in CI; never hard-code a host.
- Credentials from the env var names the suite already uses (`process.env.E2E_PASSWORD ?? ''`). If the suite has none, use `WEBTEST_USERNAME` / `WEBTEST_PASSWORD`. No literal passwords, not even for a test account.
- Tests must not depend on anything from this run: not the webtest session file, not data your journeys created, not a server you started by hand. CI has none of it.
- If the suite has a login helper, fixture or `storageState` setup project, use it. If several new tests need a signed-in user and the suite has no setup, sign in through the API or UI in a `beforeEach`, or add a small setup project, whichever matches the suite's style.

## What makes an assertion worth having

| Weak (passes when broken) | Strong |
| --- | --- |
| `expect(page.getByText('Total')).toBeVisible()` | `expect(page.getByTestId('total')).toHaveText('€48.60')` |
| `expect(page.locator('form')).toBeVisible()` after submit | `expect(page.getByRole('status')).toHaveText('Changes saved.')` then reload and `expect(field).toHaveValue('New name')` |
| `expect(page).toHaveURL(/./)` | `expect(page).toHaveURL(/\/account$/)` |
| clicking a button with no assertion after | asserting the cart badge went from 0 to 1 |

Persisted changes need a reload (or a fresh page) before the assertion; otherwise you only test the client state. Derive expected values from the product's rules (price × quantity, 10% off), not from what the page showed during exploration, or a bug becomes the expected value.

Cover, per feature: the main success path, each validation or error the code defines, and one neighbouring behaviour the change could break. Stop there. Third-party widgets, analytics, exact pixel layout and copy that marketing changes weekly don't belong in end-to-end tests.

## Reliability and speed

- Locators: `getByRole` with a name, `getByLabel`, `getByTestId` when the app has test ids, `getByText` for static copy. Avoid CSS chains and nth-child selectors that break on a layout change.
- Waiting: rely on web-first assertions (`toHaveText`, `toHaveURL`, `toBeVisible`), which retry. Never `waitForTimeout`. Wait for a response with `page.waitForResponse` when an action has no visible effect yet.
- Independence: each test sets up its own state (via the API when the app has one, it's faster than clicking) and doesn't rely on another test's leftovers or on test order. Use unique values (the run tag or a timestamp) for anything created.
- Keep each test focused on one behaviour; a single test with fifteen assertions across five pages is hard to read when it fails.

## Known bugs

Write the test for the correct behaviour and mark it:

```ts
// F1: display name is not saved (webtest report 2026-10-21)
test('keeps the new display name after reload', async ({ page }) => {
  test.fail();
  // ...
});
```

Never write a test that asserts the buggy behaviour.

## Checking your own tests before you hand them over

Ask of each test: if I broke the feature in the most likely way, would this fail? If the answer is no, strengthen the assertion. When the app runs locally and you can change code, a quick way to be sure is to break the feature on purpose (comment out the save, change the discount), run the test, see it fail, and revert.
