import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename, resolve } from 'node:path';
import { DeskService } from '../src/service.mjs';

const alpha = { id: 'agent-alpha', tenantId: 'alpha' };
function legacyDatabase(t, { audit = true, conflict = false } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'desk-history-'));
  t.after(() => {
    if (dirname(directory) !== resolve(tmpdir()) || !basename(directory).startsWith('desk-history-')) throw new Error('Unexpected cleanup path');
    rmSync(directory, { recursive: true, force: true });
  });
  const path = join(directory, 'desk.sqlite');
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE tickets(id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, contact TEXT NOT NULL,
      subject TEXT NOT NULL, owner TEXT NOT NULL DEFAULT 'automation', draft TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 0, approved_version INTEGER, send_state TEXT NOT NULL DEFAULT 'DRAFT');
    CREATE TABLE messages(id INTEGER PRIMARY KEY, ticket_id INTEGER NOT NULL, event_id TEXT NOT NULL, body TEXT NOT NULL);
    CREATE TABLE attempts(id INTEGER PRIMARY KEY, ticket_id INTEGER NOT NULL, version INTEGER NOT NULL,
      client_ref TEXT NOT NULL UNIQUE, body TEXT NOT NULL, state TEXT NOT NULL, provider_id TEXT,
      created_at TEXT, updated_at TEXT, last_checked_at TEXT, UNIQUE(ticket_id,version));
    CREATE TABLE audit(id INTEGER PRIMARY KEY, ticket_id INTEGER NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, tenant_id TEXT, actor_id TEXT, version INTEGER,
      client_ref TEXT, outcome TEXT, reason TEXT, provider_id TEXT);
    CREATE TABLE inbound_events(tenant_id TEXT NOT NULL,event_id TEXT NOT NULL,ticket_id INTEGER NOT NULL,
      PRIMARY KEY(tenant_id,event_id));
    INSERT INTO tickets(id,tenant_id,contact,subject,draft,version,send_state)
      VALUES(101,'alpha','Existing contact','Existing conversation','Current draft',2,'UNKNOWN');
    INSERT INTO messages(id,ticket_id,event_id,body) VALUES (1,101,'old-1','Customer first'),(2,101,'old-2','Customer next');
    INSERT INTO inbound_events VALUES ('alpha','old-1',101),('alpha','old-2',101);
    INSERT INTO attempts(ticket_id,version,client_ref,body,state,created_at,updated_at)
      VALUES(101,1,'old-ref','Historical reply','UNKNOWN','2026-10-30T10:00:00Z','2026-10-30T10:00:01Z');
    PRAGMA user_version = 1;
  `);
  if (audit) db.exec(`
    INSERT INTO audit(id,ticket_id,action,detail,created_at,tenant_id,actor_id,version,client_ref,outcome) VALUES
      (1,101,'inbound','old-1','2026-10-30T09:00:00Z','alpha','webhook',0,NULL,NULL),
      (2,101,'draft_updated','saved','2026-10-30T09:30:00Z','alpha','agent-alpha',1,NULL,NULL),
      (3,101,'approved','approved','2026-10-30T09:31:00Z','alpha','agent-alpha',1,NULL,NULL),
      (4,101,'dispatch_reserved','reserved','2026-10-30T10:00:00Z','alpha','agent-alpha',1,'old-ref','PENDING'),
      (5,101,'dispatch_result','uncertain','2026-10-30T10:00:01Z','alpha','agent-alpha',1,'old-ref','UNKNOWN'),
      (6,101,'inbound','old-2','2026-10-30T11:00:00Z','alpha','webhook',1,NULL,NULL),
      (7,101,'draft_updated','saved next','2026-10-30T12:00:00Z','alpha','agent-alpha',2,NULL,NULL);
  `);
  if (conflict) db.exec('UPDATE tickets SET version = 1 WHERE id = 101');
  db.close();
  return path;
}
function closeAndCleanupBefore(t, path, provider) {
  // Nested test cleanup closes SQLite before the parent removes its directory.
  const service = new DeskService({ databasePath: path, provider });
  t.after(() => service.close());
  return service;
}

test('version-one upgrade recovers known snapshots and event order, without inventing missing versions or save times', async t => {
  const path = legacyDatabase(t);
  await t.test('migrate and reconcile without dispatching', async inner => {
    let sends = 0;
    const s = closeAndCleanupBefore(inner, path, { send: async () => { sends++; },
      lookup: async ref => { assert.equal(ref, 'old-ref'); return { state: 'delivered', providerMessageId: 'existing' }; } });
    const ticket = s.getTicket(alpha, 101);
    assert.deepEqual(ticket.revisions.map(r => r.body), ['Historical reply', 'Current draft']);
    assert.ok(ticket.revisions.every(r => r.created_at === null && r.created_by === null));
    assert.equal(ticket.revisions[0].approvals[0].actor_id, alpha.id);
    assert.equal(ticket.attempts[0].revision_id, ticket.revisions[0].id);
    assert.deepEqual(ticket.timeline.filter(e => e.body !== null).map(e => e.body), ['Customer first', 'Historical reply', 'Customer next']);
    assert.equal(ticket.legacy_history.length, 0);
    const result = await s.reconcile(alpha, 101);
    assert.equal(result.attempts[0].state, 'SENT');
    assert.equal(result.timeline.at(-1).revision_id, ticket.revisions[0].id);
    assert.equal(result.send_state, 'DRAFT');
    assert.equal(sends, 0);
  });
  await t.test('reopen retains snapshot IDs, approvals and timeline without rerunning migration', inner => {
    const s = closeAndCleanupBefore(inner, path, {});
    const ticket = s.getTicket(alpha, 101);
    assert.equal(ticket.revisions.length, 2);
    assert.equal(ticket.timeline.length, 8);
    assert.equal(ticket.revisions[0].approvals.length, 1);
    assert.equal(s.db.prepare('PRAGMA user_version').get().user_version, 2);
  });
});

test('legacy records without ordering evidence stay visible separately, including after reconciliation', async t => {
  const path = legacyDatabase(t, { audit: false });
  await t.test('preserve unknown order', async inner => {
    const s = closeAndCleanupBefore(inner, path, { lookup: async () => ({ state: 'delivered', providerMessageId: 'existing' }) });
    const ticket = s.getTicket(alpha, 101);
    assert.equal(ticket.timeline.length, 0);
    assert.equal(ticket.legacy_history.length, 3);
    assert.equal(ticket.legacy_history.find(e => e.kind === 'legacy_inbound').occurred_at, null);
    const result = await s.reconcile(alpha, 101);
    assert.equal(result.timeline.length, 1);
    assert.equal(result.legacy_history.find(e => e.kind === 'legacy_attempt').body, 'Historical reply');
    assert.equal(result.legacy_history.find(e => e.kind === 'legacy_attempt').state, 'SENT');
  });
});

test('conflicting legacy snapshots abort migration without overwriting original data', t => {
  const path = legacyDatabase(t, { conflict: true });
  assert.throws(() => new DeskService({ databasePath: path, provider: {} }), /Conflicting historical draft/);
  const db = new DatabaseSync(path);
  try {
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1);
    assert.equal(db.prepare('SELECT draft FROM tickets WHERE id = 101').get().draft, 'Current draft');
    assert.equal(db.prepare('SELECT body FROM attempts WHERE ticket_id = 101').get().body, 'Historical reply');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'draft_revisions'").get().n, 0);
  } finally { db.close(); }
});
