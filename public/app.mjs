import { DraftEditor } from './draft-editor.mjs';
import { formatTimestamp as displayTime, formatAge } from './time.mjs';

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
  const unresolved = current?.delivery_summary.blocks_new_dispatch;
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
    if (action === 'reconcile') button.disabled ||= !current?.delivery_summary.can_check_delivery;
  }
  if (!current) return;
  const hints = [];
  if (dirty) hints.push('Unsaved edits are kept while refreshing, taking over or checking delivery. Save and review before approval.');
  if (dirty && editor.get(editorKey()).version !== current.version) {
    hints.push('The saved draft changed elsewhere. Copy your edits, then use Discard local edits to load the latest saved version before merging and saving.');
  }
  if (unresolved || !dirty) hints.push(current.delivery_summary.next_action);
  $('guidance').textContent = hints.join(' ');
  $('discard').disabled = busy || !dirty;
}

function updateDeliveryAges() {
  const summary = current?.delivery_summary;
  if (!summary) return;
  $('delivery-times').textContent = summary.attempt_id === null ? 'No attempt recorded.'
    : `Started: ${displayTime(summary.created_at)} (${formatAge(summary.created_at)}) · Last checked: ${summary.last_checked_at ? `${displayTime(summary.last_checked_at)} (${formatAge(summary.last_checked_at)})` : 'Never'}`;
}

function renderDeliverySummary(summary) {
  $('delivery-summary').className = `delivery-summary${summary.needs_attention ? ' needs-attention' : ''}`;
  $('delivery-title').textContent = summary.title;
  $('delivery-explanation').textContent = summary.explanation;
  $('delivery-reason').textContent = `Reason: ${summary.reason}`;
  $('delivery-reason').hidden = summary.attempt_id === null;
  $('delivery-next-action').textContent = `Next safe action: ${summary.next_action}`;
  $('delivery-warning').hidden = !summary.warning;
  $('delivery-warning').textContent = summary.warning;
  $('delivery-reference').textContent = summary.client_ref
    ? `Reply v${summary.attempt_version} · Reference: ${summary.client_ref}${summary.provider_id ? ` · Provider confirmation: ${summary.provider_id}` : ''}`
    : `Current draft: v${summary.current_draft_version}`;
  updateDeliveryAges();
}

const eventLabels = {
  inbound: 'Customer message', draft_updated: 'Draft saved', approved: 'Draft approved',
  dispatch_reserved: 'Reply dispatch started; delivery pending', dispatch_result: 'Provider delivery result',
  delivery_confirmed: 'Delivery confirmed by lookup', lookup_inconclusive: 'Delivery check inconclusive; do not resend',
  recovered_unknown: 'Interrupted dispatch recovered as uncertain', human_handoff: 'Human takeover',
  sent: 'Legacy send recorded', legacy_inbound: 'Historical customer message', legacy_attempt: 'Historical dispatch attempt'
};

function timelineItem(event, { legacy = false } = {}) {
  const item = document.createElement('li');
  const heading = document.createElement('strong');
  heading.textContent = `${eventLabels[event.kind] || event.kind}${event.version == null ? '' : ` · v${event.version}`}${event.state ? ` · ${event.state}` : ''}`;
  const metadata = document.createElement('p');
  metadata.className = 'event-meta';
  metadata.textContent = `${legacy ? 'Original order not recorded' : `Event #${event.sequence}`} · ${displayTime(event.occurred_at)}${event.actor_id ? ` · ${event.actor_id}` : ''}${event.client_ref ? ` · Reference: ${event.client_ref}` : ''}`;
  item.append(heading, metadata);
  if (event.body !== null && event.body !== undefined) {
    const body = document.createElement('p');
    body.className = 'message-text';
    body.textContent = event.body;
    item.append(body);
  }
  return item;
}

function renderHistory(ticket) {
  const timeline = ticket.timeline.map(event => timelineItem(event));
  if (!timeline.length) {
    const empty = document.createElement('li');
    empty.textContent = 'No recorded events yet. Run npm run event to receive a customer message.';
    timeline.push(empty);
  }
  $('messages').replaceChildren(...timeline);
  $('legacy-section').hidden = !ticket.legacy_history.length;
  $('legacy-messages').replaceChildren(...ticket.legacy_history.map(event => timelineItem(event, { legacy: true })));
  const revisions = ticket.revisions.map(revision => {
    const details = document.createElement('details');
    details.className = 'revision';
    const summary = document.createElement('summary');
    summary.textContent = `Draft v${revision.version}${revision.is_current ? ' · current' : ''}${revision.currently_approved ? ' · currently approved' : ''}${revision.approvals.length ? ' · approval recorded' : ''}`;
    const metadata = document.createElement('p');
    metadata.textContent = revision.source === 'saved'
      ? `Saved by ${revision.created_by} · ${displayTime(revision.created_at)}`
      : 'Recovered from existing data. Original author and save time were not recorded.';
    const body = document.createElement('pre');
    body.textContent = revision.body;
    const approvals = document.createElement('p');
    approvals.textContent = revision.approvals.length
      ? revision.approvals.map(approval => `Approved by ${approval.actor_id || 'an unrecorded actor'} at ${displayTime(approval.created_at)}`).join('; ')
      : 'No historical approval event recorded.';
    const attempts = document.createElement('p');
    attempts.textContent = revision.attempt_ids.length ? `Dispatch attempts: ${revision.attempt_ids.join(', ')}` : 'No dispatch attempt.';
    details.append(summary, metadata, body, approvals, attempts);
    return details;
  });
  if (!revisions.length) {
    const empty = document.createElement('p');
    empty.textContent = 'No saved draft revisions.';
    revisions.push(empty);
  }
  $('revisions').replaceChildren(...revisions);
}

function render(ticket, { saved = false } = {}) {
  const buffer = editor.open(editorKey(), ticket, { saved });
  current = ticket;
  $('work').hidden = false;
  $('title').textContent = `${ticket.subject} · ${ticket.contact}`;
  $('state').textContent = `Owner: ${ticket.owner} | Delivery: ${ticket.send_state} | Draft v${ticket.version} | Approved v${ticket.approved_version ?? 'none'}`;
  $('draft').value = buffer.body;
  $('saved').textContent = ticket.draft || 'No saved draft.';
  renderDeliverySummary(ticket.delivery_summary);
  renderHistory(ticket);
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
// Display-only clock updates: no polling, dispatch or reconciliation is triggered.
setInterval(updateDeliveryAges, 15000);
