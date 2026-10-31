# Verification record

Current follow-up result: **53 local tests passed**, including a clean source ZIP
extraction and browser checks described below. The first section records the
earlier implementation history; its 37-test result is historical.

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

At the initial implementation checkpoint, nothing had been submitted or published.
A private GitHub repository was created later at the candidate's request. Nothing
has been submitted to the company.

## Reliability follow-up — 2026-10-31

The follow-up started at 20:12:18 BRT. It fixes the review's UTF-8 reader defect
and unsaved-editor loss; adds optimistic draft saves, structured audit fields,
attempt times, one-time migration, query indexes and a Node 24 CI workflow.

`npm.cmd test`: **53 passed, 0 failed, 0 skipped**, exit 0; 6.345 seconds reported
by the runner. All original scenarios remain included. New checks cover every
UTF-8 byte split, actual chunked HTTP, malformed encoding, byte limits and 413
responses without a broken socket, optimistic save conflicts, scoped editor
buffers, structured audit without body/error leakage, legacy schema migration,
indexed query plans, fixed frontend asset routes and sanitized internal errors.

The updated source candidate was extracted into a clean directory and tested
again: **53 passed, 0 failed, 0 skipped**, exit 0; 6.389 seconds. No local Node
installation, database, Git metadata or preparation files are included in the ZIP.

The same separate HTTP diagnostic that previously corrupted a four-byte emoji
now preserved its original input exactly (`preservedExactly: true`).

Browser verification on a separate synthetic database confirmed: Unicode save,
explicit approval, disabled send with unsaved edits, draft preservation after
Refresh/takeover/identity switching/reconciliation, Beta-only inbox, explicit
discard, conflict rejection without lost text and reload guidance, new save
clearing approval, UNKNOWN to SENT reconciliation with one actual provider
delivery, and visible creation/update/check times plus structured audit.

The CI workflow is configured locally but has not run on GitHub. The tests were
executed on Windows; a Linux CI result is not claimed. No production deployment,
real GHL integration, load benchmark or automated full-browser suite was run.
Unsaved buffers remain memory-only and the conversation still groups inbound and
confirmed outbound messages rather than providing a chronological timeline.

At this verification checkpoint, the follow-up changes had not been committed
or pushed. Subsequent version-control activity does not change these test results.
Previous timing is historical: the additional review, Git activity and this
follow-up must all be included in the candidate's total active assessment time.
The earlier unmeasured duration remains unresolved.

At 20:22:46 BRT this follow-up had taken 10 minutes 28 seconds, including browser
checks and clean-package testing. Reserve approximately 11 minutes including
final packaging/closure, and add any subsequent work. Preview processes and the
temporary browser tab were closed after verification.

## English-language audit

Source identifiers, comments, UI messages, documentation and commit messages
were reviewed for English wording. Portuguese fixture phrases were replaced
with English text; explicit Unicode test values still cover multibyte encoding.
The historical diagnostic is described in English without changing its recorded
outcome. After these edits, all 53 local tests passed again with no failures or
skips (6.397 seconds reported by the runner).
