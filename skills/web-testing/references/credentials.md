# Test credentials

The rule behind everything here: a password you read ends up in the conversation, in logs and possibly in a shared transcript. So the scripts handle secrets, and you only ever see masked values. The store is `~/.webtest/credentials.json` (mode 600) plus saved sessions in `~/.webtest/sessions/`, keyed by origin (`https://app.example.com`) and an optional `--profile` (for example `admin` and `member`).

## 1. Check what already exists

```
node <skill>/scripts/creds.mjs status <url> [--profile p]
```

It reports a saved session (with its age), stored credentials (source and masked username) and the env var names the project's tests expect. Credentials are found in this order: env vars `WEBTEST_<HOST>_USERNAME` / `WEBTEST_<HOST>_PASSWORD` (host upper-cased, punctuation as `_`, e.g. `WEBTEST_APP_EXAMPLE_COM_PASSWORD` for `https://app.example.com`), then `WEBTEST_USERNAME` / `WEBTEST_PASSWORD`, then the store. If the user says the credentials are already in the environment under other names (like `E2E_USER` / `E2E_PASSWORD`), copy them into the store without looking at them: `node <skill>/scripts/creds.mjs from-env <url> --username-var E2E_USER --password-var E2E_PASSWORD`. Journeys then get them as `creds`, and tests keep reading the original names. Never `echo` or `printenv` them.

A saved session is the best option: no password is needed and SSO, 2FA and captchas are already done. Sessions expire; if a journey lands on the login page, the session is stale.

## 2. If something is missing, ask once, with the safe options

Offer the options that work where you are running. Use the question tool if you have one, otherwise a short message. Suggested wording:

> I need a test login for <origin>. The easiest safe ways:
> 1. **Attach a credentials file** with lines like `URL=…`, `USERNAME=…`, `PASSWORD=…` (any names ending in USER/EMAIL and PASS/PASSWORD work). I'll store it without reading the values.
> 2. **Sign in yourself in a browser window** (on your machine): run `node <skill>/scripts/creds.mjs login <url>`, sign in, press Enter. Only the session is saved, so I never see the password; this also works with SSO and 2FA.
> 3. **Type it in a terminal**: `node <skill>/scripts/creds.mjs set <url>` asks for the password with hidden input.
> 4. Set `WEBTEST_USERNAME` and `WEBTEST_PASSWORD` in the environment where I run.
>
> Please use a test account, not your personal one.

Options 2 and 3 need a terminal on the user's machine; in a hosted chat sandbox, offer 1 and 4. Pasting in chat is a last resort: if the user does it anyway, store it right away (write it to a file in the system temp directory, never inside the repo or the run folder, `creds.mjs import` it, delete the file), don't repeat it back, and suggest they change that password later because it is now in the chat history.

Don't guess passwords, don't try common defaults, and don't retry a failed login more than once; repeated failures can lock the account.

## 3. Importing a file the user attached

```
node <skill>/scripts/creds.mjs import <file> [--url <url>] [--profile p]
```

It accepts `KEY=VALUE` lines (`.env` style) or JSON. It picks the username from a key ending in USER, USERNAME, EMAIL or LOGIN, the password from one ending in PASS, PASSWORD or PWD, the URL from URL/ORIGIN/BASE_URL, and keeps any other keys (an OTP secret, a tenant id) as extras. It remembers the original key names, so tests that read `E2E_PASSWORD` get it under that name. The output lists the keys it read and the masked username. Don't open the file yourself.

## 4. Using credentials

- **Journeys** get a `creds` object (`username`, `password`, `extra`) and a `session.save()` call. Save the session right after a successful login so the next journeys and the tests skip the login screen. Never `console.log` the creds.
- **Tests** read credentials from env vars, never literals. `runtests.mjs` sets `WEBTEST_USERNAME` / `WEBTEST_PASSWORD` and the project's own names, from the `default` profile unless you pass `--profile <name>`. It does not pass the saved webtest session: tests sign in by themselves (or through the suite's setup project), so they still run in CI where that session doesn't exist. For any other command, wrap it: `node <skill>/scripts/creds.mjs exec <url> -- npx playwright test …`; its output is redacted.
- **Traces** in Playwright record typed values. `runtests.mjs` turns them off; don't turn them back on for login tests.
- Before sharing anything, run `creds.mjs scrub <paths…>`. It searches every file for every stored secret, including inside images' metadata and JSON. `--fix` redacts text files.

## 5. Cleaning up

`creds.mjs forget <url>` removes stored credentials and sessions for that origin. Mention it when the user is done with a test account.
