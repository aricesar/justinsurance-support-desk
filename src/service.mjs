import { randomUUID } from 'node:crypto';
import { openStore, record, ticketView, DeskError, transaction } from './store.mjs';
import { validateEvent, validateReply, validateVersion } from './validation.mjs';

export class DeskService {
  constructor({ databasePath = ':memory:', provider }) {
    this.db = openStore(databasePath);
    this.provider = provider;
    // An interrupted dispatch may already have reached the provider. Never replay it.
    transaction(this.db, () => {
      const interrupted = this.db.prepare("SELECT * FROM attempts WHERE state = 'PENDING'").all();
      for (const attempt of interrupted) {
        this.db.prepare("UPDATE attempts SET state = 'UNKNOWN', updated_at = ? WHERE id = ?")
          .run(new Date().toISOString(), attempt.id);
        this.db.prepare("UPDATE tickets SET send_state = 'UNKNOWN' WHERE id = ?").run(attempt.ticket_id);
        record(this.db, attempt.ticket_id, 'recovered_unknown', attempt.client_ref, {
          version: attempt.version, clientRef: attempt.client_ref, outcome: 'UNKNOWN', reason: 'process_interrupted'
        });
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
    validateEvent(event);
    return transaction(this.db, () => {
      const ticket = this.db.prepare('SELECT * FROM tickets WHERE id = ? AND tenant_id = ?')
        .get(event.ticketId, event.tenantId);
      if (!ticket) throw new DeskError(400, 'Invalid event');
      const inserted = this.db.prepare('INSERT OR IGNORE INTO inbound_events VALUES (?, ?, ?)')
        .run(event.tenantId, event.eventId, ticket.id);
      if (!inserted.changes) return { accepted: true, duplicate: true };
      this.db.prepare('INSERT INTO messages(ticket_id, event_id, body) VALUES (?, ?, ?)')
        .run(ticket.id, event.eventId, event.body);
      record(this.db, ticket.id, 'inbound', event.eventId, { actorId: 'webhook', reason: 'inbound_accepted' });
      return { accepted: true, duplicate: false };
    });
  }
  updateDraft(actor, id, body, { version } = {}) {
    return transaction(this.db, () => {
      const ticket = this.row(actor, id);
      validateReply(body);
      validateVersion(version);
      if (version !== undefined && version !== ticket.version) throw new DeskError(409, 'Draft changed. Refresh and review before saving. Your local edits were kept.');
      this.db.prepare(`UPDATE tickets SET draft = ?, version = version + 1, approved_version = NULL,
        send_state = CASE WHEN EXISTS(SELECT 1 FROM attempts WHERE ticket_id = ?
          AND state IN ('PENDING', 'UNKNOWN')) THEN send_state ELSE 'DRAFT' END WHERE id = ?`)
        .run(body, id, id);
      record(this.db, id, 'draft_updated', `${actor.id}: approval cleared`, { actorId: actor.id });
      return this.getTicket(actor, id);
    });
  }
  approveDraft(actor, id, { version } = {}) {
    return transaction(this.db, () => {
      const t = this.row(actor, id);
      validateVersion(version);
      if (version !== undefined && version !== t.version) throw new DeskError(409, 'Draft changed. Review the saved text again.');
      if (!t.draft.trim()) throw new DeskError(400, 'No draft');
      this.db.prepare('UPDATE tickets SET approved_version = version WHERE id = ?').run(id);
      record(this.db, id, 'approved', `${actor.id}: version ${t.version}`, { actorId: actor.id });
      return this.getTicket(actor, id);
    });
  }
  handoff(actor, id) {
    return transaction(this.db, () => {
      this.row(actor, id);
      this.db.prepare("UPDATE tickets SET owner = 'human' WHERE id = ?").run(id);
      record(this.db, id, 'human_handoff', actor.id, { actorId: actor.id });
      return this.getTicket(actor, id);
    });
  }
  async sendReply(actor, id, { automatic = false, version } = {}) {
    const attempt = transaction(this.db, () => {
      const t = this.row(actor, id);
      validateVersion(version);
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
      const now = new Date().toISOString();
      this.db.prepare(`INSERT INTO attempts(ticket_id, version, client_ref, body, state, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'PENDING', ?, ?)`).run(id, t.version, clientRef, t.draft, now, now);
      this.db.prepare("UPDATE tickets SET send_state = 'PENDING' WHERE id = ?").run(id);
      record(this.db, id, 'dispatch_reserved', `${automatic ? 'automation' : actor.id}: v${t.version}: ${clientRef}`, {
        actorId: actor.id, version: t.version, clientRef, outcome: 'PENDING',
        reason: automatic ? 'automation_dispatch' : 'human_dispatch'
      });
      return this.db.prepare('SELECT * FROM attempts WHERE client_ref = ?').get(clientRef);
    });
    // No await between reservation and invocation: takeover cannot commit between them
    // in this single-process fixture. The provider does NOT deduplicate clientRef.
    let state, reason, providerId = null;
    try {
      const result = await this.provider.send({ clientRef: attempt.client_ref, ticketId: id, body: attempt.body });
      if (!result || typeof result.providerMessageId !== 'string' || !result.providerMessageId) {
        throw Object.assign(new Error('Provider response contains no delivery evidence'), { code: 'INVALID_ACK' });
      }
      state = 'SENT';
      reason = 'provider_confirmed';
      providerId = result.providerMessageId;
    } catch (error) {
      state = error?.kind === 'not_accepted' ? 'FAILED' : 'UNKNOWN';
      reason = state === 'FAILED' ? 'provider_rejected_before_acceptance'
        : error?.code === 'INVALID_ACK' ? 'provider_invalid_ack'
        : ['TimeoutError', 'AbortError'].includes(error?.name) ? 'provider_timeout' : 'provider_result_unconfirmed';
    }
    this.finishAttempt(attempt, state, providerId, 'dispatch_result', { actorId: actor.id, reason });
    return this.getTicket(actor, id);
  }
  finishAttempt(attempt, state, providerId, action, context = {}) {
    transaction(this.db, () => {
      // Terminal evidence is monotonic: late send errors cannot undo reconciliation.
      const now = new Date().toISOString();
      if (context.checked) this.db.prepare('UPDATE attempts SET last_checked_at = ? WHERE id = ?').run(now, attempt.id);
      const changed = this.db.prepare(`UPDATE attempts SET state = ?, provider_id = ?, updated_at = ?
        WHERE id = ? AND state IN ('PENDING', 'UNKNOWN')`).run(state, providerId, now, attempt.id);
      if (!changed.changes) return;
      this.db.prepare(`UPDATE tickets SET send_state = CASE
        WHEN ? IN ('PENDING', 'UNKNOWN') OR version = ? THEN ? ELSE 'DRAFT' END WHERE id = ?`)
        .run(state, attempt.version, state, attempt.ticket_id);
      record(this.db, attempt.ticket_id, action, `${attempt.client_ref}: ${state}${providerId ? ': ' + providerId : ''}`, {
        ...context, version: attempt.version, clientRef: attempt.client_ref, outcome: state, providerId
      });
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
      this.finishAttempt(attempt, 'SENT', result.providerMessageId, 'delivery_confirmed', {
        actorId: actor.id, checked: true, reason: 'lookup_delivered'
      });
    } else {
      const reason = result?.state === 'not_found' ? 'lookup_not_found'
        : result?.state === 'lookup_unavailable' ? 'lookup_unavailable' : 'lookup_invalid_response';
      this.finishAttempt(attempt, 'UNKNOWN', null, 'lookup_inconclusive', { actorId: actor.id, checked: true, reason });
    }
    return this.getTicket(actor, id);
  }
}
