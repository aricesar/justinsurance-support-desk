import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readJsonObject, MAX_BODY_BYTES } from '../src/http-body.mjs';

test('JSON reader preserves UTF-8 across every possible byte boundary', async () => {
  const value = { body: 'Hello \u{1F642} cafe\u0301 \u{1F469}\u200D\u{1F4BB}' };
  const bytes = Buffer.from(JSON.stringify(value));
  for (let i = 1; i < bytes.length; i++) {
    assert.deepEqual(await readJsonObject(Readable.from([bytes.subarray(0, i), bytes.subarray(i)])), value);
  }
});

test('JSON reader limits bytes, not decoded character count', async () => {
  const bytes = Buffer.from(JSON.stringify({ body: '\u00E1'.repeat(51000) }));
  assert.ok(bytes.length > MAX_BODY_BYTES);
  await assert.rejects(readJsonObject(Readable.from([bytes])), error => error.status === 413);
});

test('JSON reader rejects malformed UTF-8, invalid JSON and non-object bodies', async () => {
  for (const bytes of [Buffer.from([0xc3, 0x28]), Buffer.from('{bad'), Buffer.from('[]'), Buffer.from('null')]) {
    await assert.rejects(readJsonObject(Readable.from([bytes])), error => error.status === 400);
  }
  assert.deepEqual(await readJsonObject(Readable.from([])), {});
});
