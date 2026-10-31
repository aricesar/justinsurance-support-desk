// Buffers are scoped to identity + ticket and live only in this browser session.
export class DraftEditor {
  constructor() { this.buffers = new Map(); }

  open(key, ticket, { saved = false } = {}) {
    const previous = this.buffers.get(key);
    if (saved || !previous || previous.body === previous.savedBody) {
      this.buffers.set(key, { body: ticket.draft, savedBody: ticket.draft, version: ticket.version });
    }
    return this.buffers.get(key);
  }

  edit(key, body) { this.buffers.get(key).body = body; }
  get(key) { return this.buffers.get(key); }
  isDirty(key) {
    const buffer = this.buffers.get(key);
    return Boolean(buffer && buffer.body !== buffer.savedBody);
  }
}
