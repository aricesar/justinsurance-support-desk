import { DeskError } from './store.mjs';

export const MAX_BODY_BYTES = 100000;

export async function readJsonObject(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) {
      request.resume(); // Drain without buffering; keep the socket alive to return 413.
      throw new DeskError(413, 'Request exceeds 100000 bytes');
    }
    chunks.push(chunk);
  }
  try {
    // Decode only after joining bytes: a UTF-8 character can span HTTP chunks.
    const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes));
    const value = text ? JSON.parse(text) : {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new DeskError(400, 'Expected a JSON object encoded as valid UTF-8'); }
}
