import assert from 'node:assert/strict';
import { evaluateGate } from '../src/agent/interventionGate.js';

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

t('Silent mode blocks everything', () => {
  const result = evaluateGate({
    mode: 'silent',
    isTeacherSpeaking: false,
    silenceDurationMs: 10000,
    isDirectAddress: true,
    unansweredQuestionAgeMs: 5000,
    attributionConfidence: 1.0,
  });
  assert.equal(result.allowed, false);
  assert.equal(result.score, 0.0);
  assert.match(result.reason, /Silent/i);
});

t('Teacher speaking blocks everything', () => {
  const result = evaluateGate({
    mode: 'proactive',
    isTeacherSpeaking: true,
    silenceDurationMs: 10000,
    isDirectAddress: true,
    unansweredQuestionAgeMs: 5000,
    attributionConfidence: 1.0,
  });
  assert.equal(result.allowed, false);
  assert.equal(result.score, 0.0);
  assert.match(result.reason, /teacher is speaking/i);
});

t('Direct address allows speaking', () => {
  const result = evaluateGate({
    mode: 'on-request',
    isTeacherSpeaking: false,
    silenceDurationMs: 500,
    isDirectAddress: true,
    unansweredQuestionAgeMs: 0,
    attributionConfidence: 1.0,
  });
  assert.equal(result.allowed, true);
  assert.equal(result.score, 1.0);
  assert.match(result.reason, /direct address/i);
});

t('Low confidence direct address is blocked', () => {
  const result = evaluateGate({
    mode: 'on-request',
    isTeacherSpeaking: false,
    silenceDurationMs: 500,
    isDirectAddress: true,
    unansweredQuestionAgeMs: 0,
    attributionConfidence: 0.4,
  });
  assert.equal(result.allowed, false);
  assert.equal(result.score, 0.4);
});

t('On-request mode blocks non-direct address', () => {
  const result = evaluateGate({
    mode: 'on-request',
    isTeacherSpeaking: false,
    silenceDurationMs: 10000,
    isDirectAddress: false,
    unansweredQuestionAgeMs: 5000,
    attributionConfidence: 1.0,
  });
  assert.equal(result.allowed, false);
  assert.equal(result.score, 0.0);
});

t('Proactive mode: short silence, no question is suppressed', () => {
  const result = evaluateGate({
    mode: 'proactive',
    isTeacherSpeaking: false,
    silenceDurationMs: 1000,
    isDirectAddress: false,
    unansweredQuestionAgeMs: 0,
    attributionConfidence: 1.0,
  });
  assert.equal(result.allowed, false);
  assert.ok(result.score < 0.60);
});

t('Proactive mode: long silence and unanswered question clears threshold', () => {
  const result = evaluateGate({
    mode: 'proactive',
    isTeacherSpeaking: false,
    silenceDurationMs: 12000, // contributes ~0.2
    isDirectAddress: false,
    unansweredQuestionAgeMs: 8000, // contributes 0.5 (max capped at 0.5)
    attributionConfidence: 1.0,
  });
  // Total score should be around 0.2 + 0.5 = 0.70
  assert.equal(result.allowed, true);
  assert.ok(result.score >= 0.60);
});

t('Proactive mode: low attribution confidence scales down and suppresses', () => {
  const result = evaluateGate({
    mode: 'proactive',
    isTeacherSpeaking: false,
    silenceDurationMs: 12000,
    isDirectAddress: false,
    unansweredQuestionAgeMs: 8000,
    attributionConfidence: 0.5, // scales 0.70 down to 0.35
  });
  assert.equal(result.allowed, false);
  assert.ok(result.score < 0.60);
});

console.log(`\n${pass} passing`);
