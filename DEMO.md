# Short demonstration guide

Allow 5-7 minutes. Use Node 24+ and synthetic local data only. Start the unchanged
provider with `npm run provider`, the desk with `npm start`, and open
http://127.0.0.1:4300. No dependency installation is required.

1. **Isolation:** sign in as Alpha, open ticket 101, then switch to Beta. Only
   ticket 202 is visible. The HTTP test "all HTTP operations enforce tenant
   isolation despite a forged tenantId" also verifies direct requests against
   every protected route, so isolation is enforced beyond the interface.
2. **Replay and overlapping dispatch:** run `npm run event` twice; the second
   response is duplicate and only one message is added. Save/approve exact text.
   The service/HTTP overlap tests verify one durable attempt and one provider
   delivery, even with concurrent calls. Editing invalidates approval.
3. **Uncertain delivery:** set the mock with `POST http://127.0.0.1:4301/control`,
   JSON `{"mode":"accept_then_timeout"}`. Send a newly saved/approved reply.
   UNKNOWN retains its reference and blocks another dispatch. Check delivery
   resolves the same attempt to SENT without sending again. Inspect the timeline,
   immutable revision and operator summary. not_found remains inconclusive.
4. **Restart recovery:** run `node --test test/http.test.mjs`. Its crash-recovery
   case selects accept_then_delay, waits for actual acceptance, kills/restarts
   only its own app process using the same database, and verifies the same
   reference, blocked repeat send, successful lookup and one ledger delivery.
   Do not delete/reset databases to demonstrate recovery.
5. **Takeover:** with a new approved version, click Take over. Automation is
   refused by the server; a human may send the approved saved text. The HTTP
   takeover test proves that a forged request body cannot bypass this policy.

Restore mock mode `{"mode":"normal"}` after the demonstration. The /deliveries
endpoint is test-only evidence; application integration uses only send/lookup.
Run `npm test` for all 89 checks, including not_found, explicit rejection,
lookup failure, stale versions, late results and history migration integrity.

Code anchors: src/service.mjs orchestrates short local transactions and external
I/O; src/delivery-policy.mjs defines evidence-based transitions; src/store.mjs
and src/history.mjs preserve reservations, constraints and immutable snapshots.
No network call runs inside a database transaction. There is no retry of UNKNOWN.

For the original failure demonstration, compare starter-original with the current
assessment-history branch. VERIFICATION.md records the two actual pre-fix
regression failures and seven pre-history feature failures; green smoke tests
alone did not establish compliance. Do not reset the working implementation.
