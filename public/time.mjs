export function parseTimestamp(value) {
  if (typeof value !== 'string' || !value) return NaN;
  // SQLite's original CURRENT_TIMESTAMP values are UTC without a suffix.
  return Date.parse(value.includes('T') ? value : value.replace(' ', 'T') + 'Z');
}

export function formatTimestamp(value) {
  const timestamp = parseTimestamp(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short'
  }) : 'Not recorded';
}

export function formatAge(value, now = Date.now()) {
  const timestamp = parseTimestamp(value);
  if (!Number.isFinite(timestamp)) return 'Not recorded';
  const milliseconds = now - timestamp;
  if (milliseconds < -1000) return 'Clock difference; check the timestamp';
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  if (seconds < 5) return 'Just now';
  let amount = seconds, unit = 'second';
  if (seconds >= 86400) { amount = Math.floor(seconds / 86400); unit = 'day'; }
  else if (seconds >= 3600) { amount = Math.floor(seconds / 3600); unit = 'hour'; }
  else if (seconds >= 60) { amount = Math.floor(seconds / 60); unit = 'minute'; }
  return `${amount} ${unit}${amount === 1 ? '' : 's'} ago`;
}
