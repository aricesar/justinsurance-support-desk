import { DraftEditor } from './draft-editor.mjs';

const $ = id => document.getElementById(id);
const editor = new DraftEditor();
let selected, current, busy = false;
const editorKey = () => `${$('identity').value}:${selected}`;
const buttons = () => document.querySelectorAll('[data-action]');

async function api(path, method = 'GET', body) {
  const response = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer demo-${$('identity').value}-token` },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error + (response.status >= 500 ? ` Reference: ${data.requestId}` : ''));
  return data;
}

function controls() {
  const dirty = editor.isDirty(editorKey());
  const unresolved = current?.attempts.some(attempt => ['PENDING', 'UNKNOWN'].includes(attempt.state));
  const attempted = current?.attempts.find(attempt => attempt.version === current.version);
  for (const button of document.querySelectorAll('button')) button.disabled = busy;
  $('identity').disabled = busy;
  $('draft').disabled = busy;
  for (const button of buttons()) {
    const action = button.dataset.action;
    button.disabled = busy || !current;
    if (action === 'approve') button.disabled ||= dirty || !current?.draft || current.approved_version === current.version;
    if (action === 'send' || action === 'automation') {
      button.disabled ||= dirty || unresolved || Boolean(attempted) || current?.approved_version !== current?.version
        || (action === 'automation' && current?.owner === 'human');
    }
    if (action === 'reconcile') button.disabled ||= !unresolved;
  }
  if (!current) return;
  const hints = [];
  if (dirty) hints.push('Unsaved edits are kept while refreshing, taking over or checking delivery. Save and review before approval.');
  if (dirty && editor.get(editorKey()).version !== current.version) {
    hints.push('The saved draft changed elsewhere. Copy your edits, then use Discard local edits to load the latest saved version before merging and saving.');
  }
  if (unresolved) hints.push('Delivery is pending or UNKNOWN. Do not resend or recreate the reply. Use Check delivery; not_found is inconclusive. Escalate if it stays unresolved.');
  else if (attempted?.state === 'FAILED') hints.push('The provider explicitly rejected this attempt before acceptance. Review and save a new version for an intentional new dispatch; this version cannot be retried.');
  else if (attempted) hints.push('This version has already been dispatched. Review its result and reference below.');
  else if (!dirty) hints.push(current.approved_version === current.version
    ? 'This exact saved version is approved and ready to send.'
    : 'Review the saved text and explicitly approve it before sending. Editing clears approval.');
  $('guidance').textContent = hints.join(' ');
  $('discard').disabled = busy || !dirty;
}

function displayTime(value) { return value ? new Date(value).toLocaleString() : 'Not recorded (legacy attempt)'; }

function render(ticket, { saved = false } = {}) {
  const buffer = editor.open(editorKey(), ticket, { saved });
  current = ticket;
  $('work').hidden = false;
  $('title').textContent = `${ticket.subject} · ${ticket.contact}`;
  $('state').textContent = `Owner: ${ticket.owner} | Delivery: ${ticket.send_state} | Draft v${ticket.version} | Approved v${ticket.approved_version ?? 'none'}`;
  $('draft').value = buffer.body;
  $('saved').textContent = ticket.draft || 'No saved draft.';
  $('messages').textContent = ticket.messages.map(message => `Customer: ${message.body}`)
    .concat(ticket.attempts.filter(attempt => attempt.state === 'SENT')
      .map(attempt => `Confirmed reply (v${attempt.version}): ${attempt.body}`))
    .join('\n\n') || 'No messages yet. Run npm run event.';
  $('attempts').textContent = ticket.attempts.map(attempt =>
    `v${attempt.version} · ${attempt.state}\nReference: ${attempt.client_ref}\nCreated: ${displayTime(attempt.created_at)}\nUpdated: ${displayTime(attempt.updated_at)}\nLast checked: ${attempt.last_checked_at ? displayTime(attempt.last_checked_at) : 'Never'}\nText: ${attempt.body}`
  ).join('\n\n') || 'No dispatch attempts.';
  $('audit').textContent = JSON.stringify(ticket.audit, null, 2);
  controls();
}

async function refresh() {
  const tickets = await api('/api/tickets');
  $('tickets').replaceChildren();
  for (const ticket of tickets) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.textContent = `${ticket.id}: ${ticket.contact}`;
    button.onclick = () => act(async () => {
      selected = ticket.id;
      render(await api(`/api/tickets/${selected}`));
    });
    item.append(button);
    $('tickets').append(item);
  }
  if (selected) render(await api(`/api/tickets/${selected}`));
}

async function act(action) {
  if (busy) return;
  busy = true;
  controls();
  try {
    $('notice').textContent = 'Working…';
    await action();
    $('notice').textContent = 'Action completed. Review the state and next safe action.';
  } catch (error) { $('notice').textContent = error.message; }
  finally { busy = false; controls(); }
}

$('draft').oninput = () => { editor.edit(editorKey(), $('draft').value); controls(); };
$('refresh').onclick = () => act(refresh);
$('identity').onchange = () => {
  selected = undefined;
  current = undefined;
  $('work').hidden = true;
  $('title').textContent = 'Select a ticket';
  $('state').textContent = '';
  act(refresh);
};
$('discard').onclick = () => act(async () => {
  // Discard is explicit; other actions never discard local edits.
  const ticket = await api(`/api/tickets/${selected}`);
  render(ticket, { saved: true });
});
for (const button of buttons()) button.onclick = () => act(async () => {
  const action = button.dataset.action;
  if (action === 'suggest') {
    editor.edit(editorKey(), 'Thanks for reaching out. A support agent will help you recover your progress.');
    $('draft').value = editor.get(editorKey()).body;
    return;
  }
  const body = action === 'draft'
    ? { body: editor.get(editorKey()).body, version: editor.get(editorKey()).version }
    : { version: current.version };
  render(await api(`/api/tickets/${selected}/${action}`, 'POST', body), { saved: action === 'draft' });
});
act(refresh);
