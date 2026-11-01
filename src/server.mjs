import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { DeskService } from './service.mjs';
import { ProviderClient } from './provider-client.mjs';
import { actors, DeskError } from './store.mjs';
import { readJsonObject } from './http-body.mjs';
import { validateTicketId } from './validation.mjs';

const service = new DeskService({ databasePath: process.env.DESK_DB || resolve('data/desk.sqlite'),
  provider: new ProviderClient(process.env.PROVIDER_URL) });
// Explicit allowlist, loaded once; never use a request path as a filesystem path.
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.mjs', ['app.mjs', 'text/javascript; charset=utf-8']],
  ['/draft-editor.mjs', ['draft-editor.mjs', 'text/javascript; charset=utf-8']],
  ['/time.mjs', ['time.mjs', 'text/javascript; charset=utf-8']]
].map(([path, [file, type]]) => [path, { type,
  body: readFileSync(fileURLToPath(new URL('../public/' + file, import.meta.url))) }]));
const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
const server = createServer(async (req, res) => {
  const requestId = randomUUID();
  res.setHeader('X-Request-Id', requestId);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && assets.has(url.pathname)) {
      const asset = assets.get(url.pathname);
      res.writeHead(200, { 'Content-Type': asset.type, 'Cache-Control': 'no-store' });
      return res.end(asset.body);
    }
    if (req.method === 'POST' && url.pathname === '/webhooks/ghl') {
      if (req.headers['x-demo-webhook-secret'] !== 'fictional-webhook-secret') throw new DeskError(401, 'Invalid webhook secret');
      return json(res, 200, service.receiveWebhook(await readJsonObject(req)));
    }
    const bearer = (req.headers.authorization || '').match(/^Bearer (.+)$/)?.[1];
    const actor = bearer && Object.hasOwn(actors, bearer) ? actors[bearer] : null;
    if (!actor) throw new DeskError(401, 'Sign in using a demo identity');
    if (req.method === 'GET' && url.pathname === '/api/tickets') return json(res, 200, service.listTickets(actor));
    const match = url.pathname.match(/^\/api\/tickets\/(\d+)(?:\/(draft|approve|send|automation|handoff|reconcile))?$/);
    if (!match) throw new DeskError(404, 'Not found');
    const id = Number(match[1]), action = match[2];
    validateTicketId(id);
    if (req.method === 'GET' && !action) return json(res, 200, service.getTicket(actor, id));
    if (req.method !== 'POST') throw new DeskError(405, 'Method not allowed');
    const b = await readJsonObject(req);
    let result;
    switch (action) {
      case 'draft': result = service.updateDraft(actor, id, b.body, { version: b.version }); break;
      case 'approve': result = service.approveDraft(actor, id, { version: b.version }); break;
      case 'handoff': result = service.handoff(actor, id); break;
      case 'send': result = await service.sendReply(actor, id, { version: b.version }); break;
      case 'automation': result = await service.sendReply(actor, id, { automatic: true, version: b.version }); break;
      case 'reconcile': result = await service.reconcile(actor, id); break;
      default: throw new DeskError(404, 'Not found');
    }
    json(res, 200, result);
  } catch (e) {
    const expected = e instanceof DeskError;
    const status = expected ? e.status : 500;
    if (!expected) console.error(JSON.stringify({ event: 'request_failed', requestId, status }));
    json(res, status, {
      error: expected ? e.message : 'Internal error. Refresh the ticket; check any pending delivery before sending again.',
      code: expected ? 'ACTION_REJECTED' : 'INTERNAL_ERROR', requestId
    });
  }
});
server.listen(Number(process.env.PORT || 4300), '127.0.0.1', () => console.log('Support desk: http://127.0.0.1:' + (process.env.PORT || 4300)));
process.on('SIGTERM', () => server.close(() => { service.close(); process.exit(); }));
