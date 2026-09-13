/**
 * Floor state machine and teacher override commands.
 *
 * Covers PS31 §3.3 (turn-taking) and §3.10 (teacher control / override).
 *
 * The governing rule from the plan: the teacher's floor always wins, and an
 * active MUTE_AGENT flag is an absolute veto checked before *every* agent
 * utterance. Both are encoded here so no caller can construct a "may speak"
 * decision that skips them.
 */

export type FloorState =
  /** Teacher is speaking. The agent must stay silent unless directly addressed. */
  | 'TEACHER_HOLDS_FLOOR'
  /** Nobody is speaking, or a student is speaking to the class. */
  | 'OPEN_FLOOR'
  /** Agent is producing TTS right now. */
  | 'AGENT_SPEAKING'
  /** A student addressed the agent and is awaiting a reply. */
  | 'STUDENT_QUESTION_PENDING';

/** Why the agent is being allowed to take the floor. */
export type SpeakTrigger =
  /** A student used the wake phrase, or the transcript addressed the agent. */
  | 'DIRECTLY_ADDRESSED'
  /** Silence gap exceeded threshold AND the gap detector flagged a misconception. */
  | 'GAP_DETECTED_IN_SILENCE'
  /** Teacher pressed a control-panel button. */
  | 'TEACHER_INVOKED'
  /** Quiz delivery initiated by teacher or gap detector. */
  | 'QUIZ_DELIVERY';

/** Every reason the agent may be denied the floor. Surfaced to the teacher UI. */
export type SpeakDenialReason =
  | 'AGENT_MUTED'
  /** Students cannot summon the agent until the teacher opens the floor. */
  | 'STUDENT_INVOCATION_DISABLED'
  | 'TEACHER_HOLDS_FLOOR'
  /**
   * The engine began a turn that nothing invited — no wake phrase, no teacher
   * command. This is the restraint mechanism working, not a policy refusal, and
   * it is by far the most common interrupt.
   */
  | 'AGENT_UNINVITED'
  | 'AGENT_ALREADY_SPEAKING'
  | 'TOPIC_DISABLED'
  | 'SILENCE_GAP_TOO_SHORT'
  /**
   * She already interjected about this topic moments ago. Distinct from
   * SILENCE_GAP_TOO_SHORT so the teacher panel can say which restraint fired.
   */
  | 'TOPIC_RECENTLY_ADDRESSED'
  /**
   * A quiz question was spoken but its {quiz} control payload never reached the
   * orchestrator by either delivery path, so no card could be shown.
   *
   * Not a restraint decision at all — the floor was granted. It reports a
   * delivery failure, and it exists because this case used to be published as
   * SILENCE_GAP_TOO_SHORT, which told the teacher the opposite of what had
   * happened.
   */
  | 'QUIZ_PAYLOAD_MISSING'
  | 'NO_SESSION';

export type SpeakDecision =
  | { allowed: true; trigger: SpeakTrigger }
  | { allowed: false; reason: SpeakDenialReason };

/** How verbose the agent should be when it does speak (§3.10 ADJUST_VERBOSITY). */
export type VerbosityLevel = 'terse' | 'normal' | 'detailed';

export interface FloorSnapshot {
  state: FloorState;
  /** participantId of whoever currently holds the floor, if anyone. */
  holderId: string | null;
  /** Epoch ms of the last speech activity from any human participant. */
  lastHumanSpeechAt: number;
  /** Epoch ms when the current state was entered. */
  since: number;
}

/**
 * Teacher-controlled policy. Read before every agent utterance.
 * `muted` is deliberately separate from the floor state: muting must survive
 * state transitions and outlive any single turn.
 */
export interface AgentPolicy {
  muted: boolean;
  verbosity: VerbosityLevel;
  /** Topic tags the agent must refuse to discuss (§3.10 DISABLE_TOPIC). */
  disabledTopics: string[];
  /** Silence required before an unprompted gap-driven interjection, in ms. */
  silenceGapThresholdMs: number;
  /**
   * How long the agent must leave a topic alone after interjecting about it
   * before she may interject about it again, in ms.
   *
   * The silence threshold alone cannot bound repetition: her own speech is not
   * human speech, so the moment she stops, the room reads as silent again and
   * the same gap is eligible on the very next tick. This is the rule that makes
   * "she said this already" a reason to stay quiet.
   */
  topicInterjectionCooldownMs: number;
  /** Phrase that counts as directly addressing the agent (§3.3, Phase 1 hardcoded). */
  wakePhrase: string;
  /** When false, the agent will not interject on its own at all — only when invoked. */
  proactiveInterjectionsEnabled: boolean;

  /**
   * Whether students may summon the agent by saying her name.
   *
   * Off by default. The teacher owns the room, and an agent that any student
   * can call at any moment is one the teacher cannot keep out of a lesson.
   * While this is off the agent still listens and still builds context — it
   * simply has no route to the floor except the teacher's own controls.
   */
  studentsMayInvoke: boolean;
}

export const DEFAULT_AGENT_POLICY: AgentPolicy = {
  muted: false,
  verbosity: 'normal',
  disabledTopics: [],
  silenceGapThresholdMs: 3500,
  topicInterjectionCooldownMs: 120_000,
  wakePhrase: 'hey athena',
  proactiveInterjectionsEnabled: true,
  studentsMayInvoke: false,
};

export type TeacherCommand =
  | { type: 'MUTE_AGENT' }
  | { type: 'RESUME_AGENT' }
  | { type: 'END_AGENT_TURN' }
  | { type: 'FORCE_AGENT_SPEAK'; topic: string; targetStudentId?: string }
  | { type: 'ADJUST_VERBOSITY'; level: VerbosityLevel }
  | { type: 'SET_STUDENT_INVOCATION'; enabled: boolean }
  | { type: 'DISABLE_TOPIC'; topic: string }
  | { type: 'ENABLE_TOPIC'; topic: string }
  | { type: 'SET_PROFICIENCY'; studentId: string; proficiency: string }
  | { type: 'START_QUIZ'; topic: string; targetStudentIds?: string[] }
  | { type: 'END_SESSION' };

export type TeacherCommandType = TeacherCommand['type'];
