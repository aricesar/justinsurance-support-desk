import { DeliveryPolicy } from './delivery-policy.mjs';

const reasons = Object.freeze({
  human_dispatch: 'The approved reply was dispatched by a human agent.',
  automation_dispatch: 'The approved reply was dispatched by automation.',
  provider_confirmed: 'The provider confirmed delivery.',
  provider_rejected_before_acceptance: 'The provider explicitly rejected the request before accepting it.',
  provider_invalid_ack: 'The provider response did not contain valid delivery confirmation.',
  provider_timeout: 'The provider did not confirm delivery before the request timed out.',
  provider_result_unconfirmed: 'The dispatch ended without a confirmed delivery result.',
  lookup_delivered: 'A delivery check confirmed the original attempt.',
  lookup_not_found: 'The lookup found no match. This does not prove that delivery failed.',
  lookup_unavailable: 'The delivery check was unavailable.',
  lookup_invalid_response: 'The delivery check returned no valid confirmation.',
  process_interrupted: 'The application restarted before the dispatch result was confirmed.'
});

function nextDraftAction(ticket) {
  if (!ticket.draft.trim()) return 'Write and save a reply, then review and explicitly approve its exact text.';
  if (ticket.approved_version !== ticket.version) return `Review saved draft v${ticket.version} and explicitly approve it before sending.`;
  return `Draft v${ticket.version} is approved. Send the exact saved reply when ready.`;
}

// Stable response data only: relative ages are calculated by the browser, not GET.
export function deliverySummary(ticket, { attempts, audit }) {
  const attempt = attempts.findLast(row => DeliveryPolicy.isUnresolved(row.state))
    || attempts.findLast(row => !DeliveryPolicy.isSupported(row.state)) || attempts.at(-1);
  const latestAudit = attempt && audit.findLast(entry => entry.attempt_id === attempt.id && entry.reason);
  const base = {
    state: attempt?.state ?? 'DRAFT', attempt_id: attempt?.id ?? null,
    attempt_version: attempt?.version ?? null, current_draft_version: ticket.version,
    client_ref: attempt?.client_ref ?? null, provider_id: attempt?.provider_id ?? null,
    created_at: attempt?.created_at ?? null, updated_at: attempt?.updated_at ?? null,
    last_checked_at: attempt?.last_checked_at ?? null,
    reason_code: latestAudit?.reason ?? null,
    reason: reasons[latestAudit?.reason] || 'No additional delivery reason was recorded.',
    blocks_new_dispatch: attempt ? DeliveryPolicy.isUnresolved(attempt.state) : false,
    can_check_delivery: attempt ? DeliveryPolicy.isUnresolved(attempt.state) : false,
    needs_attention: attempt?.state === 'UNKNOWN', warning: ''
  };
  if (!attempt) return {
    ...base, title: !ticket.draft.trim() ? 'No reply prepared'
      : ticket.approved_version === ticket.version ? 'Approved reply ready' : 'Reply awaiting approval',
    explanation: 'No dispatch attempt has been recorded for this conversation.', next_action: nextDraftAction(ticket)
  };
  if (attempt.state === 'UNKNOWN') return {
    ...base, title: 'Delivery uncertain',
    explanation: `The provider may already have delivered reply v${attempt.version}. New replies remain blocked until this attempt is resolved.`,
    next_action: 'Use Check delivery. If the result stays inconclusive, escalate with the ticket and reference.',
    warning: 'Do not resend or recreate this reply.'
  };
  if (attempt.state === 'PENDING') return {
    ...base, title: 'Delivery pending', explanation: `Reply v${attempt.version} was dispatched; its outcome is not confirmed yet.`,
    next_action: 'Wait for the current dispatch to finish, or use Check delivery.', warning: 'Do not start another dispatch.'
  };
  const newerDraft = ticket.version !== attempt.version;
  if (attempt.state === 'SENT') return {
    ...base, title: newerDraft ? 'Previous reply delivered' : 'Delivery confirmed',
    explanation: `The provider confirmed reply v${attempt.version}.${newerDraft ? ` Current draft v${ticket.version} has not been dispatched.` : ''}`,
    next_action: newerDraft ? nextDraftAction(ticket) : 'Continue the conversation. Save and approve a new reply when needed.',
    warning: `Do not resend version ${attempt.version}.`
  };
  if (attempt.state === 'FAILED') return {
    ...base, title: 'Reply not accepted by provider', explanation: `Reply v${attempt.version} was explicitly rejected before acceptance.`,
    next_action: newerDraft ? nextDraftAction(ticket)
      : 'Review the reply. Save and approve a new version only if you intend a new dispatch.',
    warning: `Version ${attempt.version} cannot be retried.`
  };
  return { ...base, needs_attention: true, blocks_new_dispatch: true, title: 'Delivery needs investigation',
    explanation: 'The saved delivery state is not recognized.', next_action: 'Escalate with the ticket and reference.',
    warning: 'Do not dispatch another reply until the saved state is reviewed.' };
}
