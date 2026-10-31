import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DeskService } from '../src/service.mjs';

const alpha = { id: 'agent-alpha', tenantId: 'alpha' };
test('regression: Alpha cannot read Beta ticket by guessing its ID', () => {
  const service = new DeskService({ provider: {} });
  try {
    assert.throws(() => service.getTicket(alpha, 202), e => e.status === 403 || e.status === 404);
  } finally { service.close(); }
});

test('regression: editing an approved draft requires approval again', async () => {
  const sent = [];
  const service = new DeskService({ provider: { send: async payload => {
    sent.push(payload); return { providerMessageId: 'one' };
  } } });
  try {
    service.updateDraft(alpha, 101, 'Approved text');
    service.approveDraft(alpha, 101);
    service.updateDraft(alpha, 101, 'Unapproved replacement');
    await assert.rejects(service.sendReply(alpha, 101), e => e.status === 409);
    assert.equal(sent.length, 0);
  } finally { service.close(); }
});
