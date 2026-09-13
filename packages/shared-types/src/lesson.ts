/**
 * Lesson material, transcript log, quizzes, and gap detection.
 *
 * Covers PS31 §3.4 (contextual answers from lesson material), §3.6 (spoken
 * quizzes), §3.9 (post-class summaries and learning insights).
 */

/** One chunk of teacher-uploaded lesson material, with its embedding. */
export interface LessonChunk {
  chunkId: string;
  sessionId: string;
  /** Source document name, shown in the teacher UI so retrieval is auditable. */
  source: string;
  text: string;
  /** Ordinal within the source document — lets the UI show surrounding context. */
  ordinal: number;
  embedding?: number[];
  /** Coarse topic tags used by the gap detector to cluster misconceptions. */
  topics: string[];
}

export interface RetrievedChunk {
  chunk: LessonChunk;
  score: number;
}

/** A single utterance in the rolling classroom transcript. */
export interface TranscriptSegment {
  segmentId: string;
  sessionId: string;
  /** null for the agent's own speech. */
  participantId: string | null;
  uid: string;
  speaker: 'teacher' | 'student' | 'agent';
  text: string;
  at: number;
  /** BCP-47 tag if the ASR reported one — feeds §3.7 code-switch handling. */
  language?: string;
  /** Turn id from the Agora client toolkit, for dedup across partial updates. */
  turnId?: number;
  /**
   * How confident the client was in attributing this turn to `uid`, from 0 to
   * 1. Only set for human turns whose speaker was resolved by comparing mic
   * levels across participants (§3.8) rather than a self-reported id — the
   * agent's own turns and any turn already carrying a real speaker id have no
   * need of it. Below roughly 0.6 the two loudest candidates were close enough
   * that the attribution is a guess, not a fact; the UI marks those as
   * uncertain rather than presenting a coin-flip with full confidence.
   */
  attributionConfidence?: number;
}

// ─── Quizzes (§3.6) ──────────────────────────────────────────────────────────

export type QuizDifficulty = 'easy' | 'medium' | 'hard';

/**
 * How long a question accepts answers, once its countdown actually starts.
 *
 * The value is unchanged at 15s. What changed is when it starts: the deadline
 * used to be set the moment the question text arrived, which is *before* the
 * agent has finished reading the four options aloud, so a good part of the
 * window was spent listening to the question. It now starts when she stops
 * speaking — see `startQuizCountdowns` — which is what the student's card
 * always claimed it did.
 *
 * The card does not read this constant; it measures each question's window from
 * the deadline it is sent, so the two cannot drift.
 */
export const QUIZ_DURATION_MS = 15_000;

export interface QuizQuestion {
  quizId: string;
  sessionId: string;
  topic: string;
  question: string;
  /** Omitted for open-response questions answered by voice. */
  options?: string[];
  /** Index into `options`, or the expected free-text answer. */
  correctAnswer: string;
  difficulty: QuizDifficulty;
  /** participantIds this quiz was aimed at; empty means the whole class. */
  targetStudentIds: string[];
  createdAt: number;
  /** Epoch ms when the question stops accepting answers and auto-closes. */
  deadline: number;
  /** Set once the quiz has closed (all answered, or the timer expired). */
  closedAt?: number;
  /** Position of this question within a multi-question set (1-based), if any. */
  setIndex?: number;
  /** Total questions in the set this belongs to, if any. */
  setTotal?: number;
  /** What caused this quiz — teacher action or an auto-detected gap. */
  origin: 'teacher' | 'gap-detector';
}

export interface QuizAnswer {
  quizId: string;
  participantId: string;
  answer: string;
  correct: boolean;
  /** How the student answered — tapping a card or speaking. */
  via: 'ui' | 'voice';
  at: number;
}

// ─── Gap detection (§3.9) ────────────────────────────────────────────────────

/**
 * A cluster of related confusion signals across students. Built from wrong quiz
 * answers and repeated confused questions on the same topic.
 */
export interface LearningGap {
  gapId: string;
  sessionId: string;
  topic: string;
  /** Human-readable statement of the misconception, for the teacher dashboard. */
  description: string;
  /** participantIds showing this gap. Length drives severity. */
  affectedStudentIds: string[];
  /** Individual signals that built this cluster. */
  evidence: GapEvidence[];
  firstSeenAt: number;
  lastSeenAt: number;
  /** Set once the agent has addressed this gap, so it is not re-raised. */
  addressedAt?: number;
}

export interface GapEvidence {
  kind: 'wrong-answer' | 'confused-question';
  participantId: string;
  text: string;
  at: number;
  /**
   * True when this signal is the agent's own report on the control channel
   * rather than something a student did.
   *
   * It matters because new evidence re-opens a gap the agent has already
   * addressed, and the agent re-reports a gap in the very turn where she
   * explains it — so without this flag her own explanation re-opened the gap
   * and the silence tick had her explain it again, once a second, forever.
   */
  selfReported?: boolean;
}

export type GapSeverity = 'low' | 'medium' | 'high';

/** Severity is purely a function of how many students share the gap. */
export function gapSeverity(gap: LearningGap, classSize: number): GapSeverity {
  const share = classSize > 0 ? gap.affectedStudentIds.length / classSize : 0;
  if (gap.affectedStudentIds.length >= 3 || share >= 0.5) return 'high';
  if (gap.affectedStudentIds.length === 2 || share >= 0.25) return 'medium';
  return 'low';
}

// ─── Post-class report (§3.9) ────────────────────────────────────────────────

export interface ConceptMastery {
  topic: string;
  score: number; // 0 to 100 percentage
  status: 'mastered' | 'developing' | 'struggling';
}

export interface InterventionRecord {
  timestamp: number;
  text: string;
  score: number;
  reason: string;
  status: 'spoken' | 'suppressed';
}

export interface SessionReport {
  sessionId: string;
  generatedAt: number;
  startedAt: number;
  endedAt: number;
  topicsCovered: string[];
  commonMisconceptions: ReportedMisconception[];
  perStudent: StudentReportEntry[];
  suggestedFollowUp: string[];
  /** Narrative summary from the batch LLM call, rendered above the tables. */
  narrative: string;
  interventionHistory: InterventionRecord[];
}

export interface ReportedMisconception {
  topic: string;
  description: string;
  studentNames: string[];
}

export interface StudentReportEntry {
  participantId: string;
  displayName: string;
  proficiency: string;
  questionsAsked: number;
  quizzesAnswered: number;
  quizzesCorrect: number;
  strugglingTopics: string[];
  note: string;
  conceptMastery: ConceptMastery[];
}
