import { DeskError } from './errors.mjs';

export const DeliveryState = Object.freeze({ PENDING: 'PENDING', UNKNOWN: 'UNKNOWN', SENT: 'SENT', FAILED: 'FAILED' });
const knownStates = new Set(Object.values(DeliveryState));
const transitions = Object.freeze({
  PENDING: Object.freeze(['UNKNOWN', 'SENT', 'FAILED']),
  UNKNOWN: Object.freeze(['UNKNOWN', 'SENT', 'FAILED']),
  SENT: Object.freeze([]),
  FAILED: Object.freeze([])
});
const hasEvidence = value => typeof value === 'string' && value.length > 0;
const outcome = (state, source, reason, providerId = null, notAccepted = false) =>
  Object.freeze({ state, source, reason, providerId, notAccepted });

// Pure business policy. Persistence and provider I/O stay in the application service.
export const DeliveryPolicy = Object.freeze({
  isSupported(state) { return knownStates.has(state); },
  isUnresolved(state) { return state === DeliveryState.PENDING || state === DeliveryState.UNKNOWN; },

  assertCanDispatch(ticket, { automatic = false, version, hasUnresolved = false, hasAttempt = false, hasUnsupportedState = false } = {}) {
    if (version !== undefined && version !== ticket.version) throw new DeskError(409, 'Draft changed. Review the saved text again.');
    if (automatic && ticket.owner === 'human') throw new DeskError(409, 'Human takeover blocks automation');
    if (!ticket.draft.trim() || ticket.approved_version !== ticket.version) throw new DeskError(409, 'Approve the current saved reply first');
    if (hasUnsupportedState) throw new DeskError(409, 'Saved delivery state needs investigation; do not dispatch.');
    if (hasUnresolved) throw new DeskError(409, 'Delivery unresolved. Check delivery; do not resend.');
    if (hasAttempt) throw new DeskError(409, 'This version already has a dispatch attempt');
  },

  fromSendResult(result) {
    return hasEvidence(result?.providerMessageId)
      ? outcome('SENT', 'send', 'provider_confirmed', result.providerMessageId)
      : outcome('UNKNOWN', 'send', 'provider_invalid_ack');
  },

  fromSendError(error) {
    if (error?.kind === 'not_accepted') return outcome('FAILED', 'send', 'provider_rejected_before_acceptance', null, true);
    const reason = ['TimeoutError', 'AbortError'].includes(error?.name) ? 'provider_timeout' : 'provider_result_unconfirmed';
    return outcome('UNKNOWN', 'send', reason);
  },

  fromLookupResult(result) {
    if (result?.state === 'delivered' && hasEvidence(result.providerMessageId)) {
      return outcome('SENT', 'lookup', 'lookup_delivered', result.providerMessageId);
    }
    return outcome('UNKNOWN', 'lookup', result?.state === 'not_found' ? 'lookup_not_found' : 'lookup_invalid_response');
  },

  fromLookupError() { return outcome('UNKNOWN', 'lookup', 'lookup_unavailable'); },
  fromInterruptedDispatch() { return outcome('UNKNOWN', 'recovery', 'process_interrupted'); },

  shouldApplyTransition(current, result) {
    if (!knownStates.has(current)) throw new DeskError(409, 'Unsupported delivery state');
    if (!result || !['SENT', 'FAILED', 'UNKNOWN'].includes(result.state)
      || !['send', 'lookup', 'recovery'].includes(result.source)) {
      throw new DeskError(409, 'Invalid delivery transition');
    }
    if (result.state === 'SENT' && (!hasEvidence(result.providerId) || result.source === 'recovery')) {
      throw new DeskError(409, 'Delivery confirmation requires provider evidence');
    }
    if (result.state === 'FAILED' && !(result.source === 'send' && result.notAccepted === true)) {
      throw new DeskError(409, 'Safe failure requires explicit rejection before acceptance');
    }
    // SENT and FAILED are terminal. Late responses never overwrite terminal evidence.
    return transitions[current].includes(result.state);
  }
});
