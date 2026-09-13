/**
 * Tests for the brace control channel (see src/agent/control.ts).
 *
 * These matter more than their size suggests: the parser reads model output, so
 * its failure modes are the model's failure modes — an unbalanced apostrophe in
 * spoken prose, a half-formed object, braces that are genuinely part of what was
 * said. Every case below is one of those, not a happy path.
 *
 * Run with: node --import tsx scripts/control.test.ts
 */

import assert from 'node:assert/strict';
import { parseAgentTurn, matchParticipantByName } from '../src/agent/control.ts';

let pass = 0;
const t = (name: string, fn: () => void) => {
  try { fn(); pass += 1; console.log(`  ok  ${name}`); }
  catch (e) { console.log(`  FAIL ${name}: ${(e as Error).message}`); process.exitCode = 1; }
};

t('plain speech, no payload', () => {
  const r = parseAgentTurn('Think about what the denominator counts.');
  assert.equal(r.spoken, 'Think about what the denominator counts.');
  assert.equal(r.control, null);
});

t('strips a "to" payload', () => {
  const r = parseAgentTurn('Good question, Ana. Halves and thirds are different sizes. {"to":"Ana"}');
  assert.equal(r.spoken, 'Good question, Ana. Halves and thirds are different sizes.');
  assert.equal(r.control?.to, 'Ana');
});

t("apostrophe in prose doesn't hide the JSON", () => {
  const r = parseAgentTurn(`That's why you can't just add them. {"to":"Bilal"}`);
  assert.equal(r.control?.to, 'Bilal');
  assert.ok(!r.spoken.includes('{'));
});

t('reads a quiz payload', () => {
  const r = parseAgentTurn(
    'Quick check. A: add the denominators. B: find the LCD. C: multiply. ' +
    '{"quiz":{"topic":"LCD","question":"What comes first?","options":["Add the denominators","Find the LCD","Multiply"],"answer":"B","difficulty":"easy"}}'
  );
  assert.equal(r.control?.quiz?.answer, 'B');
  assert.equal(r.control?.quiz?.options.length, 3);
  assert.ok(!r.spoken.includes('{'));
});

t('reads a gap payload', () => {
  const r = parseAgentTurn('Let me try that differently. {"to":"Ana","gap":{"topic":"common denominator","students":["Ana","Bilal"]}}');
  assert.equal(r.control?.gap?.students.length, 2);
  assert.equal(r.control?.gap?.topic, 'common denominator');
});

t('empty payload still strips braces', () => {
  const r = parseAgentTurn('Carry on. {}');
  assert.equal(r.spoken, 'Carry on.');
  assert.deepEqual(r.control, {});
});

t('malformed JSON is left alone, never thrown on', () => {
  const r = parseAgentTurn('Hmm {this is not json}');
  assert.equal(r.control, null);
  assert.ok(r.spoken.length > 0);
});

t('a quiz missing required fields is rejected, not half-read', () => {
  const r = parseAgentTurn('Question. {"quiz":{"topic":"x","question":"y"}}');
  assert.equal(r.control?.quiz, undefined);
});

t('math braces in speech do not become a payload', () => {
  const r = parseAgentTurn('The set is {1, 2, 3} as we said.');
  assert.equal(r.control, null);
});

t('name matching is loose', () => {
  const roster = [{ participantId: 'p1', displayName: 'Ana' }, { participantId: 'p2', displayName: 'Bilal' }];
  assert.equal(matchParticipantByName(roster, 'ana'), 'p1');
  assert.equal(matchParticipantByName(roster, 'Bilal '), 'p2');
  assert.equal(matchParticipantByName(roster, 'Nobody'), undefined);
});

t('reads a board write payload', () => {
  const r = parseAgentTurn(
    'Here is the method. {"board":{"action":"write","text":"LCD of 2 and 3 is 6"}}',
  );
  assert.equal(r.control?.board?.action, 'write');
  assert.equal(r.control?.board?.text, 'LCD of 2 and 3 is 6');
  assert.ok(!r.spoken.includes('{'));
});

console.log(`\n${pass} passing`);
