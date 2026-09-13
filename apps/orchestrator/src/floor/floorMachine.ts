/**
 * Floor state machine — PS31 §3.3 (turn-taking) and §3.10 (teacher override).
 *
 * Design rule from the plan: "no code path should be able to let the agent speak
 * while muted." That is enforced structurally here — `decideSpeak` is the *only*
 * function that returns permission to speak, it checks `policy.muted` first, and
 * callers receive a `SpeakDecision` union rather than a boolean, so a denial
 * cannot be silently coerced to "yes".
 *
 * The machine is deliberately not event-sourced or async. Every transition is a
 * pure function of (current snapshot, policy, input), which makes the turn-taking
 * rules directly testable without an Agora connection.
 */

import type {
  AgentPolicy,
  FloorSnapshot,
  FloorState,
  SpeakDecision,
  SpeakTrigger,
} from '@echosphere/shared-types';

export interface FloorInputs {
  /** Whether the gap detector currently has an unaddressed gap worth raising. */
  hasUnaddressedGap: boolean;
  /** Topic the agent wants to speak about, checked against disabled topics. */
  topic?: string;
  /**
   * How long ago the agent last interjected unprompted about this same topic,
   * in ms, or undefined if she never has.
   *
   * Supplied by the caller rather than tracked in the snapshot because it is
   * per-topic and the snapshot is a single room-wide state. See
   * `topicInterjectionCooldownMs`.
   */
  msSinceTopicInterjection?: number;
  now: number;
}

export function initialFloor(now: number): FloorSnapshot {
  return {
    state: 'OPEN_FLOOR',
    holderId: null,
    lastHumanSpeechAt: now,
    since: now,
  };
}

/**
 * The single gate for agent speech. Order of checks matters and encodes the
 * plan's precedence: mute veto → teacher's floor → already speaking → topic
 * ban → trigger-specific conditions.
 */
export function decideSpeak(
  floor: FloorSnapshot,
  policy: AgentPolicy,
  trigger: SpeakTrigger,
  inputs: FloorInputs,
): SpeakDecision {
  // 1. Absolute veto. Checked before anything else, including teacher-invoked
  //    speech — an explicitly muted agent stays silent until RESUME_AGENT.
  if (policy.muted) {
    return { allowed: false, reason: 'AGENT_MUTED' };
  }

  // 2. A teacher-invoked command outranks the remaining floor rules: the teacher
  //    pressing "speak now" is itself the authority the other rules protect.
  if (trigger === 'TEACHER_INVOKED' || trigger === 'QUIZ_DELIVERY') {
    if (isTopicDisabled(policy, inputs.topic)) {
      return { allowed: false, reason: 'TOPIC_DISABLED' };
    }
    return { allowed: true, trigger };
  }

  // 3. The teacher's floor always wins over autonomous agent speech.
  if (floor.state === 'TEACHER_HOLDS_FLOOR') {
    return { allowed: false, reason: 'TEACHER_HOLDS_FLOOR' };
  }

  // 4. Never talk over ourselves — an in-flight utterance must be interrupted
  //    explicitly (END_AGENT_TURN) rather than stacked on.
  if (floor.state === 'AGENT_SPEAKING') {
    return { allowed: false, reason: 'AGENT_ALREADY_SPEAKING' };
  }

  if (isTopicDisabled(policy, inputs.topic)) {
    return { allowed: false, reason: 'TOPIC_DISABLED' };
  }

  // 5. Being addressed by name is sufficient only while the teacher allows
  //    students to summon the agent. Otherwise the floor is the teacher's alone.
  if (trigger === 'DIRECTLY_ADDRESSED') {
    if (!policy.studentsMayInvoke) {
      return { allowed: false, reason: 'STUDENT_INVOCATION_DISABLED' };
    }
    return { allowed: true, trigger };
  }

  // 6. Unprompted interjection: requires the teacher to have left proactive mode
  //    on, a real silence gap, AND something worth saying. All three, per §3.3(b).
  if (trigger === 'GAP_DETECTED_IN_SILENCE') {
    if (!policy.proactiveInterjectionsEnabled || !inputs.hasUnaddressedGap) {
      return { allowed: false, reason: 'SILENCE_GAP_TOO_SHORT' };
    }
    const silenceMs = inputs.now - floor.lastHumanSpeechAt;
    if (silenceMs < policy.silenceGapThresholdMs) {
      return { allowed: false, reason: 'SILENCE_GAP_TOO_SHORT' };
    }
    // She already said this. The silence rule cannot catch it: her own voice is
    // not human speech, so the room reads as silent the instant she stops and
    // the same topic is eligible again on the very next tick — which is a
    // one-second repeat loop for as long as the gap stays open. This is the
    // backstop that bounds it no matter which signal re-opened the gap.
    if (
      inputs.msSinceTopicInterjection !== undefined &&
      inputs.msSinceTopicInterjection < policy.topicInterjectionCooldownMs
    ) {
      return { allowed: false, reason: 'TOPIC_RECENTLY_ADDRESSED' };
    }
    return { allowed: true, trigger };
  }

  return { allowed: false, reason: 'SILENCE_GAP_TOO_SHORT' };
}

function isTopicDisabled(policy: AgentPolicy, topic?: string): boolean {
  if (!topic) return false;
  const needle = topic.toLowerCase();
  return policy.disabledTopics.some((t) => needle.includes(t.toLowerCase()));
}

// ─── Transitions ─────────────────────────────────────────────────────────────

export function onHumanSpeechStart(
  floor: FloorSnapshot,
  speakerRole: 'teacher' | 'student',
  participantId: string,
  now: number,
): FloorSnapshot {
  const state: FloorState =
    speakerRole === 'teacher' ? 'TEACHER_HOLDS_FLOOR' : 'OPEN_FLOOR';
  return {
    state,
    holderId: participantId,
    lastHumanSpeechAt: now,
    since: now,
  };
}

export function onHumanSpeechEnd(
  floor: FloorSnapshot,
  now: number,
): FloorSnapshot {
  // Agent speech is ended by onAgentSpeechEnd, not by a human finishing.
  if (floor.state === 'AGENT_SPEAKING') {
    return { ...floor, lastHumanSpeechAt: now };
  }
  return {
    state: 'OPEN_FLOOR',
    holderId: null,
    lastHumanSpeechAt: now,
    since: now,
  };
}

/**
 * Someone — teacher or student — said the agent's name and finished speaking.
 * Named generically on purpose: addressing the agent is not a student-only
 * privilege. `studentsMayInvoke` gates whether a STUDENT'S address earns a
 * permit; it was never meant to, and must never, gate the teacher's own.
 */
export function onAddressedAgent(
  floor: FloorSnapshot,
  participantId: string,
  now: number,
): FloorSnapshot {
  return {
    state: 'STUDENT_QUESTION_PENDING',
    holderId: participantId,
    lastHumanSpeechAt: now,
    since: now,
  };
}

export function onAgentSpeechStart(
  floor: FloorSnapshot,
  now: number,
): FloorSnapshot {
  return {
    state: 'AGENT_SPEAKING',
    holderId: null,
    lastHumanSpeechAt: floor.lastHumanSpeechAt,
    since: now,
  };
}

export function onAgentSpeechEnd(
  floor: FloorSnapshot,
  now: number,
): FloorSnapshot {
  return {
    state: 'OPEN_FLOOR',
    holderId: null,
    lastHumanSpeechAt: floor.lastHumanSpeechAt,
    since: now,
  };
}

/**
 * Barge-in: the teacher started speaking while the agent was mid-utterance.
 * Returns the new snapshot plus whether the caller must issue an interrupt to
 * the ConvoAI engine. Keeping the "must interrupt" signal in the return value
 * means the transition and the side effect can never drift apart.
 */
export function onTeacherBargeIn(
  floor: FloorSnapshot,
  participantId: string,
  now: number,
): { floor: FloorSnapshot; mustInterruptAgent: boolean } {
  const wasAgentSpeaking = floor.state === 'AGENT_SPEAKING';
  return {
    floor: {
      state: 'TEACHER_HOLDS_FLOOR',
      holderId: participantId,
      lastHumanSpeechAt: now,
      since: now,
    },
    mustInterruptAgent: wasAgentSpeaking,
  };
}

/**
 * Detects the hardcoded wake phrase in a transcript segment (§3.3, Phase 1).
 * Matches on a normalised form so "Hey, Athena!" and "hey athena" both count.
 */
/**
 * Names the speech recogniser produces when someone says "Athena".
 *
 * Requiring an exact match makes the agent unreachable in practice: Deepgram
 * renders the name as "Xena", "Tina", "Athina" and similar depending on accent
 * and mic quality, and a student who has clearly addressed the agent then gets
 * silence with no way to tell why. Accepting the near-misses costs the
 * occasional false wake, which is a far cheaper failure than an agent that
 * cannot be called.
 */
const AGENT_NAME_VARIANTS = [
  'athena',
  'athina',
  'atheena',
  'athenna',
  'xena',
  'zena',
  'tina',
  'teena',
  'serena',
  'aetna',
  'anthena',
  'atena',
  'atene',
  'athene',
];

const MULTILINGUAL_GREETINGS = [
  'hey',
  'hi',
  'hello',
  'ok',
  'okay',
  'bonjour',
  'salut',
  'hola',
  'oye',
  'hallo',
  'guten tag',
  'namaste',
  'namaskar',
  'vanakkam',
  'namaskaram',
  'dis',
  'dites',
  'ecoute',
  'ecoutez',
  'ohe',
];

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isAddressedToAgent(text: string, wakePhrase: string): boolean {
  const haystack = normalise(text);
  if (haystack.length === 0) return false;

  // The configured phrase always wins, so a teacher can rename the agent.
  if (haystack.includes(normalise(wakePhrase))) return true;

  // Otherwise accept the bare name, with or without a greeting in front, and
  // tolerate what the recogniser actually produces for it.
  const configuredName = normalise(wakePhrase).split(' ').pop() ?? '';
  const candidates = configuredName === 'athena'
    ? AGENT_NAME_VARIANTS
    : [configuredName, ...AGENT_NAME_VARIANTS];

  return candidates.some((name) =>
    name.length > 0 && new RegExp(`\\b${name}\\b`).test(haystack),
  );
}

/**
 * Removes the wake phrase from an utterance. Anything that analyses what a
 * student *said* — topic inference, gap clustering — must run on the question
 * itself, or the agent's own name becomes the apparent subject of the lesson.
 */
export function stripWakePhrase(text: string, wakePhrase: string): string {
  const words = wakePhrase
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[\\s,]*');

  let out = text.replace(new RegExp(`\\b${words}\\b[\\s,!?.]*`, 'ig'), '');

  // Also strip a bare (or mis-heard) name, optionally preceded by a greeting in any supported language.
  const names = AGENT_NAME_VARIANTS.join('|');
  const greetings = MULTILINGUAL_GREETINGS.join('|');
  out = out.replace(
    new RegExp(`\\b(${greetings})?[\\s,]*(${names})\\b[\\s,!?.]*`, 'ig'),
    '',
  );

  return out.trim();
}
