/**
 * Tests for the shared-board scene merge (see whiteboard/boardSession.ts).
 *
 * The failure this guards against: a client posting a scene it drew before it
 * saw someone else's edit. Replacing the stored scene wholesale would erase
 * that edit; merging per element by Excalidraw's own `version` counter cannot.
 *
 * Run with: node --import tsx scripts/board.test.ts
 */

import assert from 'node:assert/strict';
import type { BoardElement, BoardFile } from '@echosphere/shared-types';
import {
  applyBoardCommand,
  mergeSceneElements,
  mergeSceneFiles,
  publicWhiteboard,
} from './../src/whiteboard/boardSession.ts';
import { createSession } from './../src/state/sessionRegistry.ts';

let pass = 0;
const t = (name: string, fn: () => void): void => {
  try { fn(); pass += 1; console.log(`  ok  ${name}`); }
  catch (e) { console.log(`  FAIL ${name}: ${(e as Error).message}`); process.exitCode = 1; }
};

const el = (id: string, version: number, extra: Record<string, unknown> = {}): BoardElement =>
  ({ id, version, ...extra });

t('an empty board takes everything it is given', () => {
  const s = createSession('t');
  mergeSceneElements(s, [el('a', 1), el('b', 1)]);
  assert.equal(s.whiteboard.scene.length, 2);
});

t('a newer version of an element replaces the older one', () => {
  const s = createSession('t');
  mergeSceneElements(s, [el('a', 1, { x: 10 })]);
  mergeSceneElements(s, [el('a', 2, { x: 99 })]);
  assert.equal(s.whiteboard.scene.length, 1, 'must not duplicate the element');
  assert.equal(s.whiteboard.scene[0]?.x, 99);
});

t('a stale version is ignored rather than overwriting newer work', () => {
  const s = createSession('t');
  mergeSceneElements(s, [el('a', 5, { x: 99 })]);
  mergeSceneElements(s, [el('a', 2, { x: 10 })]);
  assert.equal(s.whiteboard.scene[0]?.x, 99, 'the newer edit must survive');
});

t('a partial post does not delete elements it never mentioned', () => {
  const s = createSession('t');
  mergeSceneElements(s, [el('a', 1), el('b', 1), el('c', 1)]);
  // A client sends only the element it just moved.
  mergeSceneElements(s, [el('b', 2)]);
  assert.deepEqual(
    s.whiteboard.scene.map((e) => e.id).sort(),
    ['a', 'b', 'c'],
    'the other two strokes must still be on the board',
  );
});

t('a deletion is just another versioned change', () => {
  const s = createSession('t');
  mergeSceneElements(s, [el('a', 1)]);
  mergeSceneElements(s, [el('a', 2, { isDeleted: true })]);
  assert.equal(s.whiteboard.scene[0]?.isDeleted, true);
});

t('an equal version still applies, since Excalidraw reuses it on no-op edits', () => {
  const s = createSession('t');
  mergeSceneElements(s, [el('a', 3, { x: 1 })]);
  mergeSceneElements(s, [el('a', 3, { x: 2 })]);
  assert.equal(s.whiteboard.scene[0]?.x, 2);
});

t('the board starts empty and not presenting', () => {
  const s = createSession('t');
  assert.deepEqual(s.whiteboard.scene, []);
  assert.deepEqual(s.whiteboard.files, []);
  assert.equal(s.whiteboard.presenting, null);
});

/**
 * The bytes behind an inserted image.
 *
 * An Excalidraw `image` element carries only a `fileId`; the pixels live in a
 * separate map. The board used to carry elements alone, so a student was handed
 * a picture frame with no picture and drew Excalidraw's grey placeholder.
 */
const file = (id: string, bytes = 10): BoardFile =>
  ({ id, dataURL: `data:image/png;base64,${'A'.repeat(bytes)}`, mimeType: 'image/png', created: 1 });

t('an image the board has not seen is stored and reported as new', () => {
  const s = createSession('t');
  const added = mergeSceneFiles(s, [file('f1')]);
  assert.equal(s.whiteboard.files.length, 1);
  assert.deepEqual(added.map((f) => f.id), ['f1'], 'new files are what gets rebroadcast');
});

t('a file already held is not stored twice, nor put back on the bus', () => {
  const s = createSession('t');
  mergeSceneFiles(s, [file('f1')]);
  const added = mergeSceneFiles(s, [file('f1')]);
  assert.equal(s.whiteboard.files.length, 1, 'no duplicate');
  assert.deepEqual(added, [], 'a photo must not be rebroadcast every time its element moves');
});

t('the first copy of a file id wins, since a file never changes', () => {
  const s = createSession('t');
  mergeSceneFiles(s, [file('f1', 10)]);
  mergeSceneFiles(s, [{ ...file('f1', 10), dataURL: 'data:image/png;base64,ZZZZ' }]);
  assert.match(s.whiteboard.files[0]!.dataURL, /AAAA/);
});

t('one absurd file is skipped without blocking the rest of the batch', () => {
  const s = createSession('t');
  const added = mergeSceneFiles(s, [file('huge', 7 * 1024 * 1024), file('small')]);
  assert.deepEqual(added.map((f) => f.id), ['small']);
});

t('clearing the board drops its images too, so the memory is actually freed', () => {
  const s = createSession('t');
  mergeSceneFiles(s, [file('f1')]);
  applyBoardCommand(s, { action: 'clear', source: 'teacher' });
  assert.deepEqual(s.whiteboard.files, []);
});

t('the public state carries the files, so a late joiner gets the pictures', () => {
  const s = createSession('t');
  mergeSceneElements(s, [el('img', 1, { type: 'image', fileId: 'f1' })]);
  mergeSceneFiles(s, [file('f1')]);
  const pub = publicWhiteboard(s);
  assert.equal(pub.scene.length, 1);
  assert.deepEqual(pub.files.map((f) => f.id), ['f1']);
});

console.log(`\n${pass} passing`);
