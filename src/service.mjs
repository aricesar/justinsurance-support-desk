import { randomUUID } from 'node:crypto';
import { openStore, record, ticketView, DeskError, transaction } from './store.mjs';

export class DeskService {
  constructor({ databasePath = ':memory:', provider }) {
    this.db = openStore(databasePath);
    this.provider = provider;
    // An interrupted dispatch may already have reached the provider. Never replay it.
    transaction(this.db, () => {
      const interrupted = this.db.prepare("SELECT * FROM attempts WHERE state = 'PENDING'").all();
      for (const attempt of interrupted) {
        this.db.prepare("UPDATE attempts SET state = 'UNKNOWN' WHERE id = ?").run(attempt.id);
        this.db.prepare("UPDATE tickets SET send_state = 'UNKNOWN' WHERE id = ?").run(attempt.ticket_id);
        record(this.db, attempt.ticket_id, 'recovered_unknown', attempt.client_ref);
      }
    });
  }
  close() { this.db.close(); }
  listTickets(actor) {
    return this.db.prepare('SELECT * FROM tickets WHERE tenant_id = ? ORDER BY id').all(actor.tenantId);
  }
  row(actor, id) {
    const row = this.db.prepare('SELECT * FROM tickets WHERE id = ? AND tenant_id = ?').get(id, actor.tenantId);
    if (!row) throw new DeskError(404, 'Ticket not found');
    return row;
  }
  getTicket(actor, id) { return ticketView(this.db, this.row(actor, id)); }
  receiveWebhook(event) {
    if (!event || typeof event.tenantId !== 'string' || !Number.isSafeInteger(event.ticketId)
      || typeof event.eventId !== 'string' || !event.eventId.trim() || typeof event.body !== 'string') {
      throw new DeskError(400, 'Invalid event');
    }
    return transaction(this.db, () => {
      const ticket = this.db.prepare('SELECT * FROM tickets WHERE id = ? AND tenant_id = ?')
        .get(event.ticketId, event.tenantId);
      if (!ticket) throw new DeskError(400, 'Invalid event');
      const inserted = this.db.prepare('INSERT OR IGNORE INTO inbound_events VALUES (?, ?, ?)')
        .run(event.tenantId, event.eventId, ticket.id);
      if (!inserted.changes) return { accepted: true, duplicate: true };
      this.db.prepare('INSERT INTO messages(ticket_id, event_id, body) VALUES (?, ?, ?)')
        .run(ticket.id, event.eventId, event.body);
      record(this.db, ticket.id, 'inbound', event.eventId);
      return { accepted: true, duplicate: false };
    });
  }
  updateDraft(actor, id, body) {
    return transaction(this.db, () => {
      this.row(actor, id);
      if (typeof body !== 'string' || !body.trim()) throw new DeskError(400, 'A reply is required');
      this.db.prepare(`UPDATE tickets SET draft = ?, version = version + 1, approved_version = NULL,
        send_state = CASE WHEN EXISTS(SELECT 1 FROM attempts WHERE ticket_id = ?
          AND state IN ('PENDING', 'UNKNOWN')) THEN send_state ELSE 'DRAFT' END WHERE id = ?`)
        .run(body, id, id);
      record(this.db, id, 'draft_updated', `${actor.id}: approval cleared`);
      return this.getTicket(actor, id);
    });
  }
  approveDraft(actor, id, { version } = {}) {
    return transaction(this.db, () => {
      const t = this.row(actor, id);
      if (version !== undefined && version !== t.version) throw new DeskError(409, 'Draft changed. Review the saved text again.');
      if (!t.draft.trim()) throw new DeskError(400, 'No draft');
      this.db.prepare('UPDATE tickets SET approved_version = version WHERE id = ?').run(id);
      record(this.db, id, 'approved', `${actor.id}: version ${t.version}`);
      return this.getTicket(actor, id);
    });
  }
  handoff(actor, id) {
    return transaction(this.db, () => {
      this.row(actor, id);
      this.db.prepare("UPDATE tickets SET owner = 'human' WHERE id = ?").run(id);
      record(this.db, id, 'human_handoff', actor.id);
      return this.getTicket(actor, id);
    });
  }
  async sendReply(actor, id, { automatic = false, version } = {}) {
    const attempt = transaction(this.db, () => {
      const t = this.row(actor, id);
      if (version !== undefined && version !== t.version) throw new DeskError(409, 'Draft changed. Review the saved text again.');
      if (automatic && t.owner === 'human') throw new DeskError(409, 'Human takeover blocks automation');
      if (!t.draft.trim() || t.approved_version !== t.version) throw new DeskError(409, 'Approve the current saved reply first');
      if (this.db.prepare("SELECT 1 FROM attempts WHERE ticket_id = ? AND state IN ('PENDING', 'UNKNOWN')").get(id)) {
        throw new DeskError(409, 'Delivery unresolved. Check delivery; do not resend.');
      }
      if (this.db.prepare('SELECT 1 FROM attempts WHERE ticket_id = ? AND version = ?').get(id, t.version)) {
        throw new DeskError(409, 'This version already has a dispatch attempt');
      }
      const clientRef = randomUUID();
      this.db.prepare(`INSERT INTO attempts(ticket_id, version, client_ref, body, state)
        VALUES (?, ?, ?, ?, 'PENDING')`).run(id, t.version, clientRef, t.draft);
      this.db.prepare("UPDATE tickets SET send_state = 'PENDING' WHERE id = ?").run(id);
      record(this.db, id, 'dispatch_reserved', `${automatic ? 'automation' : actor.id}: v${t.version}: ${clientRef}`);
      return this.db.prepare('SELECT * FROM attempts WHERE client_ref = ?').get(clientRef);
    });
    // No await between reservation and invocation: takeover cannot commit between them
    // in this single-process fixture. The provider does NOT deduplicate clientRef.
    let state, providerId = null;
    try {
      const result = await this.provider.send({ clientRef: attempt.client_ref, ticketId: id, body: attempt.body });
      if (!result || typeof result.providerMessageId !== 'string' || !result.providerMessageId) {
        throw new Error('Provider response contains no delivery evidence');
      }
      state = 'SENT';
      providerId = result.providerMessageId;
    } catch (error) {
      state = error?.kind === 'not_accepted' ? 'FAILED' : 'UNKNOWN';
    }
    this.finishAttempt(attempt, state, providerId, 'dispatch_result');
    return this.getTicket(actor, id);
  }
  finishAttempt(attempt, state, providerId, action) {
    transaction(this.db, () => {
      // Terminal evidence is monotonic: late send errors cannot undo reconciliation.
      const changed = this.db.prepare(`UPDATE attempts SET state = ?, provider_id = ?
        WHERE id = ? AND state IN ('PENDING', 'UNKNOWN')`).run(state, providerId, attempt.id);
      if (!changed.changes) return;
      this.db.prepare(`UPDATE tickets SET send_state = CASE
        WHEN ? IN ('PENDING', 'UNKNOWN') OR version = ? THEN ? ELSE 'DRAFT' END WHERE id = ?`)
        .run(state, attempt.version, state, attempt.ticket_id);
      record(this.db, attempt.ticket_id, action, `${attempt.client_ref}: ${state}${providerId ? ': ' + providerId : ''}`);
    });
  }
  async reconcile(actor, id) {
    this.row(actor, id);
    const attempt = this.db.prepare(`SELECT * FROM attempts WHERE ticket_id = ?
      AND state IN ('PENDING', 'UNKNOWN') ORDER BY id DESC LIMIT 1`).get(id);
    if (!attempt) throw new DeskError(409, 'No unresolved delivery to check');
    let result;
    try { result = await this.provider.lookup(attempt.client_ref); }
    catch { result = { state: 'lookup_unavailable' }; }
    if (result?.state === 'delivered' && typeof result.providerMessageId === 'string' && result.providerMessageId) {
      this.finishAttempt(attempt, 'SENT', result.providerMessageId, 'delivery_confirmed');
    } else {
      this.finishAttempt(attempt, 'UNKNOWN', null, 'delivery_inconclusive');
      record(this.db, id, 'lookup_inconclusive', `${attempt.client_ref}: ${result?.state || 'invalid_response'}; no resend`);
    }
    return this.getTicket(actor, id);
  }
}
