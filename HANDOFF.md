# Support desk handoff

## Changes

All ticket operations enforce the server-resolved organization. Authenticated webhooks use durable `(tenant_id, event_id)` deduplication; receipt, message and audit commit atomically. Editing clears approval; dispatch requires the current approved version and reserves an immutable, unique `(ticket_id, version)` attempt before external I/O. No transaction spans the network. Takeover blocks new automation while preserving approved human sends. Late responses cannot downgrade confirmed delivery.

Saved drafts now have immutable revisions linked to approvals and attempts. A chronological timeline uses persisted local event order, with unknown legacy order shown separately. Migration 2 recovers available snapshots without inventing missing authors/times and rejects conflicting historical bodies. Earlier improvements preserve unsaved edits, validate UTF-8/bytes, detect stale saves and add structured audit, attempt times, indexes and safe errors. The mock, original routes and fixture identities remain unchanged.

DeliveryPolicy centralizes dispatch guards and evidence-based transitions; terminal outcomes resist late responses. The operator summary shows reason, reference, attempt/draft versions, elapsed time and next safe action. Unknown persisted states block dispatch. Displayed ages update locally without polling or sending.

## Run and verification

Use Node 24+. No dependencies need installation. From the source directory, in separate terminals:

```sh
npm run provider
npm start
npm test
```

Open http://127.0.0.1:4300. On Windows, `npm.cmd` is equivalent. The latest local suite passed **89 tests, zero failures/skips**, including transition/evidence rules, operator guidance, immutable revisions, isolation, concurrent sends and migration rollback. HTTP tests inspect the real mock ledger and kill/restart the app without resetting state. Two regressions failed before original fixes; seven feature tests failed before history implementation.

Browser checks verified history, safe text, isolation and the new summary: uncertainty, reconciliation preserving unsaved edits, previous-delivery/new-draft distinction and explicit rejection. One provider delivery was recorded. All corrections were merged into main as `5c4f3da`, which passed [Windows/Ubuntu CI](https://github.com/aricesar/justinsurance-support-desk/actions/runs/41255622252). See `VERIFICATION.md` and `DEMO.md`.

## Operator instructions

- Save, review the exact saved text, explicitly approve, then send. Suggestions never authorize delivery.
- PENDING/UNKNOWN may already be delivered. Never resend/recreate the reply. **Check delivery** queries the same stored reference. Restart changes interrupted PENDING attempts to UNKNOWN without replay.
- not_found, lookup failure and malformed evidence remain inconclusive. Consult again later or escalate with ticket/version/reference. No force-retry exists.
- SENT confirms that attempt. FAILED means this mock explicitly rejected before acceptance. That version is never retried; review/save/approve a new version only for an intentional new dispatch. A client timeout is always uncertain.
- A newer draft may be DRAFT while an older attempt is SENT. Consult attempt history and timestamps.
- **Saved draft history** is read-only. Historical approval does not authorize a newer draft. Earlier overwritten legacy versions may be unavailable.
- Conflicting save: copy local edits, **Discard local edits** to load the latest saved version, merge and save. In-memory edits do not survive browser reload/closure.

## Remaining risks and production plan

Single-process fixture; demo authentication, raw audit presentation, unpaginated history, incomplete legacy evidence and manual browser checks remain limitations. No distributed fencing, retry scheduler, production monitoring or backup policy. Persistent uncertainty requires human escalation.

Before a real GHL pilot, validate actual authentication/scopes, webhook signatures, tenant/contact mapping, rate limits, acceptance/error semantics and correlation/idempotency guarantees. Add real authorization, redacted logs/alerts, retention, backup/restore drills and coordinated workers. Start with a restricted pilot; rollback disables automation while retaining attempts for reconciliation. This exercise is not production-ready.

## AI and time

OpenAI Codex assisted code, tests and documentation. Accepted durable reservation instead of timeout retries, verified by concurrency/crash/ledger tests. The follow-up corrected two review findings and added regressions. No separate rejected suggestion is claimed.

Approximately **2 hours total**, conservatively counting elapsed time from the candidate-reported 19:25 BRT start through final delivery around 21:25 BRT on October 31, 2026, including setup, analysis, implementation, reviews, Git/CI, tests, documentation and submission. This includes pauses rather than subtracting unmeasured gaps. The three-hour cap is respected on that basis; no precise active-time measurement is claimed.
