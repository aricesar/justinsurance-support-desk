# Verification record

Current result: **89 local tests passed** for the delivery policy/operator summary.
Earlier 37- and 53-test results below describe previous implementation stages.

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

At that checkpoint, the CI workflow had not run on GitHub. Those local tests were
executed on Windows. No production deployment,
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

## Published baseline CI

Published commit `7f6ba4fc39f0ec06fde6badd507ed20af2289ca1` passed both Windows and
Ubuntu GitHub Actions jobs, including npm test. Run: [41252426945](https://github.com/aricesar/justinsurance-support-desk/actions/runs/41252426945).
This result applies to the 53-test baseline, not the subsequent local enhancement.

## Timeline and immutable revision enhancement

Started 2026-10-31 at 20:41:48 BRT. The bounded change adds immutable saved-draft
snapshots, revision-linked approvals/attempts, a chronological timeline and a
schema-version-2 migration. Existing routes and response fields remain, with
revisions/timeline/legacy_history added to the authorized ticket response.

Before implementation, `node --test test/history.test.mjs` failed all seven new
feature cases (history-before.txt retained outside the source package). The
expanded `npm.cmd test` then passed **70 tests, zero failures/skips**, exit 0;
6.723 seconds reported by the runner. Additional coverage includes update/delete/
replacement rejection, atomic snapshot rollback, cross-tenant FK/link rejection,
in-flight edits, timestamp ties/clock reversal, old approval retention, version-1
migration/reopen, unknown legacy ordering and conflicting-snapshot rollback.
HTTP tests verify history references and persistence across actual process restart.

Browser verification on separate synthetic data confirmed:

- Revision 1's exact text and approval remain after revision 2 replaces it.
- Only revision 2 is current/actively approved; its attempt references that snapshot.
- The timeline shows inbound message, saves/approvals, dispatch, UNKNOWN, customer
  follow-up and lookup confirmation in recorded sequence.
- Confirmation does not add another reply body or send again: one ledger delivery.
- Unsaved local edits survive reconciliation; Beta has no Alpha timeline/revisions.
- HTML-like customer text remains literal, with zero injected image elements.

Migration recovers only available snapshots. Missing earlier overwritten versions,
original save times/authors and unrecorded ordering remain unknown. Conflicting
legacy bodies abort migration instead of silently replacing history. Timeline
sequence represents local processing order, not remote/provider occurrence time.
History remains unpaginated, and no remote CI result is claimed for this local
enhancement. No commit or push was performed for it during implementation.

The final source candidate was extracted into a clean directory and tested again:
**70 passed, 0 failed, 0 skipped**, exit 0; 6.842 seconds reported by the runner.
The source package contains 29 English-language source/documentation/workflow
files and excludes databases, Git metadata, dependencies and preparation files.
At 20:54:20 BRT, this stage had taken 12 minutes 32 seconds; reserve approximately
13 minutes including final packaging/closure. Add this stage to all earlier active
work; the previously unmeasured duration is still not represented as zero.

## Delivery policy and operator summary

Started 2026-10-31 at 20:59:34 BRT. This bounded follow-up centralizes dispatch
guards, outcome classification and allowed transitions in a pure DeliveryPolicy.
Persistence/network orchestration remain in the service. Transition checks use
the current stored attempt state; terminal evidence cannot be overwritten by late
results. Explicit rejection of the same in-flight send may resolve an earlier
inconclusive lookup. Unknown persisted states fail closed for new dispatches.

The ticket response adds a stable delivery_summary projection. The UI displays
reason, reference, reply/current-draft versions, absolute times, elapsed ages and
safe next action. Age display updates every 15 seconds without network polling.
It does not infer delivery from elapsed time or retry an uncertain attempt.

`npm.cmd test`: **89 passed, 0 failed, 0 skipped**, exit 0; 8.429 seconds reported
by the runner. New coverage exercises the transition/evidence matrix, forged or
unsupported transitions, takeover dispatch guards, terminal-state protection,
operator guidance across states, stable summary timestamps, missing/future ages,
SQLite UTC interpretation, late explicit rejection and unsupported persisted
state dispatch refusal. Existing service, migration, HTTP, real mock ledger and
actual crash/restart tests remain included. Fixed asset serving includes time.mjs.

Browser checks on separate synthetic databases confirmed no-attempt, awaiting
approval and approved states; UNKNOWN blocks repeat sends; Check delivery resolves
the same reference without losing unsaved edits; a new draft does not inherit
the previous reply's delivery; explicit rejection shows FAILED and disables
repeat send; Beta has its own empty summary. The unchanged provider ledger held
exactly one delivery after acceptance/timeout, lookup and a rejected second reply.
Screenshots and logs are retained outside the source package. Preview processes
and the temporary tab were closed. These are manual, not automated browser tests.

No schema change, dependency, route, fixture identity or mock behavior changed.
The new changes remain local at this checkpoint; no commit, push, company message
or submission was performed for this stage. Remote CI, real GHL, multi-process
workers and production/load verification are not claimed.

Clean source ZIP extraction: **89 passed, 0 failed, 0 skipped**, exit 0; 6.897
seconds reported by the runner. All 36 packaged files passed the English-language
scan; databases, dependencies, Git metadata and preparation files are excluded.
Application/test/workflow files were compared with the tested extraction before
final packaging. CONTRACT.md, package.json, mock provider, replay script and the
original smoke tests remain unchanged from the preceding implementation.
At 21:12:18 BRT this stage had taken 12 minutes 44 seconds. Reserve approximately
14 minutes including final packaging/closure. Add this and intervening reviews/
Git activity to earlier active work; the overall remaining budget is still not
verifiable because earlier analysis/setup time was not measured.

## Final publication and consolidated time

The earlier local-only statements above are historical checkpoints, superseded
by this publication record. Delivery-policy commit `3ea7e33c532bd4c891c589f9993169c2d34ca8d7`
was pushed to assessment-history. Its [CI run 41255577764](https://github.com/aricesar/justinsurance-support-desk/actions/runs/41255577764)
completed successfully on Windows and Ubuntu. Main now contains that full source
tree via merge `5c4f3daf7d627915060420d7e38af9e2609193ae`, preserving both initial
histories without force-push. Its [CI run 41255622252](https://github.com/aricesar/justinsurance-support-desk/actions/runs/41255622252)
also passed both platforms, including npm test. Timeline commit d7beed3 passed
[run 41254351328](https://github.com/aricesar/justinsurance-support-desk/actions/runs/41254351328)
on both platforms. The current full suite contains 89 passing tests.

The complete review link is [starter-original...assessment-history](https://github.com/aricesar/justinsurance-support-desk/compare/starter-original...assessment-history).
The original starter tag is preserved; solution-corrected is an older intermediate
version. The final documentation/PDF commit follows the verified code merge;
its own CI result must be inspected rather than inferred from that earlier run.

The candidate supplied the missing overall start: **19:25 BRT, October 31, 2026**.
Use **approximately two hours total**, conservatively counting wall-clock elapsed
time through delivery around 21:25 BRT, including setup, analysis, implementation,
tests, reviews, Git/CI, documentation, packaging and actual submission. This
includes gaps instead of inventing a retroactive active timer or excluding setup.
It supersedes the earlier unresolved-total notes. On that reported start and
conservative accounting, the total is below the 180-minute cap. The estimate is
not an independently measured minute-by-minute activity log. Stop by 22:25 BRT
if delivery encounters further problems; do not silently expand the allowance.

HANDOFF.md is rendered as HANDOFF.pdf with an explicit page break and checked as
two pages at readable font size. DEMO.md covers isolation, duplicate prevention,
uncertainty, actual process restart and takeover. The final ZIP includes code,
tests, documentation, the PDF and workflow; excludes databases, Git metadata and
dependencies. The repository remains private; no collaborator access or public
visibility is implied. The submission must provide an accessible archive rather
than relying only on private GitHub links.

Final artifact commit b45671e passed both Windows and Ubuntu jobs in
[main run 41255796614](https://github.com/aricesar/justinsurance-support-desk/actions/runs/41255796614)
and [assessment-history run 41255798903](https://github.com/aricesar/justinsurance-support-desk/actions/runs/41255798903).
Its exact source ZIP was extracted and tested: 89 passed, zero failures/skips.
The archived PDF was reopened with strict parsing and confirmed as two pages.

The first submission attempt through the existing Get on Board reply address
was rejected by Gmail's executable/archive policy. A Sent label alone did not
establish delivery; the immediate bounce was checked. Therefore that attempt
was not counted as a completed company submission. A source download link is
needed instead; the final submission receipt is retained outside the source ZIP.
