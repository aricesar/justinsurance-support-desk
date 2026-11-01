export class DeskError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
