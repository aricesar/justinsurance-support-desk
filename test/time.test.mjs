import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTimestamp, formatTimestamp, formatAge } from '../public/time.mjs';

const now = Date.parse('2026-10-31T12:00:00Z');
test('relative ages are deterministic and use correct English units', () => {
  for (const [seconds, expected] of [[0, 'Just now'], [10, '10 seconds ago'], [60, '1 minute ago'],
    [120, '2 minutes ago'], [3600, '1 hour ago'], [7200, '2 hours ago'], [86400, '1 day ago']]) {
    assert.equal(formatAge(new Date(now - seconds * 1000).toISOString(), now), expected);
  }
});

test('missing, invalid and future timestamps are not shown as misleading elapsed time', () => {
  for (const value of [null, '', 'invalid', 123]) {
    assert.equal(formatAge(value, now), 'Not recorded');
    assert.equal(formatTimestamp(value), 'Not recorded');
  }
  assert.match(formatAge(new Date(now + 10000).toISOString(), now), /Clock difference/);
});

test('original SQLite timestamps are interpreted as UTC rather than local browser time', () => {
  assert.equal(parseTimestamp('2026-10-31 12:00:00'), now);
  assert.match(formatTimestamp('2026-10-31 12:00:00'), /2026/);
});
