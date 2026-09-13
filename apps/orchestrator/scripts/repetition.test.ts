/**
 * Tests for the repeat loop and the spoken-answer path (see gaps/gapDetector.ts,
 * floor/floorMachine.ts, classroomController.ts).
 *
 * The gaps these lock down, all observed together in one live lesson:
 *
 *   1. Athena repeated the same interjection four times in a row. The prompt
 *      asks her to report a class-wide gap on the control channel, and the turn
 *      where she EXPLAINS a gap satisfies that instruction — so her own report
 *      cleared `addressedAt` on the gap she had just addressed, the one-second
 *      silence tick found it pending again, and round it went.
 *
 *   2. Every quiz that timed out manufactured a fresh gap, because the blank
 *      answer submitted on behalf of anyone who did not answer was fed to the
 *      gap detector as a wrong answer. Two non-answers crossed the class-wide
 *      threshold on their own.
 *
 *   3. Answering out loud did nothing. Athena reads all four options aloud, so
 *      "Option B" is a literal substring of her own sentence and the self-echo
 *      filter discarded it. Between that and a 15s deadline that started while
 *      she was still reading the options, there was barely a window in which a
 *      spoken answer could count at all.
 *
 * Run with: node --env-file=.env --import tsx scripts/repetition.test.ts
 */

import assert from 'node:assert/strict';
import type { ClassroomEvent } from '@echosphere/shared-types';
import { DEFAULT_AGENT_POLICY, QUIZ_DURATION_MS } from '@echosphere/shared-types';
import {
  applyControl,
  ingestTranscript,
  releaseFloor,
  scheduleQuizClose,
  submitQuizAnswer,
  sweepExpiredQuiz,
} from './../src/classroomController.ts';
import { rememberAgentUtterance, stripSelfEcho } from './../src/agent/echo.ts';
import {
  markGapAddressed,
  pendingClassWideGap,
  recordReportedGap,
  recordWrongAnswer,
} from './../src/gaps/gapDetector.ts';
import { decideSpeak, initialFloor } from './../src/floor/floorMachine.ts';
import {
  answersFor,
  optionIndicesMentioned,
  recordQuizFromControl,
} from './../src/quiz/quizEngine.ts';
import { subscribe } from './../src/state/eventBus.ts';
import { addParticipant, createSession } from './../src/state/sessionRegistry.ts';

let pass = 0;
const t = async (name: string, fn: () => void | Promise<void>): Promise<void> => {
  try { await fn(); pass += 1; console.log(`  ok  ${name}`); }
  catch (e) { console.log(`  FAIL ${name}: ${(e as Error).message}`); process.exitCode = 1; }
};

function recorder(sessionId: string, role: 'teacher' | 'student' = 'teacher') {
  const events: ClassroomEvent[] = [];
  const stop = subscribe(sessionId, {
    subscriberId: 'test',
    participantId: 'test',
    role,
    send: (e) => events.push(e),
    close: () => undefined,
  });
  return { events, stop };
}

/** A class with two students, which is the threshold for a class-wide gap. */
function classroom() {
  const session = createSession('Fractions');
  const ana = addParticipant(session, { displayName: 'Ana', role: 'student' });
  const bilal = addParticipant(session, { displayName: 'Bilal', role: 'student' });
  return { session, ana, bilal };
}

// ─── 1. The interjection repeat loop ─────────────────────────────────────────

await t('her own gap report does not re-open the gap she was just sent to address', () => {
  const { session, ana, bilal } = classroom();
  recordReportedGap(session, 'common denominator', [ana.participantId, bilal.participantId]);

  const gap = pendingClassWideGap(session);
  assert.ok(gap, 'two students reporting the same confusion is a class-wide gap');
  markGapAddressed(session, gap.gapId);
  assert.equal(pendingClassWideGap(session), undefined, 'addressed, so nothing pending');

  // The turn where she explains it carries the same gap payload, as the prompt asks.
  applyControl(session, {
    gap: { topic: 'common denominator', students: ['Ana', 'Bilal'] },
  });

  assert.equal(
    pendingClassWideGap(session),
    undefined,
    'her own echo of the gap must not make it pending again',
  );
});

await t('a student getting it wrong DOES re-open an addressed gap', () => {
  const { session, ana, bilal } = classroom();
  recordReportedGap(session, 'common denominator', [ana.participantId, bilal.participantId]);
  const gap = pendingClassWideGap(session)!;
  markGapAddressed(session, gap.gapId);
  // She finished explaining a few seconds ago; the student answers after that.
  gap.addressedAt = Date.now() - 5_000;

  const quiz = recordQuizFromControl(
    session,
    { topic: 'common denominator', question: 'LCD of 1/2 and 1/3?', options: ['two', 'three', 'five', 'six'], answer: 'D' },
    'gap-detector',
  );
  recordWrongAnswer(session, quiz, ana.participantId, 'two');

  assert.ok(
    pendingClassWideGap(session),
    'real evidence from a student must still re-raise the gap',
  );
});

await t('a self-report re-opens the gap again once the cooldown has passed', () => {
  const { session, ana, bilal } = classroom();
  recordReportedGap(session, 'common denominator', [ana.participantId, bilal.participantId]);
  const gap = pendingClassWideGap(session)!;
  // Addressed a long time ago: the class has moved on and come back to it.
  gap.addressedAt = Date.now() - 10 * 60_000;

  recordReportedGap(session, 'common denominator', [ana.participantId, bilal.participantId]);
  assert.ok(
    pendingClassWideGap(session),
    'a misconception that genuinely resurfaces later must still be raised',
  );
});

// ─── 2. The floor cooldown backstop ──────────────────────────────────────────

await t('the floor refuses a second interjection on a topic she just covered', () => {
  const now = Date.now();
  const floor = { ...initialFloor(now), lastHumanSpeechAt: now - 60_000 };
  const inputs = { hasUnaddressedGap: true, topic: 'common denominator', now };

  const first = decideSpeak(floor, DEFAULT_AGENT_POLICY, 'GAP_DETECTED_IN_SILENCE', inputs);
  assert.equal(first.allowed, true, 'the first interjection is allowed');

  const second = decideSpeak(floor, DEFAULT_AGENT_POLICY, 'GAP_DETECTED_IN_SILENCE', {
    ...inputs,
    msSinceTopicInterjection: 1_000,
  });
  assert.equal(second.allowed, false);
  assert.equal(!second.allowed && second.reason, 'TOPIC_RECENTLY_ADDRESSED');
});

await t('the cooldown expires, and it never blocks a topic she has not covered', () => {
  const now = Date.now();
  const floor = { ...initialFloor(now), lastHumanSpeechAt: now - 60_000 };
  const inputs = { hasUnaddressedGap: true, topic: 'common denominator', now };

  assert.equal(
    decideSpeak(floor, DEFAULT_AGENT_POLICY, 'GAP_DETECTED_IN_SILENCE', {
      ...inputs,
      msSinceTopicInterjection: DEFAULT_AGENT_POLICY.topicInterjectionCooldownMs + 1,
    }).allowed,
    true,
  );
  assert.equal(
    decideSpeak(floor, DEFAULT_AGENT_POLICY, 'GAP_DETECTED_IN_SILENCE', inputs).allowed,
    true,
    'a topic with no recorded interjection is unaffected',
  );
});

await t('the cooldown does not gag a teacher command or a direct address', () => {
  const now = Date.now();
  const floor = { ...initialFloor(now), lastHumanSpeechAt: now - 60_000 };
  const recent = { hasUnaddressedGap: true, topic: 'common denominator', now, msSinceTopicInterjection: 500 };

  assert.equal(decideSpeak(floor, DEFAULT_AGENT_POLICY, 'TEACHER_INVOKED', recent).allowed, true);
  assert.equal(decideSpeak(floor, DEFAULT_AGENT_POLICY, 'QUIZ_DELIVERY', recent).allowed, true);
  assert.equal(
    decideSpeak(
      floor,
      { ...DEFAULT_AGENT_POLICY, studentsMayInvoke: true },
      'DIRECTLY_ADDRESSED',
      recent,
    ).allowed,
    true,
  );
});

await t('mute still outranks everything, cooldown or not', () => {
  const now = Date.now();
  const floor = { ...initialFloor(now), lastHumanSpeechAt: now - 60_000 };
  const decision = decideSpeak(
    floor,
    { ...DEFAULT_AGENT_POLICY, muted: true },
    'GAP_DETECTED_IN_SILENCE',
    { hasUnaddressedGap: true, topic: 'x', now },
  );
  assert.equal(!decision.allowed && decision.reason, 'AGENT_MUTED');
});

// ─── 3. Timed-out quizzes must not manufacture gaps ──────────────────────────

await t('a quiz nobody answers does not invent a class-wide gap', () => {
  const { session, ana, bilal } = classroom();
  const quiz = recordQuizFromControl(
    session,
    { topic: 'common denominator', question: 'LCD of 1/2 and 1/3?', options: ['two', 'three', 'five', 'six'], answer: 'D' },
    'gap-detector',
    [ana.participantId, bilal.participantId],
  );
  quiz.deadline = Date.now() - 1;
  sweepExpiredQuiz(session, quiz.quizId);

  assert.equal(answersFor(session, quiz.quizId).length, 2, 'both still scored as incorrect');
  assert.equal(
    pendingClassWideGap(session),
    undefined,
    'not answering is not evidence of a misconception',
  );
  assert.equal(session.gaps.size, 0);
});

await t('a non-answer still counts against the student mastery stats', () => {
  const { session, ana } = classroom();
  const quiz = recordQuizFromControl(
    session,
    { topic: 'x', question: 'q', options: ['a', 'b'], answer: 'A' },
    'teacher',
    [ana.participantId],
  );
  submitQuizAnswer(session, quiz.quizId, ana.participantId, '', 'ui');
  const profile = session.participants.get(ana.participantId) as { stats: { quizzesAnswered: number; quizzesCorrect: number } };
  assert.equal(profile.stats.quizzesAnswered, 1);
  assert.equal(profile.stats.quizzesCorrect, 0);
});

await t('a real wrong answer still builds a gap', () => {
  const { session, ana, bilal } = classroom();
  const quiz = recordQuizFromControl(
    session,
    { topic: 'common denominator', question: 'LCD of 1/2 and 1/3?', options: ['two', 'three', 'five', 'six'], answer: 'D' },
    'teacher',
    [ana.participantId, bilal.participantId],
  );
  submitQuizAnswer(session, quiz.quizId, ana.participantId, 'two', 'ui');
  submitQuizAnswer(session, quiz.quizId, bilal.participantId, 'three', 'ui');
  assert.ok(pendingClassWideGap(session), 'two students genuinely wrong is a real gap');
});

// ─── 4. Answering out loud ───────────────────────────────────────────────────

const QUIZ_TURN =
  'What is three plus two? Option A four Option B five Option C six Option D seven ' +
  '{"quiz":{"topic":"addition","question":"What is three plus two?","options":["four","five","six","seven"],"answer":"B"}}';

/** Drives Athena asking the question, exactly as it arrives from the engine. */
async function askQuiz(session: ReturnType<typeof classroom>['session']) {
  await ingestTranscript(session, { uid: '123456', text: QUIZ_TURN, isFinal: true, turnId: 1 });
  const quiz = [...session.quizzes.values()][0];
  assert.ok(quiz, 'the control payload should have produced a quiz');
  return quiz;
}

await t('the option list she reads aloud is still recognised as her own echo', () => {
  const { session } = classroom();
  rememberAgentUtterance(session, 'What is three plus two? Option A four Option B five Option C six Option D seven');
  assert.equal(
    stripSelfEcho(session, 'Option A four Option B five Option C six Option D seven'),
    '',
    'the echo filter must keep doing its job',
  );
});

await t('"Option B" is scored even though the echo filter discards the turn', async () => {
  const { session, ana } = classroom();
  const quiz = await askQuiz(session);

  // Her voice has stopped; the answer window is open.
  releaseFloor(session);

  await ingestTranscript(session, { uid: ana.uid, text: 'Option b five', isFinal: true, turnId: 2 });

  const answers = answersFor(session, quiz.quizId);
  assert.equal(answers.length, 1, 'the spoken answer must be recorded');
  assert.equal(answers[0]?.answer, 'five');
  assert.equal(answers[0]?.correct, true);
  assert.equal(answers[0]?.via, 'voice');
});

await t('an answer spoken into a quiet room is logged as that student speaking', async () => {
  const { session, ana } = classroom();
  await askQuiz(session);
  releaseFloor(session);
  const before = session.transcript.length;

  await ingestTranscript(session, { uid: ana.uid, text: 'Option c six', isFinal: true, turnId: 2 });

  // This used to assert the opposite. The echo filter discarded every short
  // turn that reused her words, so a spoken answer never reached the
  // transcript at all and had to be recovered by `maybeRescueSpokenQuizAnswer`
  // purely to be scored. With the whole-turn drop gated on her audio actually
  // playing (see MIN_WHOLE_TURN_DROP_LENGTH and the `agentSpeaking` argument),
  // a student answering into a quiet room is recognised as what it is: their
  // speech, under their name, in the class transcript.
  //
  // The echo protections are unchanged and still covered by the two tests
  // below — her full option list is still dropped, and nothing is rescued or
  // logged while she is mid-sentence.
  assert.equal(
    session.transcript.length,
    before + 1,
    'a student answering out loud belongs in the transcript',
  );
  assert.equal(
    session.transcript.at(-1)?.participantId,
    ana.participantId,
    'and it belongs to the student who said it',
  );
  assert.equal(
    pendingClassWideGap(session),
    undefined,
    'one student answering wrong is not yet a class-wide gap',
  );
});

await t('her whole option list echoing back through a mic is NOT scored as an answer', async () => {
  const { session, ana } = classroom();
  const quiz = await askQuiz(session);
  releaseFloor(session);

  await ingestTranscript(session, {
    uid: ana.uid,
    text: 'Option A four Option B five Option C six Option D seven',
    isFinal: true,
    turnId: 2,
  });

  assert.equal(
    answersFor(session, quiz.quizId).length,
    0,
    'an utterance naming every option is her list, not an answer',
  );
});

await t('nothing is rescued while she is still speaking', async () => {
  const { session, ana } = classroom();
  const quiz = await askQuiz(session);
  // No releaseFloor: her audio is still playing, so this is far likelier to be echo.
  session.floor = { ...session.floor, state: 'AGENT_SPEAKING' };

  await ingestTranscript(session, { uid: ana.uid, text: 'Option b five', isFinal: true, turnId: 2 });
  assert.equal(answersFor(session, quiz.quizId).length, 0);
});

await t('optionIndicesMentioned separates one option from the whole list', () => {
  const quiz = {
    options: ['four', 'five', 'six', 'seven'],
  } as Parameters<typeof optionIndicesMentioned>[1];
  assert.deepEqual([...optionIndicesMentioned('Option b five', quiz)], [1]);
  assert.deepEqual([...optionIndicesMentioned('option c', quiz)], [2]);
  assert.equal(optionIndicesMentioned('Option A four Option B five Option C six Option D seven', quiz).size, 4);
  assert.equal(optionIndicesMentioned('I have no idea', quiz).size, 0);
});

// ─── 5. The countdown starts when she stops speaking ─────────────────────────

await t('the answer window does not start until she has finished reading the options', async () => {
  const { session } = classroom();
  const quiz = await askQuiz(session);
  const issuedDeadline = quiz.deadline;

  // She spends a few seconds reading the four options out loud.
  session.floor = { ...session.floor, state: 'AGENT_SPEAKING', since: quiz.createdAt - 1 };
  await new Promise((r) => setTimeout(r, 30));
  releaseFloor(session);

  assert.ok(
    quiz.deadline > issuedDeadline,
    'the deadline should be pushed out to a full window from when she stopped',
  );
  const windowFromNow = quiz.deadline - Date.now();
  assert.ok(
    windowFromNow > QUIZ_DURATION_MS - 1_000 && windowFromNow <= QUIZ_DURATION_MS,
    `students should get the full window, got ${windowFromNow}ms`,
  );
});

await t('the student card is told about the new deadline', async () => {
  const { session } = classroom();
  const quiz = await askQuiz(session);
  const { events, stop } = recorder(session.sessionId, 'student');

  session.floor = { ...session.floor, state: 'AGENT_SPEAKING', since: quiz.createdAt - 1 };
  await new Promise((r) => setTimeout(r, 30));
  releaseFloor(session);
  stop();

  const issued = events.filter((e) => e.kind === 'echosphere:quiz-issued');
  assert.equal(issued.length, 1, 're-broadcast so the ring restarts against the real deadline');
});

await t('a question someone already answered is not held open', async () => {
  const { session, ana } = classroom();
  const quiz = await askQuiz(session);
  submitQuizAnswer(session, quiz.quizId, ana.participantId, 'five', 'ui');
  const deadlineAfterAnswer = quiz.deadline;

  session.floor = { ...session.floor, state: 'AGENT_SPEAKING', since: quiz.createdAt - 1 };
  releaseFloor(session);

  assert.equal(quiz.deadline, deadlineAfterAnswer, 'an answered question keeps its deadline');
});

await t('the timer armed against the old deadline re-arms instead of closing early', async () => {
  const { session } = classroom();
  const quiz = await askQuiz(session);

  // Armed to fire in 50ms, then the countdown starts properly and pushes the
  // deadline out — exactly what releaseFloor does when she stops speaking.
  const originalDeadline = Date.now() + 50;
  quiz.deadline = originalDeadline;
  scheduleQuizClose(session, quiz.quizId, originalDeadline);
  quiz.deadline = Date.now() + 400;

  await new Promise((r) => setTimeout(r, 150));
  assert.equal(quiz.closedAt, undefined, 'the students\' window is still open');

  await new Promise((r) => setTimeout(r, 400));
  assert.ok(quiz.closedAt, 'and it closes once the real deadline passes');
});

await t('sweepExpiredQuiz itself still closes on demand, as its callers expect', async () => {
  const { session } = classroom();
  const quiz = await askQuiz(session);
  quiz.deadline = Date.now() + 60_000;
  sweepExpiredQuiz(session, quiz.quizId);
  assert.ok(quiz.closedAt, 'an explicit sweep is an unconditional close');
});

// ─── 6. The answer reaches the card ──────────────────────────────────────────

await t('quiz-result carries the chosen option, so a spoken answer shows on the card', () => {
  const { session, ana } = classroom();
  const quiz = recordQuizFromControl(
    session,
    { topic: 'addition', question: 'q', options: ['four', 'five', 'six', 'seven'], answer: 'B' },
    'teacher',
    [ana.participantId],
  );
  const { events, stop } = recorder(session.sessionId, 'teacher');
  submitQuizAnswer(session, quiz.quizId, ana.participantId, 'five', 'voice');
  stop();

  const result = events.find((e) => e.kind === 'echosphere:quiz-result') as
    | { answer?: string }
    | undefined;
  assert.ok(result, 'a result should be published');
  assert.equal(result.answer, 'five');
});

await t('a blank auto-submitted answer carries no option to highlight', () => {
  const { session, ana } = classroom();
  const quiz = recordQuizFromControl(
    session,
    { topic: 'addition', question: 'q', options: ['four', 'five'], answer: 'B' },
    'teacher',
    [ana.participantId],
  );
  const { events, stop } = recorder(session.sessionId, 'teacher');
  submitQuizAnswer(session, quiz.quizId, ana.participantId, '', 'ui');
  stop();

  const result = events.find((e) => e.kind === 'echosphere:quiz-result') as
    | { answer?: string }
    | undefined;
  assert.ok(result);
  assert.equal(result.answer, undefined, 'nothing was chosen, so nothing is highlighted');
});

console.log(`\n${pass} passing (repetition loop, floor cooldown, spoken answers)`);
