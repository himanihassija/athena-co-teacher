/**
 * Unit tests for the floor state machine itself (floor/floorMachine.ts).
 *
 * `scripts/floor.test.ts` already covers enforcement *around* the machine —
 * permits, handleAgentState, the transcript-driven address-detection path.
 * This file tests the machine's own pure transitions directly: no session
 * registry, no Agora, just (snapshot, policy, input) -> snapshot, which is
 * the whole point of it being pure per the file's own header comment.
 *
 * Run with: node --import tsx scripts/floorMachine.test.ts
 */

import assert from 'node:assert/strict';
import { DEFAULT_AGENT_POLICY, type AgentPolicy } from '@echosphere/shared-types';
import {
  decideSpeak,
  initialFloor,
  isAddressedToAgent,
  onAddressedAgent,
  onAgentSpeechEnd,
  onAgentSpeechStart,
  onHumanSpeechEnd,
  onHumanSpeechStart,
  onTeacherBargeIn,
  stripWakePhrase,
} from './../src/floor/floorMachine.ts';

let pass = 0;
const t = (name: string, fn: () => void) => {
  try {
    fn();
    pass += 1;
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.log(`  FAIL ${name}: ${(e as Error).message}`);
    process.exitCode = 1;
  }
};

const policy = (overrides: Partial<AgentPolicy> = {}): AgentPolicy => ({
  ...DEFAULT_AGENT_POLICY,
  ...overrides,
});

const NOW = 1_000_000;

// ─── initialFloor ────────────────────────────────────────────────────────────

t('initialFloor starts OPEN_FLOOR with no holder', () => {
  const floor = initialFloor(NOW);
  assert.equal(floor.state, 'OPEN_FLOOR');
  assert.equal(floor.holderId, null);
  assert.equal(floor.lastHumanSpeechAt, NOW);
  assert.equal(floor.since, NOW);
});

// ─── decideSpeak: precedence order ──────────────────────────────────────────

t('decideSpeak: mute vetoes everything, even a teacher-invoked command', () => {
  const floor = initialFloor(NOW);
  const result = decideSpeak(floor, policy({ muted: true }), 'TEACHER_INVOKED', {
    hasUnaddressedGap: false,
    now: NOW,
  });
  assert.equal(result.allowed, false);
  assert.equal(!result.allowed && result.reason, 'AGENT_MUTED');
});

t('decideSpeak: TEACHER_INVOKED bypasses the floor state entirely', () => {
  const floor: ReturnType<typeof initialFloor> = {
    ...initialFloor(NOW),
    state: 'TEACHER_HOLDS_FLOOR',
  };
  const result = decideSpeak(floor, policy(), 'TEACHER_INVOKED', {
    hasUnaddressedGap: false,
    now: NOW,
  });
  assert.equal(result.allowed, true);
});

t('decideSpeak: TEACHER_INVOKED still respects a disabled topic', () => {
  const floor = initialFloor(NOW);
  const result = decideSpeak(
    floor,
    policy({ disabledTopics: ['fractions'] }),
    'TEACHER_INVOKED',
    { hasUnaddressedGap: false, topic: 'unlike fractions', now: NOW },
  );
  assert.equal(result.allowed, false);
  assert.equal(!result.allowed && result.reason, 'TOPIC_DISABLED');
});

t('decideSpeak: the teacher holding the floor blocks autonomous speech', () => {
  const floor: ReturnType<typeof initialFloor> = {
    ...initialFloor(NOW),
    state: 'TEACHER_HOLDS_FLOOR',
  };
  const result = decideSpeak(floor, policy({ studentsMayInvoke: true }), 'DIRECTLY_ADDRESSED', {
    hasUnaddressedGap: false,
    now: NOW,
  });
  assert.equal(result.allowed, false);
  assert.equal(!result.allowed && result.reason, 'TEACHER_HOLDS_FLOOR');
});

t('decideSpeak: the agent cannot be granted a second, stacked turn', () => {
  const floor: ReturnType<typeof initialFloor> = {
    ...initialFloor(NOW),
    state: 'AGENT_SPEAKING',
  };
  const result = decideSpeak(floor, policy({ studentsMayInvoke: true }), 'DIRECTLY_ADDRESSED', {
    hasUnaddressedGap: false,
    now: NOW,
  });
  assert.equal(result.allowed, false);
  assert.equal(!result.allowed && result.reason, 'AGENT_ALREADY_SPEAKING');
});

t('decideSpeak: direct address is denied while studentsMayInvoke is off', () => {
  const floor = initialFloor(NOW);
  const result = decideSpeak(floor, policy({ studentsMayInvoke: false }), 'DIRECTLY_ADDRESSED', {
    hasUnaddressedGap: false,
    now: NOW,
  });
  assert.equal(result.allowed, false);
  assert.equal(!result.allowed && result.reason, 'STUDENT_INVOCATION_DISABLED');
});

t('decideSpeak: direct address is granted once studentsMayInvoke is on', () => {
  const floor = initialFloor(NOW);
  const result = decideSpeak(floor, policy({ studentsMayInvoke: true }), 'DIRECTLY_ADDRESSED', {
    hasUnaddressedGap: false,
    now: NOW,
  });
  assert.equal(result.allowed, true);
  assert.equal(result.allowed && result.trigger, 'DIRECTLY_ADDRESSED');
});

t('decideSpeak: direct address still respects a disabled topic', () => {
  const floor = initialFloor(NOW);
  const result = decideSpeak(
    floor,
    policy({ studentsMayInvoke: true, disabledTopics: ['exams'] }),
    'DIRECTLY_ADDRESSED',
    { hasUnaddressedGap: false, topic: 'the exams next week', now: NOW },
  );
  assert.equal(result.allowed, false);
  assert.equal(!result.allowed && result.reason, 'TOPIC_DISABLED');
});

t('decideSpeak: a silent interjection needs proactive mode ON', () => {
  const floor = initialFloor(NOW);
  const result = decideSpeak(
    floor,
    policy({ proactiveInterjectionsEnabled: false }),
    'GAP_DETECTED_IN_SILENCE',
    { hasUnaddressedGap: true, now: NOW + 10_000 },
  );
  assert.equal(result.allowed, false);
  assert.equal(!result.allowed && result.reason, 'SILENCE_GAP_TOO_SHORT');
});

t('decideSpeak: a silent interjection needs an actual unaddressed gap', () => {
  const floor = initialFloor(NOW);
  const result = decideSpeak(
    floor,
    policy({ proactiveInterjectionsEnabled: true }),
    'GAP_DETECTED_IN_SILENCE',
    { hasUnaddressedGap: false, now: NOW + 10_000 },
  );
  assert.equal(result.allowed, false);
  assert.equal(!result.allowed && result.reason, 'SILENCE_GAP_TOO_SHORT');
});

t('decideSpeak: a silent interjection needs the silence to clear the threshold', () => {
  const floor = initialFloor(NOW);
  const p = policy({ proactiveInterjectionsEnabled: true, silenceGapThresholdMs: 3500 });
  const tooSoon = decideSpeak(floor, p, 'GAP_DETECTED_IN_SILENCE', {
    hasUnaddressedGap: true,
    now: NOW + 1000,
  });
  assert.equal(tooSoon.allowed, false);

  const longEnough = decideSpeak(floor, p, 'GAP_DETECTED_IN_SILENCE', {
    hasUnaddressedGap: true,
    now: NOW + 3600,
  });
  assert.equal(longEnough.allowed, true);
});

// ─── Transitions ─────────────────────────────────────────────────────────────

t('onHumanSpeechStart: a teacher speaking takes the floor', () => {
  const floor = onHumanSpeechStart(initialFloor(NOW), 'teacher', 'p-teacher', NOW + 1);
  assert.equal(floor.state, 'TEACHER_HOLDS_FLOOR');
  assert.equal(floor.holderId, 'p-teacher');
  assert.equal(floor.lastHumanSpeechAt, NOW + 1);
});

t('onHumanSpeechStart: a student speaking leaves the floor open', () => {
  const floor = onHumanSpeechStart(initialFloor(NOW), 'student', 'p-student', NOW + 1);
  assert.equal(floor.state, 'OPEN_FLOOR');
  assert.equal(floor.holderId, 'p-student');
});

t('onHumanSpeechEnd: resets to OPEN_FLOOR when the agent was not speaking', () => {
  const held = onHumanSpeechStart(initialFloor(NOW), 'teacher', 'p-teacher', NOW + 1);
  const ended = onHumanSpeechEnd(held, NOW + 2);
  assert.equal(ended.state, 'OPEN_FLOOR');
  assert.equal(ended.holderId, null);
});

t('onHumanSpeechEnd: does not clobber AGENT_SPEAKING (only bumps the clock)', () => {
  const speaking = onAgentSpeechStart(initialFloor(NOW), NOW + 1);
  const stillSpeaking = onHumanSpeechEnd(speaking, NOW + 2);
  assert.equal(stillSpeaking.state, 'AGENT_SPEAKING');
  assert.equal(stillSpeaking.lastHumanSpeechAt, NOW + 2);
});

t('onAddressedAgent: opens STUDENT_QUESTION_PENDING for the addresser', () => {
  const floor = onAddressedAgent(initialFloor(NOW), 'p-student', NOW + 1);
  assert.equal(floor.state, 'STUDENT_QUESTION_PENDING');
  assert.equal(floor.holderId, 'p-student');
});

t('onAgentSpeechStart / onAgentSpeechEnd round-trip back to OPEN_FLOOR', () => {
  const speaking = onAgentSpeechStart(initialFloor(NOW), NOW + 1);
  assert.equal(speaking.state, 'AGENT_SPEAKING');
  assert.equal(speaking.holderId, null);

  const ended = onAgentSpeechEnd(speaking, NOW + 2);
  assert.equal(ended.state, 'OPEN_FLOOR');
  assert.equal(ended.holderId, null);
});

t('onAgentSpeechStart preserves lastHumanSpeechAt across the turn', () => {
  const before = { ...initialFloor(NOW), lastHumanSpeechAt: NOW - 500 };
  const speaking = onAgentSpeechStart(before, NOW + 1);
  assert.equal(speaking.lastHumanSpeechAt, NOW - 500);
});

t('onTeacherBargeIn: signals mustInterruptAgent only when the agent was speaking', () => {
  const idle = onTeacherBargeIn(initialFloor(NOW), 'p-teacher', NOW + 1);
  assert.equal(idle.mustInterruptAgent, false);
  assert.equal(idle.floor.state, 'TEACHER_HOLDS_FLOOR');

  const speaking = onAgentSpeechStart(initialFloor(NOW), NOW + 1);
  const bargedIn = onTeacherBargeIn(speaking, 'p-teacher', NOW + 2);
  assert.equal(bargedIn.mustInterruptAgent, true);
  assert.equal(bargedIn.floor.state, 'TEACHER_HOLDS_FLOOR');
  assert.equal(bargedIn.floor.holderId, 'p-teacher');
});

// ─── Wake-phrase detection ───────────────────────────────────────────────────

t('isAddressedToAgent: matches the configured wake phrase', () => {
  assert.equal(isAddressedToAgent('Hey Athena, can you help?', 'hey athena'), true);
});

t('isAddressedToAgent: tolerates common ASR mishearings of the name', () => {
  assert.equal(isAddressedToAgent('Xena, what is a fraction?', 'hey athena'), true);
  assert.equal(isAddressedToAgent('Tina can you explain that again', 'hey athena'), true);
});

t('isAddressedToAgent: unrelated speech does not match', () => {
  assert.equal(isAddressedToAgent('I think the answer is twelve', 'hey athena'), false);
});

t('isAddressedToAgent: empty text never matches', () => {
  assert.equal(isAddressedToAgent('', 'hey athena'), false);
});

t('stripWakePhrase: removes the name so gap-detection sees only the question', () => {
  const stripped = stripWakePhrase('Hey Athena, what is a common denominator?', 'hey athena');
  assert.equal(/athena/i.test(stripped), false);
  assert.match(stripped, /common denominator/i);
});

console.log(`\n${pass} passing`);
