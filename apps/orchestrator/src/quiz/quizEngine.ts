/**
 * Quiz engine — PS31 §3.6 (spoken quizzes and interactive exercises).
 *
 * The plan left open whether structured quiz output could come through the
 * pipeline or would need a separate call. The answer here is neither: the agent
 * asks the question out loud and appends the same question as JSON on the brace
 * control channel in the *same turn*. One model, one call, one round trip, and
 * no OpenAI key — the spoken question and the on-screen card cannot drift,
 * because they are the same generation.
 *
 * So this module no longer generates questions. It takes the control payload,
 * records it, and owns everything downstream: answer normalisation, scoring,
 * and the proficiency feedback loop into §3.5.
 */

import { randomUUID } from 'node:crypto';
import {
  QUIZ_DURATION_MS,
  toPublicQuiz,
  type ProficiencyTag,
  type QuizAnswer,
  type QuizDifficulty,
  type QuizQuestion,
  type StudentProfile,
} from '@echosphere/shared-types';
import type { QuizControl } from '../agent/control.js';
import { publish, publishToTeachers } from '../state/eventBus.js';
import {
  activeStudents,
  type ClassroomSession,
} from '../state/sessionRegistry.js';

const LETTERS = ['A', 'B', 'C', 'D'];
const NUMBER_WORDS = ['one', 'two', 'three', 'four'];

/**
 * How long a question accepts answers before it auto-closes.
 *
 * Re-exported from shared-types so the student's card and the server hold the
 * same number; see `QUIZ_DURATION_MS` there. The window is started for real by
 * `startQuizCountdowns` when the agent stops speaking, so it is not spent
 * listening to the options being read out.
 */
export { QUIZ_DURATION_MS };

/**
 * Turns a control-channel quiz payload into a recorded question.
 *
 * `targetStudentIds` comes from whatever asked for the quiz — a teacher button
 * or the gap detector — because the agent is not told to echo it back.
 */
export function recordQuizFromControl(
  session: ClassroomSession,
  control: QuizControl,
  origin: 'teacher' | 'gap-detector',
  targetStudentIds: string[] = [],
): QuizQuestion {
  const targets =
    targetStudentIds.length > 0
      ? targetStudentIds
      : activeStudents(session).map((s) => s.participantId);

  const quiz: QuizQuestion = {
    quizId: randomUUID(),
    sessionId: session.sessionId,
    topic: control.topic,
    question: control.question,
    options: control.options,
    // Stored as the option text rather than a letter, so a spoken answer and a
    // tapped answer compare against the same thing.
    correctAnswer: resolveAnswerText(control),
    difficulty: control.difficulty ?? inferDifficulty(session, targets),
    targetStudentIds: targets,
    createdAt: Date.now(),
    deadline: Date.now() + QUIZ_DURATION_MS,
    origin,
  };

  session.quizzes.set(quiz.quizId, quiz);
  return quiz;
}

/**
 * The agent reports the answer as the letter it read aloud. If it sends the
 * option text instead, that is accepted too — the contract asks for a letter,
 * but a model that answers "the second one" should not lose the quiz.
 */
function resolveAnswerText(control: QuizControl): string {
  const raw = control.answer.trim();

  const byLetter = LETTERS.indexOf(raw.toUpperCase().replace(/[^A-D]/g, ''));
  if (byLetter >= 0 && control.options[byLetter]) {
    return control.options[byLetter] as string;
  }

  const exact = control.options.find(
    (o) => o.toLowerCase() === raw.toLowerCase(),
  );
  if (exact) return exact;

  // Unresolvable answer key: fall back to the first option rather than throwing.
  // A wrong key marks everyone incorrect, which is visible in the teacher panel;
  // a throw would take down the turn that carried it.
  return control.options[0] ?? raw;
}

const DIFFICULTY_BY_PROFICIENCY: Record<ProficiencyTag, QuizDifficulty> = {
  beginner: 'easy',
  intermediate: 'medium',
  advanced: 'hard',
};

function inferDifficulty(
  session: ClassroomSession,
  targetIds: string[],
): QuizDifficulty {
  const targets = activeStudents(session).filter((s) =>
    targetIds.includes(s.participantId),
  );
  if (targets.length === 0) return 'medium';
  const ranks = targets
    .map((s) =>
      ['easy', 'medium', 'hard'].indexOf(DIFFICULTY_BY_PROFICIENCY[s.proficiency]),
    )
    .sort((a, b) => a - b);
  const mid = ranks[Math.floor(ranks.length / 2)] ?? 1;
  return (['easy', 'medium', 'hard'][mid] ?? 'medium') as QuizDifficulty;
}

/** The most recent quiz still open for answers, used to route voice answers. */
export function openQuizFor(
  session: ClassroomSession,
  participantId: string,
): QuizQuestion | undefined {
  const answered = new Set(
    session.answers
      .filter((a) => a.participantId === participantId)
      .map((a) => a.quizId),
  );
  return [...session.quizzes.values()]
    .filter(
      (quiz) =>
        !quiz.closedAt &&
        !answered.has(quiz.quizId) &&
        (quiz.targetStudentIds.length === 0 ||
          quiz.targetStudentIds.includes(participantId)),
    )
    .sort((a, b) => b.createdAt - a.createdAt)[0];
}

// ─── Answering and scoring ───────────────────────────────────────────────────

export interface RecordAnswerResult {
  answer: QuizAnswer;
  quiz: QuizQuestion;
  /** Set when the student's proficiency tag moved as a result (§3.5). */
  proficiencyChangedTo?: ProficiencyTag;
}

export function recordAnswer(
  session: ClassroomSession,
  quizId: string,
  participantId: string,
  rawAnswer: string,
  via: 'ui' | 'voice',
): RecordAnswerResult | { error: string } {
  const quiz = session.quizzes.get(quizId);
  if (!quiz) return { error: 'Unknown quiz' };
  // A closed quiz takes no more answers. The countdown sweep marks absentees
  // just before calling markQuizClosed, so it is not blocked by this.
  if (quiz.closedAt) return { error: 'Quiz already closed' };

  const student = session.participants.get(participantId);
  if (!student || student.role !== 'student') {
    return { error: 'Only students can answer quizzes' };
  }
  if (
    session.answers.some(
      (a) => a.quizId === quizId && a.participantId === participantId,
    )
  ) {
    return { error: 'Already answered' };
  }

  const normalised = normaliseAnswer(rawAnswer, quiz);
  const correct = normalised === quiz.correctAnswer;

  const answer: QuizAnswer = {
    quizId,
    participantId,
    answer: normalised,
    correct,
    via,
    at: Date.now(),
  };
  session.answers.push(answer);

  const profile = student as StudentProfile;
  profile.stats.quizzesAnswered += 1;
  if (correct) {
    profile.stats.quizzesCorrect += 1;
  } else {
    profile.stats.missedTopics.push(quiz.topic);
  }

  const proficiencyChangedTo = reassessProficiency(profile);

  return { answer, quiz, proficiencyChangedTo };
}

/**
 * Resolves a raw answer to one of the quiz's option strings. Handles the shapes
 * an answer actually arrives in: the option text (a UI tap), a bare letter or
 * number, or a spoken sentence containing either.
 */
export function normaliseAnswer(raw: string, quiz: QuizQuestion): string {
  const options = quiz.options ?? [];
  const trimmed = raw.trim();
  if (options.length === 0) return trimmed;

  const exact = options.find((o) => o.toLowerCase() === trimmed.toLowerCase());
  if (exact) return exact;

  const letterMatch = /^\(?([a-dA-D])\)?[.:)]?$/.exec(trimmed);
  if (letterMatch?.[1]) {
    const index = LETTERS.indexOf(letterMatch[1].toUpperCase());
    if (index >= 0 && options[index]) return options[index] as string;
  }

  const numberMatch = /^([1-4])[.:)]?$/.exec(trimmed);
  if (numberMatch?.[1]) {
    const index = Number(numberMatch[1]) - 1;
    if (options[index]) return options[index] as string;
  }

  const spoken = trimmed.toLowerCase();
  const contained = options.find((o) => spoken.includes(o.toLowerCase()));
  if (contained) return contained;

  // Spoken references, e.g. "I think it's B" or "option two".
  for (let i = 0; i < options.length; i += 1) {
    const letter = (LETTERS[i] ?? '').toLowerCase();
    if (
      new RegExp(`\\b(option\\s+|answer\\s+)?${letter}\\b`).test(spoken) ||
      new RegExp(`\\b(option\\s+|answer\\s+)?${NUMBER_WORDS[i]}\\b`).test(spoken)
    ) {
      return options[i] as string;
    }
  }

  return trimmed;
}

/**
 * Which of a quiz's options an utterance refers to, by index.
 *
 * Used to tell a student answering from the agent reading the list out. She
 * says every option in one breath, so her utterance names four; a student names
 * one. `normaliseAnswer` cannot answer this — it returns the first match and is
 * indifferent to how many there were.
 *
 * Matching deliberately mirrors `normaliseAnswer`, so an utterance this counts
 * as naming exactly one option is one that resolves to that same option.
 */
export function optionIndicesMentioned(
  raw: string,
  quiz: QuizQuestion,
): Set<number> {
  const options = quiz.options ?? [];
  const spoken = raw.trim().toLowerCase();
  const found = new Set<number>();
  if (options.length === 0 || spoken.length === 0) return found;

  for (let i = 0; i < options.length; i += 1) {
    const option = (options[i] ?? '').toLowerCase();
    if (option.length > 0 && spoken.includes(option)) {
      found.add(i);
      continue;
    }
    const letter = (LETTERS[i] ?? '').toLowerCase();
    if (
      new RegExp(`\\b(option\\s+|answer\\s+)?${letter}\\b`).test(spoken) ||
      new RegExp(`\\b(option\\s+|answer\\s+)?${NUMBER_WORDS[i]}\\b`).test(spoken)
    ) {
      found.add(i);
    }
  }
  return found;
}

/**
 * Re-derives a student's proficiency from their quiz record (§3.5, §3.6).
 * Requires at least three answers so one unlucky question cannot demote a
 * student mid-lesson.
 */
function reassessProficiency(student: StudentProfile): ProficiencyTag | undefined {
  const { quizzesAnswered, quizzesCorrect } = student.stats;
  if (quizzesAnswered < 3) return undefined;

  const accuracy = quizzesCorrect / quizzesAnswered;
  const next: ProficiencyTag =
    accuracy >= 0.85 ? 'advanced' : accuracy >= 0.55 ? 'intermediate' : 'beginner';

  if (next === student.proficiency) return undefined;
  student.proficiency = next;
  return next;
}

export function answersFor(
  session: ClassroomSession,
  quizId: string,
): QuizAnswer[] {
  return session.answers.filter((a) => a.quizId === quizId);
}

/**
 * True once every still-present target student has an answer on record for this
 * quiz. Students who have left are not counted — otherwise a quiz issued to the
 * whole class could never close if one person dropped. Returns false when there
 * are no active targets at all, so an empty room never trips a "closed" event.
 */
export function allTargetsAnswered(
  session: ClassroomSession,
  quiz: QuizQuestion,
): boolean {
  const targetIds =
    quiz.targetStudentIds.length > 0
      ? quiz.targetStudentIds
      : activeStudents(session).map((s) => s.participantId);

  const activeTargets = targetIds.filter((id) => {
    const p = session.participants.get(id);
    return p?.role === 'student' && p.leftAt === undefined;
  });
  if (activeTargets.length === 0) return false;

  const answered = new Set(
    session.answers
      .filter((a) => a.quizId === quiz.quizId)
      .map((a) => a.participantId),
  );
  return activeTargets.every((id) => answered.has(id));
}

/**
 * Closes a quiz and reveals the correct answer to the whole room. Idempotent:
 * the "everyone answered" path and the countdown-expiry path both call it, and
 * whichever runs second is a no-op.
 */
export function markQuizClosed(
  session: ClassroomSession,
  quiz: QuizQuestion,
): boolean {
  if (quiz.closedAt) return false;
  quiz.closedAt = Date.now();
  publish(session.sessionId, {
    kind: 'echosphere:quiz-closed',
    quizId: quiz.quizId,
    correctAnswer: quiz.correctAnswer,
  });
  return true;
}

/** Broadcasts the quiz card. The answer key is stripped by `toPublicQuiz`. */
export function broadcastQuiz(
  session: ClassroomSession,
  quiz: QuizQuestion,
): void {
  publish(session.sessionId, {
    kind: 'echosphere:quiz-issued',
    quiz: toPublicQuiz(quiz),
  });
  // Teachers get the answer key immediately so the dashboard can show live
  // correctness without waiting for the quiz to close.
  publishToTeachers(session.sessionId, {
    kind: 'echosphere:quiz-closed',
    quizId: quiz.quizId,
    correctAnswer: quiz.correctAnswer,
  });
}
