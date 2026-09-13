/**
 * Gap detector — PS31 §3.9 (clustering repeated errors across students) and the
 * trigger side of §3.3(b) (what makes a silence gap worth interrupting for).
 *
 * Two kinds of signal feed the clusters:
 *   1. wrong quiz answers, tagged with the quiz's topic
 *   2. confused questions, detected from the transcript by phrasing
 *
 * Clustering is intentionally simple, as the plan permits: signals join an
 * existing gap when their topic matches, or when their text overlaps an existing
 * gap's evidence above a threshold. This is stable and explainable in a demo,
 * where an embedding-based cluster that silently regroups mid-class is not.
 *
 * A gap only becomes worth interrupting for when more than one student shows it
 * — the plan's example scenario is "multiple students struggle with the same
 * concept", and a single confused student is better served by answering them
 * directly than by stopping the class.
 */

import { randomUUID } from 'node:crypto';
import {
  gapSeverity,
  type GapEvidence,
  type LearningGap,
  type QuizQuestion,
} from '@echosphere/shared-types';
import { tokenise } from '../lesson/lessonStore.js';
import { publishToTeachers } from '../state/eventBus.js';
import {
  activeStudents,
  type ClassroomSession,
} from '../state/sessionRegistry.js';

/** Jaccard overlap above this merges a signal into an existing gap. */
const TEXT_MERGE_THRESHOLD = 0.34;

/** Distinct students required before a gap is class-wide enough to interrupt for. */
const INTERRUPT_STUDENT_THRESHOLD = 2;

/**
 * How long the agent's own report of a gap is ignored as a reason to re-open a
 * gap she has already addressed.
 *
 * The prompt asks her to report a gap whenever two or more students show the
 * same confusion, and the turn where she *explains* that gap satisfies that
 * instruction — so she re-reported the gap she had just been sent to address.
 * That cleared `addressedAt`, the silence tick found it pending again, and she
 * explained it again, roughly once a second, which is what put four near
 * identical "least common denominator" interjections in a row on screen.
 *
 * A student doing something new still re-opens the gap immediately; only her
 * own echo of it has to wait. The window is long enough to cover the turn she
 * is in the middle of and the relays that follow it.
 */
const SELF_REPORT_REOPEN_COOLDOWN_MS = 90_000;

/**
 * Phrases that mark a question as confusion rather than curiosity. Deliberately
 * conservative: a false positive here can make the agent interject over a
 * perfectly clear lesson, which is the failure mode the plan warns about.
 */
const CONFUSION_PATTERNS: RegExp[] = [
  /\bi (?:don'?t|do not) (?:get|understand|follow)\b/i,
  /\bi'?m (?:confused|lost|stuck)\b/i,
  /\bnot sure (?:i|what|how|why)\b/i,
  /\bcan you (?:explain|go over|repeat) (?:that|this|it) again\b/i,
  /\bwhat do you mean by\b/i,
  /\bwhy (?:does|do|is|are) that\b/i,
  /\bhow (?:does|do|did) (?:that|this|it) work\b/i,
  /\bdoesn'?t make sense\b/i,
];

export function looksConfused(text: string): boolean {
  return CONFUSION_PATTERNS.some((pattern) => pattern.test(text));
}

export interface GapUpdate {
  gap: LearningGap;
  /** True the first time this gap crosses the multi-student threshold. */
  becameClassWide: boolean;
  isNew: boolean;
}

export function recordWrongAnswer(
  session: ClassroomSession,
  quiz: QuizQuestion,
  participantId: string,
  answerText: string,
): GapUpdate {
  return record(session, quiz.topic, {
    kind: 'wrong-answer',
    participantId,
    text: `Answered "${answerText}" to: ${quiz.question}`,
    at: Date.now(),
  });
}

/**
 * A gap the agent itself reported on the control channel (§3.9).
 *
 * This is a second, independent signal to the keyword detector below: the model
 * hears tone and phrasing the regexes cannot, and it sees the whole exchange.
 * Both feed the same clusters, so a misconception spotted either way surfaces
 * on the teacher's dashboard.
 */
export function recordReportedGap(
  session: ClassroomSession,
  topic: string,
  participantIds: string[],
): GapUpdate | null {
  let update: GapUpdate | null = null;
  for (const participantId of participantIds) {
    update = record(session, topic, {
      kind: 'confused-question',
      participantId,
      text: `Athena reported confusion about ${topic}`,
      at: Date.now(),
      selfReported: true,
    });
  }
  return update;
}

export function recordConfusedQuestion(
  session: ClassroomSession,
  participantId: string,
  text: string,
): GapUpdate | null {
  if (!looksConfused(text)) return null;
  const topic = inferTopicFromQuestion(session, text);
  return record(session, topic, {
    kind: 'confused-question',
    participantId,
    text,
    at: Date.now(),
  });
}

function record(
  session: ClassroomSession,
  topic: string,
  evidence: GapEvidence,
): GapUpdate {
  const existing = findMatchingGap(session, topic, evidence.text);
  const wasClassWide = existing
    ? existing.affectedStudentIds.length >= INTERRUPT_STUDENT_THRESHOLD
    : false;

  const gap: LearningGap = existing ?? {
    gapId: randomUUID(),
    sessionId: session.sessionId,
    topic,
    description: describeGap(topic, evidence),
    affectedStudentIds: [],
    evidence: [],
    firstSeenAt: evidence.at,
    lastSeenAt: evidence.at,
  };

  gap.evidence.push(evidence);
  gap.lastSeenAt = evidence.at;
  if (!gap.affectedStudentIds.includes(evidence.participantId)) {
    gap.affectedStudentIds.push(evidence.participantId);
  }
  // New evidence means the gap is live again even if the agent already spoke to
  // it once — otherwise a misconception addressed early can never be re-raised.
  //
  // Except when the "new" evidence is the agent's own report of the same gap
  // arriving right after she addressed it. That is her echoing the thing she
  // was just sent to explain, not a student showing fresh confusion, and
  // treating it as new evidence is what made her repeat herself on a loop.
  // After the cooldown a self-report counts again, so a misconception that
  // genuinely resurfaces later is still re-raised.
  if (gap.addressedAt !== undefined && evidence.at > gap.addressedAt) {
    const isSelfEcho =
      evidence.selfReported === true &&
      evidence.at - gap.addressedAt < SELF_REPORT_REOPEN_COOLDOWN_MS;
    if (!isSelfEcho) gap.addressedAt = undefined;
  }

  session.gaps.set(gap.gapId, gap);

  const isClassWide = gap.affectedStudentIds.length >= INTERRUPT_STUDENT_THRESHOLD;
  const update: GapUpdate = {
    gap,
    isNew: !existing,
    becameClassWide: isClassWide && !wasClassWide,
  };

  // Teacher dashboard only — students must not see who is struggling (§3.9).
  publishToTeachers(session.sessionId, { kind: 'echosphere:gap-detected', gap });

  return update;
}

function findMatchingGap(
  session: ClassroomSession,
  topic: string,
  text: string,
): LearningGap | undefined {
  const byTopic = [...session.gaps.values()].find(
    (g) => g.topic.toLowerCase() === topic.toLowerCase(),
  );
  if (byTopic) return byTopic;

  const terms = new Set(tokenise(text));
  if (terms.size === 0) return undefined;

  let best: { gap: LearningGap; score: number } | undefined;
  for (const gap of session.gaps.values()) {
    const gapTerms = new Set(gap.evidence.flatMap((e) => tokenise(e.text)));
    const score = jaccard(terms, gapTerms);
    if (score >= TEXT_MERGE_THRESHOLD && (!best || score > best.score)) {
      best = { gap, score };
    }
  }
  return best?.gap;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const term of a) if (b.has(term)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

/**
 * Names the topic a confused question is about by matching it against the
 * lesson material's topic tags, falling back to the question's own keywords.
 */
function inferTopicFromQuestion(session: ClassroomSession, text: string): string {
  const terms = tokenise(text);
  const lessonTopics = session.lesson.topics();
  const termSet = new Set(terms);
  const hit = lessonTopics.find((topic) => termSet.has(topic.toLowerCase()));
  if (hit) return hit;

  // The words that *signal* confusion are not what the confusion is about.
  // Dropping them keeps "I don't get why the denominator changes" clustering
  // under "denominator" rather than "understand".
  const subject = terms.filter((t) => !CONFUSION_META_WORDS.has(t));
  return subject.slice(0, 2).join(' ') || 'general';
}

const CONFUSION_META_WORDS = new Set([
  'understand', 'understanding', 'confused', 'confusing', 'lost', 'stuck',
  'explain', 'explanation', 'again', 'repeat', 'mean', 'means', 'sense',
  'get', 'got', 'follow', 'sure', 'question', 'sorry', 'please', 'think',
  'know', 'tell', 'say', 'said', 'work', 'works', 'help',
]);

function describeGap(topic: string, evidence: GapEvidence): string {
  return evidence.kind === 'wrong-answer'
    ? `Students are answering "${topic}" questions incorrectly.`
    : `Students are asking for clarification about "${topic}".`;
}

// ─── Consumption by the floor machine and the report ─────────────────────────

/**
 * The most pressing unaddressed, class-wide gap — this is what makes a silence
 * gap worth interrupting for in `decideSpeak`. Returns undefined when nothing
 * qualifies, which keeps the agent quiet by default.
 */
export function pendingClassWideGap(
  session: ClassroomSession,
): LearningGap | undefined {
  return [...session.gaps.values()]
    .filter(
      (g) =>
        g.addressedAt === undefined &&
        g.affectedStudentIds.length >= INTERRUPT_STUDENT_THRESHOLD,
    )
    .sort(
      (a, b) =>
        b.affectedStudentIds.length - a.affectedStudentIds.length ||
        b.lastSeenAt - a.lastSeenAt,
    )[0];
}

export function markGapAddressed(session: ClassroomSession, gapId: string): void {
  const gap = session.gaps.get(gapId);
  if (gap) gap.addressedAt = Date.now();
}

/** Gaps ranked for the teacher's live "who needs help" panel (§3.9). */
export function rankedGaps(
  session: ClassroomSession,
): Array<LearningGap & { severity: ReturnType<typeof gapSeverity> }> {
  const classSize = activeStudents(session).length;
  return [...session.gaps.values()]
    .map((gap) => ({ ...gap, severity: gapSeverity(gap, classSize) }))
    .sort(
      (a, b) =>
        b.affectedStudentIds.length - a.affectedStudentIds.length ||
        b.lastSeenAt - a.lastSeenAt,
    );
}
