import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DraftEditor } from '../public/draft-editor.mjs';

test('refresh, takeover and reconciliation updates preserve an unsaved draft', () => {
  const editor = new DraftEditor();
  editor.open('alpha:101', { draft: 'saved', version: 1 });
  editor.edit('alpha:101', 'unsaved 🙂');
  for (const status of ['DRAFT', 'UNKNOWN', 'SENT']) {
    const buffer = editor.open('alpha:101', { draft: 'saved', version: 1, send_state: status, owner: 'human' });
    assert.equal(buffer.body, 'unsaved 🙂');
    assert.equal(editor.isDirty('alpha:101'), true);
  }
});

test('buffers are isolated by identity and ticket, and survive switching back', () => {
  const editor = new DraftEditor();
  editor.open('alpha:101', { draft: 'Alpha', version: 1 });
  editor.edit('alpha:101', 'Alpha local edits');
  assert.equal(editor.open('beta:202', { draft: 'Beta', version: 2 }).body, 'Beta');
  assert.equal(editor.open('beta:101', { draft: 'Other identity', version: 1 }).body, 'Other identity');
  assert.equal(editor.open('alpha:101', { draft: 'Alpha', version: 1 }).body, 'Alpha local edits');
});

test('remote edits do not silently replace dirty text or advance its save version', () => {
  const editor = new DraftEditor();
  editor.open('alpha:101', { draft: 'old', version: 1 });
  editor.edit('alpha:101', 'local');
  const buffer = editor.open('alpha:101', { draft: 'remote', version: 2 });
  assert.equal(buffer.body, 'local');
  assert.equal(buffer.version, 1);
  assert.equal(editor.open('alpha:101', { draft: 'remote', version: 2 }, { saved: true }).body, 'remote');
  assert.equal(editor.isDirty('alpha:101'), false);
});

test('successful save clears dirty state and clean refresh adopts a newer saved draft', () => {
  const editor = new DraftEditor();
  editor.open('alpha:101', { draft: '', version: 0 });
  editor.edit('alpha:101', 'new');
  editor.open('alpha:101', { draft: 'new', version: 1 }, { saved: true });
  assert.equal(editor.isDirty('alpha:101'), false);
  assert.deepEqual(editor.open('alpha:101', { draft: 'remote update', version: 2 }), {
    body: 'remote update', savedBody: 'remote update', version: 2
  });
});
