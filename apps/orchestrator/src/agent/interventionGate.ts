export interface GateInput {
  mode: 'silent' | 'on-request' | 'proactive';
  isTeacherSpeaking: boolean;
  silenceDurationMs: number;
  isDirectAddress: boolean;
  unansweredQuestionAgeMs: number;
  attributionConfidence: number;
}

export interface GateDecision {
  score: number;
  allowed: boolean;
  reason: string;
}

/**
 * Pure scoring function for Meraki's restraint threshold.
 *
 * Scores a potential co-teacher response between 0.0 and 1.0.
 * A score >= 0.60 is allowed to speak.
 */
export function evaluateGate(input: GateInput): GateDecision {
  const {
    mode,
    isTeacherSpeaking,
    silenceDurationMs,
    isDirectAddress,
    unansweredQuestionAgeMs,
    attributionConfidence,
  } = input;

  // 1. Silent mode vetoes everything
  if (mode === 'silent') {
    return { score: 0.0, allowed: false, reason: 'mode is Silent' };
  }

  // 2. Hard veto if the teacher is currently speaking
  if (isTeacherSpeaking) {
    return { score: 0.0, allowed: false, reason: 'teacher is speaking' };
  }

  // 3. Direct address is an automatic permit (if not muted/silent)
  if (isDirectAddress) {
    if (attributionConfidence < 0.5) {
      return { score: 0.4, allowed: false, reason: 'direct address but attribution confidence too low' };
    }
    return { score: 1.0, allowed: true, reason: 'direct address' };
  }

  // 4. On-request mode only allows direct address (which is handled above)
  if (mode === 'on-request') {
    return { score: 0.0, allowed: false, reason: 'mode is On-request and not directly addressed' };
  }

  // 5. Proactive mode scoring logic
  let score = 0.0;

  // Silence contribution: silence gives space to speak, up to +0.4
  if (silenceDurationMs > 3000) {
    // Reaches max +0.4 after 10 seconds of silence
    score += Math.min(0.4, (silenceDurationMs - 3000) / 17500);
  }

  // Unanswered question contribution: if a student asked a question, up to +0.5
  if (unansweredQuestionAgeMs > 0) {
    // Reaches max +0.5 after 5 seconds of waiting
    score += Math.min(0.5, (unansweredQuestionAgeMs / 10000));
  }

  // Scale the total score by the attribution confidence (so uncertain speaker states stay quiet)
  score = score * attributionConfidence;

  // Keep score in bounds
  score = Math.max(0.0, Math.min(1.0, score));

  // Round to two decimal places
  score = Math.round(score * 100) / 100;

  const threshold = 0.60;
  const allowed = score >= threshold;
  const reason = allowed
    ? 'score cleared threshold'
    : `score ${score.toFixed(2)} < ${threshold.toFixed(2)}`;

  return { score, allowed, reason };
}
