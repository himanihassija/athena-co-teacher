/**
 * Tests for turn-taking enforcement (see classroomController.ts).
 *
 * `hasSpeakPermit` used to be a fixed-duration TTL (15s), and the case that
 * mattered most here was a legitimate answer running long past it — ASR
 * settle + LLM generation + a genuinely long spoken response — and getting
 * cut off mid-sentence because enforcement re-validated the permit's
 * timestamp on every state-change event, even ones well after the turn had
 * already, correctly, begun. `authorizedTurnInProgress` fixed that half.
 *
 * The other half was the same bug one step earlier: a reasoning model can
 * take upwards of 20 seconds just to make its FIRST thinking/speaking
 * transition, and a fixed TTL cut that off too — before the turn had even
 * begun, for a permit that was never superseded by anything. A permit is
 * now valid for as long as it still is the invitation it was: nobody has
 * spoken again since it was granted. There is no duration left to tune.
 *
 * That event-based check then needed one more refinement, also found live:
 * a turn commonly relays more than once, and `lastHumanSpeechAt` refreshes on
 * every relay because the silence-gap detector needs it to — so a permit
 * granted off the first relay of an address read every later relay of that
 * SAME utterance as new speech and revoked itself within about a second.
 * `lastHumanSpeechTurnId`, tracked alongside grantSpeakPermit's own optional
 * turnId, lets `hasSpeakPermit` tell "this turn relaying again" apart from
 * "someone genuinely spoke" without slowing that refresh down for anything
 * else that depends on it.
 *
 * Time is faked by rewinding `speakPermit.grantedAt` and by moving
 * `floor.lastHumanSpeechAt` directly, rather than sleeping; these run in
 * milliseconds and still exercise real elapsed-time and event-ordering logic.
 *
 * Run with: node --import tsx scripts/floor.test.ts
 */

import assert from 'node:assert/strict';
import {
  applyControl,
  clearSpeakPermit,
  grantSpeakPermit,
  handleAgentState,
  hasSpeakPermit,
  ingestTranscript,
  onTurnSettled,
  releaseFloor,
} from './../src/classroomController.ts';
import { addParticipant, createSession } from './../src/state/sessionRegistry.ts';

let pass = 0;
const t = async (name: string, fn: () => void | Promise<void>) => {
  try {
    await fn();
    pass += 1;
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.log(`  FAIL ${name}: ${(e as Error).message}`);
    process.exitCode = 1;
  }
};

/** Longer than TURN_SETTLE_MS, so a spoken turn has stopped growing. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 900));

const rewind = (session: ReturnType<typeof createSession>, ms: number) => {
  if (session.speakPermit) session.speakPermit.grantedAt -= ms;
};

/**
 * Ages the turn clocks, so continuation windows lapse without sleeping.
 *
 * Both clocks move together, because this models time passing rather than an
 * event happening. Rewinding only the authorisation would leave
 * `lastHumanSpeechAt` looking newer than it, i.e. would fake a human speaking
 * after the turn was authorised — a different scenario entirely, and the one
 * `but a think AFTER someone speaks needs its own permit` covers.
 */
const rewindAuthorisation = (
  session: ReturnType<typeof createSession>,
  ms: number,
) => {
  if (session.lastAuthorisedTurnAt !== null) session.lastAuthorisedTurnAt -= ms;
  session.floor = { ...session.floor, lastHumanSpeechAt: session.floor.lastHumanSpeechAt - ms };
};

/**
 * Same idea, for a permit that has not been consumed yet: ages the grant and
 * the speech that caused it together, so "granted a long time ago" is
 * simulated without also faking "and someone has spoken since" — moving only
 * `grantedAt` backward would put it before the speech that caused it, which
 * cannot happen for real.
 *
 * `lastSettledHumanSpeech` is what `hasSpeakPermit` actually reads;
 * `floor.lastHumanSpeechAt` moves too so the floor stays coherent for
 * everything else that reads it.
 */
const rewindPermit = (session: ReturnType<typeof createSession>, ms: number) => {
  if (session.speakPermit) session.speakPermit.grantedAt -= ms;
  if (session.lastSettledHumanSpeech) session.lastSettledHumanSpeech.at -= ms;
  session.floor = { ...session.floor, lastHumanSpeechAt: session.floor.lastHumanSpeechAt - ms };
};

await t('no permit: a turn starting is interrupted', async () => {
  const session = createSession('test');
  const result = await handleAgentState(session, 'thinking');
  assert.equal(result.interrupted, true);
});

await t('valid permit: a turn is allowed to start', async () => {
  const session = createSession('test');
  grantSpeakPermit(session, 'DIRECTLY_ADDRESSED');
  const result = await handleAgentState(session, 'thinking');
  assert.equal(result.interrupted, false);
  assert.equal(session.authorizedTurnInProgress, true);
});

await t(
  'the exact regression: a turn already authorized is NOT re-cut by a later, stale-looking check',
  async () => {
    const session = createSession('test');
    grantSpeakPermit(session, 'DIRECTLY_ADDRESSED');

    const started = await handleAgentState(session, 'thinking');
    assert.equal(started.interrupted, false);

    // Once authorized, the standing permit was already consumed (set to
    // null) — rewinding grantedAt is a no-op on it and this is really just
    // confirming that: the guard for an in-progress turn is
    // `authorizedTurnInProgress`, checked before `hasSpeakPermit` is ever
    // reached, not the permit at all.
    rewind(session, 20_000);
    assert.equal(hasSpeakPermit(session), false, 'sanity: the standing permit was consumed');

    const midSpeech = await handleAgentState(session, 'speaking');
    assert.equal(
      midSpeech.interrupted,
      false,
      'a turn already under way must not be cut off by a later re-check',
    );
  },
);

await t(
  'a permit is not cut off by a model that takes a long time to even begin',
  async () => {
    const session = createSession('test');
    grantSpeakPermit(session, 'DIRECTLY_ADDRESSED');

    // The turn has not started yet — the engine is still generating the
    // first token. Rewind the grant, and the speech that caused it, far past
    // the old 15s TTL; nobody else has spoken since, so this is still
    // exactly the invitation it was.
    rewindPermit(session, 60_000);
    assert.equal(hasSpeakPermit(session), true, 'a slow model is not an uninvited one');

    const result = await handleAgentState(session, 'thinking');
    assert.equal(
      result.interrupted,
      false,
      'a turn that is still the one that was invited must not be cut off for taking a while to start',
    );
  },
);

await t(
  'a permit goes stale once someone else has spoken since it was granted',
  async () => {
    const session = createSession('test');
    grantSpeakPermit(session, 'DIRECTLY_ADDRESSED');

    // Someone spoke again — without re-addressing her, which would grant a
    // fresh permit — so the room has moved on since this invitation.
    session.lastSettledHumanSpeech = { at: Date.now() + 1000, turnId: 7 };
    assert.equal(hasSpeakPermit(session), false);

    const result = await handleAgentState(session, 'thinking');
    assert.equal(
      result.interrupted,
      true,
      'a reply this stale is no longer an answer to the most recent thing said',
    );
  },
);

await t(
  'a permit survives a later relay of the SAME utterance that earned it',
  async () => {
    // The exact live regression: "Athena, can you hear me?" relays more than
    // once as the recogniser settles on a final version. Each relay bumps
    // lastHumanSpeechAt — the silence-gap detector needs that — which used to
    // read as someone new speaking and revoke the permit within about a
    // second, on the very address that granted it.
    const session = createSession('test');
    grantSpeakPermit(session, 'DIRECTLY_ADDRESSED', 42);

    // A later relay of turnId 42 settles again: the timestamp moves forward,
    // same as any speech would, but it is still turnId 42.
    session.lastSettledHumanSpeech = { at: Date.now() + 1000, turnId: 42 };

    assert.equal(
      hasSpeakPermit(session),
      true,
      'a relay of the turn that earned the permit is not new speech',
    );
    const result = await handleAgentState(session, 'thinking');
    assert.equal(result.interrupted, false);
  },
);

await t(
  'the live regression, end to end: an address relayed twice is still answered',
  async () => {
    // Drives the real ingest path rather than setting state by hand, because
    // the bug lived in the interaction between them: the same turn arriving
    // twice, each arrival refreshing floor.lastHumanSpeechAt, against a
    // permit granted on the first arrival. Reproduced live as a permit
    // granted and revoked inside one second.
    const session = createSession('t');
    const teacher = addParticipant(session, { displayName: 'Ms Rao', role: 'teacher' });

    await ingestTranscript(session, {
      uid: teacher.uid,
      text: 'Athena, can you hear me?',
      isFinal: true,
      turnId: 4,
    });
    assert.equal(session.speakPermit?.reason, 'DIRECTLY_ADDRESSED');
    // Held from BEFORE the relay, because that is the grant the sanity check
    // below is about. Reading `grantedAt` afterwards instead compares the
    // timestamp against a grant the relay itself has just re-issued a
    // fraction of a millisecond earlier, which only passes when both land in
    // the same tick — a flake, and not the property being asserted.
    const firstGrantedAt = session.speakPermit?.grantedAt ?? 0;

    // The same turn again, restated slightly longer — what upsertByTurn
    // treats as 'updated', and what the recogniser genuinely does.
    await ingestTranscript(session, {
      uid: teacher.uid,
      text: 'Athena, can you hear me? Yes.',
      isFinal: true,
      turnId: 4,
    });

    assert.ok(
      session.floor.lastHumanSpeechAt >= firstGrantedAt,
      'sanity: the shared floor timestamp did move past the grant, as it should',
    );
    assert.equal(
      hasSpeakPermit(session),
      true,
      'the same turn relaying again is not somebody else speaking',
    );

    const turn = await handleAgentState(session, 'thinking');
    assert.equal(turn.interrupted, false, 'she must be allowed to answer');
  },
);

await t(
  'a permit still goes stale when a genuinely different turn is spoken',
  async () => {
    // The other half of the same fix: it must not become impossible to
    // revoke a permit. A DIFFERENT turnId is unambiguously new speech.
    const session = createSession('test');
    grantSpeakPermit(session, 'DIRECTLY_ADDRESSED', 42);

    session.lastSettledHumanSpeech = { at: Date.now() + 1000, turnId: 43 };

    assert.equal(hasSpeakPermit(session), false);
    const result = await handleAgentState(session, 'thinking');
    assert.equal(
      result.interrupted,
      true,
      'a different turn is not an echo of the one that earned the permit',
    );
  },
);

await t('a turn ending resets authorization for the next one', async () => {
  const session = createSession('test');
  grantSpeakPermit(session, 'DIRECTLY_ADDRESSED');
  await handleAgentState(session, 'thinking');
  await handleAgentState(session, 'speaking');

  await handleAgentState(session, 'silent');
  assert.equal(session.authorizedTurnInProgress, false);

  // No fresh permit was granted — the next turn must be authorized on its
  // own, not inherit the previous turn's clearance.
  //
  // This originally asserted that the very next 'thinking' was interrupted,
  // with no delay. That could not stand once long answers were fixed: the
  // engine voices a long reply in chunks and re-enters 'thinking' between
  // them, so an immediate re-think is the commonest shape of a turn that is
  // still in progress, and interrupting it truncated every long explanation
  // mid-sentence. The two are indistinguishable from the states alone — only
  // the gap separates them — so the property this test protects is now scoped
  // to a re-think that arrives after the continuation window has lapsed.
  // `a re-think between chunks of one answer is not cut off` covers the other
  // side of that line, and the brief-gap case immediately below is deliberate.
  // The window is TURN_CONTINUATION_MS; 9s is comfortably past it.
  rewindAuthorisation(session, 9_000);

  const nextTurn = await handleAgentState(session, 'thinking');
  assert.equal(nextTurn.interrupted, true);
});

await t('a brief re-think right after a turn ends is treated as the same answer', async () => {
  const session = createSession('test');
  grantSpeakPermit(session, 'DIRECTLY_ADDRESSED');
  await handleAgentState(session, 'thinking');
  await handleAgentState(session, 'speaking');
  await handleAgentState(session, 'silent');

  // The deliberate cost of the above: within the short window, and only while
  // nobody has spoken, she may resume. That is what keeps a chunked answer
  // whole, and the teacher's mute and barge-in still cut it instantly.
  assert.equal((await handleAgentState(session, 'thinking')).interrupted, false);
});

await t('mute blocks a turn that has not started yet, even with a valid permit', async () => {
  const session = createSession('test');
  grantSpeakPermit(session, 'DIRECTLY_ADDRESSED');
  session.policy.muted = true;
  const result = await handleAgentState(session, 'thinking');
  assert.equal(result.interrupted, true);
});

await t('clearSpeakPermit revokes both the standing permit and an in-progress turn', () => {
  const session = createSession('test');
  grantSpeakPermit(session, 'TEACHER_INVOKED');
  session.authorizedTurnInProgress = true;
  clearSpeakPermit(session);
  assert.equal(session.speakPermit, null);
  assert.equal(session.authorizedTurnInProgress, false);
});

await t(
  'the other regression: the teacher can address the agent by name even with the floor closed to students',
  () => {
    const session = createSession('test');
    const teacher = addParticipant(session, {
      displayName: 'Ms Rao',
      role: 'teacher',
    });
    // Explicit, even though this is the default — the floor gate exists to
    // control STUDENT access, and must never block the teacher's own.
    session.policy.studentsMayInvoke = false;

    ingestTranscript(session, {
      uid: teacher.uid,
      text: 'Athena, can you hear me?',
      isFinal: true,
    });

    assert.equal(
      session.speakPermit?.reason,
      'DIRECTLY_ADDRESSED',
      'the teacher addressing her by name must grant a permit',
    );
    assert.equal(session.activeQuestionerId, teacher.participantId);
  },
);

await t('the gate still blocks a STUDENT addressing her while the floor is closed', () => {
  const session = createSession('test');
  const student = addParticipant(session, {
    displayName: 'Ana',
    role: 'student',
  });
  session.policy.studentsMayInvoke = false;

  ingestTranscript(session, {
    uid: student.uid,
    text: 'Hey Athena, what is a fraction?',
    isFinal: true,
  });

  assert.equal(
    session.speakPermit,
    null,
    'a student must not be able to summon her while the floor is closed',
  );
});

await t('a student CAN address her once the teacher opens the floor', () => {
  const session = createSession('test');
  const student = addParticipant(session, {
    displayName: 'Ana',
    role: 'student',
  });
  session.policy.studentsMayInvoke = true;

  ingestTranscript(session, {
    uid: student.uid,
    text: 'Hey Athena, what is a fraction?',
    isFinal: true,
  });

  assert.equal(session.speakPermit?.reason, 'DIRECTLY_ADDRESSED');
  assert.equal(session.activeQuestionerId, student.participantId);
});

// ─── Restraint meter reflects real floor decisions (Phase 3 wiring) ──────────

await t('a blocked student invocation drives the restraint meter to held-back', async () => {
  const session = createSession('test');
  const student = addParticipant(session, { displayName: 'Ana', role: 'student' });
  session.policy.studentsMayInvoke = false;

  await ingestTranscript(session, {
    uid: student.uid,
    text: 'Athena, can you continue?',
    isFinal: true,
  });

  assert.equal(session.speakPermit, null, 'no permit for a blocked student');
  assert.equal(session.restraintMeterState, 'held-back');
});

await t('an authorised turn beginning drives the meter to speaking', async () => {
  const session = createSession('test');
  grantSpeakPermit(session, 'DIRECTLY_ADDRESSED');
  await handleAgentState(session, 'thinking');
  assert.equal(session.restraintMeterState, 'speaking');
});

await t('a turn ending returns the meter to listening', async () => {
  const session = createSession('test');
  grantSpeakPermit(session, 'DIRECTLY_ADDRESSED');
  await handleAgentState(session, 'thinking');
  await handleAgentState(session, 'silent');
  assert.equal(session.restraintMeterState, 'listening');
});

await t('an un-permitted autonomous turn being cut drives the meter to held-back', async () => {
  const session = createSession('test');
  const result = await handleAgentState(session, 'thinking');
  assert.equal(result.interrupted, true);
  assert.equal(session.restraintMeterState, 'held-back');
});

/**
 * The live failure this pins: the teacher addressed Athena by name, the floor
 * was granted, and she was cut off mid-word — "I can't draw a".
 *
 * A turn is authorised on its first state change, which consumes the standing
 * permit and sets authorizedTurnInProgress. Any non-starting state clears that
 * flag. So one stray or out-of-order 'listening' between 'thinking' and
 * 'speaking' left the turn with neither flag nor permit, and the next
 * 'speaking' was interrupted as un-permitted. Agent state arrives over RTM and
 * is not guaranteed ordered or complete, so this is reachable in normal use.
 */
await t('a stray state mid-turn does not cut off an authorised turn', async () => {
  const session = createSession('t');
  addParticipant(session, { displayName: 'Ms Rao', role: 'teacher' });
  grantSpeakPermit(session, 'DIRECTLY_ADDRESSED');

  const started = await handleAgentState(session, 'thinking');
  assert.equal(started.interrupted, false, 'a granted turn must be allowed to start');

  // The engine reports a momentary non-speaking state mid-turn.
  await handleAgentState(session, 'listening');

  const resumed = await handleAgentState(session, 'speaking');
  assert.equal(
    resumed.interrupted,
    false,
    'she must not be cut off partway through a turn she was granted',
  );
});

await t('a genuinely new turn after one ends still needs its own permit', async () => {
  const session = createSession('t');
  addParticipant(session, { displayName: 'Ms Rao', role: 'teacher' });
  grantSpeakPermit(session, 'DIRECTLY_ADDRESSED');

  await handleAgentState(session, 'thinking');
  await handleAgentState(session, 'silent');

  // Well past any continuation window: an unrelated later turn must not ride
  // on the invitation meant for the finished one.
  session.lastAuthorisedTurnAt = Date.now() - 60_000;
  const next = await handleAgentState(session, 'speaking');
  assert.equal(next.interrupted, true, 'an unrelated later turn must be interrupted');
});

await t(
  'the reported reason names the real cause, not whichever policy is false',
  async () => {
    // Reproduces exactly what the teacher panel showed: the TEACHER addressed
    // Athena, she then began an extra, uninvited turn, and the panel claimed
    // "a student called her — floor is closed to students". No student had
    // spoken; studentsMayInvoke merely happened to be false.
    const session = createSession('t');
    addParticipant(session, { displayName: 'Ms Rao', role: 'teacher' });
    session.policy.studentsMayInvoke = false;

    grantSpeakPermit(session, 'DIRECTLY_ADDRESSED');
    const invited = await handleAgentState(session, 'thinking');
    assert.equal(invited.interrupted, false, 'the teacher-invited turn must run');
    await handleAgentState(session, 'silent');

    session.lastAuthorisedTurnAt = Date.now() - 60_000;
    const uninvited = await handleAgentState(session, 'thinking');

    assert.equal(uninvited.interrupted, true, 'an uninvited turn is still cut');
    assert.notEqual(
      uninvited.reason,
      'STUDENT_INVOCATION_DISABLED',
      'no student spoke, so the panel must not blame a student',
    );
    assert.equal(uninvited.reason, 'AGENT_UNINVITED');
  },
);

await t('a muted agent still reports muting, not an uninvited turn', async () => {
  const session = createSession('t');
  session.policy.muted = true;
  grantSpeakPermit(session, 'DIRECTLY_ADDRESSED');

  const result = await handleAgentState(session, 'thinking');
  assert.equal(result.interrupted, true, 'muting overrides a valid permit');
  assert.equal(result.reason, 'AGENT_MUTED');
});

await t(
  'an interim fragment of the teacher\'s own sentence does not revoke her invitation',
  async () => {
    // The failure Syna hit: the teacher addresses Athena, the permit is
    // granted, and the recogniser then relays the next interim fragment of the
    // same breath. That fragment used to run the barge-in path and wipe the
    // permit, so the answer the teacher had just asked for was cut off for
    // being "uninvited".
    const session = createSession('t');
    const teacher = addParticipant(session, { displayName: 'Ms Rao', role: 'teacher' });
    session.policy.studentsMayInvoke = true;

    await ingestTranscript(session, {
      uid: teacher.uid,
      text: 'Athena, can you hear me?',
      isFinal: true,
    });
    assert.equal(session.speakPermit?.reason, 'DIRECTLY_ADDRESSED');

    await ingestTranscript(session, {
      uid: teacher.uid,
      text: 'could you write',
      isFinal: false,
    });

    assert.ok(
      session.speakPermit,
      'a teacher still mid-sentence has not barged in on anyone',
    );

    const turn = await handleAgentState(session, 'thinking');
    assert.equal(turn.interrupted, false, 'she must be allowed to answer');
  },
);

await t('a real barge-in while she is speaking still revokes the permit', async () => {
  const session = createSession('t');
  const teacher = addParticipant(session, { displayName: 'Ms Rao', role: 'teacher' });
  session.policy.studentsMayInvoke = true;
  grantSpeakPermit(session, 'DIRECTLY_ADDRESSED');
  session.floor = {
    state: 'AGENT_SPEAKING',
    holderId: null,
    lastHumanSpeechAt: Date.now() - 1_000,
    since: Date.now() - 1_000,
  };

  // No wake phrase, so nothing re-grants afterwards.
  await ingestTranscript(session, {
    uid: teacher.uid,
    text: 'hold on everyone',
    isFinal: true,
  });

  assert.equal(
    session.speakPermit,
    null,
    'cutting her off mid-answer must still revoke her permission',
  );
});

await t('the completed sentence reaches the board, not just the first fragment', async () => {
  // "Athena, could you write two plus two equals four on the whiteboard"
  // reached the orchestrator first as a truncated guess ending "on the", which
  // parses as no command at all. The finished sentence arrived as a rewrite of
  // the same turn and used to be dropped as a duplicate, so nothing was ever
  // written.
  const session = createSession('t');
  const teacher = addParticipant(session, { displayName: 'Ms Rao', role: 'teacher' });
  session.policy.studentsMayInvoke = true;

  await ingestTranscript(session, {
    uid: teacher.uid,
    turnId: 'turn-1',
    text: 'Athena, could you write two plus two equals four on the',
    isFinal: true,
  });
  await ingestTranscript(session, {
    uid: teacher.uid,
    turnId: 'turn-1',
    text: 'Athena, could you write two plus two equals four on the whiteboard',
    isFinal: true,
  });

  await settle();
  assert.equal(session.whiteboard.cards.length, 1, 'the command must reach the board');
  assert.match(String(session.whiteboard.cards[0]?.text), /two plus two equals four/i);
});

await t('one spoken command relayed repeatedly is written to the board once', async () => {
  const session = createSession('t');
  const teacher = addParticipant(session, { displayName: 'Ms Rao', role: 'teacher' });
  session.policy.studentsMayInvoke = true;

  const relay = (text: string) =>
    ingestTranscript(session, { uid: teacher.uid, turnId: 'turn-9', text, isFinal: true });

  await relay('Athena, write photosynthesis on the whiteboard');
  await relay('Athena, write photosynthesis on the whiteboard please');
  await relay('Athena, write photosynthesis on the whiteboard please everyone');

  await settle();
  assert.equal(
    session.whiteboard.cards.length,
    1,
    'a sentence relayed three times must not be written three times',
  );
  assert.match(
    String(session.whiteboard.cards[0]?.text),
    /photosynthesis/i,
    'and it must be the completed sentence that lands',
  );
});

await t('a turn relayed many times acts once, on its final text', async () => {
  // The mechanism behind the repeated answers: one question relayed five times
  // produced five replies. Actions now collapse onto the settled turn.
  const seen: string[] = [];
  for (const text of ['Could you write', 'Could you write team', 'Could you write team Meraki']) {
    onTurnSettled('turn:demo', () => seen.push(text));
  }
  await settle();

  assert.equal(seen.length, 1, 'one sentence must produce one action');
  assert.equal(seen[0], 'Could you write team Meraki', 'and act on the complete text');
});

await t('turns are settled independently of one another', async () => {
  const seen: string[] = [];
  onTurnSettled('turn:a', () => seen.push('a'));
  onTurnSettled('turn:b', () => seen.push('b'));
  await settle();
  assert.deepEqual(seen.sort(), ['a', 'b'], 'two separate turns both act');
});

await t('an untracked turn acts immediately', () => {
  // No turn id means no way to recognise a later relay, so waiting would only
  // add latency to something that will never be superseded.
  let ran = false;
  onTurnSettled(null, () => {
    ran = true;
  });
  assert.equal(ran, true);
});

await t('one agent turn relayed repeatedly is stored once', async () => {
  // The recogniser re-sends Athena's turn as her sentence completes. Each
  // relay used to append another copy, so a single quiz question filled the
  // transcript with two dozen identical rows.
  const session = createSession('t');
  addParticipant(session, { displayName: 'Ms Rao', role: 'teacher' });

  const relay = (text: string) =>
    ingestTranscript(session, { uid: '123456', turnId: 12, text, isFinal: true });

  await relay('Which of the following numbers is odd?');
  await relay('Which of the following numbers is odd? Option A: Two.');
  await relay('Which of the following numbers is odd? Option A: Two. Option B: Four.');

  const agentRows = session.transcript.filter((seg) => seg.speaker === 'agent');
  assert.equal(agentRows.length, 1, 'one spoken turn is one row');
  assert.match(String(agentRows[0]?.text), /Option B: Four/, 'holding the complete sentence');
});

/*
 * A long answer voiced in chunks.
 *
 * The engine streams a long reply and re-enters 'thinking' between chunks,
 * after the permit has already been consumed by the first one. 'thinking' was
 * excluded from the turn-continuation window on the reasoning that thinking is
 * how a NEW turn begins — true of a new turn, false of a long one. A live
 * lesson heard "Photosynthesis is the process by which green plants, algae,"
 * and then silence, while short answers were fine, which is why it read as
 * intermittent rather than broken.
 */
await t('a re-think between chunks of one answer is not cut off', async () => {
  const session = createSession('t');
  addParticipant(session, { displayName: 'Rao', role: 'teacher' });
  grantSpeakPermit(session, 'DIRECTLY_ADDRESSED');

  assert.equal((await handleAgentState(session, 'thinking')).interrupted, false);
  assert.equal((await handleAgentState(session, 'speaking')).interrupted, false);
  // A gap in state delivery between two chunks of the same answer.
  await handleAgentState(session, 'listening');

  const rethink = await handleAgentState(session, 'thinking');
  assert.equal(rethink.interrupted, false, 'the rest of the answer must not be cut off');
  assert.equal((await handleAgentState(session, 'speaking')).interrupted, false);
});

await t('a re-think after a realistic 3-4s generation gap is not cut off', async () => {
  const session = createSession('t');
  addParticipant(session, { displayName: 'Rao', role: 'teacher' });
  grantSpeakPermit(session, 'DIRECTLY_ADDRESSED');

  await handleAgentState(session, 'thinking');
  await handleAgentState(session, 'speaking');
  await handleAgentState(session, 'listening');

  // Measured from a live lesson: grant at 07:28:53, the engine came back for
  // the next chunk at +2s, +3s and +4s. A 2s window was tried first and still
  // truncated the answer, which is why the window is not the discriminator.
  rewindAuthorisation(session, 3_500);

  assert.equal(
    (await handleAgentState(session, 'thinking')).interrupted,
    false,
    'generating the next chunk takes seconds; that is still the same answer',
  );
});

await t('a re-think still continues after a silent state', async () => {
  const session = createSession('t');
  addParticipant(session, { displayName: 'Rao', role: 'teacher' });
  grantSpeakPermit(session, 'DIRECTLY_ADDRESSED');

  await handleAgentState(session, 'thinking');
  await handleAgentState(session, 'speaking');
  await handleAgentState(session, 'silent');
  assert.equal((await handleAgentState(session, 'thinking')).interrupted, false);
});

await t('but a think AFTER someone speaks needs its own permit', async () => {
  const session = createSession('t');
  const teacher = addParticipant(session, { displayName: 'Rao', role: 'teacher' });
  grantSpeakPermit(session, 'DIRECTLY_ADDRESSED');

  await handleAgentState(session, 'thinking');
  await handleAgentState(session, 'speaking');
  await handleAgentState(session, 'listening');

  // The room moved on. Whatever she says next answers THIS, not the earlier
  // invitation, so it is a new turn and must be invited on its own.
  await new Promise((resolve) => setTimeout(resolve, 5));
  await ingestTranscript(session, {
    uid: teacher.uid,
    text: 'Right, moving on to fractions.',
    isFinal: true,
    turnId: 91,
  });

  const uninvited = await handleAgentState(session, 'thinking');
  assert.equal(uninvited.interrupted, true, 'an unrelated later turn must not ride on the old invitation');
  assert.equal(uninvited.reason, 'AGENT_UNINVITED');
});

await t('the continuation window does not outlive an explicit revocation', async () => {
  const session = createSession('t');
  addParticipant(session, { displayName: 'Rao', role: 'teacher' });
  grantSpeakPermit(session, 'DIRECTLY_ADDRESSED');

  await handleAgentState(session, 'thinking');
  await handleAgentState(session, 'listening');
  // Mute, barge-in and closing the floor all funnel through this.
  clearSpeakPermit(session);

  const stopped = await handleAgentState(session, 'thinking');
  assert.equal(stopped.interrupted, true, 'an override must beat the continuation window');
});

await t('a muted agent is still cut off mid-answer', async () => {
  const session = createSession('t');
  addParticipant(session, { displayName: 'Rao', role: 'teacher' });
  grantSpeakPermit(session, 'DIRECTLY_ADDRESSED');

  await handleAgentState(session, 'thinking');
  await handleAgentState(session, 'listening');
  session.policy.muted = true;

  const muted = await handleAgentState(session, 'thinking');
  assert.equal(muted.interrupted, true);
  assert.equal(muted.reason, 'AGENT_MUTED');
});


// ─── The live stall: "Waiting on Athena" with no answer ever coming ──────────
//
// Reproduced from an orchestrator log in which a direct address was granted a
// permit and the very next agent turns were refused:
//
//   [floor] granted DIRECTLY_ADDRESSED to teacher in session 5612
//   [floor] interrupted an un-permitted turn in session 5612: AGENT_UNINVITED
//   [floor] interrupted an un-permitted turn in session 5612: AGENT_UNINVITED
//
// Two independent defects put the room in that state, and both are covered
// below: enforcement adjudicating a turn before the transcript that invites it
// can arrive, and the floor having no way back out of STUDENT_QUESTION_PENDING.

await t(
  'a turn the engine starts before the transcript lands is not cut off for it',
  async () => {
    // The engine hears the wake word itself and begins answering within a few
    // hundred ms; the browser holds the same sentence for TURN_SETTLE_MS before
    // relaying it. For that window enforcement sees a turn with no permit --
    // and used to interrupt it.
    const session = createSession('t');
    addParticipant(session, { displayName: 'Rao', role: 'teacher' });

    const adjudication = handleAgentState(session, 'thinking');

    // The address arrives while that decision is still open.
    setTimeout(() => grantSpeakPermit(session, 'DIRECTLY_ADDRESSED', 9), 300);

    const result = await adjudication;
    assert.equal(
      result.interrupted,
      false,
      'she was answering a question she had in fact just been asked',
    );
    assert.equal(session.authorizedTurnInProgress, true);
  },
);

await t(
  'an interrupt already in flight does not wipe a permit granted behind it',
  async () => {
    // The other half. interruptAgent is a round trip to Agora -- 1.4s in the
    // log above -- and the revocation used to run on the far side of it, so a
    // permit granted during those seconds was destroyed by a decision taken
    // before it existed. The `think` that followed then had nothing to present
    // and was cut off in turn.
    const session = createSession('t');
    addParticipant(session, { displayName: 'Rao', role: 'teacher' });

    // Nobody has addressed her, so this turn is genuinely uninvited and the
    // grace below will lapse without finding a permit.
    const adjudication = handleAgentState(session, 'thinking');
    const refused = await adjudication;
    assert.equal(refused.interrupted, true);

    // ...and the address lands immediately afterwards, as it does live.
    grantSpeakPermit(session, 'DIRECTLY_ADDRESSED', 11);
    assert.equal(
      hasSpeakPermit(session),
      true,
      'a refusal must not reach forward and revoke the next invitation',
    );

    const next = await handleAgentState(session, 'thinking');
    assert.equal(next.interrupted, false, 'the driven answer must be allowed through');
  },
);

await t('a directly-addressed answer moves the floor off "waiting"', async () => {
  // STUDENT_QUESTION_PENDING is what the room renders as "Waiting on Athena".
  // Only requestFloor used to claim the floor for her, which covers the turns
  // the orchestrator starts -- a directly-addressed turn is started by the
  // engine, so the lamp stayed amber right through her answer.
  const session = createSession('t');
  const teacher = addParticipant(session, { displayName: 'Rao', role: 'teacher' });

  await ingestTranscript(session, {
    uid: teacher.uid,
    text: 'Athena, can you hear me?',
    isFinal: true,
    turnId: 3,
  });
  assert.equal(session.floor.state, 'STUDENT_QUESTION_PENDING');

  await handleAgentState(session, 'thinking');
  assert.equal(session.floor.state, 'AGENT_SPEAKING', 'her answer holds the floor');

  releaseFloor(session);
  assert.equal(session.floor.state, 'OPEN_FLOOR');
});

await t('a question that will never be answered stops saying "waiting"', async () => {
  // The refusal path: she was cut off, muted, or the floor closed under her.
  // releaseFloor only handled AGENT_SPEAKING, so a pending question nothing
  // would ever answer left the indicator amber until the next person spoke.
  const session = createSession('t');
  const teacher = addParticipant(session, { displayName: 'Rao', role: 'teacher' });

  await ingestTranscript(session, {
    uid: teacher.uid,
    text: 'Athena, can you hear me?',
    isFinal: true,
    turnId: 5,
  });
  assert.equal(session.floor.state, 'STUDENT_QUESTION_PENDING');

  clearSpeakPermit(session);
  session.policy.muted = true;
  const muted = await handleAgentState(session, 'thinking');

  assert.equal(muted.interrupted, true);
  assert.equal(
    session.floor.state,
    'OPEN_FLOOR',
    'the room must not be left waiting on an answer that is not coming',
  );
});

// ─── The board she said she had written on ──────────────────────────────────

await t('a board write on a turn somebody asked for lands', async () => {
  // Live: "I've put the example on the board: 3/4 = 3 parts out of 4 equal
  // parts" -- and the board was empty. The payload used to be dropped here
  // when the teacher's annotate toggle was off, silently, while the spoken
  // half of the same turn went out as normal.
  const session = createSession('t');
  addParticipant(session, { displayName: 'Rao', role: 'teacher' });

  grantSpeakPermit(session, 'DIRECTLY_ADDRESSED', 21);
  await handleAgentState(session, 'thinking');

  applyControl(session, { board: { action: 'write', text: '3/4 = 3 parts out of 4' } });

  assert.equal(session.whiteboard.cards.length, 1, 'what she said she wrote is on the board');
  assert.equal(session.whiteboard.cards[0]?.text, '3/4 = 3 parts out of 4');
  assert.equal(session.whiteboard.open, true, 'and the board is showing');
});

await t('a board write she volunteered lands too', async () => {
  // The case the old annotate gate held back: she judges something board-worthy
  // during a silence interjection. Nothing gates it now -- how sparingly she
  // writes is the prompt's job, and the interjection itself is already
  // rate-limited by the gap cooldown.
  const session = createSession('t');
  addParticipant(session, { displayName: 'Rao', role: 'teacher' });

  session.lastAuthorisedTurnTrigger = 'GAP_DETECTED_IN_SILENCE';
  applyControl(session, { board: { action: 'write', text: 'A denominator is...' } });

  assert.equal(session.whiteboard.cards.length, 1, 'the line she volunteered is on the board');
  assert.equal(session.whiteboard.cards[0]?.text, 'A denominator is...');
});

await t('board control lands however the turn began', async () => {
  const session = createSession('t');
  session.lastAuthorisedTurnTrigger = 'GAP_DETECTED_IN_SILENCE';
  applyControl(session, { board: { action: 'show' } });
  assert.equal(session.whiteboard.open, true);
  applyControl(session, { board: { action: 'hide' } });
  assert.equal(session.whiteboard.open, false);
});

console.log(`\n${pass} passing`);
