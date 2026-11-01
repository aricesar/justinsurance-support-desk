# Implementation logic and architecture

This is a single-process assessment application: JavaScript ES modules, native
Node.js SQLite and the existing browser interface. The design keeps business
decisions explicit without adding frameworks or dependencies. README.md explains
startup, HANDOFF.md covers operations/risks, and DEMO.md provides a walkthrough.

## Workflow and trust boundaries

1. **Inbound:** the HTTP layer authenticates the fixture webhook secret. The
   service validates the event's organization/ticket mapping. A receipt keyed by
   `(tenant_id, event_id)`, the message and its audit event commit together.
   Replays, including overlapping calls and restarts, have no second effect.
2. **Organization access:** bearer tokens resolve to fixed server-side actors.
   Ticket operations first authorize `(ticket_id, actor.tenantId)`; child history
   is read only after that check. A request body cannot select another actor's
   organization or turn the automation route into a human send.
3. **Draft and approval:** saving atomically increments the version, appends an
   immutable text snapshot and clears active approval. Approval references the
   current snapshot; dispatch requires that exact saved version. Optional observed
   versions reject stale saves, approvals and sends. Historical approval does not
   approve a later revision.
4. **Dispatch:** a short transaction checks ownership, approval and previous
   attempts, then reserves PENDING with a stable client reference and exact text.
   `UNIQUE(ticket_id, version)` prevents duplicate reservations. The transaction
   commits before the provider call; the result is saved in another transaction.
5. **Recovery:** the operator checks the same persisted reference. Confirmation
   resolves that attempt without resending. Uncertainty blocks all new dispatches
   on the ticket, including newer approved drafts.

The provider does **not** deduplicate client references. Duplicate prevention
therefore depends on the durable reservation, not a retry or provider promise.

## Delivery state policy

| Current state | Allowed outcome | Required evidence |
|---|---|---|
| PENDING | UNKNOWN | Timeout, connection loss, invalid acknowledgement or interrupted process |
| UNKNOWN | UNKNOWN | not_found, unavailable lookup or inconclusive response |
| PENDING / UNKNOWN | SENT | Send acknowledgement or lookup confirmation with a provider message ID |
| PENDING / UNKNOWN | FAILED | Explicit rejection before acceptance from that same send |
| SENT / FAILED | No further transition | Terminal evidence is retained; late results are ignored |

An in-flight send's late explicit rejection can resolve an earlier inconclusive
lookup. A lookup's not_found cannot establish FAILED or authorize retry. FAILED
does not retry its version; an intentional new reply requires a new save and
approval. Unsupported stored states block dispatch and require investigation.

## Transactions, concurrency and restart

SQLite writes use synchronous `BEGIN IMMEDIATE` transactions, with rollback on
failure, foreign keys, WAL and a bounded busy timeout. No transaction remains
open during network I/O. Failure to reserve means no external send; failure to
persist the result leaves the existing reservation blocked and recoverable.

Results re-read the stored attempt state before a conditional update, preventing
late timeout/lookup responses from downgrading terminal evidence. Each attempt
retains its own revision/text: editing during a send cannot change that payload,
and its late result cannot mark a newer draft delivered. Startup converts
interrupted PENDING attempts to UNKNOWN without replaying them.

Takeover commits ownership before subsequent dispatch checks. There is no await
between reservation and provider invocation in this single-process fixture, so
takeover cannot interleave there. It blocks new automation, permits an approved
human reply, and cannot recall a message already dispatched. Multiple workers
would require coordinated dispatch ownership/fencing beyond this design.

## Read models and operator experience

Audit IDs provide persisted local processing order even when timestamps tie or
move backwards. Timeline projection uses maps and linear passes over ticket
history; a reply body appears at dispatch reservation, with separate outcome
markers. Legacy records with unknown ordering remain separate. Migration 2
recovers available snapshots, rejects conflicting bodies and never invents
missing text, authors or times. Database guards reject revision mutation and
attempt links that disagree with a snapshot.

The delivery summary prioritizes unresolved attempts and distinguishes an older
delivered reply from a newer draft. It shows evidence, reference and safe next
action. Browser age updates are display-only. Unsaved edits are buffered per
identity/ticket in memory; customer text is rendered with textContent.

## Code and verification map

| Responsibility | Implementation | Relevant tests |
|---|---|---|
| HTTP identity, webhook authentication, validation | src/server.mjs, src/http-body.mjs, src/validation.mjs | test/http.test.mjs, test/http-body.test.mjs |
| Workflow orchestration and reservation | src/service.mjs | test/service.test.mjs, test/regression.test.mjs |
| Pure dispatch/transition policy | src/delivery-policy.mjs | test/delivery-policy.test.mjs |
| Persistence, migrations, immutable history | src/store.mjs, src/history.mjs | test/history.test.mjs, test/history-migration.test.mjs, test/improvements.test.mjs |
| Provider boundary | src/provider-client.mjs | test/http.test.mjs with the unchanged local provider |
| Summary and editor | src/delivery-summary.mjs, public/app.mjs, public/draft-editor.mjs, public/time.mjs | test/delivery-summary.test.mjs, test/draft-editor.test.mjs, test/time.test.mjs |

HTTP tests inspect the mock ledger as independent test evidence and kill/restart
their own processes. The application integrates only through send/lookup, never
the provider's inspection endpoint. The 89-test suite and manual browser evidence
are recorded in VERIFICATION.md; they do not prove production readiness.

Production would need real authentication/signatures, coordinated workers,
pagination/retention, observability and backup/restore verification. History is
currently unbounded, and browser checks are manual. No real GHL, LLM or cloud
integration is claimed.
