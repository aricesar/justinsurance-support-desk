import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DeliveryPolicy as policy } from '../src/delivery-policy.mjs';

const ticket = { owner: 'automation', draft: 'Approved exact text', version: 2, approved_version: 2 };
const conflict = error => error.status === 409;

test('dispatch policy requires current approval and rejects stale versions, unresolved outcomes and repeated attempts', () => {
  assert.doesNotThrow(() => policy.assertCanDispatch(ticket));
  for (const [row, options] of [
    [{ ...ticket, approved_version: 1 }, {}], [{ ...ticket, draft: '' }, {}],
    [ticket, { version: 1 }], [ticket, { hasUnresolved: true }], [ticket, { hasAttempt: true }],
    [ticket, { hasUnsupportedState: true }]
  ]) assert.throws(() => policy.assertCanDispatch(row, options), conflict);
});

test('takeover rejects automation while still allowing a new approved human dispatch', () => {
  const human = { ...ticket, owner: 'human' };
  assert.throws(() => policy.assertCanDispatch(human, { automatic: true }), conflict);
  assert.doesNotThrow(() => policy.assertCanDispatch(human, { automatic: false }));
});

test('dispatch and lookup outcomes require positive evidence before confirming delivery', () => {
  assert.equal(policy.fromSendResult({ providerMessageId: 'confirmed' }).state, 'SENT');
  for (const response of [null, {}, { providerMessageId: '' }]) assert.equal(policy.fromSendResult(response).state, 'UNKNOWN');
  assert.equal(policy.fromLookupResult({ state: 'delivered', providerMessageId: 'confirmed' }).state, 'SENT');
  for (const response of [null, {}, { state: 'delivered' }, { state: 'not_found' }]) {
    assert.equal(policy.fromLookupResult(response).state, 'UNKNOWN');
  }
  assert.equal(policy.fromLookupResult({ state: 'not_found' }).reason, 'lookup_not_found');
});

test('only explicit rejection before acceptance is a safe failure; timeouts and lost connections stay uncertain', () => {
  assert.equal(policy.fromSendError({ kind: 'not_accepted' }).state, 'FAILED');
  for (const error of [new Error('connection lost'), { name: 'TimeoutError' }, { name: 'AbortError' }, null]) {
    assert.equal(policy.fromSendError(error).state, 'UNKNOWN');
  }
  assert.equal(policy.fromLookupError().state, 'UNKNOWN');
  assert.equal(policy.fromInterruptedDispatch().state, 'UNKNOWN');
});

test('all valid outcomes preserve terminal evidence and resolve only pending or uncertain attempts', () => {
  const outcomes = [policy.fromSendResult({ providerMessageId: 'one' }), policy.fromSendError({ kind: 'not_accepted' }),
    policy.fromSendError(new Error()), policy.fromLookupResult({ state: 'delivered', providerMessageId: 'one' }),
    policy.fromLookupResult({ state: 'not_found' }), policy.fromLookupError(), policy.fromInterruptedDispatch()];
  for (const result of outcomes) {
    assert.equal(policy.shouldApplyTransition('PENDING', result), true);
    assert.equal(policy.shouldApplyTransition('UNKNOWN', result), true);
    assert.equal(policy.shouldApplyTransition('SENT', result), false);
    assert.equal(policy.shouldApplyTransition('FAILED', result), false);
  }
});

test('invalid transitions cannot manufacture confirmation, safe failure or an implicit retry', () => {
  for (const result of [
    { state: 'SENT', source: 'lookup', providerId: null },
    { state: 'SENT', source: 'recovery', providerId: 'invented' },
    { state: 'FAILED', source: 'lookup', notAccepted: true },
    { state: 'FAILED', source: 'send', notAccepted: false },
    { state: 'PENDING', source: 'send' }, { state: 'UNKNOWN', source: 'unsupported' }
  ]) assert.throws(() => policy.shouldApplyTransition('UNKNOWN', result), conflict);
  assert.throws(() => policy.shouldApplyTransition('unsupported', policy.fromLookupError()), conflict);
});
