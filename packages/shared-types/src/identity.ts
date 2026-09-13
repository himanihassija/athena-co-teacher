/**
 * Roles, participants, and student profiles.
 *
 * Covers PS31 §3.2 (role awareness), §3.5 (differentiated explanation levels),
 * and §3.8 (student identification through session identity).
 *
 * Identity anchor: every participant has a stable `participantId` minted at join
 * time and an Agora RTC `uid`. Agora reports transcripts and speaker events by
 * `uid`, so the orchestrator maps uid -> participantId to answer "who said this"
 * without ambiguity.
 */

export type Role = 'teacher' | 'student';

/**
 * How deep an explanation the agent should give a particular student.
 * Set by the teacher, or inferred from quiz performance (§3.6 -> §3.5).
 */
export type ProficiencyTag = 'beginner' | 'intermediate' | 'advanced';

export const PROFICIENCY_TAGS: readonly ProficiencyTag[] = [
  'beginner',
  'intermediate',
  'advanced',
] as const;

export interface Participant {
  participantId: string;
  /** Agora RTC UID, as a string. Agora emits transcript events keyed by this. */
  uid: string;
  displayName: string;
  role: Role;
  joinedAt: number;
  /** Set when the participant's RTC connection drops; kept for post-class reporting. */
  leftAt?: number;
  language?: import('./support.js').LanguageCode;
  handRaised?: boolean;
}

export interface StudentProfile extends Participant {
  role: 'student';
  proficiency: ProficiencyTag;
  /** Preferred language tag (BCP-47). Drives §3.7 code-switching hints. */
  preferredLanguage?: string;
  /** Running counters fed by the quiz engine; drive automatic proficiency inference. */
  stats: StudentStats;
}

export interface StudentStats {
  questionsAsked: number;
  quizzesAnswered: number;
  quizzesCorrect: number;
  /** Topic tags this student has answered incorrectly, most recent last. */
  missedTopics: string[];
}

export function emptyStudentStats(): StudentStats {
  return {
    questionsAsked: 0,
    quizzesAnswered: 0,
    quizzesCorrect: 0,
    missedTopics: [],
  };
}

export function isStudent(p: Participant): p is StudentProfile {
  return p.role === 'student';
}

/**
 * Request body for joining a classroom. The orchestrator assigns the RTC uid and
 * mints the Agora token only after it has recorded the role — the plan's §3.2
 * rule that identity is resolved before a token is issued.
 */
export interface JoinClassroomRequest {
  sessionId: string;
  displayName: string;
  role: Role;
  preferredLanguage?: string;
}

export interface JoinClassroomResponse {
  participantId: string;
  uid: string;
  channel: string;
  rtcToken: string;
  rtmToken: string;
  appId: string;
  role: Role;
  sessionId: string;
}
