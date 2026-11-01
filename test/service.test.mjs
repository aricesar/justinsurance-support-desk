import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename, resolve } from 'node:path';
import { DeskService } from '../src/service.mjs';

const alpha = { id: 'agent-alpha', tenantId: 'alpha' };
const beta = { id: 'agent-beta', tenantId: 'beta' };
const event = { tenantId: 'alpha', ticketId: 101, eventId: 'event-1', body: 'Help <script>demo</script>' };
const conflict = error => error.status === 409;
function fixture(t, overrides = {}) {
  const calls = [];
  const provider = { send: async payload => { calls.push(payload); return { providerMessageId: 'delivered-1' }; },
    lookup: async () => ({ state: 'delivered', providerMessageId: 'delivered-1', count: 1 }), ...overrides };
  const s = new DeskService({ provider });
  t.after(() => s.close());
  return { s, calls };
}
function approve(s, body = 'Exact reply') {
  s.updateDraft(alpha, 101, body);
  s.approveDraft(alpha, 101);
}
function disk() {
  const directory = mkdtempSync(join(tmpdir(), 'desk-test-'));
  const cleanup = () => {
    if (dirname(directory) !== resolve(tmpdir()) || !basename(directory).startsWith('desk-test-')) {
      throw new Error('Unexpected cleanup path');
    }
    rmSync(directory, { recursive: true, force: true });
  };
  return { path: join(directory, 'desk.sqlite'), cleanup };
}

test('all service operations deny access to another organization without effects', async t => {
  const { s, calls } = fixture(t);
  const before = s.getTicket(beta, 202);
  for (const run of [() => s.getTicket(alpha, 202), () => s.updateDraft(alpha, 202, 'intrusion'),
    () => s.approveDraft(alpha, 202), () => s.handoff(alpha, 202)]) {
    assert.throws(run, error => error.status === 404);
  }
  for (const run of [() => s.sendReply(alpha, 202), () => s.sendReply(alpha, 202, { automatic: true }),
    () => s.reconcile(alpha, 202)]) await assert.rejects(run(), error => error.status === 404);
  assert.deepEqual(s.getTicket(beta, 202), before);
  assert.equal(calls.length, 0);
});

test('webhook deduplicates overlapping requests and scopes event identity to organization', async t => {
  const { s } = fixture(t);
  const responses = await Promise.all(Array.from({ length: 12 }, () => Promise.resolve().then(() => s.receiveWebhook(event))));
  assert.equal(responses.filter(result => !result.duplicate).length, 1);
  s.receiveWebhook({ ...event, tenantId: 'beta', ticketId: 202 });
  assert.equal(s.getTicket(alpha, 101).messages.length, 1);
  assert.equal(s.getTicket(beta, 202).messages.length, 1);
  assert.equal(s.getTicket(alpha, 101).audit.filter(a => a.action === 'inbound').length, 1);
});

test('event receipt, message and audit roll back together', t => {
  const { s } = fixture(t);
  s.db.exec("CREATE TRIGGER fail_inbound BEFORE INSERT ON audit WHEN NEW.action = 'inbound' BEGIN SELECT RAISE(ABORT, 'injected failure'); END");
  assert.throws(() => s.receiveWebhook(event), /injected failure/);
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM inbound_events').get().n, 0);
  assert.equal(s.getTicket(alpha, 101).messages.length, 0);
  s.db.exec('DROP TRIGGER fail_inbound');
  assert.equal(s.receiveWebhook(event).duplicate, false);
  assert.equal(s.getTicket(alpha, 101).messages.length, 1);
});

test('webhook identity is organization + event, not ticket + event', t => {
  const { s } = fixture(t);
  s.db.prepare("INSERT INTO tickets(id, tenant_id, contact, subject) VALUES (303, 'alpha', 'Demo', 'Another ticket')").run();
  s.receiveWebhook(event);
  assert.equal(s.receiveWebhook({ ...event, ticketId: 303, body: 'changed' }).duplicate, true);
  assert.equal(s.getTicket(alpha, 303).messages.length, 0);
});

test('malformed webhook and wrong ticket organization are rejected', t => {
  const { s } = fixture(t);
  for (const bad of [null, {}, { ...event, eventId: 1 }, { ...event, eventId: '' },
    { ...event, body: null }, { ...event, ticketId: '101' }, { ...event, tenantId: 'beta' }]) {
    assert.throws(() => s.receiveWebhook(bad), error => error.status === 400);
  }
  assert.equal(s.getTicket(alpha, 101).messages.length, 0);
});

test('webhook deduplication survives closing and reopening the same database', t => {
  const { path, cleanup } = disk();
  let s = new DeskService({ databasePath: path, provider: {} });
  t.after(() => { s.close(); cleanup(); });
  s.receiveWebhook(event);
  s.close(); s = new DeskService({ databasePath: path, provider: {} });
  assert.equal(s.receiveWebhook(event).duplicate, true);
  assert.equal(s.getTicket(alpha, 101).messages.length, 1);
  assert.equal(s.getTicket(alpha, 101).audit.length, 1);
});

test('sending requires explicit approval; approved body is byte-for-byte preserved', async t => {
  const { s, calls } = fixture(t);
  await assert.rejects(s.sendReply(alpha, 101), conflict);
  s.updateDraft(alpha, 101, '  Exact text\n<customer>  ');
  await assert.rejects(s.sendReply(alpha, 101), conflict);
  s.approveDraft(alpha, 101);
  const result = await s.sendReply(alpha, 101);
  assert.equal(calls[0].body, '  Exact text\n<customer>  ');
  assert.equal(result.attempts[0].body, calls[0].body);
  assert.equal(result.send_state, 'SENT');
  await assert.rejects(s.sendReply(alpha, 101), conflict);
  assert.equal(calls.length, 1);
});

test('optional observed version prevents approving/sending a stale UI version', async t => {
  const { s, calls } = fixture(t);
  approve(s, 'first');
  s.updateDraft(alpha, 101, 'second');
  assert.throws(() => s.approveDraft(alpha, 101, { version: 1 }), conflict);
  s.approveDraft(alpha, 101, { version: 2 });
  await assert.rejects(s.sendReply(alpha, 101, { version: 1 }), conflict);
  await s.sendReply(alpha, 101, { version: 2 });
  assert.equal(calls[0].body, 'second');
});

test('overlapping sends reserve one persistent attempt before external I/O', async t => {
  const response = Promise.withResolvers();
  let calls = 0;
  const { s } = fixture(t, { send: () => { calls++; return response.promise; } });
  approve(s);
  const first = s.sendReply(alpha, 101);
  const pending = s.getTicket(alpha, 101);
  assert.equal(pending.send_state, 'PENDING');
  assert.equal(pending.attempts.length, 1);
  assert.ok(pending.attempts[0].client_ref);
  await assert.rejects(s.sendReply(alpha, 101), conflict);
  response.resolve({ providerMessageId: 'one' });
  await first;
  assert.equal(calls, 1);
  assert.equal(s.getTicket(alpha, 101).attempts.length, 1);
});

test('reservation and audit failure prevent external dispatch', async t => {
  const { s, calls } = fixture(t);
  approve(s);
  s.db.exec("CREATE TRIGGER fail_reserve BEFORE INSERT ON audit WHEN NEW.action = 'dispatch_reserved' BEGIN SELECT RAISE(ABORT, 'reserve failure'); END");
  await assert.rejects(s.sendReply(alpha, 101), /reserve failure/);
  assert.equal(calls.length, 0);
  assert.equal(s.getTicket(alpha, 101).attempts.length, 0);
  assert.equal(s.getTicket(alpha, 101).send_state, 'DRAFT');
});

test('accepted then timeout is UNKNOWN, never retried, and reconciled by the same reference', async t => {
  const deliveries = [];
  const references = [];
  const { s } = fixture(t, { send: async p => { deliveries.push(p); throw new Error('timeout after acceptance'); },
    lookup: async ref => { references.push(ref); return { state: 'delivered', providerMessageId: 'accepted', count: 1 }; } });
  approve(s);
  const result = await s.sendReply(alpha, 101);
  assert.equal(result.send_state, 'UNKNOWN');
  await assert.rejects(s.sendReply(alpha, 101), conflict);
  const confirmed = await s.reconcile(alpha, 101);
  assert.equal(confirmed.send_state, 'SENT');
  assert.equal(confirmed.attempts[0].provider_id, 'accepted');
  assert.deepEqual(references, [deliveries[0].clientRef]);
  assert.equal(deliveries.length, 1);
});

for (const mode of ['not_found', 'lookup_error', 'invalid_response']) {
  test(`inconclusive ${mode} keeps UNKNOWN and blocks even a new approved version`, async t => {
    let sends = 0;
    const { s } = fixture(t, { send: async () => { sends++; throw new Error('connection lost'); },
      lookup: async () => { if (mode === 'lookup_error') throw new Error('offline');
        return mode === 'invalid_response' ? { state: 'delivered' } : { state: 'not_found' }; } });
    approve(s);
    await s.sendReply(alpha, 101);
    assert.equal((await s.reconcile(alpha, 101)).send_state, 'UNKNOWN');
    approve(s, 'A new draft must not bypass uncertain delivery');
    assert.equal(s.getTicket(alpha, 101).send_state, 'UNKNOWN');
    await assert.rejects(s.sendReply(alpha, 101), conflict);
    assert.equal(sends, 1);
    assert.ok(s.getTicket(alpha, 101).audit.some(a => a.action === 'lookup_inconclusive'));
  });
}

test('explicit not_accepted is FAILED with no automatic retry', async t => {
  let sends = 0;
  const { s } = fixture(t, { send: async () => { sends++; throw Object.assign(new Error('rejected'), { kind: 'not_accepted' }); } });
  approve(s);
  const failed = await s.sendReply(alpha, 101);
  assert.equal(failed.send_state, 'FAILED');
  assert.equal(failed.attempts[0].state, 'FAILED');
  await assert.rejects(s.sendReply(alpha, 101), conflict);
  assert.equal(sends, 1);
});

test('a malformed send acknowledgement cannot claim SENT', async t => {
  const { s } = fixture(t, { send: async () => ({}) });
  approve(s);
  assert.equal((await s.sendReply(alpha, 101)).send_state, 'UNKNOWN');
});

test('takeover blocks new automation but human can send an approved reply', async t => {
  const { s, calls } = fixture(t);
  approve(s);
  s.handoff(alpha, 101);
  await assert.rejects(s.sendReply(alpha, 101, { automatic: true }), conflict);
  assert.equal(calls.length, 0);
  assert.equal((await s.sendReply(alpha, 101)).send_state, 'SENT');
  assert.equal(calls.length, 1);
});

test('automation still needs approval before takeover', async t => {
  const { s, calls } = fixture(t);
  s.updateDraft(alpha, 101, 'Suggested text');
  await assert.rejects(s.sendReply(alpha, 101, { automatic: true }), conflict);
  s.approveDraft(alpha, 101);
  await s.sendReply(alpha, 101, { automatic: true });
  assert.equal(calls.length, 1);
});

test('takeover does not recall an already dispatched automated reply', async t => {
  const response = Promise.withResolvers();
  const { s } = fixture(t, { send: () => response.promise });
  approve(s);
  const inFlight = s.sendReply(alpha, 101, { automatic: true });
  s.handoff(alpha, 101);
  response.resolve({ providerMessageId: 'already-dispatched' });
  assert.equal((await inFlight).owner, 'human');
  approve(s, 'next');
  await assert.rejects(s.sendReply(alpha, 101, { automatic: true }), conflict);
});

test('edit during send preserves attempt text and late response does not mark new draft SENT', async t => {
  const response = Promise.withResolvers();
  let payload;
  const { s } = fixture(t, { send: p => { payload = p; return response.promise; } });
  approve(s, 'Original');
  const sending = s.sendReply(alpha, 101);
  s.updateDraft(alpha, 101, 'Replacement');
  response.resolve({ providerMessageId: 'original-delivered' });
  const ticket = await sending;
  assert.equal(payload.body, 'Original');
  assert.equal(ticket.draft, 'Replacement');
  assert.equal(ticket.approved_version, null);
  assert.equal(ticket.send_state, 'DRAFT');
  assert.equal(ticket.attempts[0].state, 'SENT');
});

test('late timeout and inconclusive lookup cannot undo confirmed delivery or a newer attempt', async t => {
  const firstSend = Promise.withResolvers();
  const lookup = Promise.withResolvers();
  let sends = 0;
  let lookups = 0;
  const { s } = fixture(t, { send: () => ++sends === 1 ? firstSend.promise : Promise.resolve({ providerMessageId: 'second' }),
    lookup: () => ++lookups === 1 ? lookup.promise : Promise.resolve({ state: 'delivered', providerMessageId: 'first' }) });
  approve(s, 'first');
  const sending = s.sendReply(alpha, 101);
  const staleLookup = s.reconcile(alpha, 101);
  await s.reconcile(alpha, 101);
  approve(s, 'second');
  await s.sendReply(alpha, 101);
  firstSend.reject(new Error('late timeout'));
  lookup.resolve({ state: 'not_found' });
  await Promise.all([sending, staleLookup]);
  const ticket = s.getTicket(alpha, 101);
  assert.equal(ticket.send_state, 'SENT');
  assert.deepEqual(ticket.attempts.map(a => a.state), ['SENT', 'SENT']);
  assert.equal(ticket.attempts[1].provider_id, 'second');
});

test('pending reservation survives restart as UNKNOWN; no second send and reconciliation remains possible', async t => {
  const { path, cleanup } = disk();
  let sends = 0;
  const provider = { send: async () => { sends++; return { providerMessageId: 'unexpected' }; },
    lookup: async ref => { assert.equal(ref, 'persisted-reference'); return { state: 'delivered', providerMessageId: 'original' }; } };
  let s = new DeskService({ databasePath: path, provider });
  t.after(() => { s.close(); cleanup(); });
  approve(s);
  s.db.prepare("INSERT INTO attempts(ticket_id, version, client_ref, body, state) VALUES (101, 1, 'persisted-reference', 'Exact reply', 'PENDING')").run();
  s.db.prepare("UPDATE tickets SET send_state = 'PENDING' WHERE id = 101").run();
  s.close(); s = new DeskService({ databasePath: path, provider });
  assert.equal(s.getTicket(alpha, 101).send_state, 'UNKNOWN');
  await assert.rejects(s.sendReply(alpha, 101), conflict);
  assert.equal((await s.reconcile(alpha, 101)).send_state, 'SENT');
  s.close(); s = new DeskService({ databasePath: path, provider });
  await assert.rejects(s.sendReply(alpha, 101), conflict);
  assert.equal(sends, 0);
});

test('failure saving provider result leaves reserved attempt blocked and recoverable', async t => {
  const { s, calls } = fixture(t);
  approve(s);
  s.db.exec("CREATE TRIGGER fail_result BEFORE INSERT ON audit WHEN NEW.action = 'dispatch_result' BEGIN SELECT RAISE(ABORT, 'result failure'); END");
  await assert.rejects(s.sendReply(alpha, 101), /result failure/);
  assert.equal(s.getTicket(alpha, 101).attempts[0].state, 'PENDING');
  await assert.rejects(s.sendReply(alpha, 101), conflict);
  assert.equal(calls.length, 1);
  assert.equal((await s.reconcile(alpha, 101)).send_state, 'SENT');
});

test('late explicit rejection can safely resolve a previously inconclusive lookup of the same in-flight attempt', async t => {
  const response = Promise.withResolvers();
  let sends = 0;
  const { s } = fixture(t, { send: () => { sends++; return response.promise; }, lookup: async () => ({ state: 'not_found' }) });
  approve(s);
  const sending = s.sendReply(alpha, 101);
  const inconclusive = await s.reconcile(alpha, 101);
  assert.equal(inconclusive.send_state, 'UNKNOWN');
  assert.equal(inconclusive.delivery_summary.blocks_new_dispatch, true);
  response.reject(Object.assign(new Error('explicit rejection'), { kind: 'not_accepted' }));
  const rejected = await sending;
  assert.equal(rejected.send_state, 'FAILED');
  assert.equal(rejected.delivery_summary.reason_code, 'provider_rejected_before_acceptance');
  assert.equal(rejected.attempts[0].client_ref, inconclusive.attempts[0].client_ref);
  assert.equal(sends, 1);
});

test('unsupported persisted state blocks a newer approved dispatch and requests investigation', async t => {
  const { s, calls } = fixture(t);
  approve(s, 'first');
  await s.sendReply(alpha, 101);
  s.db.exec("UPDATE attempts SET state = 'unsupported' WHERE ticket_id = 101");
  approve(s, 'new approved draft');
  await assert.rejects(s.sendReply(alpha, 101), conflict);
  assert.equal(calls.length, 1);
  const result = s.getTicket(alpha, 101).delivery_summary;
  assert.equal(result.blocks_new_dispatch, true);
  assert.equal(result.can_check_delivery, false);
});
