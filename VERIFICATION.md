# Verification record

## Environment and commands

Windows x64; Node.js v24.22.2; npm 11.19.1; native SQLite 3.53.4.
No npm dependencies installed. Commands were run from the source directory with
the compatible Node executable on PATH (`npm.cmd` on Windows).

| Check | Actual result |
|---|---|
| Original `npm test`, before adding tests or changing application code | 2 passed, 0 failed |
| `node --test test/regression.test.mjs`, before application fixes | 0 passed, 2 failed; exit 1 |
| `npm test`, immediately after initial fixes | 4 passed, 0 failed |
| Expanded service suite, first run | 25 passed, 2 failed during Windows temporary-directory cleanup; cleanup was reordered to close SQLite first |
| Service + HTTP suite | 36 passed, 0 failed |
| Final `npm test`, including the real five-second deadline | 37 passed, 0 failed, 0 skipped; exit 0; 6.101 seconds reported by the runner |
| `npm test` from a clean extraction of the source candidate ZIP | 37 passed, 0 failed, 0 skipped; exit 0; 6.148 seconds reported by the runner |

The two original-defect failures were:

```text
regression: Alpha cannot read Beta ticket by guessing its ID
AssertionError: Missing expected exception.

regression: editing an approved draft requires approval again
AssertionError: Missing expected rejection.
```

The same two test bodies pass after the fixes. The original mock provider, contract,
fixture identities, replay script and smoke tests are retained. Raw execution logs
are retained separately in the candidate's local preparation folder, outside the
source package.

## Behavioral coverage

- Service tests: every cross-tenant operation, scoped webhook deduplication and
  restart, malformed inputs, transactional rollback, exact approval, stale observed
  versions, single reservation under overlap, reservation/result persistence
  failures, unknown outcomes, explicit rejection, not_found and failed/malformed
  lookup, takeover, edits during send and late responses after reconciliation.
- HTTP tests: bearer/webhook authentication, spoofed tenantId, every protected route,
  overlapping webhook/send requests, same event ID across tenants, 504 after
  acceptance, 503 before acceptance, automation's server-set flag, actual process
  kill/restart during accept_then_delay, preserved database state/reference and
  real five-second client deadline. Assertions inspect the mock's actual ledger;
  the application uses only the message send/lookup API.
- Manual browser checks on a separate synthetic database: saved-text review,
  disabled send for unsaved edits, approval cleared by save, UNKNOWN with a safe
  next action and disabled resend, reconciliation to SENT with exactly one ledger
  delivery, Beta-only inbox after identity switch, HTML-like customer text shown
  literally with zero injected image elements. These are not automated UI tests.

No real GHL integration, cloud deployment, production authorization, distributed
worker behavior, cross-browser matrix or load test was performed.

## Time accounting

- Earlier analysis and Node installation were performed but not measured as a
  consolidated active-work total. They are not counted as zero or excluded.
- Previous recorded preparation: 2026-10-31 19:39:53–19:40:48 BRT, 55 seconds;
  reserve approximately one minute.
- This implementation stage began at 2026-10-31 19:42:18 BRT (22:42:18 UTC).
- At 19:52:42 BRT, implementation, browser verification, documentation and clean
  extraction testing were complete: 10 minutes 24 seconds elapsed in this stage.
  Reserve approximately 11 minutes including final packaging/closure; later work
  must be added if performed. Preview child processes were stopped.
- Total remaining budget cannot be established without the earlier unmeasured
  duration. The limit is 180 minutes for all active work, including handoff.
  The candidate must add the earlier analysis/setup estimate before submission;
  this record does not assert a verified overall duration or compliance total.

No submission or external publication was performed.
