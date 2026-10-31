import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, basename, resolve, join } from 'node:path';
import { DeskService } from '../src/service.mjs';

const alpha = { id: 'agent-alpha', tenantId: 'alpha' };
function fixture(t, provider = {}) {
  const service = new DeskService({ provider });
  t.after(() => service.close());
  return service;
}

test('observed draft version rejects a lost update while legacy save requests still work', t => {
  const s = fixture(t);
  s.updateDraft(alpha, 101, 'first agent', { version: 0 });
  assert.throws(() => s.updateDraft(alpha, 101, 'stale second agent', { version: 0 }), e => e.status === 409);
  assert.equal(s.getTicket(alpha, 101).draft, 'first agent');
  assert.equal(s.getTicket(alpha, 101).version, 1);
  assert.equal(s.updateDraft(alpha, 101, 'legacy API caller').version, 2);
});

test('version types and reply byte limits are validated without modifying state', async t => {
  const s = fixture(t);
  s.updateDraft(alpha, 101, 'saved');
  for (const version of [null, -1, 1.5, '1', {}, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => s.updateDraft(alpha, 101, 'bad', { version }), e => e.status === 400);
    assert.throws(() => s.approveDraft(alpha, 101, { version }), e => e.status === 400);
    await assert.rejects(s.sendReply(alpha, 101, { version }), e => e.status === 400);
  }
  assert.throws(() => s.updateDraft(alpha, 101, '\u00E1'.repeat(51000)), e => e.status === 413);
  assert.equal(s.getTicket(alpha, 101).draft, 'saved');
  assert.equal(s.getTicket(alpha, 101).audit.length, 1);
});

test('attempt times and structured audit explain uncertainty without copying message text', async t => {
  const s = fixture(t, { send: async () => { throw Object.assign(new Error('private-provider-error'), { name: 'TimeoutError' }); },
    lookup: async () => ({ state: 'not_found' }) });
  s.updateDraft(alpha, 101, 'private-body-marker-123');
  s.approveDraft(alpha, 101);
  const unknown = await s.sendReply(alpha, 101);
  assert.ok(Number.isFinite(Date.parse(unknown.attempts[0].created_at)));
  assert.ok(Number.isFinite(Date.parse(unknown.attempts[0].updated_at)));
  assert.equal(unknown.attempts[0].last_checked_at, null);
  const checked = await s.reconcile(alpha, 101);
  assert.ok(Number.isFinite(Date.parse(checked.attempts[0].last_checked_at)));
  const result = checked.audit.find(entry => entry.action === 'dispatch_result');
  assert.equal(result.tenant_id, 'alpha');
  assert.equal(result.actor_id, 'agent-alpha');
  assert.equal(result.version, 1);
  assert.equal(result.client_ref, checked.attempts[0].client_ref);
  assert.equal(result.outcome, 'UNKNOWN');
  assert.equal(result.reason, 'provider_timeout');
  assert.equal(checked.audit.at(-1).reason, 'lookup_not_found');
  assert.equal(JSON.stringify(checked.audit).includes('private-body-marker-123'), false);
  assert.equal(JSON.stringify(checked.audit).includes('private-provider-error'), false);
});

test('query indexes avoid full-table scans and temporary sorting for critical reads', t => {
  const s = fixture(t);
  for (const sql of ["SELECT * FROM tickets WHERE tenant_id = 'alpha' ORDER BY id",
    'SELECT * FROM messages WHERE ticket_id = 101 ORDER BY id',
    'SELECT * FROM audit WHERE ticket_id = 101 ORDER BY id',
    "SELECT * FROM attempts WHERE ticket_id = 101 AND state IN ('PENDING', 'UNKNOWN') ORDER BY id DESC LIMIT 1"]) {
    const details = s.db.prepare('EXPLAIN QUERY PLAN ' + sql).all().map(row => row.detail).join('; ');
    assert.match(details, /SEARCH/);
    assert.doesNotMatch(details, /SCAN |TEMP B-TREE/);
  }
});

test('legacy schema migration preserves data, unknown historical times and runs backfill only once', t => {
  const directory = mkdtempSync(join(tmpdir(), 'desk-migration-'));
  const path = join(directory, 'desk.sqlite');
  const old = new DatabaseSync(path);
  old.exec(`
    CREATE TABLE tickets (id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, contact TEXT NOT NULL,
      subject TEXT NOT NULL, owner TEXT NOT NULL DEFAULT 'automation', draft TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 0, approved_version INTEGER, send_state TEXT NOT NULL DEFAULT 'DRAFT');
    CREATE TABLE messages (id INTEGER PRIMARY KEY, ticket_id INTEGER NOT NULL, event_id TEXT NOT NULL, body TEXT NOT NULL);
    CREATE TABLE attempts (id INTEGER PRIMARY KEY, ticket_id INTEGER NOT NULL, version INTEGER NOT NULL,
      client_ref TEXT NOT NULL UNIQUE, body TEXT NOT NULL, state TEXT NOT NULL, provider_id TEXT, UNIQUE(ticket_id, version));
    CREATE TABLE audit (id INTEGER PRIMARY KEY, ticket_id INTEGER NOT NULL, action TEXT NOT NULL,
      detail TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    INSERT INTO tickets(id,tenant_id,contact,subject,draft,version,send_state) VALUES (101,'alpha','Legacy','Preserved','old reply',1,'UNKNOWN');
    INSERT INTO messages(ticket_id,event_id,body) VALUES (101,'legacy-event','old inbound');
    INSERT INTO attempts(ticket_id,version,client_ref,body,state) VALUES (101,1,'legacy-ref','old reply','UNKNOWN');
    INSERT INTO audit(ticket_id,action,detail,created_at) VALUES (101,'inbound','legacy-event','2026-01-01 00:00:00');
  `);
  old.close();
  let s = new DeskService({ databasePath: path, provider: {} });
  t.after(() => {
    s.close();
    if (dirname(directory) !== resolve(tmpdir()) || !basename(directory).startsWith('desk-migration-')) throw new Error('Unexpected cleanup path');
    rmSync(directory, { recursive: true, force: true });
  });
  const ticket = s.getTicket(alpha, 101);
  assert.equal(ticket.contact, 'Legacy');
  assert.equal(ticket.messages[0].body, 'old inbound');
  assert.equal(ticket.attempts[0].created_at, null);
  assert.equal(ticket.audit[0].created_at, '2026-01-01 00:00:00');
  assert.equal(ticket.audit[0].actor_id, null);
  assert.equal(ticket.audit[0].tenant_id, 'alpha');
  assert.equal(s.receiveWebhook({ tenantId: 'alpha', ticketId: 101, eventId: 'legacy-event', body: 'replay' }).duplicate, true);
  s.db.exec("CREATE TRIGGER reject_repeated_backfill BEFORE INSERT ON inbound_events BEGIN SELECT RAISE(ABORT, 'migration repeated'); END");
  s.close(); s = new DeskService({ databasePath: path, provider: {} });
  assert.equal(s.getTicket(alpha, 101).messages.length, 1);
  assert.equal(s.db.prepare('PRAGMA user_version').get().user_version, 1);
});
