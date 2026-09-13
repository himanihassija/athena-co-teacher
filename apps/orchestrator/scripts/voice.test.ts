/**
 * Tests for spoken board commands (see whiteboard/voice.ts).
 *
 * Written from a real session where nothing reached the board. The teacher said
 * "Right on the whiteboard. Two plus two equal four" — speech recognition heard
 * "right" for "write", and the content followed the command instead of
 * preceding it. Both forms returned null.
 *
 * Run with: node --import tsx scripts/voice.test.ts
 */

import assert from 'node:assert/strict';
import { parseVoiceBoardCommand } from './../src/whiteboard/voice.ts';

let pass = 0;
const t = (name: string, fn: () => void): void => {
  try { fn(); pass += 1; console.log(`  ok  ${name}`); }
  catch (e) { console.log(`  FAIL ${name}: ${(e as Error).message}`); process.exitCode = 1; }
};

t('content before the phrase still works', () => {
  const r = parseVoiceBoardCommand('write two plus two equals four on the board');
  assert.equal(r?.action, 'write');
  assert.equal(r?.text, 'two plus two equals four');
});

t('content after the phrase, in the same sentence', () => {
  const r = parseVoiceBoardCommand('Athena, write on the whiteboard two plus two equals four');
  assert.equal(r?.action, 'write');
  assert.match(r?.text ?? '', /two plus two equals four/i);
});

t('content in the sentence that follows — the live failure', () => {
  const r = parseVoiceBoardCommand('Write on the whiteboard. Two plus two equal four');
  assert.equal(r?.action, 'write');
  assert.match(r?.text ?? '', /two plus two equal four/i);
});

t('"right" is accepted for "write", which is what ASR returns', () => {
  const r = parseVoiceBoardCommand('Right on the whiteboard. Two plus two equal four');
  assert.equal(r?.action, 'write');
  assert.match(r?.text ?? '', /two plus two equal four/i);
});

t('a bare demonstrative is not board content', () => {
  // Previously wrote the literal word "this" onto the board.
  assert.equal(parseVoiceBoardCommand('Athena write this on the board'), null);
  assert.equal(parseVoiceBoardCommand('write that on the whiteboard'), null);
});

t('"right" on its own is never a board command', () => {
  assert.equal(parseVoiceBoardCommand('Right, so the denominator stays the same'), null);
  assert.equal(parseVoiceBoardCommand('That is right'), null);
});

t('ordinary lesson talk is still ignored', () => {
  assert.equal(parseVoiceBoardCommand('Add the numerators after you find the LCD.'), null);
  assert.equal(parseVoiceBoardCommand('Can everyone hear me?'), null);
});

t('show, hide and clear still parse', () => {
  assert.equal(parseVoiceBoardCommand('Athena, show the whiteboard')?.action, 'show');
  assert.equal(parseVoiceBoardCommand('hide the whiteboard')?.action, 'hide');
  assert.equal(parseVoiceBoardCommand('clear the board')?.action, 'clear');
});

t('a write is not mistaken for a show', () => {
  const r = parseVoiceBoardCommand('show the LCD of 2 and 3 on the board');
  assert.equal(r?.action, 'write', 'content plus "on the board" is a write, not a show');
});

console.log(`\n${pass} passing`);
