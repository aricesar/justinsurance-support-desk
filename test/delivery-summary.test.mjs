import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deliverySummary } from '../src/delivery-summary.mjs';

const draft = { version: 2, approved_version: null, draft: 'New reply' };
const attempt = { id: 10, version: 2, state: 'UNKNOWN', client_ref: 'stable-ref', provider_id: null,
  created_at: '2026-10-31T12:00:00Z', updated_at: '2026-10-31T12:00:05Z', last_checked_at: null };
const summary = (ticket = draft, rows = [attempt], audit = []) => deliverySummary(ticket, { attempts: rows, audit });

test('summary distinguishes no draft, unapproved draft and an approved reply with no dispatch', () => {
  assert.equal(summary({ ...draft, draft: '' }, []).title, 'No reply prepared');
  assert.equal(summary(draft, []).title, 'Reply awaiting approval');
  const ready = summary({ ...draft, approved_version: 2 }, []);
  assert.equal(ready.title, 'Approved reply ready');
  assert.equal(ready.state, 'DRAFT');
  assert.equal(ready.attempt_id, null);
});

test('uncertain delivery prioritizes reconciliation with the same reference and blocks any newer reply', () => {
  const result = summary({ ...draft, version: 3, approved_version: 3 }, [attempt], [
    { attempt_id: 10, reason: 'lookup_not_found' }
  ]);
  assert.equal(result.attempt_version, 2);
  assert.equal(result.current_draft_version, 3);
  assert.equal(result.client_ref, 'stable-ref');
  assert.equal(result.blocks_new_dispatch, true);
  assert.equal(result.can_check_delivery, true);
  assert.equal(result.needs_attention, true);
  assert.match(result.warning, /Do not resend/);
  assert.match(result.next_action, /Check delivery/);
  assert.match(result.reason, /does not prove/);
});

test('pending summary never claims delivery or recommends a retry', () => {
  const result = summary(draft, [{ ...attempt, state: 'PENDING' }]);
  assert.equal(result.title, 'Delivery pending');
  assert.equal(result.blocks_new_dispatch, true);
  assert.match(result.explanation, /not confirmed/);
  assert.match(result.warning, /Do not start another dispatch/);
});

test('previous delivered reply cannot be mistaken for delivery of a newer draft', () => {
  const result = summary({ ...draft, version: 3 }, [{ ...attempt, state: 'SENT', provider_id: 'one' }]);
  assert.equal(result.title, 'Previous reply delivered');
  assert.match(result.explanation, /draft v3 has not been dispatched/);
  assert.match(result.next_action, /draft v3/);
  assert.equal(result.blocks_new_dispatch, false);
});

test('safe rejection guidance requires a deliberate new saved and approved version', () => {
  const result = summary(draft, [{ ...attempt, state: 'FAILED' }], [
    { attempt_id: 10, reason: 'provider_rejected_before_acceptance' }
  ]);
  assert.equal(result.title, 'Reply not accepted by provider');
  assert.match(result.next_action, /new version/);
  assert.match(result.warning, /cannot be retried/);
});

test('an older uncertain attempt takes precedence over a later terminal record', () => {
  const result = summary(draft, [attempt, { ...attempt, id: 11, state: 'SENT' }]);
  assert.equal(result.state, 'UNKNOWN');
  assert.equal(result.attempt_id, 10);
});

test('summary uses persisted timestamps only and does not copy raw provider errors or reply bodies', () => {
  const rows = [{ ...attempt, body: 'private reply body' }];
  const audit = [{ attempt_id: 10, reason: 'lookup_unavailable', detail: 'private provider exception' }];
  const result = summary(draft, rows, audit);
  assert.deepEqual(result, summary(draft, rows, audit));
  assert.equal(result.created_at, attempt.created_at);
  assert.equal(result.last_checked_at, null);
  assert.equal(JSON.stringify(result).includes('private'), false);
  assert.match(result.reason, /unavailable/);
});

test('an unsupported persisted state requests investigation rather than offering an unsupported lookup', () => {
  const result = summary(draft, [{ ...attempt, state: 'unsupported' }]);
  assert.equal(result.needs_attention, true);
  assert.equal(result.blocks_new_dispatch, true);
  assert.equal(result.can_check_delivery, false);
  assert.match(result.next_action, /Escalate/);
});
