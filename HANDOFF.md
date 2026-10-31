# Support desk handoff

## Changes

All ticket operations enforce the server-resolved organization. Authenticated webhooks use durable `(tenant_id, event_id)` deduplication; receipt, message and audit commit atomically. Editing clears approval; dispatch requires the current approved version and reserves an immutable, unique `(ticket_id, version)` attempt before external I/O. No transaction spans the network. Takeover blocks new automation while preserving approved human sends. Late responses cannot downgrade confirmed delivery.

The follow-up fixes fragmented UTF-8 input and preserves unsaved editor text during application refresh, takeover, reconciliation and ticket/identity switching. Optional observed versions on save/approve/send detect stale views; legacy requests remain supported. Byte limits, safe errors with request references, structured audit, attempt timestamps, query indexes and a one-time schema migration were added. Unknown historical timestamps remain null. The mock, original routes and fixture identities remain unchanged.

## Run and verification

Use Node 24+. No dependencies need installation. From the source directory, in separate terminals:

```sh
npm run provider
npm start
npm test
```

Open http://127.0.0.1:4300. On Windows, `npm.cmd` is equivalent. The latest local suite passed **53 tests, zero failures/skips**. It covers authorization, replay/rollback, approval, overlap, uncertain outcomes, lookup failures, takeover, crash/restart, UTF-8, byte limits, optimistic saves and migration. HTTP tests inspect the real mock ledger and kill/restart the app without resetting state. Two regression tests failed before the original fixes and now pass.

Browser checks verified preserved edits, approval clearing, organization switching, conflict handling and UNKNOWN-to-SENT reconciliation with one provider delivery. Details are in `VERIFICATION.md`. CI is configured for Node 24 on Windows/Ubuntu; no remote CI result is claimed.

## Operator instructions

- Save, review the exact saved text, explicitly approve, then send. Suggestions never authorize delivery.
- PENDING/UNKNOWN may already be delivered. Never resend/recreate the reply. **Check delivery** queries the same stored reference. Restart changes interrupted PENDING attempts to UNKNOWN without replay.
- not_found, lookup failure and malformed evidence remain inconclusive. Consult again later or escalate with ticket/version/reference. No force-retry exists.
- SENT confirms that attempt. FAILED means this mock explicitly rejected before acceptance. That version is never retried; review/save/approve a new version only for an intentional new dispatch. A client timeout is always uncertain.
- A newer draft may be DRAFT while an older attempt is SENT. Consult attempt history and timestamps.
- Conflicting save: copy local edits, **Discard local edits** to load the latest saved version, merge and save. In-memory edits do not survive browser reload/closure.

## Remaining risks and production plan

Single-process fixture; demo authentication, raw audit presentation, unpaginated history, grouped conversation ordering and manual browser checks remain limitations. No distributed fencing, retry scheduler, production monitoring or backup policy. Persistent uncertainty requires human escalation.

Before a real GHL pilot, validate actual authentication/scopes, webhook signatures, tenant/contact mapping, rate limits, acceptance/error semantics and correlation/idempotency guarantees. Add real authorization, redacted logs/alerts, retention, backup/restore drills and coordinated workers. Start with a restricted pilot; rollback disables automation while retaining attempts for reconciliation. This exercise is not production-ready.

## AI and time

OpenAI Codex assisted code, tests and documentation. Accepted durable reservation instead of timeout retries, verified by concurrency/crash/ledger tests. The follow-up corrected two review findings and added regressions. No separate rejected suggestion is claimed.

Initial implementation was approximately 11 minutes plus one measured preparation minute. Review, Git activity and this follow-up add time; earlier analysis/installation was unmeasured. `VERIFICATION.md` records checkpoints; no exact total is claimed. These follow-up changes remain local, with no company submission.
