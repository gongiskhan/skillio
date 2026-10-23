# results.json

`report.mjs init` writes the skeleton from the journey manifests. You fill in the fields marked "you". `report.mjs build` refuses to build until the rules at the end hold. Paths are relative to the run directory, except test files, which are relative to the repo.

```json
{
  "schema": "webtest/1",
  "target": {
    "url": "http://localhost:3000",
    "environment": "local",
    "repo": "/path/to/repo",
    "changeset": { "kind": "commit", "ref": "22f7506" }
  },
  "scope": "you: what was tested and why, two or three sentences",
  "snapshots": [
    { "url": "https://example.com/", "viewport": "mobile", "status": 200, "screenshot": "snap/home-mobile.jpg", "consoleErrors": 0, "failedRequests": 1, "file": "snap/home-mobile.json" }
  ],
  "journeys": [
    {
      "id": "settings",
      "title": "Change display name",
      "why": "you: why this journey matters",
      "status": "you: pass | fail | blocked",
      "video": "evidence/settings/video.webm",
      "steps": [
        {
          "n": 2,
          "title": "Save a new name",
          "expect": "Message 'Changes saved.' and the new name after reload",
          "screenshot": "evidence/settings/02-save-a-new-name.jpg",
          "checks": [{ "desc": "name persists after reload", "ok": false, "detail": "field shows Demo User" }],
          "seen": "you: true only if you opened this screenshot",
          "verdict": "you: pass | fail | unclear",
          "observed": "you: what the screenshot and checks show (required unless pass)"
        }
      ]
    }
  ],
  "findings": [
    {
      "id": "F1",
      "severity": "major",
      "title": "Display name is not saved",
      "page": "/account/settings",
      "journey": "settings",
      "step": 2,
      "details": "After 'Changes saved.' and a reload the field shows the old name.",
      "evidence": ["evidence/settings/02-save-a-new-name.jpg"],
      "test": "tests/e2e/settings.spec.ts › keeps the new name after reload"
    }
  ],
  "tests": {
    "dir": "tests/e2e",
    "added": [
      { "file": "tests/e2e/settings.spec.ts", "titles": ["keeps the new name after reload"], "knownFailure": true }
    ],
    "skippedAsCovered": [{ "journey": "sign-in", "by": "tests/e2e/login.spec.ts › user can sign in" }],
    "run": "written by runtests.mjs"
  },
  "summary": "you: two or three plain sentences, the verdict first"
}
```

Set `tests` to `null` for evidence-only runs (no repo).

## Severity

- **critical**: a core task is impossible or data is lost or exposed (can't sign in, checkout fails, wrong account's data shown).
- **major**: a feature gives wrong results or fails in a common case (wrong total, a save that doesn't save, a 500 on a normal form, a button users can't reach).
- **minor**: wrong in an edge case, or works with friction (missing validation message, flaky behaviour, console error with no visible effect, broken secondary image).
- **cosmetic**: visual polish with no effect on the task (misalignment, inconsistent spacing).

## Rules the build enforces

- Every step has a verdict and an existing screenshot. A step marked `pass` must have `seen: true` or only passing checks.
- A step that errored, or a journey with a failed step, can't be marked pass.
- Any verdict other than `pass` needs `observed`.
- Every finding has a unique id, a severity from the scale, a title and evidence files that exist.
- Every test file listed exists, and if tests were added they were run.
- `summary` is not empty, and the run has at least one journey or page snapshot.
