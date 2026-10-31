// Called inside the schema migration transaction, before immutable guards exist.
export function migrateHistory(db) {
  if (db.prepare('PRAGMA user_version').get().user_version >= 2) return;
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS tickets_identity ON tickets(id, tenant_id);
    CREATE TABLE draft_revisions (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      ticket_id INTEGER NOT NULL,
      version INTEGER NOT NULL CHECK(version >= 0),
      body TEXT NOT NULL,
      created_by TEXT,
      created_at TEXT,
      source TEXT NOT NULL CHECK(source IN ('saved', 'legacy_current', 'legacy_attempt')),
      UNIQUE(ticket_id, version),
      FOREIGN KEY(ticket_id, tenant_id) REFERENCES tickets(id, tenant_id),
      CHECK(source != 'saved' OR (created_by IS NOT NULL AND created_at IS NOT NULL))
    );
    ALTER TABLE messages ADD COLUMN created_at TEXT;
    ALTER TABLE attempts ADD COLUMN revision_id INTEGER REFERENCES draft_revisions(id);
    ALTER TABLE audit ADD COLUMN revision_id INTEGER REFERENCES draft_revisions(id);
    ALTER TABLE audit ADD COLUMN attempt_id INTEGER REFERENCES attempts(id);
    ALTER TABLE audit ADD COLUMN message_id INTEGER REFERENCES messages(id);
  `);
  const find = db.prepare('SELECT * FROM draft_revisions WHERE ticket_id = ? AND version = ?');
  const insert = db.prepare(`INSERT INTO draft_revisions(tenant_id, ticket_id, version, body, source)
    VALUES (?, ?, ?, ?, ?)`);
  function recover(ticketId, tenantId, version, body, source) {
    const existing = find.get(ticketId, version);
    if (existing && existing.body !== body) {
      throw new Error(`Conflicting historical draft for ticket ${ticketId}, version ${version}; migration rolled back`);
    }
    if (!existing) insert.run(tenantId, ticketId, version, body, source);
  }
  for (const attempt of db.prepare(`SELECT a.*, t.tenant_id FROM attempts a
    JOIN tickets t ON t.id = a.ticket_id ORDER BY a.id`).all()) {
    recover(attempt.ticket_id, attempt.tenant_id, attempt.version, attempt.body, 'legacy_attempt');
  }
  for (const ticket of db.prepare('SELECT * FROM tickets ORDER BY id').all()) {
    if (ticket.version > 0 || ticket.draft) recover(ticket.id, ticket.tenant_id, ticket.version, ticket.draft, 'legacy_current');
  }
  db.exec(`
    UPDATE attempts SET revision_id = (SELECT r.id FROM draft_revisions r
      WHERE r.ticket_id = attempts.ticket_id AND r.version = attempts.version);
    UPDATE audit SET attempt_id = (SELECT a.id FROM attempts a
      WHERE a.ticket_id = audit.ticket_id AND a.client_ref = audit.client_ref)
      WHERE client_ref IS NOT NULL;
    UPDATE audit SET revision_id = (SELECT r.id FROM draft_revisions r
      WHERE r.ticket_id = audit.ticket_id AND r.version = audit.version)
      WHERE action IN ('draft_updated', 'approved', 'dispatch_reserved', 'dispatch_result',
        'delivery_confirmed', 'lookup_inconclusive', 'recovered_unknown');
    UPDATE audit SET revision_id = (SELECT revision_id FROM attempts WHERE id = audit.attempt_id)
      WHERE attempt_id IS NOT NULL;
  `);
  // Old inbound audit rows carry event ID in detail. Match occurrences in recorded
  // order, preserving pre-existing duplicates rather than deleting history.
  const groups = new Map();
  for (const message of db.prepare('SELECT * FROM messages ORDER BY id').all()) {
    const key = JSON.stringify([message.ticket_id, message.event_id]);
    if (!groups.has(key)) groups.set(key, { rows: [], next: 0 });
    groups.get(key).rows.push(message);
  }
  const link = db.prepare('UPDATE audit SET message_id = ? WHERE id = ?');
  for (const entry of db.prepare("SELECT * FROM audit WHERE action = 'inbound' ORDER BY id").all()) {
    const group = groups.get(JSON.stringify([entry.ticket_id, entry.detail]));
    const message = group?.rows[group.next++];
    if (message) link.run(message.id, entry.id);
  }
  db.exec(`
    CREATE INDEX audit_revision ON audit(revision_id, id);
    CREATE TRIGGER revision_no_update BEFORE UPDATE ON draft_revisions
      BEGIN SELECT RAISE(ABORT, 'Draft revisions are immutable'); END;
    CREATE TRIGGER revision_no_delete BEFORE DELETE ON draft_revisions
      BEGIN SELECT RAISE(ABORT, 'Draft revisions are immutable'); END;
    CREATE TRIGGER attempt_revision_insert BEFORE INSERT ON attempts
      WHEN NEW.revision_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM draft_revisions r WHERE r.id = NEW.revision_id
        AND r.ticket_id = NEW.ticket_id AND r.version = NEW.version AND r.body = NEW.body)
      BEGIN SELECT RAISE(ABORT, 'Attempt revision mismatch'); END;
    CREATE TRIGGER attempt_revision_update BEFORE UPDATE OF revision_id, ticket_id, version, body ON attempts
      WHEN NEW.revision_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM draft_revisions r WHERE r.id = NEW.revision_id
        AND r.ticket_id = NEW.ticket_id AND r.version = NEW.version AND r.body = NEW.body)
      BEGIN SELECT RAISE(ABORT, 'Attempt revision mismatch'); END;
    PRAGMA user_version = 2;
  `);
}

// Linear projection over indexed, ticket-scoped reads. Audit ID is the persisted
// local processing order; wall clocks can tie or move backwards.
export function historyView(ticket, { messages, attempts, audit, revisions }) {
  const messageById = new Map(messages.map(message => [message.id, message]));
  const attemptById = new Map(attempts.map(attempt => [attempt.id, attempt]));
  const revisionById = new Map(revisions.map(revision => [revision.id, revision]));
  const linkedMessages = new Set(), linkedAttempts = new Set();
  const approvals = new Map(), revisionAttempts = new Map();
  for (const attempt of attempts) {
    if (!revisionAttempts.has(attempt.revision_id)) revisionAttempts.set(attempt.revision_id, []);
    revisionAttempts.get(attempt.revision_id).push(attempt.id);
  }
  const timeline = audit.map(entry => {
    const message = messageById.get(entry.message_id);
    const attempt = attemptById.get(entry.attempt_id);
    const revision = revisionById.get(entry.revision_id);
    if (message) linkedMessages.add(message.id);
    if (attempt && entry.action === 'dispatch_reserved') linkedAttempts.add(attempt.id);
    if (entry.action === 'approved' && revision) {
      if (!approvals.has(revision.id)) approvals.set(revision.id, []);
      approvals.get(revision.id).push({ sequence: entry.id, actor_id: entry.actor_id, created_at: entry.created_at });
    }
    return {
      sequence: entry.id, occurred_at: entry.created_at, kind: entry.action, actor_id: entry.actor_id,
      revision_id: entry.revision_id,
      version: ['inbound', 'human_handoff'].includes(entry.action) ? null : attempt?.version ?? revision?.version ?? entry.version,
      attempt_id: entry.attempt_id, client_ref: entry.client_ref, state: entry.outcome, reason: entry.reason,
      body: entry.action === 'inbound' ? message?.body ?? null
        : entry.action === 'dispatch_reserved' ? attempt?.body ?? null : null,
      detail: entry.detail
    };
  });
  const legacyHistory = [
    ...messages.filter(message => !linkedMessages.has(message.id)).map(message => ({
      kind: 'legacy_inbound', body: message.body, occurred_at: message.created_at,
      version: null, client_ref: null, state: null
    })),
    ...attempts.filter(attempt => !linkedAttempts.has(attempt.id)).map(attempt => ({
      kind: 'legacy_attempt', body: attempt.body, occurred_at: attempt.created_at,
      version: attempt.version, client_ref: attempt.client_ref, state: attempt.state
    }))
  ];
  return {
    timeline, legacy_history: legacyHistory,
    revisions: revisions.map(revision => ({
      ...revision, is_current: revision.version === ticket.version,
      currently_approved: revision.version === ticket.version && ticket.approved_version === revision.version,
      approvals: approvals.get(revision.id) || [], attempt_ids: revisionAttempts.get(revision.id) || []
    }))
  };
}
