import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DeskService } from '../src/service.mjs';

const alpha = { id: 'agent-alpha', tenantId: 'alpha' };
const beta = { id: 'agent-beta', tenantId: 'beta' };
function fixture(t, overrides = {}) {
  const calls = [];
  const provider = { send: async payload => { calls.push(payload); return { providerMessageId: 'one' }; },
    lookup: async () => ({ state: 'delivered', providerMessageId: 'one' }), ...overrides };
  const service = new DeskService({ provider });
  t.after(() => service.close());
  return { s: service, calls };
}

test('every saved draft remains available with exact text and its historical approvals', t => {
  const { s } = fixture(t);
  s.updateDraft(alpha, 101, '  First exact draft\n\u{1F642}  ');
  s.approveDraft(alpha, 101);
  const ticket = s.updateDraft(alpha, 101, 'Second draft');
  assert.ok(Array.isArray(ticket.revisions), 'saved revisions must be returned');
  assert.deepEqual(ticket.revisions.map(r => r.body), ['  First exact draft\n\u{1F642}  ', 'Second draft']);
  assert.equal(ticket.revisions[0].created_by, alpha.id);
  assert.ok(Number.isFinite(Date.parse(ticket.revisions[0].created_at)));
  assert.equal(ticket.revisions[0].approvals[0].actor_id, alpha.id);
  assert.equal(ticket.revisions[0].currently_approved, false);
  assert.equal(ticket.revisions[1].is_current, true);
  assert.equal(ticket.approved_version, null);
});

test('timeline interleaves inbound, dispatch and delivery events in stable recorded order', async t => {
  const { s } = fixture(t);
  s.receiveWebhook({ tenantId: 'alpha', ticketId: 101, eventId: 'first', body: 'Customer first' });
  s.updateDraft(alpha, 101, 'Agent reply');
  s.approveDraft(alpha, 101);
  await s.sendReply(alpha, 101);
  s.receiveWebhook({ tenantId: 'alpha', ticketId: 101, eventId: 'second', body: 'Customer follow-up' });
  const ticket = s.getTicket(alpha, 101);
  assert.ok(Array.isArray(ticket.timeline), 'chronological timeline must be returned');
  assert.deepEqual(ticket.timeline.filter(e => e.body !== null).map(e => e.body), [
    'Customer first', 'Agent reply', 'Customer follow-up'
  ]);
  assert.deepEqual(ticket.timeline.map(e => e.kind), ['inbound', 'draft_updated', 'approved', 'dispatch_reserved', 'dispatch_result', 'inbound']);
  assert.equal(ticket.timeline.find(e => e.kind === 'dispatch_reserved').state, 'PENDING');
  assert.equal(ticket.timeline.find(e => e.kind === 'dispatch_result').state, 'SENT');
  assert.deepEqual(ticket.timeline.map(e => e.sequence), [...ticket.timeline.map(e => e.sequence)].sort((a, b) => a - b));
  assert.equal(ticket.legacy_history.length, 0);
});

test('revision rows reject updates, deletes and replacement writes', t => {
  const { s } = fixture(t);
  s.updateDraft(alpha, 101, 'Immutable');
  const revision = s.getTicket(alpha, 101).revisions[0];
  assert.throws(() => s.db.prepare('UPDATE draft_revisions SET body = ? WHERE id = ?').run('tampered', revision.id), /immutable/i);
  assert.throws(() => s.db.prepare('DELETE FROM draft_revisions WHERE id = ?').run(revision.id), /immutable/i);
  assert.throws(() => s.db.prepare(`INSERT OR REPLACE INTO draft_revisions
    (id, tenant_id, ticket_id, version, body, source, created_by, created_at)
    VALUES (?, 'alpha', 101, 1, 'replaced', 'saved', 'other-agent', '2026-10-31T00:00:00Z')`).run(revision.id), /immutable/i);
  assert.equal(s.getTicket(alpha, 101).revisions[0].body, 'Immutable');
});

test('revision creation and the draft/audit update roll back together', t => {
  const { s } = fixture(t);
  s.db.exec("CREATE TRIGGER fail_draft BEFORE INSERT ON audit WHEN NEW.action = 'draft_updated' BEGIN SELECT RAISE(ABORT, 'injected draft failure'); END");
  assert.throws(() => s.updateDraft(alpha, 101, 'must not remain'), /injected draft failure/);
  const ticket = s.getTicket(alpha, 101);
  assert.equal(ticket.version, 0);
  assert.equal(ticket.revisions.length, 0);
  assert.equal(ticket.timeline.length, 0);
});

test('approval and attempt reference the immutable revision even when a newer draft is saved during dispatch', async t => {
  const response = Promise.withResolvers();
  let payload;
  const { s } = fixture(t, { send: p => { payload = p; return response.promise; } });
  s.updateDraft(alpha, 101, 'Approved original');
  s.approveDraft(alpha, 101);
  const sending = s.sendReply(alpha, 101);
  s.updateDraft(alpha, 101, 'New unapproved draft');
  response.resolve({ providerMessageId: 'original-delivered' });
  const ticket = await sending;
  const original = ticket.revisions[0];
  assert.equal(ticket.attempts[0].revision_id, original.id);
  assert.equal(ticket.audit.find(e => e.action === 'approved').revision_id, original.id);
  assert.equal(payload.body, original.body);
  assert.equal(ticket.send_state, 'DRAFT');
  assert.equal(ticket.revisions[1].currently_approved, false);
});

test('uncertain delivery and reconciliation add status events without duplicating the reply', async t => {
  let sends = 0;
  const { s } = fixture(t, { send: async () => { sends++; throw new Error('timeout'); } });
  s.updateDraft(alpha, 101, 'One reply');
  s.approveDraft(alpha, 101);
  await s.sendReply(alpha, 101);
  const ticket = await s.reconcile(alpha, 101);
  assert.equal(ticket.timeline.filter(e => e.kind === 'dispatch_reserved').length, 1);
  assert.equal(ticket.timeline.filter(e => e.body === 'One reply').length, 1);
  assert.deepEqual(ticket.timeline.filter(e => e.state).map(e => e.state), ['PENDING', 'UNKNOWN', 'SENT']);
  assert.equal(sends, 1);
});

test('revision history and timeline stay scoped to the authenticated organization', t => {
  const { s } = fixture(t);
  s.updateDraft(beta, 202, 'Beta-only history');
  assert.throws(() => s.getTicket(alpha, 202), e => e.status === 404);
  assert.equal(s.getTicket(alpha, 101).revisions.length, 0);
  assert.equal(s.getTicket(alpha, 101).timeline.length, 0);
  assert.equal(s.getTicket(beta, 202).revisions[0].body, 'Beta-only history');
});

test('database rejects cross-tenant revisions and mismatched attempt snapshots', t => {
  const { s } = fixture(t);
  s.updateDraft(alpha, 101, 'Alpha snapshot');
  const revision = s.getTicket(alpha, 101).revisions[0];
  assert.throws(() => s.db.prepare(`INSERT INTO draft_revisions
    (tenant_id, ticket_id, version, body, source) VALUES ('alpha', 202, 1, 'wrong tenant', 'legacy_current')`).run(), /FOREIGN KEY/);
  assert.throws(() => s.db.prepare(`INSERT INTO attempts(ticket_id, version, client_ref, body, state, revision_id)
    VALUES (202, 1, 'wrong-ticket', 'Alpha snapshot', 'PENDING', ?)`).run(revision.id), /revision mismatch/i);
  assert.throws(() => s.db.prepare(`INSERT INTO attempts(ticket_id, version, client_ref, body, state, revision_id)
    VALUES (101, 1, 'wrong-body', 'Unapproved body', 'PENDING', ?)`).run(revision.id), /revision mismatch/i);
});

test('timeline ordering remains stable when timestamps tie or the wall clock moves backwards', t => {
  const { s } = fixture(t);
  s.receiveWebhook({ tenantId: 'alpha', ticketId: 101, eventId: 'first', body: 'First' });
  s.updateDraft(alpha, 101, 'Second');
  s.approveDraft(alpha, 101);
  s.db.exec("UPDATE audit SET created_at = '2026-10-31T00:00:00Z'; UPDATE audit SET created_at = '2026-01-01T00:00:00Z' WHERE action = 'approved'");
  assert.deepEqual(s.getTicket(alpha, 101).timeline.map(e => e.kind), ['inbound', 'draft_updated', 'approved']);
});

test('inconsistent current draft cannot approve or send a different historical body', async t => {
  const { s, calls } = fixture(t);
  s.updateDraft(alpha, 101, 'Saved snapshot');
  s.approveDraft(alpha, 101);
  s.db.exec("UPDATE tickets SET draft = 'tampered body' WHERE id = 101");
  assert.throws(() => s.approveDraft(alpha, 101), e => e.status === 409);
  await assert.rejects(s.sendReply(alpha, 101), e => e.status === 409);
  assert.equal(calls.length, 0);
});
