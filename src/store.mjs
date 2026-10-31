import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export class DeskError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function openStore(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 3000;
    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, contact TEXT NOT NULL,
      subject TEXT NOT NULL, owner TEXT NOT NULL DEFAULT 'automation',
      draft TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 0,
      approved_version INTEGER, send_state TEXT NOT NULL DEFAULT 'DRAFT'
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY, ticket_id INTEGER NOT NULL, event_id TEXT NOT NULL,
      body TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY, ticket_id INTEGER NOT NULL, action TEXT NOT NULL,
      detail TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS attempts (
      id INTEGER PRIMARY KEY, ticket_id INTEGER NOT NULL, version INTEGER NOT NULL,
      client_ref TEXT NOT NULL UNIQUE, body TEXT NOT NULL,
      state TEXT NOT NULL, provider_id TEXT,
      UNIQUE(ticket_id, version)
    );
    CREATE TABLE IF NOT EXISTS inbound_events (
      tenant_id TEXT NOT NULL, event_id TEXT NOT NULL, ticket_id INTEGER NOT NULL,
      PRIMARY KEY(tenant_id, event_id)
    );
    INSERT OR IGNORE INTO tickets(id, tenant_id, contact, subject) VALUES
      (101, 'alpha', 'Jordan Demo', 'Cannot resume my practice exam'),
      (202, 'beta', 'Casey Example', 'Course completion is missing');
  `);
  transaction(db, () => {
    if (db.prepare('PRAGMA user_version').get().user_version >= 1) return;
    // Existing rows keep NULL for historical times/actors we cannot reconstruct.
    for (const [table, columns] of Object.entries({
      attempts: { created_at: 'TEXT', updated_at: 'TEXT', last_checked_at: 'TEXT' },
      audit: { tenant_id: 'TEXT', actor_id: 'TEXT', version: 'INTEGER', client_ref: 'TEXT',
        outcome: 'TEXT', reason: 'TEXT', provider_id: 'TEXT' }
    })) {
      const present = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name));
      for (const [name, type] of Object.entries(columns)) {
        if (!present.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
      }
    }
    db.exec(`
      INSERT OR IGNORE INTO inbound_events(tenant_id, event_id, ticket_id)
        SELECT t.tenant_id, m.event_id, m.ticket_id FROM messages m
        JOIN tickets t ON t.id = m.ticket_id ORDER BY m.id;
      UPDATE audit SET tenant_id = (SELECT tenant_id FROM tickets WHERE tickets.id = audit.ticket_id);
      CREATE INDEX IF NOT EXISTS tickets_tenant ON tickets(tenant_id);
      CREATE INDEX IF NOT EXISTS messages_ticket ON messages(ticket_id);
      CREATE INDEX IF NOT EXISTS audit_ticket ON audit(ticket_id);
      CREATE INDEX IF NOT EXISTS attempts_unresolved ON attempts(ticket_id, id)
        WHERE state IN ('PENDING', 'UNKNOWN');
      PRAGMA user_version = 1;
    `);
  });
  return db;
}

// Callbacks must be synchronous: never hold the write lock during network I/O.
export function transaction(db, work) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function record(db, id, action, detail, context = {}) {
  const ticket = db.prepare('SELECT tenant_id, version FROM tickets WHERE id = ?').get(id);
  db.prepare(`INSERT INTO audit(ticket_id, action, detail, created_at, tenant_id, actor_id,
    version, client_ref, outcome, reason, provider_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, action, detail, new Date().toISOString(), ticket.tenant_id, context.actorId || 'system',
      context.version ?? ticket.version, context.clientRef ?? null, context.outcome ?? null,
      context.reason ?? action, context.providerId ?? null);
}

export function ticketView(db, row) {
  return {
    ...row,
    messages: db.prepare('SELECT * FROM messages WHERE ticket_id = ? ORDER BY id').all(row.id),
    audit: db.prepare('SELECT * FROM audit WHERE ticket_id = ? ORDER BY id').all(row.id),
    attempts: db.prepare('SELECT * FROM attempts WHERE ticket_id = ? ORDER BY id').all(row.id)
  };
}

// Synthetic identities only. Treat server-side identity as authoritative.
export const actors = {
  'demo-alpha-token': { id: 'agent-alpha', tenantId: 'alpha' },
  'demo-beta-token': { id: 'agent-beta', tenantId: 'beta' }
};
