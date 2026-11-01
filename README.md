# JustInsurance support-desk work sample

You are inheriting a small, unfinished support inbox. Make one customer-support workflow safe and usable. This is fictional assessment software. It uses synthetic data and is not work on our production system.

## Format and time limit

- Up to **3 hours of implementation**. Candidates selected to advance will have a **45-minute live walkthrough and change**. Stop at the limit and explain remaining work; do not hide extra hours. If setup blocks you, tell us before spending more than 20 minutes on it; setup assistance does not count against implementation time.
- **This assessment is unpaid.** Confirm that you are comfortable with these terms before starting. Participation does not guarantee an interview or a job offer. If you previously received a paid invitation, resolve those earlier terms with the recruiter before starting or continuing; this document does not silently replace an accepted paid arrangement.
- AI assistants, documentation, search, and your usual editor are allowed throughout. You may ask AI to generate, review, or debug code. You must understand and be able to change everything you submit. Do not delegate the assessment to another person.
- No paid AI subscription, real customer data, production credentials, HighLevel account, cloud deployment, or external message delivery is required.
- Same starter, requirements, time allowance, and core evaluation for every candidate. Clarifications that change the specification will be shared with everyone.

## Business context

JustInsurance needs a support desk connected to a CRM before its later exam, SCORM, and tutoring projects. Support agents must see their own customers' conversations, prepare replies, approve the exact text, and understand whether a message was actually delivered. Once a person takes over a conversation, automation must stop sending new replies.

This sample uses two fictional customer organizations, Alpha and Beta. They must never access each other's tickets. The mock provider is **GHL-like, not a specification or implementation of HighLevel's real API**. Judge behavior against the contract in `CONTRACT.md`, not assumptions about an external service.

## Run the starter

Use Node.js **24 or newer** (built-in SQLite). No npm dependencies or installation are needed. From this directory:

1. Terminal A: `npm run provider`
2. Terminal B: `npm start`
3. Open `http://127.0.0.1:4300`.
4. Terminal C: `npm run event` — run it twice to replay the same inbound event.
5. Run the two baseline tests with `npm test`.

The starter intentionally passes only simple smoke tests. **Green baseline tests do not mean the application meets the requirements.** You are expected to change application code and add meaningful tests. You may edit any application file. Preserve the public HTTP contract and provider semantics. You may use TypeScript or an alternative backend language if you prefer; document an equally simple run command and keep the same observable behavior. Framework migration and visual polish earn no extra credit.

SQLite files persist in `data/`. Stopping and starting the app must retain state. For a fresh local fixture, stop both processes, remove only this exercise's `data/` directory, then restart. Do not reset state to demonstrate restart recovery.

## Required behavior

1. **Safe inbound delivery.** A webhook replay must not create a second customer message or repeat its business effect, including overlapping requests and application restarts. Event identity is scoped to the organization: Alpha and Beta may both receive an event called `event-1`. The event write and its business change must succeed or fail together. Reject invalid webhook authentication.
2. **Customer isolation.** The authenticated server-side identity controls organization access. Guessing another ticket ID or adding a different `tenantId` to a request must not allow reading or changing that ticket, its messages, audit history, approval, ownership, or delivery. Do not fix this only by hiding UI controls.
3. **Exact approval.** A saved draft needs explicit human approval before it can be sent. Editing it invalidates that approval. A repeated click or overlapping send request must not send the same approved version twice. AI-generated text has no special authority.
4. **Honest delivery and recovery.** The provider may accept a message but return a timeout. Do not automatically resend an uncertain delivery or call it sent without evidence. Persist an operator-visible `UNKNOWN` (or equivalent) state and a reference that can be reconciled. A restart after recording an attempt must not cause a second send. Allow the operator to check delivery; when the provider confirms the same attempt was delivered, resolve it without resending. A provider `not_found` response is inconclusive and must not authorize a blind retry. A documented, explicit rejection before acceptance can be shown as a safe failure; a sophisticated retry scheduler is not required.
5. **Human takeover.** Once takeover commits, a new automation dispatch must be refused by server-side code. The human agent can still send a properly approved reply. You do not need to recall a message already dispatched before takeover.
6. **Usable handoff.** The supplied inbox must show conversation, owner, current draft/approval, delivery status, and an audit trail that explains significant actions and unresolved failures. A support agent should know the next safe action. Keep untrusted customer text rendered as text, not executable HTML.

All behavior above is in scope for evaluation. We may vary IDs, timing, event bodies and request order; there are no undisclosed feature requirements. If you cannot finish, submit working progress and explicitly identify the risk and next fix. A smaller honest implementation is preferable to unsupported claims of production readiness.

## Submission

Return a source ZIP or private repository with:

- Your changes and tests, with commands to start and test from a clean checkout. Exclude `data/`, real secrets and dependency folders.
- `HANDOFF.md`, at most two pages: what you fixed; exact checks run and results; remaining limitations; how an operator handles uncertain delivery; and how you would verify the real GHL integration before rollout.
- A short AI-use note: which tools you used, one suggestion you accepted or changed, and how you verified it. If there was no rejected suggestion, say so. We do not require private prompt history, account access, or AI-detector scores.
- Your approximate time spent. Commit history is welcome but not proof of authorship.

The live session includes showing a failure before a fix, tracing code and database state, and implementing one small change to the same workflow with AI allowed. We assess reasoning, verification, communication, and ownership—not typing speed or memorized syntax.

## What is not required

Do not build a full CRM, actual GHL OAuth, production authentication, a real LLM integration, SCORM, an avatar tutor, billing, analytics, or a cloud deployment. Explain any production limitations rather than trying to solve the entire roadmap in three hours.

## Candidate implementation notes

The commands above remain unchanged. On Windows PowerShell, `npm.cmd` can be used
instead of `npm`. No installation step is needed once Node.js 24+ is available.
Run commands from this project's directory. Use separate terminals for provider
and application; stop them with Ctrl+C. Keep both SQLite databases for restart
recovery checks. Never expose these fixture servers publicly.

`npm test` includes service regressions and HTTP tests. HTTP tests launch their own
application and unchanged mock provider on temporary loopback ports, use separate
temporary databases, and terminate only their own child processes. They need local
socket/process permissions and take roughly 10 seconds on this environment.

The UI displays the saved text separately from unsaved edits. Save, review,
explicitly approve, then send. Draft save, approval and send optionally accept `{ "version": N }`
to reject a stale UI view with 409; the original `{}` requests remain supported.
An unresolved attempt blocks any new dispatch on that ticket, including a newly
edited/approved version. `Check delivery` never sends. See `HANDOFF.md` for state
semantics, operator recovery, verification and production limitations.

### Reliability follow-up

- JSON bodies are limited to 100000 **bytes**, decoded without corrupting split
  UTF-8 characters, and must be objects. Invalid encoding is rejected.
- Unsaved edits are kept in memory per identity/ticket across the application's
  Refresh, takeover, reconciliation and ticket switching. They do not survive a
  browser reload/closure. **Discard local edits** explicitly reloads the saved text.
- The UI sends the version originally edited when saving. A conflicting update
  returns 409 and keeps the local text. Copy it, discard/reload the latest saved
  draft, then merge and save. Legacy requests without version remain supported.
- Attempts include `created_at`, `updated_at` and `last_checked_at`. Historical
  times that were never recorded remain null rather than being invented.
- Audit entries include tenant, actor, draft version, reference, outcome and
  reason. Technical errors return a request reference and a safe message; server
  error logs contain no request bodies, credentials or raw database errors.
- Schema version 1 adds audit/time columns and query indexes, and backfills the
  event receipt registry once. Existing data and unresolved attempts are retained.
- `.github/workflows/test.yml` configures Node 24 tests on Ubuntu and Windows,
  read-only repository permissions and no dependency-install step. It runs after
  the workflow is pushed; configuring it locally does not prove a remote run.

### Timeline and immutable saved revisions

Every new draft save creates a read-only revision with its exact text, author and
save time in the same transaction as the current draft and audit update. Approval
and dispatch reference that revision. A later edit clears active approval while
retaining the previous text and historical approval record. **Saved draft history**
shows available versions, approval events and associated dispatch attempts.

The conversation timeline interleaves inbound messages, saved/approved drafts,
dispatch and delivery events in persisted local processing order. Its sequence
remains stable across restarts and tied/backwards timestamps. Dispatch appears
as PENDING; later UNKNOWN/SENT entries update the history without adding a second
copy of the reply. Timestamps show desk processing time, not provider event time.

`GET /api/tickets/:id` retains its existing fields and adds `revisions`, `timeline`
and `legacy_history`. These fields use the same server-side tenant authorization.
No new HTTP routes or write actions for historical revisions were added.

Schema migration 2 recovers available old snapshots from attempts/current drafts
and links existing audit evidence. Missing historical text, save times or authors
are not invented. Records without known ordering appear separately as **Earlier
history**. Conflicting bodies for the same old ticket/version abort migration
without overwriting those records and require investigation. New snapshots reject
updates, deletion and replacement; attempt links must match ticket/version/text.

History commit `d7beed3` passed [Windows/Ubuntu CI](https://github.com/aricesar/justinsurance-support-desk/actions/runs/41254351328).
The complete implementation is now on `main`; the original remains available as
`starter-original`. Use the [complete comparison](https://github.com/aricesar/justinsurance-support-desk/compare/starter-original...assessment-history)
to review all changes. The older `solution-corrected` tag is an intermediate version.

### Delivery policy and operator summary

`DeliveryPolicy` centralizes dispatch guards and provider-evidence classification.
The service retains short database transactions and provider I/O orchestration.
PENDING can become UNKNOWN, SENT or FAILED; UNKNOWN can stay UNKNOWN or resolve
to SENT/FAILED. SENT requires provider confirmation. FAILED requires an explicit
send rejection before acceptance; lookup absence never establishes failure.
SENT and FAILED are terminal. Transition checks read the current stored attempt
state so late responses cannot overwrite terminal evidence. Unsupported persisted
states block dispatch and require investigation. No transition authorizes retry.

The authorized ticket response adds stable `delivery_summary` data: attempt and
draft versions, reference, reason, timestamps, dispatch block and safe next action.
The UI presents this above the timeline, distinguishes a previously delivered
reply from a newer draft, and warns against resending uncertain attempts.
Elapsed ages refresh locally every 15 seconds; this does not poll the provider,
send messages or change persistence. Missing times remain unknown. Schema version
2, existing routes, fixture identities and provider semantics are unchanged.

### Final delivery

Delivery-policy commit `3ea7e33` passed [Windows/Ubuntu CI](https://github.com/aricesar/justinsurance-support-desk/actions/runs/41255577764),
with all 89 tests. `main` includes the complete implementation. `HANDOFF.pdf` is the
two-page rendering of `HANDOFF.md`; `DEMO.md` gives a short verification guide.
`ARCHITECTURE.md` explains workflow decisions, state transitions, transaction
boundaries, concurrency/restart behavior and the implementation/test map.
The final source ZIP can be reviewed independently of the private GitHub
repository. The submission provides the archive or its download link. GitHub links remain
private; repository access is not implied by possession of a link.
