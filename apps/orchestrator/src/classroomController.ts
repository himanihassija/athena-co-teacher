/**
 * Classroom controller — the seam where PS31's separate mechanisms meet.
 *
 * Transcript in -> speaker attribution (§3.8) -> floor transition (§3.3) ->
 * confusion detection (§3.9) -> a decision about whether the agent may speak.
 * Agent turns out -> control-channel parse (§3.6, §3.9) -> quiz cards and gaps.
 *
 * Every path that can make the agent talk goes through `requestFloor`, which is
 * the only caller of `decideSpeak`. That is what makes the teacher's mute an
 * absolute veto in practice rather than just in intent: there is one door.
 */

import type {
  Participant,
  ProficiencyTag,
  QuizQuestion,
  SpeakDenialReason,
  SpeakTrigger,
  TeacherCommand,
  TranscriptSegment,
} from '@echosphere/shared-types';
import {
  decideSpeak,
  isAddressedToAgent,
  onAgentSpeechEnd,
  onAgentSpeechStart,
  onHumanSpeechEnd,
  onHumanSpeechStart,
  onAddressedAgent,
  onTeacherBargeIn,
  stripWakePhrase,
} from './floor/floorMachine.js';
import {
  assistantTurnSnapshot,
  interruptAgent,
  pollForPayloadTurn,
  pushInstructions,
  think,
} from './agent/agentLifecycle.js';
import {
  matchParticipantByName,
  parseAgentTurn,
  type CoTeacherControl,
} from './agent/control.js';
import {
  markGapAddressed,
  pendingClassWideGap,
  recordConfusedQuestion,
  recordReportedGap,
  recordWrongAnswer,
} from './gaps/gapDetector.js';
import {
  SYSTEM_PREFIX,
  addressedByTeacherDirective,
  forceSpeakDirective,
  gapInterjectionDirective,
  quizDirective,
} from './agent/prompt.js';
import {
  QUIZ_DURATION_MS,
  allTargetsAnswered,
  answersFor,
  broadcastQuiz,
  markQuizClosed,
  normaliseAnswer,
  openQuizFor,
  optionIndicesMentioned,
  recordAnswer,
  recordQuizFromControl,
} from './quiz/quizEngine.js';
import { rememberAgentUtterance, stripSelfEcho } from './agent/echo.js';
import {
  applyBoardCommand,
  broadcastWhiteboard,
  mergeSceneElements,
  openWhiteboard,
} from './whiteboard/boardSession.js';
import {
  forgetIllustrations,
  generateIllustration,
  placeBeside,
  type IllustrationContext,
} from './board/boardAgent.js';
import { parseVoiceBoardCommand } from './whiteboard/voice.js';
import { recordHeldBackDoubt } from './workspace/workspaceManager.js';
import { suggestReadingForGap } from './support/targetedReading.js';
import { publish, publishTo, publishToTeachers } from './state/eventBus.js';
import {
  AGENT_UID,
  activeStudents,
  appendTranscript,
  participantByUid,
  setProficiency,
  toPublicParticipant,
  type ClassroomSession,
} from './state/sessionRegistry.js';

/**
 * How close together two identical utterances must be to count as one.
 *
 * Only relevant for segments with no turnId, where text is the sole identity.
 * Wide enough to absorb a slow relay, far short of how long it takes someone to
 * repeat themselves.
 */
const DUPLICATE_WINDOW_MS = 4000;

/** A quiz request the agent never answered is abandoned after this long. */
const PENDING_QUIZ_TTL_MS = 30_000;

/**
 * Slack allowed when the expiry sweep checks whether a quiz's deadline has
 * really passed. setTimeout can fire a few milliseconds early, and without this
 * an on-time sweep would see a positive remainder and re-arm itself forever.
 */
const SWEEP_TOLERANCE_MS = 250;

/**
 * The single gate for agent speech. Everything that wants the agent to talk
 * calls this; nothing calls `decideSpeak` directly.
 */
export function requestFloor(
  session: ClassroomSession,
  trigger: SpeakTrigger,
  topic?: string,
): boolean {
  const lastInterjection =
    topic === undefined
      ? undefined
      : session.lastInterjectionByTopic.get(topic.toLowerCase());
  const decision = decideSpeak(session.floor, session.policy, trigger, {
    hasUnaddressedGap: pendingClassWideGap(session) !== undefined,
    topic,
    msSinceTopicInterjection:
      lastInterjection === undefined ? undefined : Date.now() - lastInterjection,
    now: Date.now(),
  });

  if (!decision.allowed) {
    // Denials are surfaced to the teacher panel: "the agent tried to speak and
    // was blocked because you muted it" is exactly what makes the override
    // mechanism legible during a demo (§3.10).
    console.info(
      `[floor] denied ${trigger} for session ${session.sessionId}: ${decision.reason}`,
    );
    publishToTeachers(session.sessionId, {
      kind: 'echosphere:agent-blocked',
      reason: decision.reason,
      at: Date.now(),
    });
    setRestraintMeter(session, 'held-back', RESTRAINT_HELD_BACK_MS);
    return false;
  }

  console.info(
    `[floor] granted ${decision.trigger} for session ${session.sessionId}`,
  );
  session.floor = onAgentSpeechStart(session.floor, Date.now());
  grantSpeakPermit(session, decision.trigger);
  setRestraintMeter(session, 'speaking');
  broadcastFloor(session);
  return true;
}

/**
 * How long after a turn was authorised a further starting state still counts as
 * that same turn.
 *
 * Agent state arrives over RTM, which is neither ordered nor guaranteed. A
 * momentary 'listening' between 'thinking' and 'speaking' clears
 * `authorizedTurnInProgress`, and because the standing permit is consumed when
 * the turn is authorised, the next 'speaking' had neither — so a turn the
 * teacher had explicitly asked for was cut off mid-word.
 *
 * Deliberately short. It has to cover a gap in state delivery, not license a
 * later unrelated turn; the mute and barge-in paths call `interruptAgent`
 * directly and clear the timestamp, so neither can be ridden out by this.
 */
const TURN_CONTINUATION_MS = 8_000;


export function grantSpeakPermit(
  session: ClassroomSession,
  reason: SpeakTrigger,
  /**
   * The turnId of the spoken address that earned this permit, when there is
   * one — omitted for a teacher-command grant (`/agent/start`'s greeting,
   * FORCE_AGENT_SPEAK) that has no transcript turn to point to. Threaded
   * through so `hasSpeakPermit` can tell a later relay of this SAME
   * utterance apart from someone genuinely speaking again.
   */
  turnId?: number,
): void {
  session.speakPermit = { grantedAt: Date.now(), reason, turnId };
}

/**
 * Whether an invitation to speak is still the one it was, not how long ago it
 * was issued.
 *
 * This used to be a fixed 15-second TTL — long enough, it seemed, to cover
 * ASR settle plus generation latency for the model in place at the time. A
 * reasoning model broke that assumption: measured live, a single reply can
 * take upwards of 20 seconds just to begin, and there is no duration short
 * enough to bound that without also being long enough to feel broken on a
 * fast one. A slow reply to a question that is still the most recent thing
 * anyone said is not "uninvited" — it is just slow, and it is invited for as
 * long as nothing has since made it not the answer to the most recent thing
 * said.
 *
 * So validity is judged by that instead: has anyone spoken again since the
 * permit was granted. If not, it is still exactly the invitation it was, no
 * matter how long the engine takes to act on it — wait for her. If someone
 * has, the room has moved on and a reply this stale would be answering
 * something that is no longer the question; that check already exists as
 * `nobodySpokeSinceAuthorisation` below for a turn already in progress, and
 * this mirrors it for one that has not started yet. Anything that should
 * revoke an invitation outright already does, explicitly and immediately,
 * by calling `clearSpeakPermit` — mute, teacher barge-in, the floor closing
 * to students, a quiz that never landed.
 *
 * "Has anyone spoken again" turned out to need one more qualification, found
 * live: a turn commonly relays more than once — the recogniser settling on a
 * final version, or simply arriving twice — and `lastHumanSpeechAt` refreshes
 * on every relay, finished or not, because the silence-gap detector and the
 * floor indicator both need it to (a teacher mid-sentence must never read as
 * silent). A permit granted off the FIRST relay of an address then read every
 * later relay of that SAME utterance as fresh evidence someone else had
 * spoken, and revoked itself — measured live, within about a second of being
 * granted, on the very address that granted it. The fix is not to slow that
 * refresh down (`lastHumanSpeechAt`'s other consumers depend on it staying
 * fast); it is to also ask WHICH turn the latest speech belongs to.
 * `lastHumanSpeechTurnId`, tracked in parallel, answers that: if it names the
 * same turn the permit itself was granted for, the timestamp moving on is not
 * new speech, it is an echo of the old, and does not count. This only has to
 * catch a stale
 * invitation nobody explicitly revoked, not stand in for those calls.
 */
export function hasSpeakPermit(session: ClassroomSession): boolean {
  const permit = session.speakPermit;
  if (!permit) return false;
  const settled = session.lastSettledHumanSpeech;
  // Nothing has finished being said since the grant. Note this reads
  // `lastSettledHumanSpeech`, not `floor.lastHumanSpeechAt`: an interim
  // fragment of the sentence still being spoken bumps the latter — by
  // design, the silence detector needs it to — and must not read as
  // somebody else having spoken.
  if (!settled || settled.at <= permit.grantedAt) return true;
  // Something did settle after the grant — but if it is the SAME turn that
  // earned this permit, restated or relayed again, it is an echo of the old,
  // not new speech, and must not count against it. A permit with no turnId
  // (a teacher-command grant, which points at no transcript turn) has no
  // such exception: it goes stale the instant anything else is said.
  return permit.turnId !== undefined && settled.turnId === permit.turnId;
}

/**
 * Revokes everything that would let the agent speak: any standing invitation
 * to start a new turn, and authorization for a turn already under way. This
 * is the single function every override (mute, teacher barge-in, floor
 * closed) calls, so "the agent may not speak" always means the same thing.
 */
export function clearSpeakPermit(session: ClassroomSession): void {
  session.speakPermit = null;
  session.authorizedTurnInProgress = false;
  // Closed too: otherwise a mute or barge-in would be undone by the
  // continuation window it is meant to override.
  session.lastAuthorisedTurnAt = null;
}

/**
 * Enforcement for autonomous agent turns — the hard half of §3.3.
 *
 * The browser relays the engine's own state changes here. When the agent starts
 * thinking or speaking without a permit, it is interrupted at once. The prompt
 * asks her to stay quiet and usually succeeds; this is what makes it a rule
 * rather than a request, and it is the only thing that stops her answering a
 * teacher who was talking to the class.
 */
export async function handleAgentState(
  session: ClassroomSession,
  state: string,
): Promise<{ interrupted: boolean; reason?: SpeakDenialReason }> {
  const starting = state === 'thinking' || state === 'speaking';

  if (!starting) {
    // The turn has ended (silent/listening/idle). Authorization does not
    // carry over: the next turn, whatever prompts it, needs its own permit.
    session.authorizedTurnInProgress = false;
    setRestraintMeter(session, 'listening');
    return { interrupted: false };
  }

  // Already cleared to run. This is what makes authorization cover the whole
  // turn rather than a snapshot in time: once granted, nothing here can
  // revoke it mid-sentence — only an explicit action (mute, teacher barge-in,
  // floor closed) can, and each of those calls interruptAgent directly rather
  // than waiting for this function to notice on its next poll.
  if (session.authorizedTurnInProgress) return { interrupted: false };

  // Still the turn authorised a moment ago, resurfacing after a gap in state
  // delivery rather than starting a new one.
  //
  // 'speaking' is the engine continuing to voice a turn it already started, so
  // it qualifies on the window alone.
  //
  // 'thinking' used to be excluded outright, on the reasoning that thinking is
  // how a NEW turn begins and so must always present its own permit. That is
  // true of a new turn and false of a long one: the engine streams a long
  // answer in chunks and re-enters 'thinking' between them, having already
  // consumed the permit on the first chunk. So a long explanation was cut off
  // partway — "Photosynthesis is the process by which green plants, algae,"
  // and then silence — while a short one, voiced in a single burst, was fine.
  // That is why this looked intermittent rather than broken.
  //
  // What actually separates the two cases is whether anyone has spoken since
  // the turn was authorised. Nobody has: the engine is still working through
  // the answer it was invited to give. Somebody has: whatever it is about to
  // say is a response to THEM, it is not covered by the earlier invitation, and
  // it must present its own permit. `lastHumanSpeechAt` moves on interim
  // transcripts too, so a teacher who has merely started talking is enough.
  //
  // The overrides are unaffected. Mute, teacher barge-in and closing the floor
  // all call `clearSpeakPermit`, which nulls `lastAuthorisedTurnAt` and so
  // closes this window immediately rather than waiting for it to lapse.
  const sinceAuthorised =
    session.lastAuthorisedTurnAt === null
      ? Number.POSITIVE_INFINITY
      : Date.now() - session.lastAuthorisedTurnAt;

  // The guard that does the real work for 'thinking'.
  //
  // A narrower time window was tried first, on the assumption that a chunk
  // boundary is a pause of milliseconds. Live sessions disproved it: the gaps
  // are two to four seconds, because the engine is generating the next chunk,
  // and a 2s window still cut long answers off. The window is not what
  // separates the two cases — this is. The engine only produces a turn in
  // response to input, so a genuinely new, uninvited turn is preceded by
  // somebody speaking; a continued one is not. `lastHumanSpeechAt` moves on
  // interim transcripts, so a teacher who has merely started talking closes it.
  const nobodySpokeSinceAuthorisation =
    session.lastAuthorisedTurnAt !== null &&
    session.floor.lastHumanSpeechAt <= session.lastAuthorisedTurnAt;

  const continuingAuthorisedTurn =
    sinceAuthorised <= TURN_CONTINUATION_MS &&
    (state === 'speaking' || nobodySpokeSinceAuthorisation);

  let permitted = hasSpeakPermit(session) || continuingAuthorisedTurn;

  // The invitation for this very turn may not have arrived yet. See
  // `awaitPermitInFlight` — this is the window in which Athena was cut off for
  // answering a question she had, in fact, just been asked.
  if (!permitted && !session.policy.muted) {
    permitted = await awaitPermitInFlight(session);
    // Another relay of the same state change adjudicated it while we waited.
    // It has already done everything below; doing it again would consume a
    // second permit for one turn.
    if (session.authorizedTurnInProgress) return { interrupted: false };
  }

  if (session.policy.muted || !permitted) {
    // Revoked BEFORE the interrupt, not after.
    //
    // `interruptAgent` is a round trip to Agora — measured at 1.4s in a live
    // session — and this function used to clear the permit on the far side of
    // that await. A permit granted during those 1.4s (which is exactly what
    // happens when the transcript of the address lands a moment after the
    // engine has already started answering it) was therefore wiped by a
    // decision taken before it existed. The `think` that followed then had no
    // permit, was cut off in turn, and the floor was left reading
    // "Waiting on Athena" with no answer ever coming.
    //
    // Every mutation here is a consequence of the decision made above, so it
    // belongs with that decision, in the same synchronous step.
    releaseFloor(session);
    clearSpeakPermit(session);
    // Report why the interrupt actually fired.
    //
    // This used to infer a reason from whichever policy happened to be false,
    // so a turn the TEACHER had requested was logged and shown as
    // STUDENT_INVOCATION_DISABLED — "a student called her" — when no student
    // had spoken. That sent real debugging down the wrong path twice.
    //
    // Only two things reach here: the agent is muted, or she began a turn
    // without a permit. Which policy is set is not the cause and is no longer
    // consulted.
    const reason: SpeakDenialReason = session.policy.muted
      ? 'AGENT_MUTED'
      : 'AGENT_UNINVITED';
    console.info(
      `[floor] interrupted an un-permitted turn in session ${session.sessionId}: ${reason}`,
    );
    publishToTeachers(session.sessionId, {
      kind: 'echosphere:agent-blocked',
      reason,
      at: Date.now(),
    });
    setRestraintMeter(session, 'held-back', RESTRAINT_HELD_BACK_MS);
    await interruptAgent(session.sessionId).catch(() => undefined);
    return { interrupted: true, reason };
  }

  // First valid check for this turn: authorize it for its full duration and
  // consume the standing permit, so a later, unrelated turn cannot ride on an
  // invitation meant for this one.
  session.authorizedTurnInProgress = true;
  session.lastAuthorisedTurnAt = Date.now();
  // Kept past the permit's own lifetime, for the things that must know whether
  // anyone asked for this turn. A continuation carries the trigger of the turn
  // it continues, so it is only overwritten when a fresh permit is consumed.
  if (session.speakPermit) {
    session.lastAuthorisedTurnTrigger = session.speakPermit.reason;
  }
  session.speakPermit = null;
  claimFloorForAgent(session);
  setRestraintMeter(session, 'speaking');
  return { interrupted: false };
}

/**
 * How long to wait for an invitation that is probably already on its way.
 *
 * The engine hears the wake word itself and starts answering within a few
 * hundred milliseconds. The orchestrator learns the same thing far later: the
 * browser holds each spoken turn for `TURN_SETTLE_MS` before relaying it, so
 * that a sentence is posted once, complete, rather than as a dozen growing
 * fragments. For that window the agent is legitimately answering a question
 * the orchestrator has not been told about yet, and enforcement — which knows
 * only that no permit exists — cut her off for it.
 *
 * Comfortably longer than the relay's settle plus a round trip, so the
 * transcript has had its chance to land. Waiting is only ever entered for a
 * turn that would otherwise be interrupted outright, and never when the agent
 * is muted, so the mute veto keeps its immediacy.
 */
const PERMIT_GRACE_MS = 1_500;
const PERMIT_GRACE_POLL_MS = 100;

/**
 * True once this turn turns out to have been invited after all.
 *
 * Polls rather than waits on an event because the grant happens in a different
 * request — the transcript POST — and the two share nothing but the session.
 */
async function awaitPermitInFlight(session: ClassroomSession): Promise<boolean> {
  const deadline = Date.now() + PERMIT_GRACE_MS;
  while (Date.now() < deadline) {
    // Deliberately NOT unref'd, unlike `onTurnSettled`'s timer: this one is
    // awaited inside a request that is holding a decision open, so letting the
    // process exit out from under it would leave that decision unmade.
    await new Promise((resolve) => setTimeout(resolve, PERMIT_GRACE_POLL_MS));
    // A mute or a barge-in arriving mid-wait settles the question immediately.
    if (session.policy.muted) return false;
    if (session.endedAt !== null) return false;
    if (session.authorizedTurnInProgress) return true;
    if (hasSpeakPermit(session)) return true;
  }
  return false;
}

/**
 * Marks the floor as Athena's for the turn she has just been cleared to give.
 *
 * Only `requestFloor` used to do this, which covers the turns the orchestrator
 * starts. A directly-addressed turn is started by the engine, so the floor sat
 * in `STUDENT_QUESTION_PENDING` — the state the room reads as "Waiting on
 * Athena" — for the whole of her answer and beyond, since `releaseFloor` had
 * nothing to release. Now every authorised turn passes through the same two
 * states, whoever started it.
 */
function claimFloorForAgent(session: ClassroomSession): void {
  if (session.floor.state === 'AGENT_SPEAKING') return;
  session.floor = onAgentSpeechStart(session.floor, Date.now());
  broadcastFloor(session);
}

/**
 * Hands the floor back after an agent turn ends — or after one is refused.
 *
 * `STUDENT_QUESTION_PENDING` is released as well as `AGENT_SPEAKING`. A
 * question that will never be answered — she was interrupted, muted, or the
 * floor closed under her — otherwise left the room's floor indicator showing
 * "Waiting on Athena" indefinitely, with nothing but the next person to speak
 * able to clear it.
 */
export function releaseFloor(session: ClassroomSession): void {
  if (
    session.floor.state !== 'AGENT_SPEAKING' &&
    session.floor.state !== 'STUDENT_QUESTION_PENDING'
  ) {
    return;
  }
  const wasSpeakingSince =
    session.floor.state === 'AGENT_SPEAKING' ? session.floor.since : null;
  session.floor = onAgentSpeechEnd(session.floor, Date.now());
  session.activeQuestionerId = null;
  broadcastFloor(session);
  if (wasSpeakingSince !== null) startQuizCountdowns(session, wasSpeakingSince);
}

/**
 * Starts the answer window for any quiz she issued during the turn that just
 * ended.
 *
 * A quiz's deadline is set when its control payload is parsed, which is when
 * her *text* arrives — but her voice is still reading the four options aloud
 * for several seconds after that. So the countdown the student sees had already
 * been running while they were still being told what the options were, and a
 * 15-second window could be most of the way gone before anyone could answer.
 * The card's own doc comment claimed the window started "after she has finished
 * asking"; this is what makes that true.
 *
 * Only quizzes nobody has answered yet are moved: if a student got in early,
 * their window was evidently long enough and extending it would hold the class
 * on a question that is already done.
 */
function startQuizCountdowns(session: ClassroomSession, turnStartedAt: number): void {
  const now = Date.now();
  for (const quiz of session.quizzes.values()) {
    if (quiz.closedAt) continue;
    if (quiz.createdAt < turnStartedAt) continue;
    if (session.answers.some((a) => a.quizId === quiz.quizId)) continue;
    if (quiz.deadline >= now + QUIZ_DURATION_MS) continue;
    quiz.deadline = now + QUIZ_DURATION_MS;
    // Re-broadcast so the ring on the student's card restarts against the
    // deadline the server is actually holding it to.
    broadcastQuiz(session, quiz);
    scheduleQuizClose(session, quiz.quizId, quiz.deadline);
  }
}

// ─── Transcript ingestion (§3.4, §3.8, §3.9) ─────────────────────────────────

export interface IngestOptions {
  uid: string;
  text: string;
  /** Partial transcripts update the floor but are not logged or analysed. */
  isFinal: boolean;
  turnId?: number;
  language?: string;
  /** How sure the relaying client was about `uid` — see TranscriptSegment. */
  attributionConfidence?: number;
}

/**
 * How long one spoken turn is allowed to keep growing before we act on it.
 *
 * The recogniser does not deliver a sentence once. It finalises a guess, then
 * re-sends the same turn as more words arrive, and every browser in the room
 * may relay each version. Acting on each arrival makes Athena answer the same
 * question once per relay; acting only on the first makes her answer a
 * truncated version of it. So actions that must happen exactly once per
 * sentence wait for the turn to stop changing, then run against the last text
 * seen.
 */
const TURN_SETTLE_MS = 700;

const settlingTurns = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Run `action` once for a spoken turn, using the most complete version of it.
 * Each new relay of the same turn replaces the pending action, so only the
 * final one runs. A turn with no id cannot be tracked across relays and runs
 * immediately.
 */
export function onTurnSettled(key: string | null, action: () => void): void {
  if (key === null) {
    action();
    return;
  }
  const pending = settlingTurns.get(key);
  if (pending) clearTimeout(pending);

  const timer = setTimeout(() => {
    settlingTurns.delete(key);
    action();
  }, TURN_SETTLE_MS);
  // Never hold the process open just to finish a turn.
  timer.unref?.();
  settlingTurns.set(key, timer);
}

/**
 * True for the orchestrator's own injected instructions coming back through the
 * transcript stream.
 *
 * These reach us on either side of the relay's speaker split. The engine treats
 * an injected directive as user input, so it usually arrives uid "0" and is
 * dropped on the human path below — but the browser's discriminator keys on
 * `metadata.object`, and when the engine tags the echo AGENT_TRANSCRIPTION the
 * same text arrives under the agent's uid instead, taking the `uid ===
 * AGENT_UID` branch and never reaching that guard. It was then appended as one
 * of Athena's own turns, which is how a classroom read
 * "[classroom:system] The teacher just spoke to you directly:" on screen,
 * attributed to her.
 */
function isSystemDirective(text: string): boolean {
  return text.trimStart().startsWith(SYSTEM_PREFIX);
}

/**
 * Why a transcript turn was discarded.
 *
 * Six guards in `ingestTranscript` drop a turn and return. None of them logged,
 * and the route replies `{ok:true}` either way — so a dropped turn was
 * indistinguishable from a stored one both from the browser AND from the server
 * logs, which is why "the student spoke and nothing happened" could never be
 * attributed to anything. Naming them changes no behaviour; it only makes the
 * existing behaviour observable.
 */
type TranscriptDropReason =
  | 'unchanged'
  | 'duplicate'
  | 'system-directive'
  | 'unknown-uid'
  | 'not-final'
  | 'self-echo';

function dropTranscript(
  session: ClassroomSession,
  reason: TranscriptDropReason,
  uid: string,
  text: string,
  turnId?: number,
): void {
  console.info(
    `[transcript] drop reason=${reason} session=${session.sessionId} ` +
      `uid=${uid} turn=${turnId ?? '-'} text=${JSON.stringify(text.slice(0, 60))}`,
  );
}

export async function ingestTranscript(
  session: ClassroomSession,
  { uid, text, isFinal, turnId, language, attributionConfidence }: IngestOptions,
): Promise<void> {
  const now = Date.now();
  const systemDirective = isSystemDirective(text);

  // Every browser in the room sees the same RTM transcript stream, and any of
  // them may relay it, so (uid, turnId) identifies one utterance across relays.
  //
  // A repeat is not always noise: the toolkit re-emits a turn as more of it
  // arrives, so the same turnId legitimately comes back longer. Identical text
  // is dropped; a grown version replaces what is stored.
  // True once the transcript store already holds this turn, so the append
  // below is skipped. Intent still runs: see the `updated` branch.
  let alreadyStored = false;

  // A directive must not reach the upsert either. It shares its turn id with
  // the reply it provoked, so a relay carrying the directive is a *longer*
  // version of that turn and would overwrite Athena's stored words with the
  // instruction text.
  if (isFinal && turnId !== undefined && !systemDirective) {
    const outcome = upsertByTurn(session, uid, text, turnId);
    if (outcome === 'unchanged') {
      dropTranscript(session, 'unchanged', uid, text, turnId);
      return;
    }
    if (outcome === 'updated') {
      // The stored segment was rewritten in place; re-publish so clients that
      // already rendered the fragment replace it rather than showing both.
      republishTurn(session, uid, turnId);
      // ...and then keep going. This used to return here, which meant the
      // COMPLETED form of a sentence never reached the wake-phrase check or
      // the board parser below — only the first fragment did. "Athena, write
      // two plus two equals four on the whiteboard" arrived first as
      // "...on the", which parses as no command at all, and the finished
      // sentence that did parse was discarded as a duplicate. The board write
      // is de-duplicated by turn id instead, further down.
      alreadyStored = true;
    }
  } else if (isFinal && isDuplicateSegment(session, uid, text, turnId)) {
    dropTranscript(session, 'duplicate', uid, text, turnId);
    return;
  }

  if (uid === AGENT_UID) {
    // A re-emission of a turn already held was fully handled by the upsert
    // above: the stored row was rewritten with the longer text and republished.
    // Running the turn again here would append a second copy of it — which is
    // exactly what happened when the early return below was lifted so that
    // human turns could reach the board and wake-phrase checks. One spoken quiz
    // question was recorded twenty-four times, all under the same turn id.
    //
    // The row is handled; the control payload is not. It is appended at the END
    // of a turn, so it exists only in the last and longest relay — precisely the
    // one that lands here. `upsertByTurn` parses the text to store the spoken
    // half and drops the object on the floor, so returning outright meant a
    // diagram or quiz Athena reported on a multi-relay turn was never acted on.
    // She said "you should be able to see the diagram now" and nothing had been
    // drawn, because `applyControl` had never been reached.
    //
    // Quizzes survived this because they have a second delivery path — the
    // agent-history poll in `issueSetQuestion` — which is exactly what §3 of the
    // handoff means by neither path being removable. Anything carried only by
    // the relay had no such backstop.
    if (alreadyStored) {
      applyLateControl(session, text, turnId);
      return;
    }
    if (isFinal) ingestAgentTurn(session, text, now, turnId, language);
    return;
  }

  // Instructions injected with `think` come back through the transcript stream
  // as though a human had said them, because the engine treats the injected
  // text as user input. They are orchestrator plumbing, not classroom speech:
  // logging them would put "[classroom:system] The teacher has asked you to…"
  // in front of the students and feed it to the gap detector as a confused
  // question.
  if (systemDirective) {
    dropTranscript(session, 'system-directive', uid, text, turnId);
    return;
  }

  const participant = participantByUid(session, uid);
  if (!participant) {
    // Unknown uid — not a registered classroom member. Also fires in bulk after
    // an orchestrator restart: sessions live in an in-memory Map, so a restart
    // wipes `uidToParticipantId` and every relayed turn lands here while the
    // room still looks perfectly connected. A burst of these means check the
    // deploy timestamps before debugging anything else.
    dropTranscript(session, 'unknown-uid', uid, text, turnId);
    return;
  }

  // Whether the agent was mid-utterance when this segment arrived, captured
  // before the transition below overwrites it: a student's own speech moves the
  // floor to OPEN_FLOOR unconditionally, so by the time the echo check runs
  // there is no longer any record that her audio was still playing.
  const agentWasSpeaking = session.floor.state === 'AGENT_SPEAKING';

  // Floor transition first, so a teacher's barge-in cuts the agent off before
  // any of the slower analysis below runs.
  if (participant.role === 'teacher') {
    const { floor, mustInterruptAgent } = onTeacherBargeIn(
      session.floor,
      participant.participantId,
      now,
    );
    session.floor = floor;
    // Cutting the agent off revokes her permission too, so a reply that was
    // about to start is stopped rather than merely queued.
    //
    // Only when she was actually speaking. This used to run on every teacher
    // segment, including the interim ones the recogniser emits while the
    // teacher is still mid-sentence — so "Athena, could you write..." granted
    // a permit on the finalised text and the very next interim fragment of
    // the same breath revoked it. She was then cut off for having no permit,
    // which is what put a row of "held back" entries in the teacher panel
    // seconds after a grant. A teacher talking into an open floor is not
    // barging in on anyone and must not cancel the invitation they are in the
    // middle of issuing.
    if (mustInterruptAgent) {
      clearSpeakPermit(session);
      await interruptAgent(session.sessionId).catch(() => undefined);
      session.activeQuestionerId = null;
    }
  } else {
    session.floor = onHumanSpeechStart(
      session.floor,
      'student',
      participant.participantId,
      now,
    );
  }
  broadcastFloor(session);

  if (!isFinal) {
    dropTranscript(session, 'not-final', uid, text, turnId);
    return;
  }

  // Athena's own TTS, played out of a shared speaker, can be picked up by
  // anyone's open mic and come back looking exactly like a human turn — most
  // plausibly in the common setup this project targets: a teacher and students
  // in the same room on laptop speakers rather than headphones. Stripped before
  // any of it is stored or analysed, so an echo can neither pollute the
  // transcript nor coincidentally contain her own name and make her answer
  // herself.
  // `agentWasSpeaking` keeps the aggressive whole-turn drop for the case it was
  // built for — her voice leaking into an open mic while she is actually
  // talking — without it eating short student answers spoken into a quiet room.
  const spokenText = stripSelfEcho(session, text, now, agentWasSpeaking);
  if (spokenText.length === 0) {
    // Except when the discarded turn was somebody answering the quiz. Athena
    // reads all four options aloud, so "Option B" is a literal substring of her
    // own sentence and the echo filter — correctly, by its own rules — threw
    // away the exact phrasing she just told the class to answer with. Between
    // that and the 15-second deadline there was a five-second slot in which a
    // spoken answer could count at all, which is why answering out loud looked
    // like it did nothing.
    maybeRescueSpokenQuizAnswer(session, participant, text, agentWasSpeaking);
    broadcastFloor(session);
    dropTranscript(session, 'self-echo', uid, text, turnId);
    return;
  }

  // Real, settled, human speech — final, and not Athena's own voice coming
  // back through a mic. This is the only thing `hasSpeakPermit` counts as
  // somebody having spoken; see `lastSettledHumanSpeech`'s doc comment for
  // why `floor.lastHumanSpeechAt` cannot be used for that question.
  session.lastSettledHumanSpeech = { at: now, turnId };

  if (!alreadyStored) {
    const segment = appendTranscript(session, {
      participantId: participant.participantId,
      uid,
      speaker: participant.role,
      text: spokenText,
      at: now,
      language,
      turnId,
      attributionConfidence,
    });
    publish(session.sessionId, { kind: 'echosphere:transcript', segment });
    // The counterpart to `dropTranscript`. Without a kept-line to compare
    // against, a log full of drops cannot be read as "most turns land, these
    // six did not" versus "nothing is landing at all".
    console.info(
      `[transcript] keep session=${session.sessionId} uid=${uid} ` +
        `turn=${turnId ?? '-'} speaker=${participant.role} ` +
        `conf=${attributionConfidence ?? '-'}`,
    );
  }

  session.floor = onHumanSpeechEnd(session.floor, now);

  // Whoever spoke, check whether they addressed the agent by name. This is
  // deliberately NOT gated to students: the teacher owns the room and must be
  // able to call on their own co-teacher exactly as freely as a student can.
  // `studentsMayInvoke` governs student self-service access to the floor —
  // it was being read as "can anyone address her", which meant a teacher
  // saying "Athena, can you hear me?" with the floor open still got no
  // response, because this whole check used to live inside a
  // role==='student'-only branch below.
  // Identifies one spoken turn across every relay of it, so actions that must
  // happen once per sentence can be collapsed onto the settled version.
  const turnKey = turnId === undefined ? null : `${session.sessionId}:${uid}:${turnId}`;

  const addressed = isAddressedToAgent(spokenText, session.policy.wakePhrase);
  const studentInvocationBlocked =
    addressed && participant.role === 'student' && !session.policy.studentsMayInvoke;

  if (studentInvocationBlocked) {
    // Heard, understood, and deliberately not acted on. Surfaced so the
    // teacher can see that a student tried to reach her and decide whether to
    // open the floor.
    console.info(
      `[floor] student invocation blocked in session ${session.sessionId} — floor closed to students`,
    );
    publishToTeachers(session.sessionId, {
      kind: 'echosphere:agent-blocked',
      reason: 'STUDENT_INVOCATION_DISABLED',
      at: now,
    });
    // The ConvoAI engine hears the wake word on its own and will start
    // answering regardless of this branch — the prompt tells her not to, but
    // that is advisory. Cut it here, at the moment we see the student's turn,
    // rather than waiting for the browser to relay her AGENT_STATE_CHANGED a
    // round trip later; and make sure no stale permit lets it through.
    clearSpeakPermit(session);
    await interruptAgent(session.sessionId).catch(() => undefined);
    setRestraintMeter(session, 'held-back', RESTRAINT_HELD_BACK_MS);
    recordHeldBackDoubt(
      session,
      spokenText,
      'Student question held back while teacher holds the floor',
      0.85,
      'Held-Back Student Question',
    );
  } else if (addressed) {
    session.activeQuestionerId = participant.participantId;
    // The permit that makes the answer legitimate; without it the enforcement
    // path cuts her off. Carries turnId so a later relay of THIS utterance —
    // the recogniser settling on a final version, or arriving twice — cannot
    // read as someone else speaking and invalidate the very permit it earned.
    grantSpeakPermit(session, 'DIRECTLY_ADDRESSED', turnId);
    session.floor = onAddressedAgent(session.floor, participant.participantId, now);
    console.info(
      `[floor] granted DIRECTLY_ADDRESSED to ${participant.role} in session ${session.sessionId}`,
    );

    // The teacher IS allowed, and the orchestrator knows who spoke, so drive the
    // answer explicitly with a [classroom:system] directive so Athena always responds reliably.
    if (participant.role === 'teacher') {
      const question = stripWakePhrase(spokenText, session.policy.wakePhrase);
      onTurnSettled(turnKey === null ? null : `${turnKey}:think`, () => {
        void think(session.sessionId, addressedByTeacherDirective(question, session.language)).catch(
          () => undefined,
        );
      });
    }
  }

  // Re-parsed on every relay, because an early fragment often ends mid-phrase
  // ("...on the") and parses as nothing, while the finished sentence carries
  // the real command. Applied once the turn settles, so the board gets the
  // completed instruction and gets it a single time.
  const boardSpeech = parseVoiceBoardCommand(spokenText);
  if (boardSpeech && (participant.role === 'teacher' || addressed)) {
    const source = participant.role === 'teacher' ? 'teacher' : 'athena';
    onTurnSettled(turnKey === null ? null : `${turnKey}:board`, () => {
      applyBoardCommand(session, {
        action: boardSpeech.action,
        text: boardSpeech.text,
        source,
      });
    });
  }

  if (participant.role !== 'student') {
    broadcastFloor(session);
    return;
  }

  // A student finished speaking. Two more things can follow beyond the
  // addressing check above: they answered an open quiz, or they said
  // something confused.
  maybeScoreVoiceAnswer(session, participant.participantId, spokenText);

  if (addressed) {
    const stats = (participant as { stats?: { questionsAsked: number } }).stats;
    if (stats) stats.questionsAsked += 1;
  }

  // Analysed without the wake phrase: "Hey Athena, I don't get denominators"
  // is confusion about denominators, not about Athena.
  recordConfusedQuestion(
    session,
    participant.participantId,
    addressed ? stripWakePhrase(spokenText, session.policy.wakePhrase) : spokenText,
  );
  broadcastFloor(session);

  // The ConvoAI engine answers a directly-addressed question on its own. The
  // orchestrator does not push it; it only needs the room state to be current
  // by the time that turn is generated, which the system prompt already carries.
}

/**
 * Acts on a control payload that only appeared in a later relay of a turn.
 *
 * Guarded per turn id rather than per payload: relays keep arriving after the
 * object is complete, and each one carries it again. The first relay in which
 * the JSON actually parses is the right moment — a half-arrived object does not
 * parse and is skipped, so this cannot fire on a fragment.
 */
function applyLateControl(
  session: ClassroomSession,
  text: string,
  turnId: number | undefined,
): void {
  // Without an id there is nothing to key the guard on, and `ingestAgentTurn`
  // has already handled the turn as new.
  if (turnId === undefined) return;
  if (session.agentControlAppliedTurns.has(turnId)) return;

  const { control } = parseAgentTurn(text);
  // An empty `{}` is a valid payload meaning "nothing applies" — it is not
  // worth marking the turn as spent over.
  if (!control || Object.keys(control).length === 0) return;

  session.agentControlAppliedTurns.add(turnId);
  applyControl(session, control);
}

/**
 * Handles one finished agent turn: strips the control payload, logs the spoken
 * remainder, and applies whatever the agent reported.
 */
function ingestAgentTurn(
  session: ClassroomSession,
  text: string,
  now: number,
  turnId: number | undefined,
  language: string | undefined,
): void {
  const { spoken, control } = parseAgentTurn(text);

  // Only the spoken half is stored. The control object never reached the room's
  // ears, so it must not appear in the transcript the room can read either —
  // and neither must an injected directive that the engine echoed back tagged
  // as the agent's own speech. `applyControl` below still runs: dropping the
  // row must not cost a board write or diagram that rode on the same turn.
  if (spoken.length > 0 && !isSystemDirective(spoken)) {
    // Recorded so a later human turn that is actually this speech leaking back
    // in through an open mic can be recognised and stripped.
    rememberAgentUtterance(session, spoken);

    const segment = appendTranscript(session, {
      participantId: null,
      uid: AGENT_UID,
      speaker: 'agent',
      text: spoken,
      at: now,
      language,
      turnId,
    });
    publish(session.sessionId, { kind: 'echosphere:transcript', segment });
  }

  if (control) {
    // Recorded so a later, longer relay of this same turn does not act on the
    // same payload a second time — see `applyLateControl`.
    if (turnId !== undefined && Object.keys(control).length > 0) {
      session.agentControlAppliedTurns.add(turnId);
    }
    applyControl(session, control);
  }

  // The permit is deliberately not cleared here. A turn's transcript arrives
  // after the next turn may already have been authorised, so clearing on
  // completion revoked permission for a reply that had only just been granted —
  // the teacher pressed Explain and the engine was cut off mid-sentence.
  // Expiry and explicit revocation (teacher takes the floor, floor closes,
  // mute) are what bound a permit instead.
  releaseFloor(session);
}

/**
 * How long the same question text is treated as a redelivery of one turn rather
 * than a deliberate re-ask. Comfortably longer than the 25s history poll plus
 * the reveal linger, and far shorter than a lesson, so a teacher genuinely
 * asking the same question again later still gets a fresh card.
 */
const QUIZ_REDELIVERY_WINDOW_MS = 90_000;

/**
 * True when this exact question has already been turned into a card moments
 * ago — i.e. the second of the two delivery paths has just arrived.
 *
 * Keyed on the question and its options rather than on a turn id, because the
 * two paths carry different identity: the history poll has no turn id at all,
 * and the relay's is the browser's. The text is the only thing they share.
 */
/**
 * Records a freshly issued quiz against the running set, whichever delivery
 * path produced it.
 *
 * This used to happen only inside `issueSetQuestion`, on the history-poll path.
 * But the same payload also arrives through the RTM relay, and when the relay
 * won the race the card went up, the class answered it, and the set held no
 * record of it — so `maybeAdvanceQuizSet` refused to advance and every quiz set
 * silently stopped at its first question. Confirmed in production: two
 * `(no turn)` poll failures, a working quiz on screen, and no `advancing` line.
 *
 * Idempotent, because both paths call it for the same quiz and either may
 * arrive first.
 */
export function recordQuizInSet(session: ClassroomSession, quiz: QuizQuestion): void {
  const set = session.activeQuizSet;
  if (!set) return;
  if (set.quizIds.includes(quiz.quizId)) return;
  set.quizIds.push(quiz.quizId);
  set.askedQuestions.push(quiz.question);
  if (set.total > 1) {
    quiz.setIndex = set.asked;
    quiz.setTotal = set.total;
  }
}

export function findRecentQuizByPayload(
  session: ClassroomSession,
  incoming: { question: string; options?: string[] },
): QuizQuestion | undefined {
  const key = (q: string, o: string[] | undefined) =>
    `${q.trim().toLowerCase()}::${(o ?? []).map((x) => x.trim().toLowerCase()).join('|')}`;
  const incomingKey = key(incoming.question, incoming.options);
  const cutoff = Date.now() - QUIZ_REDELIVERY_WINDOW_MS;

  for (const quiz of session.quizzes.values()) {
    if (quiz.createdAt < cutoff) continue;
    if (key(quiz.question, quiz.options) === incomingKey) return quiz;
  }
  return undefined;
}

/**
 * How long the same illustrate topic is treated as a redelivery of one turn
 * rather than a fresh request.
 *
 * Longer than the quiz window, because the cost of getting this wrong is
 * higher. A duplicate quiz is a second card; a duplicate illustration is a
 * second Excalidraw round trip and a second copy of the same diagram pasted
 * beside the first.
 */
const ILLUSTRATE_REDELIVERY_WINDOW_MS = 180_000;

/** Recently requested topics per session, for the redelivery guard. */
const recentIllustrations = new Map<string, Map<string, number>>();

/**
 * True when this topic has already been sent to the board agent moments ago —
 * i.e. the second of the two delivery paths has just arrived.
 *
 * Same problem as `findRecentQuizByPayload`, and the same reasoning: one spoken
 * turn reaches `applyControl` twice, once from the agent-history poll in
 * `issueSetQuestion` and once from the relayed RTM transcript in
 * `ingestAgentTurn`. Neither path can be dropped, so the payload is the key.
 * Unlike a quiz there is no record to hand back, because the diagram does not
 * exist yet — the guard only has to stop the second call being made.
 */
export function isDuplicateIllustration(
  session: ClassroomSession,
  topic: string,
): boolean {
  const key = topic.trim().toLowerCase();
  if (!key) return true;

  const now = Date.now();
  let seen = recentIllustrations.get(session.sessionId);
  if (!seen) {
    seen = new Map();
    recentIllustrations.set(session.sessionId, seen);
  }

  // Sweep here rather than on a timer: the map only grows when Athena draws.
  for (const [existing, at] of seen) {
    if (now - at > ILLUSTRATE_REDELIVERY_WINDOW_MS) seen.delete(existing);
  }

  if (seen.has(key)) return true;
  seen.set(key, now);
  return false;
}

/**
 * Drops everything remembered about a session's diagrams.
 *
 * Two pieces of state, in two modules: the redelivery guard here, and the
 * scratch-scene/seen-element bookkeeping in the board agent. Released together
 * when a lesson ends so neither outlives the room.
 */
export function releaseIllustrationState(sessionId: string): void {
  recentIllustrations.delete(sessionId);
  forgetIllustrations(sessionId);
}

/**
 * How many recent lines of classroom speech the diagram model is shown.
 *
 * Enough to resolve what the topic phrase is pointing at, and no more. Every
 * line here is spent from the same per-minute token budget the rest of the
 * lesson draws on, and a transcript long enough to bury the topic makes the
 * diagram worse, not better.
 */
const ILLUSTRATION_TRANSCRIPT_LINES = 12;

/** Longest a single quoted line may be before it is cut. */
const ILLUSTRATION_LINE_CHARS = 220;

/**
 * Assembles what the lesson can tell the diagram model about the topic.
 *
 * The board agent used to be handed `Topic: <phrase>` and nothing else, which
 * is not enough to draw from: "flow of synthesis" does not say whether the
 * subject is photosynthesis, protein synthesis or an organic prep, and asked to
 * draw it anyway the model restates the phrase it was given. Everything here is
 * already in memory — no extra network call, and `retrieveSync` is synchronous
 * by design — so this costs a few hundred prompt tokens and nothing else.
 */
function illustrationContext(
  session: ClassroomSession,
  topic: string,
): IllustrationContext {
  const transcript = session.transcript
    .slice(-ILLUSTRATION_TRANSCRIPT_LINES)
    .map((segment) => {
      const who =
        segment.speaker === 'agent'
          ? 'Athena'
          : session.participants.get(segment.participantId ?? '')?.displayName ??
            segment.speaker;
      return `${who}: ${segment.text.slice(0, ILLUSTRATION_LINE_CHARS)}`;
    });

  // Ranked against the topic rather than the transcript: the teacher's uploaded
  // material is the most authoritative statement of what this class means by a
  // word, and the topic is the thing being drawn.
  const material = session.lesson.isEmpty()
    ? []
    : session.lesson
        .retrieveSync(topic, 2)
        .map((hit) => hit.chunk.text.slice(0, 400));

  return {
    lessonTitle: session.title,
    language: session.language,
    transcript,
    material,
  };
}

/**
 * Draws a diagram and puts it on the board, without blocking the turn.
 *
 * Deliberately not awaited by `applyControl`. Generation is a model call plus
 * two Excalidraw round trips — seconds, not milliseconds — and the spoken turn
 * it came from has already been said. Making the control path wait would delay
 * every other field in the same payload behind a picture.
 *
 * The result goes onto the board through exactly the path a participant's own
 * edit takes: merge into the authoritative scene, then publish the same
 * `whiteboard-scene` event. Nothing in the client needs to know these elements
 * came from Athena rather than from the teacher's pointer.
 */
async function runIllustration(
  session: ClassroomSession,
  topic: string,
): Promise<void> {
  const result = await generateIllustration(
    session.sessionId,
    topic,
    illustrationContext(session, topic),
  );

  if (!result.ok) {
    // One line, always, whether it worked or not. A diagram that never appears
    // used to leave nothing behind but a bare `console.error` on some paths and
    // silence on others, so there was no way to tell a model failure from an
    // Excalidraw failure after the fact — which is exactly the question worth
    // asking when only half of them are landing.
    console.error(
      `[illustrate] FAILED stage=${result.stage} ms=${result.ms} topic="${topic}" — ${result.detail}`,
    );
    if (session.endedAt === null) {
      publish(session.sessionId, {
        kind: 'echosphere:illustration-failed',
        topic,
        stage: result.stage,
        detail: result.detail,
        at: Date.now(),
      });
    }
    return;
  }

  console.log(
    `[illustrate] ok kind=${result.kind} elements=${result.elements.length} ms=${result.ms} topic="${topic}"`,
  );

  // The session can end while Excalidraw is still drawing.
  if (session.endedAt !== null) return;

  const elements = placeBeside(session.whiteboard.scene, result.elements);
  mergeSceneElements(session, elements);

  // A diagram nobody can see is not worth the round trip: if the board was
  // closed when she was asked, open it as it lands.
  if (!session.whiteboard.open) {
    await openWhiteboard(session);
  } else {
    broadcastWhiteboard(session);
  }

  publish(session.sessionId, {
    kind: 'echosphere:whiteboard-scene',
    elements,
    by: 'athena',
  });
}

/**
 * Applies a parsed control payload (§3.5 attribution, §3.6 quiz, §3.9 gap).
 * Returns the quiz it created, if any, so a multi-question set can track it.
 */
export function applyControl(
  session: ClassroomSession,
  control: CoTeacherControl,
): { quiz?: QuizQuestion } {
  const roster = activeStudents(session).map((s) => ({
    participantId: s.participantId,
    displayName: s.displayName,
  }));

  if (control.to) {
    const id = matchParticipantByName(roster, control.to);
    if (id) session.activeQuestionerId = id;
  }

  if (control.gap) {
    const ids = control.gap.students
      .map((name) => matchParticipantByName(roster, name))
      .filter((id): id is string => id !== undefined);
    if (ids.length > 0) {
      const update = recordReportedGap(session, control.gap.topic, ids);
      if (update?.gap) void suggestReadingForGap(session, update.gap);
    }
  }

  if (control.illustrate && !isDuplicateIllustration(session, control.illustrate.topic)) {
    // Never gated: a diagram is what someone just asked her out loud to draw,
    // and making that silently depend on a toggle nobody remembered to set was
    // the more confusing failure. `board` below makes the same call.
    void runIllustration(session, control.illustrate.topic).catch((err) => {
      console.error('[illustrate] failed:', err);
    });
  }

  if (control.board) {
    // Never gated. Writes used to require the teacher's annotate toggle when
    // the turn was one Athena had started herself, which silently dropped the
    // payload while the spoken half of the same turn went out as normal — she
    // narrated a board she had not been allowed to write on. The toggle bought
    // little: it only ever reached a write on a silence interjection, which is
    // already rate-limited by the gap cooldown, and how sparingly she writes is
    // the prompt's job. Same call the `illustrate` field above makes.
    applyBoardCommand(session, {
      action: control.board.action,
      text: control.board.text,
      source: 'athena',
    });
  }

  if (control.library) {
    if (control.library.action === 'open' && typeof control.library.page === 'number') {
      const targetBookId = control.library.bookId || session.library.activeBookId;
      session.library.activeBookId = targetBookId;
      session.library.currentPage = control.library.page;
      session.library.lastSequence += 1;
      session.library.glowPage = control.library.page;
      session.library.isPresenting = true;

      publish(session.sessionId, {
        kind: 'echosphere:library-page',
        payload: {
          bookId: targetBookId,
          page: control.library.page,
          seq: session.library.lastSequence,
          source: 'agent',
          glow: true,
        },
      });

      publish(session.sessionId, {
        kind: 'echosphere:library-present',
        payload: {
          presenting: true,
          presenterId: null,
        },
      });
    }
  }

  if (control.quiz) {
    // One spoken turn can reach here twice: `issueSetQuestion` recovers the
    // payload from the agent's history, and the same turn also arrives as a
    // relayed RTM transcript through `ingestAgentTurn`. Both call this, and
    // `recordQuizFromControl` mints a fresh quizId each time — which is how one
    // question ended up on screen as two identical cards, both labelled with
    // the same "Question N of M". Neither path can be dropped: the history poll
    // is the reliable one for a Start Quiz set, but a quiz Athena poses on her
    // own is only ever seen via the relay. So the payload itself is the key.
    // Already on screen from the other delivery path. Hand the existing quiz
    // back rather than nothing: `issueSetQuestion` records the returned id in
    // `set.quizIds`, and `maybeAdvanceQuizSet` refuses to advance a set whose
    // closing quiz it cannot find there. Returning `{}` here silently capped
    // every quiz set at its first question.
    const alreadyIssued = findRecentQuizByPayload(session, control.quiz);
    if (alreadyIssued) {
      // The other delivery path got here first. Record it against the set from
      // here too, so advancement no longer depends on which path won.
      recordQuizInSet(session, alreadyIssued);
      return { quiz: alreadyIssued };
    }
    const pending = takePendingQuiz(session);
    const set = session.activeQuizSet;
    const quiz = recordQuizFromControl(
      session,
      control.quiz,
      pending?.origin ?? set?.origin ?? 'teacher',
      pending?.targetStudentIds ?? set?.targetStudentIds ?? [],
    );
    if (set && set.total > 1) {
      quiz.setIndex = set.asked;
      quiz.setTotal = set.total;
    }
    broadcastQuiz(session, quiz);
    scheduleQuizClose(session, quiz.quizId, quiz.deadline);
    // This path got here first — the relay, most often. Same recording either
    // way, so the set advances whether or not the history poll ever answers.
    recordQuizInSet(session, quiz);
    return { quiz };
  }

  return {};
}

/**
 * Arms the countdown-expiry sweep for a freshly issued quiz.
 *
 * The timer re-checks the deadline when it fires rather than closing outright,
 * because a quiz's deadline can be pushed out after its timer was armed — see
 * `startQuizCountdowns`. Without the re-check, the sweep armed against the
 * deadline set while she was still reading the options would close the question
 * the moment the students' window actually opened.
 *
 * `sweepExpiredQuiz` itself stays an unconditional close, which is what the
 * teacher-facing paths and the quiz-set machinery expect of it.
 */
export function scheduleQuizClose(
  session: ClassroomSession,
  quizId: string,
  deadline: number,
): void {
  setTimeout(() => {
    const quiz = session.quizzes.get(quizId);
    if (!quiz || quiz.closedAt) return;
    // Timers can fire a shade early; the tolerance stops an on-time firing from
    // re-arming itself in a tight loop.
    if (quiz.deadline - Date.now() > SWEEP_TOLERANCE_MS) {
      scheduleQuizClose(session, quizId, quiz.deadline);
      return;
    }
    sweepExpiredQuiz(session, quizId);
  }, Math.max(0, deadline - Date.now()));
}

/**
 * Closes a quiz whose countdown has run out. Any active target student who has
 * not answered is marked incorrect — a non-answer counts against the student's
 * mastery stats — and the correct answer is revealed to the room. Safe to call
 * more than once and after the "everyone answered" path has already closed it.
 */
export function sweepExpiredQuiz(
  session: ClassroomSession,
  quizId: string,
): void {
  if (session.endedAt !== null) return;
  const quiz = session.quizzes.get(quizId);
  if (!quiz || quiz.closedAt) return;

  const answered = new Set(
    answersFor(session, quizId).map((a) => a.participantId),
  );
  const targets =
    quiz.targetStudentIds.length > 0
      ? quiz.targetStudentIds
      : activeStudents(session).map((s) => s.participantId);

  for (const participantId of targets) {
    const p = session.participants.get(participantId);
    if (p?.role !== 'student' || p.leftAt !== undefined) continue;
    if (answered.has(participantId)) continue;
    // An empty answer scores as incorrect and bumps quizzesAnswered, through
    // the normal path. Runs before markQuizClosed sets closedAt.
    submitQuizAnswer(session, quizId, participantId, '', 'ui');
  }

  if (markQuizClosed(session, quiz)) void maybeAdvanceQuizSet(session, quiz);
}

function takePendingQuiz(session: ClassroomSession) {
  const pending = session.pendingQuiz;
  session.pendingQuiz = null;
  if (!pending) return null;
  // A stale request means the agent is answering a much older prompt; treating
  // it as the trigger for this quiz would mis-target the card.
  if (Date.now() - pending.requestedAt > PENDING_QUIZ_TTL_MS) return null;
  return pending;
}

/**
 * Scores a quiz answer out of a turn the self-echo filter discarded.
 *
 * Narrow on purpose. The turn stays out of the transcript and out of the gap
 * detector — if it really was Athena's voice coming back through a mic, none of
 * that should change — and the only thing rescued is the answer itself.
 *
 * The discriminator is how many options the utterance names. Athena says all
 * four in one breath when she asks the question; a student says one. So an
 * utterance naming exactly one option, arriving when she is not currently
 * speaking, is a student answering, and an utterance naming several is her list
 * echoing back and is left alone.
 */
function maybeRescueSpokenQuizAnswer(
  session: ClassroomSession,
  participant: Participant,
  rawText: string,
  agentWasSpeaking: boolean,
): void {
  if (participant.role !== 'student') return;
  // While her audio is still playing, an echo is the far likelier explanation,
  // and the answer window has not started yet anyway — see startQuizCountdowns.
  // This must be the state as it was when the segment arrived: `session.floor`
  // has already been moved to OPEN_FLOOR by this very segment.
  if (agentWasSpeaking) return;

  const quiz = openQuizFor(session, participant.participantId);
  if (!quiz?.options || quiz.options.length === 0) return;

  if (optionIndicesMentioned(rawText, quiz).size !== 1) return;

  const resolved = normaliseAnswer(rawText, quiz);
  if (!quiz.options.includes(resolved)) return;

  submitQuizAnswer(session, quiz.quizId, participant.participantId, resolved, 'voice');
}

/**
 * Scores a spoken quiz answer (§3.6).
 *
 * Only counts when the utterance resolves to an actual option — otherwise every
 * sentence a student says while a quiz is open would be recorded as an attempt.
 */
function maybeScoreVoiceAnswer(
  session: ClassroomSession,
  participantId: string,
  text: string,
): void {
  const quiz = openQuizFor(session, participantId);
  if (!quiz?.options || quiz.options.length === 0) return;

  const resolved = normaliseAnswer(text, quiz);
  if (!quiz.options.includes(resolved)) return;

  submitQuizAnswer(session, quiz.quizId, participantId, resolved, 'voice');
}

/**
 * Polled from the server tick. Handles §3.3(b): a real silence gap plus an
 * unaddressed class-wide misconception is the only condition under which the
 * agent speaks unprompted.
 */
export async function considerSilenceInterjection(
  session: ClassroomSession,
): Promise<boolean> {
  if (session.endedAt !== null) return false;

  const gap = pendingClassWideGap(session);
  if (!gap) return false;

  if (!requestFloor(session, 'GAP_DETECTED_IN_SILENCE', gap.topic)) return false;

  // Stamped before the turn rather than after it, so the cooldown covers the
  // turn itself. `think` resolves when the request is accepted, not when she
  // has finished talking, and the tick runs every second — stamping afterwards
  // would leave the whole of her answer inside the eligible window.
  session.lastInterjectionByTopic.set(gap.topic.toLowerCase(), Date.now());
  markGapAddressed(session, gap.gapId);
  const ok = await think(
    session.sessionId,
    gapInterjectionDirective(gap.topic, gap.affectedStudentIds.length, session.language),
  );
  if (!ok) releaseFloor(session);
  return ok;
}

// ─── Teacher commands (§3.10) ────────────────────────────────────────────────

export interface CommandResult {
  ok: boolean;
  detail?: string;
}

export async function applyTeacherCommand(
  session: ClassroomSession,
  command: TeacherCommand,
  issuedBy: string,
): Promise<CommandResult> {
  publish(session.sessionId, {
    kind: 'echosphere:command',
    command,
    issuedBy,
  });

  switch (command.type) {
    case 'MUTE_AGENT': {
      session.policy.muted = true;
      // Muting must take effect mid-sentence, not at the next turn boundary —
      // this is the moment the plan calls out as worth demoing (§3.10).
      await interruptAgent(session.sessionId).catch(() => undefined);
      releaseFloor(session);
      // A running multi-question quiz stops here too.
      session.activeQuizSet = null;
      session.restraintMeterState = 'listening';
      publish(session.sessionId, {
        kind: 'echosphere:restraint-meter-changed',
        state: 'listening',
      });
      broadcastPolicy(session);
      return { ok: true, detail: 'Agent muted and any in-flight speech stopped.' };
    }

    case 'RESUME_AGENT': {
      session.policy.muted = false;
      broadcastPolicy(session);
      return { ok: true };
    }

    case 'END_AGENT_TURN': {
      // "Make sure Athena isn't talking" — if she already wasn't, that's done,
      // not an error. Reserving 409 for commands that were genuinely refused.
      const stopped = await interruptAgent(session.sessionId);
      releaseFloor(session);
      clearSpeakPermit(session);
      return { ok: true, detail: stopped ? undefined : 'Athena was already silent.' };
    }

    case 'FORCE_AGENT_SPEAK': {
      if (!requestFloor(session, 'TEACHER_INVOKED', command.topic)) {
        return { ok: false, detail: 'Blocked by agent policy (is the agent muted?).' };
      }
      session.activeQuestionerId = command.targetStudentId ?? null;
      const name = command.targetStudentId
        ? session.participants.get(command.targetStudentId)?.displayName
        : undefined;
      const ok = await think(
        session.sessionId,
        forceSpeakDirective(command.topic, name, session.language),
      );
      if (!ok) releaseFloor(session);
      return { ok, detail: ok ? undefined : 'Agent is not running.' };
    }

    case 'SET_STUDENT_INVOCATION': {
      session.policy.studentsMayInvoke = command.enabled;
      if (!command.enabled) {
        // Closing the floor revokes any permission already granted, so a reply
        // that was about to start does not slip through.
        clearSpeakPermit(session);
        await interruptAgent(session.sessionId).catch(() => undefined);
        releaseFloor(session);
      }
      broadcastPolicy(session);
      // The prompt states whether students may call her, so she stops offering.
      await pushInstructions(session);
      return { ok: true };
    }

    case 'ADJUST_VERBOSITY': {
      session.policy.verbosity = command.level;
      broadcastPolicy(session);
      // The verbosity rule lives in the system prompt, so the agent only obeys
      // it once the prompt is re-pushed.
      await pushInstructions(session);
      return { ok: true };
    }

    case 'DISABLE_TOPIC': {
      if (!session.policy.disabledTopics.includes(command.topic)) {
        session.policy.disabledTopics.push(command.topic);
      }
      broadcastPolicy(session);
      await pushInstructions(session);
      return { ok: true };
    }

    case 'ENABLE_TOPIC': {
      session.policy.disabledTopics = session.policy.disabledTopics.filter(
        (t) => t !== command.topic,
      );
      broadcastPolicy(session);
      await pushInstructions(session);
      return { ok: true };
    }

    case 'SET_PROFICIENCY': {
      const updated = setProficiency(
        session,
        command.studentId,
        command.proficiency as ProficiencyTag,
      );
      if (!updated) return { ok: false, detail: 'No such student.' };
      publish(session.sessionId, {
        kind: 'echosphere:proficiency-changed',
        participantId: updated.participantId,
        proficiency: updated.proficiency,
      });
      // §3.5 lives entirely in the roster block of the prompt, so a level change
      // has no effect on the agent until this lands.
      await pushInstructions(session);
      return { ok: true };
    }

    case 'START_QUIZ': {
      return startQuiz(session, command.topic, command.targetStudentIds, 'teacher');
    }

    case 'END_SESSION': {
      return { ok: true, detail: 'Handled by the session route.' };
    }

    default: {
      return { ok: false, detail: 'Unknown command.' };
    }
  }
}

// ─── Quiz delivery (§3.6) ────────────────────────────────────────────────────

/** How many questions one "Start Quiz" asks. */
const QUIZ_SET_SIZE = 3;

/** Pause after a question's answer is revealed before the next one appears. */
const QUIZ_REVEAL_PAUSE_MS = 2_500;

/**
 * Asks the agent to pose a quiz — a SET of {@link QUIZ_SET_SIZE} questions on
 * the topic, auto-advancing as each one closes. The {quiz} payload comes back a
 * turn later NOT on the browser relay (skipPatterns strips the braces from that
 * too) but from the agent's own history, which `issueSetQuestion` polls for.
 */
export async function startQuiz(
  session: ClassroomSession,
  topic: string,
  targetStudentIds: string[] | undefined,
  origin: 'teacher' | 'gap-detector',
): Promise<CommandResult> {
  const targets = targetStudentIds ?? [];

  // A fresh Start Quiz replaces any set still running.
  session.activeQuizSet = {
    topic,
    targetStudentIds: targets,
    origin,
    total: QUIZ_SET_SIZE,
    asked: 1,
    quizIds: [],
    askedQuestions: [],
  };

  // issueSetQuestion owns the floor request for EVERY question in the set,
  // including this first one — Q2/Q3 were silently going out without a permit,
  // so enforcement killed the agent's turn before it could emit the payload.
  const issued = await issueSetQuestion(session);
  if (!issued) {
    session.activeQuizSet = null;
    return {
      ok: false,
      detail: 'Blocked — is Athena muted, is the topic off-limits, or is she not running?',
    };
  }
  return {
    ok: true,
    detail: `Quiz started — ${QUIZ_SET_SIZE} questions on "${topic}".`,
  };
}

/**
 * Issues one quiz question and recovers its payload from the agent's history.
 * Retries once if the first attempt produced no usable payload — the LLM is
 * reliable at this, but the history endpoint can be briefly flaky. Ends the set
 * and tells the teacher if it still fails.
 *
 * Returns false only when the agent could not be asked at all (not running).
 */
async function issueSetQuestion(
  session: ClassroomSession,
  attempt = 1,
  /**
   * The set this call is for.
   *
   * Captured by the caller rather than re-read from the session, so a retry
   * cannot silently switch to a DIFFERENT set the teacher started while it was
   * in flight — which is how a retry for a photosynthesis quiz ended up issuing
   * an alphabet one, with two concurrent issuances then racing for the same
   * history turn.
   */
  forSet: ClassroomSession['activeQuizSet'] = session.activeQuizSet,
): Promise<boolean> {
  const set = forSet;
  if (!set || session.activeQuizSet !== set) return false;

  // Two concurrent issuances share one `session.pendingQuiz` slot and race for
  // the same history turn; the loser then tore down the set the winner had just
  // filled. Released before the retry below recurses, so a retry is not
  // mistaken for a competing caller.
  if (set.issuing) {
    console.warn(
      `[quiz] issueSetQuestion re-entered while in flight in session ${session.sessionId} — ignoring`,
    );
    return true;
  }
  set.issuing = true;
  try {
    return await issueSetQuestionInner(session, set, attempt);
  } finally {
    set.issuing = false;
  }
}

async function issueSetQuestionInner(
  session: ClassroomSession,
  set: NonNullable<ClassroomSession['activeQuizSet']>,
  attempt: number,
): Promise<boolean> {
  // A permit for THIS question. QUIZ_DELIVERY bypasses the floor state, so a
  // retry or an advance while the previous turn is still winding down is fine;
  // it only fails on a mute or a disabled topic.
  if (!requestFloor(session, 'QUIZ_DELIVERY', set.topic)) {
    return false;
  }

  const names = activeStudents(session)
    .filter((s) => set.targetStudentIds.includes(s.participantId))
    .map((s) => s.displayName);

  session.pendingQuiz = {
    topic: set.topic,
    targetStudentIds: set.targetStudentIds,
    origin: set.origin,
    requestedAt: Date.now(),
  };

  const before = await assistantTurnSnapshot(session.sessionId);

  // Not interruptable: the question, its spoken options, and the trailing
  // {quiz} payload are one turn; a stray "okay" would truncate the payload.
  const ok = await think(
    session.sessionId,
    quizDirective(set.topic, names, set.askedQuestions, session.language),
    { interruptable: false },
  );
  if (!ok) {
    session.pendingQuiz = null;
    clearSpeakPermit(session);
    releaseFloor(session);
    return false;
  }

  const text = await pollForPayloadTurn(session.sessionId, before, {
    timeoutMs: 25_000,
  });
  const control = text ? parseAgentTurn(text).control : null;

  if (!control?.quiz) {
    console.warn(
      `[quiz] attempt ${attempt}: no {quiz} payload from the agent in session ${session.sessionId}` +
        (text ? ` (said: "${text.slice(0, 80)}")` : ' (no turn)'),
    );
    session.pendingQuiz = null;
    if (attempt < 2 && session.activeQuizSet === set) {
      // Hand the flag over to the retry rather than letting it see itself as a
      // competing caller. Reassigned synchronously before the call, and the
      // retry claims it again synchronously at its own top, so there is no
      // window for a genuine second caller to slip through.
      set.issuing = false;
      return issueSetQuestion(session, attempt + 1, set);
    }

    // Give up on this QUESTION — but not on a set that has already delivered
    // it. `think()` succeeded, so the question may well have been asked and
    // landed via the relay path while this poll was failing. Tearing the set
    // down here is what turned a recoverable poll failure into a silently
    // truncated quiz: the card was on screen, the class answered it, and the
    // set had already been nulled.
    const deliveredAnyway =
      session.activeQuizSet === set && set.quizIds.length >= set.asked;

    if (!deliveredAnyway && session.activeQuizSet === set) {
      session.activeQuizSet = null;
      publishToTeachers(session.sessionId, {
        kind: 'echosphere:agent-blocked',
        reason: 'QUIZ_PAYLOAD_MISSING',
        at: Date.now(),
      });
    } else if (deliveredAnyway) {
      console.info(
        `[quiz] poll found no payload but the set already holds question ${set.asked} ` +
          `in session ${session.sessionId} — keeping the set alive`,
      );
    }
    clearSpeakPermit(session);
    releaseFloor(session);
    return true; // the agent IS running; the quiz just didn't land
  }

  if (session.activeQuizSet !== set) return true; // cancelled mid-flight
  console.info(`[quiz] payload recovered from agent history in session ${session.sessionId}`);
  // `applyControl` records the quiz against the set itself now, via
  // `recordQuizInSet`, so both delivery paths land it. Called again here rather
  // than dropped: keeping both callers is what stops a future change to one
  // path silently capping the set again. Idempotent, so the repeat is free —
  // the raw `quizIds.push` this replaces was NOT, and would have double-counted
  // every question against `set.total`.
  const { quiz } = applyControl(session, control);
  if (quiz) recordQuizInSet(session, quiz);
  return true;
}

/**
 * Called when a quiz closes. If it belongs to a running set and there are
 * questions left, pauses on the reveal, then asks the next one. Cancelled by a
 * mute, a lesson end, or a fresh Start Quiz during the pause.
 */
export async function maybeAdvanceQuizSet(
  session: ClassroomSession,
  closedQuiz: QuizQuestion,
): Promise<void> {
  const set = session.activeQuizSet;
  if (!set || !set.quizIds.includes(closedQuiz.quizId)) return;

  if (set.asked >= set.total) {
    console.info(`[quiz] set complete (${set.total} questions) in session ${session.sessionId}`);
    announcePerfectScores(session, set);
    session.activeQuizSet = null;
    return;
  }

  await new Promise((r) => setTimeout(r, QUIZ_REVEAL_PAUSE_MS));

  // Something during the pause invalidated the set.
  if (session.activeQuizSet !== set || session.endedAt !== null || session.policy.muted) {
    if (session.activeQuizSet === set) session.activeQuizSet = null;
    return;
  }

  set.asked += 1;
  console.info(
    `[quiz] advancing to question ${set.asked} of ${set.total} in session ${session.sessionId}`,
  );
  if (!(await issueSetQuestion(session))) {
    session.activeQuizSet = null;
  }
}

/**
 * Fires a celebration event to any student who answered every question in a
 * just-finished quiz set correctly. Sent only to that student (`publishTo`) —
 * classmates and the teacher don't see it.
 */
function announcePerfectScores(
  session: ClassroomSession,
  set: NonNullable<ClassroomSession['activeQuizSet']>,
): void {
  // Only meaningful once every question in the set has actually been issued.
  if (set.quizIds.length < set.total) return;

  const targets =
    set.targetStudentIds.length > 0
      ? set.targetStudentIds
      : activeStudents(session).map((s) => s.participantId);

  for (const participantId of targets) {
    const allCorrect = set.quizIds.every((quizId) =>
      session.answers.some(
        (a) => a.quizId === quizId && a.participantId === participantId && a.correct,
      ),
    );
    if (!allCorrect) continue;
    publishTo(session.sessionId, participantId, {
      kind: 'echosphere:quiz-set-perfect',
      topic: set.topic,
    });
  }
}

export function submitQuizAnswer(
  session: ClassroomSession,
  quizId: string,
  participantId: string,
  answer: string,
  via: 'ui' | 'voice',
): CommandResult {
  const result = recordAnswer(session, quizId, participantId, answer, via);
  if ('error' in result) return { ok: false, detail: result.error };

  // Whether the answer actually landed on one of the four options, as opposed
  // to being the blank the expiry sweep submits for someone who never answered.
  // Open-response questions have no options and are always treated as a real
  // attempt, which is what they were before this distinction existed.
  const options = result.quiz.options;
  const attempted =
    options === undefined ||
    options.length === 0 ||
    options.includes(result.answer.answer);

  publishTo(session.sessionId, participantId, {
    kind: 'echosphere:quiz-result',
    quizId,
    participantId,
    correct: result.answer.correct,
    // Only when it resolved to an option — the card highlights it, and there is
    // nothing to highlight for a blank.
    ...(attempted && result.answer.answer ? { answer: result.answer.answer } : {}),
  });
  publishToTeachers(session.sessionId, {
    kind: 'echosphere:quiz-result',
    quizId,
    participantId,
    correct: result.answer.correct,
    ...(attempted && result.answer.answer ? { answer: result.answer.answer } : {}),
  });

  // A non-answer still counts against the student's mastery stats above, but it
  // is not evidence of a misconception and must not build a learning gap.
  // Every quiz that timed out used to manufacture one — enough of them at once
  // to cross the class-wide threshold — which sent Athena off to explain a
  // topic nobody had actually got wrong, and did it again after the next one.
  if (!result.answer.correct && attempted) {
    recordWrongAnswer(session, result.quiz, participantId, result.answer.answer);
  }

  if (result.proficiencyChangedTo) {
    publish(session.sessionId, {
      kind: 'echosphere:proficiency-changed',
      participantId,
      proficiency: result.proficiencyChangedTo,
    });
    // An inferred level change matters to the agent as much as a teacher's
    // manual one, so the prompt is refreshed either way.
    void pushInstructions(session);
  }

  // Once every active target student has answered, the question is done before
  // its timer runs out: close it early and reveal the answer to the room so the
  // card resolves instead of hanging open. markQuizClosed is idempotent with
  // the countdown-expiry path.
  if (allTargetsAnswered(session, result.quiz) && markQuizClosed(session, result.quiz)) {
    console.info(
      `[quiz] all targets answered ${result.quiz.quizId} in session ${session.sessionId} — revealing answer`,
    );
    void maybeAdvanceQuizSet(session, result.quiz);
  }

  return { ok: true, detail: result.answer.correct ? 'correct' : 'incorrect' };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Records a turn that carries a turnId, replacing a shorter earlier version.
 *
 * Returns 'new' when nothing was stored for this turn yet (the caller carries on
 * and does the full ingest), 'unchanged' when the text is identical, and
 * 'updated' when an existing segment was rewritten.
 */
function upsertByTurn(
  session: ClassroomSession,
  uid: string,
  text: string,
  turnId: number,
): 'new' | 'unchanged' | 'updated' {
  const existing = findTurn(session, uid, turnId);
  if (!existing) return 'new';
  if (existing.text === text) return 'unchanged';

  // Guard against a late-arriving shorter fragment overwriting the full turn:
  // relays race, and the longest version is the complete one.
  if (text.length < existing.text.length) return 'unchanged';

  existing.text =
    existing.speaker === 'agent' ? parseAgentTurn(text).spoken : text;
  existing.at = Date.now();
  return 'updated';
}

function findTurn(
  session: ClassroomSession,
  uid: string,
  turnId: number,
): TranscriptSegment | undefined {
  // Matched on turnId plus which side spoke, not the exact uid. A turn_id is
  // shared by the agent and a human when the turn began with an injected
  // instruction, so the side has to be part of the key — but the human uid
  // itself must not be, or a turn whose attribution was revised would land as
  // a second row under a second name.
  const wantAgent = uid === AGENT_UID;
  for (let i = session.transcript.length - 1; i >= 0; i -= 1) {
    const segment = session.transcript[i];
    if (!segment) continue;
    if (segment.turnId === turnId && (segment.speaker === 'agent') === wantAgent) {
      return segment;
    }
    // Turns arrive in order, so a short tail scan is enough.
    if (session.transcript.length - i > 40) break;
  }
  return undefined;
}

function republishTurn(
  session: ClassroomSession,
  uid: string,
  turnId: number,
): void {
  const segment = findTurn(session, uid, turnId);
  if (segment) {
    publish(session.sessionId, { kind: 'echosphere:transcript', segment });
  }
}

/**
 * True when this segment has already been recorded. Only the tail is scanned:
 * a duplicate relay arrives within moments of the original, and scanning the
 * whole transcript would make ingestion quadratic over a long lesson.
 */
function isDuplicateSegment(
  session: ClassroomSession,
  uid: string,
  text: string,
  turnId?: number,
): boolean {
  const now = Date.now();
  const tail = session.transcript.slice(-30);
  return tail.some((segment) => {
    if (segment.uid !== uid) return false;
    if (turnId !== undefined && segment.turnId !== undefined) {
      return segment.turnId === turnId;
    }
    // Without a turnId, identical text is the only signal — but people repeat
    // themselves, and a student who was not answered the first time will say
    // the same words again. Treating that as a duplicate makes the agent
    // permanently deaf to anyone who asks twice, so a repeat only counts as a
    // relay artefact when it lands within the window a relay race would.
    return segment.text === text && now - segment.at < DUPLICATE_WINDOW_MS;
  });
}

export function broadcastFloor(session: ClassroomSession): void {
  publish(session.sessionId, {
    kind: 'echosphere:floor-changed',
    floor: session.floor,
  });
}

/** How long the meter shows 'held-back' before settling, when no turn-end event will. */
const RESTRAINT_HELD_BACK_MS = 3000;

/**
 * Single writer for the restraint-meter UI state. It reflects genuine floor
 * decisions, never synthesised events:
 *   - 'speaking'  the floor was granted, or an autonomous turn was authorised
 *   - 'held-back' a request to speak was denied, or an un-permitted turn was cut
 *   - 'listening' resting state, restored when a turn ends
 *
 * A denial starts no turn, so no turn-end event follows to clear it — those
 * callers pass `revertAfterMs` so the meter settles on its own.
 */
function setRestraintMeter(
  session: ClassroomSession,
  state: ClassroomSession['restraintMeterState'],
  revertAfterMs?: number,
): void {
  if (session.restraintMeterState !== state) {
    session.restraintMeterState = state;
    publish(session.sessionId, {
      kind: 'echosphere:restraint-meter-changed',
      state,
    });
  }
  if (revertAfterMs !== undefined) {
    setTimeout(() => {
      if (session.restraintMeterState === state) {
        setRestraintMeter(session, 'listening');
      }
    }, revertAfterMs);
  }
}

export function broadcastPolicy(session: ClassroomSession): void {
  publish(session.sessionId, {
    kind: 'echosphere:policy-changed',
    policy: session.policy,
  });
}

export function broadcastParticipantJoined(
  session: ClassroomSession,
  participantId: string,
): void {
  const participant = session.participants.get(participantId);
  if (!participant) return;
  publish(session.sessionId, {
    kind: 'echosphere:participant-joined',
    participant: toPublicParticipant(participant),
  });
  // A new student is a new entry in the roster block, and the agent cannot
  // pitch an explanation at someone it does not know about.
  void pushInstructions(session);
}

export function segmentsFor(session: ClassroomSession): TranscriptSegment[] {
  return session.transcript;
}