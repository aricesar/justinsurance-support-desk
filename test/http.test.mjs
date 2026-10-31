import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function port() {
  const socket = createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const value = socket.address().port;
  await new Promise((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
  return value;
}
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  // On Windows this terminates the process, providing an actual crash/restart test.
  child.kill('SIGKILL');
  await exited;
}
async function ready(url, child) {
  for (let n = 0; n < 100; n++) {
    if (child.exitCode !== null) throw new Error(`Child exited: ${child.output}`);
    try { const r = await fetch(url, { signal: AbortSignal.timeout(500) }); if (r.ok) return; } catch {}
    await sleep(50);
  }
  throw new Error(`Server not ready: ${url}; ${child.output}`);
}

test('HTTP contract, real provider ledger and process crash recovery', { timeout: 45000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'desk-http-'));
  const providerPort = await port();
  let appPort = await port();
  while (appPort === providerPort) appPort = await port();
  const providerUrl = `http://127.0.0.1:${providerPort}`;
  const appUrl = `http://127.0.0.1:${appPort}`;
  const children = [];
  function launch(script) {
    const child = spawn(process.execPath, [script], { cwd: root, windowsHide: true,
      env: { ...process.env, PORT: String(appPort), PROVIDER_PORT: String(providerPort),
        PROVIDER_URL: providerUrl, DESK_DB: join(directory, 'desk.sqlite'), PROVIDER_DB: join(directory, 'provider.sqlite') },
      stdio: ['ignore', 'pipe', 'pipe'] });
    child.output = '';
    child.stdout.on('data', b => { child.output += b.toString(); });
    child.stderr.on('data', b => { child.output += b.toString(); });
    child.on('error', error => { child.output += error.message; });
    children.push(child);
    return child;
  }
  t.after(async () => {
    await Promise.all(children.map(stop));
    if (dirname(directory) !== resolve(tmpdir()) || !basename(directory).startsWith('desk-http-')) {
      throw new Error('Unexpected cleanup path');
    }
    rmSync(directory, { recursive: true, force: true });
  });
  const provider = launch('src/mock-provider.mjs');
  await ready(providerUrl + '/deliveries', provider);
  let app = launch('src/server.mjs');
  await ready(appUrl + '/', app);
  async function request(path, { method = 'GET', body, token = 'demo-alpha-token', headers = {} } = {}) {
    const r = await fetch(appUrl + path, { method, headers: { 'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(8000) });
    return { status: r.status, data: await r.json() };
  }
  const post = (action, body = {}, id = 101) => request(`/api/tickets/${id}/${action}`, { method: 'POST', body });
  async function mode(value) {
    const r = await fetch(providerUrl + '/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: value }) });
    assert.equal(r.status, 200);
  }
  async function ledger() { return (await fetch(providerUrl + '/deliveries')).json(); }
  async function prepare(body) {
    assert.equal((await post('draft', { body })).status, 200);
    assert.equal((await post('approve')).status, 200);
  }
  const webhook = { tenantId: 'alpha', ticketId: 101, eventId: 'http-event', body: '<img src=x onerror=alert(1)>' };
  const hook = (body = webhook, secret = 'fictional-webhook-secret') => request('/webhooks/ghl', {
    method: 'POST', token: null, body, headers: { 'X-Demo-Webhook-Secret': secret } });

  await t.test('authentication rejects missing, invalid, inherited and malformed bearer identities', async () => {
    for (const token of [null, 'bad-token', 'toString', '__proto__']) {
      assert.equal((await request('/api/tickets', { token })).status, 401);
    }
    assert.equal((await request('/api/tickets', { headers: { Authorization: 'demo-alpha-token' } })).status, 401);
    assert.deepEqual((await request('/api/tickets')).data.map(ticket => ticket.id), [101]);
    assert.deepEqual((await request('/api/tickets', { token: 'demo-beta-token' })).data.map(ticket => ticket.id), [202]);
    assert.equal((await post('draft', null)).status, 400);
  });

  await t.test('all HTTP operations enforce tenant isolation despite a forged tenantId', async () => {
    const before = (await request('/api/tickets/202', { token: 'demo-beta-token' })).data;
    assert.equal((await request('/api/tickets/202?tenantId=beta')).status, 404);
    for (const action of ['draft', 'approve', 'send', 'automation', 'handoff', 'reconcile']) {
      assert.equal((await post(action, { tenantId: 'beta', body: 'intrusion' }, 202)).status, 404);
    }
    assert.deepEqual((await request('/api/tickets/202', { token: 'demo-beta-token' })).data, before);
    assert.equal((await ledger()).length, 0);
  });

  await t.test('webhook authentication and overlapping replay have one business effect per tenant', async () => {
    assert.equal((await hook(webhook, 'invalid')).status, 401);
    assert.equal((await hook(null)).status, 400);
    const replies = await Promise.all(Array.from({ length: 10 }, () => hook()));
    assert.ok(replies.every(r => r.status === 200));
    assert.equal(replies.filter(r => !r.data.duplicate).length, 1);
    assert.equal((await hook({ ...webhook, tenantId: 'beta', ticketId: 202 })).status, 200);
    const ticket = (await request('/api/tickets/101')).data;
    assert.equal(ticket.messages.length, 1);
    assert.equal(ticket.messages[0].body, webhook.body);
    assert.equal(ticket.audit.filter(a => a.action === 'inbound').length, 1);
  });

  await t.test('approval is current, optional observed version rejects stale approval, repeated send delivers once', async () => {
    assert.equal((await post('draft', { body: 'first' })).status, 200);
    assert.equal((await post('send')).status, 409);
    await post('approve');
    const draft = await post('draft', { body: 'approved exact body' });
    assert.equal((await post('send')).status, 409);
    assert.equal((await post('approve', { version: draft.data.version - 1 })).status, 409);
    await post('approve', { version: draft.data.version });
    const replies = await Promise.all([post('send'), post('send'), post('send')]);
    assert.equal(replies.filter(r => r.status === 200).length, 1);
    assert.equal(replies.filter(r => r.status === 409).length, 2);
    const deliveries = await ledger();
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0].body, 'approved exact body');
  });

  await t.test('504 after acceptance stays UNKNOWN, blocks another send and reconciles without delivery duplication', async () => {
    await mode('accept_then_timeout');
    await prepare('Timeout example');
    const result = await post('send');
    assert.equal(result.status, 200);
    assert.equal(result.data.send_state, 'UNKNOWN');
    assert.equal((await post('send')).status, 409);
    assert.equal((await ledger()).length, 2);
    assert.equal((await post('reconcile')).data.send_state, 'SENT');
    assert.equal((await ledger()).length, 2);
  });

  await t.test('explicit mock 503 is FAILED and is not retried', async () => {
    await mode('reject_before_accept');
    await prepare('Rejected example');
    assert.equal((await post('send')).data.send_state, 'FAILED');
    assert.equal((await ledger()).length, 2);
    assert.equal((await post('send')).status, 409);
  });

  await t.test('takeover is server-enforced; body cannot turn automation into a manual request', async () => {
    await mode('normal');
    await prepare('Human reply');
    await post('handoff');
    assert.equal((await post('automation', { automatic: false })).status, 409);
    assert.equal((await post('send')).data.send_state, 'SENT');
    assert.equal((await ledger()).length, 3);
  });

  await t.test('crash after provider acceptance recovers same attempt without a second delivery or resetting state', async () => {
    await mode('accept_then_delay');
    await prepare('Crash recovery example');
    // Attach rejection handling immediately: a killed server drops the HTTP connection.
    const sending = post('send').catch(error => ({ disconnected: error.message }));
    for (let n = 0; n < 100 && (await ledger()).length < 4; n++) await sleep(25);
    assert.equal((await ledger()).length, 4);
    const before = (await request('/api/tickets/101')).data;
    assert.equal(before.send_state, 'PENDING');
    const attempt = before.attempts.at(-1);
    await stop(app);
    await sending;
    app = launch('src/server.mjs');
    await ready(appUrl + '/', app);
    const recovered = (await request('/api/tickets/101')).data;
    assert.equal(recovered.send_state, 'UNKNOWN');
    assert.equal(recovered.attempts.at(-1).client_ref, attempt.client_ref);
    assert.equal(recovered.owner, 'human');
    assert.equal((await post('send')).status, 409);
    assert.equal((await hook()).data.duplicate, true);
    assert.equal(recovered.messages.length, 1);
    const confirmed = await post('reconcile');
    assert.equal(confirmed.data.send_state, 'SENT');
    assert.equal(confirmed.data.attempts.at(-1).client_ref, attempt.client_ref);
    assert.equal((await ledger()).length, 4);
    assert.equal((await post('send')).status, 409);
  });

  await t.test('client-side deadline after acceptance is UNKNOWN and reconcilable without retry', async () => {
    await mode('accept_then_delay');
    await prepare('Accepted before client deadline');
    const result = await post('send');
    assert.equal(result.status, 200);
    assert.equal(result.data.send_state, 'UNKNOWN');
    assert.equal((await ledger()).length, 5);
    assert.equal((await post('send')).status, 409);
    assert.equal((await post('reconcile')).data.send_state, 'SENT');
    assert.equal((await ledger()).length, 5);
  });
});
