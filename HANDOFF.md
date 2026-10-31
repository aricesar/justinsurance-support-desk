# Support desk handoff

## Changes and ownership

All ticket operations authorize using the server-resolved organization. Webhook authentication remains at HTTP ingress. A durable `(tenant_id, event_id)` receipt, customer message and audit entry commit together. Existing inbound history is backfilled into the receipt registry; historical duplicates are not deleted.

Editing creates a new draft version and clears approval. Send requires the current approved version. The UI separately shows the exact saved text; optional `version` on approval/send rejects stale views while preserving existing `{}` requests. Before external I/O, a short transaction reserves a unique `(ticket_id, version)` attempt with immutable body and correlation reference. No transaction spans network I/O. The provider does not deduplicate requests.

Takeover blocks subsequent automation dispatches in server code; approved human replies remain possible. Already-dispatched messages are not recalled. Confirmed attempts cannot be downgraded by late responses. Editing during dispatch preserves the original attempt and cannot mark the replacement draft as delivered. The unchanged mock and public routes/fixture identities are preserved.

## Verification

Node 24.22.2, npm 11.19.1, native SQLite 3.53.4; no dependencies added. From a clean source directory:

```sh
npm run provider
# separate terminal:
npm start
# separate terminal:
npm test
```

Before application changes, `node --test test/regression.test.mjs` failed both new tests: cross-organization read and edited draft sent without reapproval. After correction both passed. The original two smoke tests also remain green. Full-suite results and exact scope are in `VERIFICATION.md`.

Tests cover authorization, ingress authentication, scoped replay, rollback, approval, overlapping sends, persisted reservation, uncertain outcomes, failed lookup/not_found, explicit rejection, takeover, edits/late responses and recovery. HTTP tests inspect the actual mock ledger and kill/restart the application after acceptance without deleting state. Browser checks additionally verified unsaved-edit blocking, approval clearing, UNKNOWN to SENT reconciliation, organization switching and literal HTML-like customer text.

## Operator instructions

- `DRAFT`: review saved text, approve its version, then send. A suggestion is never approval.
- `PENDING` / `UNKNOWN`: delivery may have occurred. Do not resend or recreate the reply. Use **Check delivery**, which queries the stored reference. Restart converts interrupted PENDING attempts to UNKNOWN and never dispatches them again.
- `not_found`, lookup errors and malformed evidence remain UNKNOWN. Repeat lookup later or escalate with ticket, version and reference. There is deliberately no force-retry/unlock action.
- `SENT`: provider evidence confirms that attempt. `FAILED`: this mock explicitly rejected before acceptance. That version is not retried; review/save and approve a new version only for an intentional new dispatch. The five-second client deadline is uncertain, never a safe failure.
- Attempt history is authoritative for older versions. A newer draft can remain DRAFT while an older attempt is SENT. **Take over** disables subsequent automation, not human approval/send.

## Remaining risks and production plan

This is a single-process local fixture, not production-ready. Browser checks were manual, not an automated cross-browser/accessibility suite. Demo identities/secrets, raw audit display, no distributed dispatch fencing, no retry scheduler, backup policy or historical-duplicate repair remain intentional limitations. Persistent inconclusive delivery requires human escalation.

Before a real GHL pilot, verify the actual API's authentication/scopes, webhook signatures/replays, organization/contact mapping, acceptance/error meanings, correlation/lookup and idempotency guarantees in a sandbox. Add real authorization, redacted structured logs, metrics/alerts for UNKNOWN age, rejected access and duplicate events, durable multi-worker coordination, retention/backups and failure drills. Start with a restricted pilot; rollback disables automation and preserves attempts for human reconciliation rather than replaying them.

## AI use and time

OpenAI Codex assisted analysis, code, tests and documentation. Accepted suggestion: durable reservation before dispatch instead of retrying on timeout. Verified with overlapping-send tests and the real-provider crash/ledger test. No separate rejected suggestion is claimed. A Windows test-cleanup ordering issue was corrected and the suite rerun.

Recorded implementation/testing/handoff/packaging: approximately 11 minutes; previous measured preparation: approximately 1 minute. Earlier analysis/installation was not measured and must be added to the candidate's total. An exact overall duration is not established; see `VERIFICATION.md`. Nothing was sent or published.
