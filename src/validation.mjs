import { DeskError } from './store.mjs';

export function validateVersion(version) {
  if (version !== undefined && (!Number.isSafeInteger(version) || version < 0)) {
    throw new DeskError(400, 'Version must be a non-negative integer');
  }
}

export function validateTicketId(id) {
  if (!Number.isSafeInteger(id) || id <= 0) throw new DeskError(400, 'Invalid ticket ID');
}

export function validateReply(body) {
  if (typeof body !== 'string' || !body.trim()) throw new DeskError(400, 'A reply is required');
  if (Buffer.byteLength(body, 'utf8') > 100000) throw new DeskError(413, 'Reply is too large');
}

export function validateEvent(event) {
  if (!event || typeof event.tenantId !== 'string' || !event.tenantId.trim()
    || typeof event.eventId !== 'string' || !event.eventId.trim()
    || typeof event.body !== 'string') throw new DeskError(400, 'Invalid event');
  validateTicketId(event.ticketId);
  if (Buffer.byteLength(event.body, 'utf8') > 100000) throw new DeskError(413, 'Message is too large');
}
