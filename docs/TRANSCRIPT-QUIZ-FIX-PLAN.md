# Transcript & Quiz Reliability — Implementation Plan

Fixing the intermittent transcript loss and the quiz-set truncation, in the order
that minimises risk to the parts that already work.

**Audience:** whoever picks this up next, including future-you.
**Written from:** the ConvoAI integration side — what the engine actually guarantees
versus what this codebase assumes it guarantees.

---

## 0. The governing principle

> Every change in Phases 0–3 is **additive or strictly-narrowing**. No working
> delivery path is deleted. Where a new path is introduced, the old one stays as
> the fallback, so a regression degrades to today's behaviour rather than to
> nothing.

This matters because both subsystems are *already* built on redundant paths, and
past fixes have removed one path to tidy things up — which is exactly how the
quiz-set cap and the double-quiz-card bugs were introduced (see the comments at
`classroomController.ts:1259-1272`). Don't repeat it.

**Regression net:** `pnpm --filter @echosphere/orchestrator verify`
(typecheck + 15 test suites, including `scripts/echo.test.ts` and
`scripts/quiz.test.ts`). Run it after every phase. Nothing below is allowed to
turn it red.

---

## 1. What is actually wrong (one paragraph each)

| # | Fault | Evidence |
|---|---|---|
| **A** | The self-echo filter deletes real student speech. Both its match branches are far too loose. | Reproduced against the live function — 6 of 9 realistic student lines destroyed. |
| **B** | Speaker identity is guessed from microphone volume, while the engine already sends it on the payload. | `UserTranscription.user_id` exists in the toolkit typings; `grep user_id apps/web` → 0 hits. |
| **C** | The entire room's transcript runs on the teacher's browser tab, with no visibility handling. | `grep visibilitychange\|document.hidden\|wakeLock apps/web` → 0 hits. |
| **D** | Six silent `return`s in transcript ingestion, zero logging, route replies `{ok:true}` regardless. | Lines 624, 638, 676, 679, 723, 733 of `classroomController.ts`. |
| **E** | Two speakers within one `turn_id` collapse onto one relay entry. | Relay key at `ClassroomAudio.tsx:509` drops `stream_id`; the toolkit keys on it. |
| **F** | Quiz-set advancement depends on the one delivery path that failed. | Render logs, session 3921 — `(no turn)` ×2, no `payload recovered`, no `advancing`. |
| **G** | The give-up branch tears down a quiz set that has already delivered its question. | `classroomController.ts:1712`. |
| **H** | A bare `catch {}` hides why the history endpoint returns nothing. | `agentLifecycle.ts:651`, and again at 597. |

### The ConvoAI-side reality behind F and H

The Agora docs for `GET /agents/{agentId}/history` document **no** pagination, no
time-window filter, and no rate limit, and state it *"only supports querying the
running agent."* There is no documented reason a running agent's `contents`
should come back empty. The docs also show a `[think API injected]` marker
appearing in history for injected turns, which is undocumented special handling.

The conclusion for the design is not "fix the poll" — it's that **a REST endpoint
with undocumented behaviour under `think()` injection cannot be the load-bearing
path for a feature the teacher is standing in front of a class waiting on.** The
RTM relay demonstrably delivered the payload in every failing session. Phase 3
makes that the primary and demotes the poll to a backstop.

---

## Phase 0 — Observability (no behaviour change)

**Do this first and deploy it on its own.** It changes no logic, carries
essentially zero risk, and one classroom session afterwards resolves the three
remaining unknowns. Phase 2 is *gated* on what it reports.

### 0.1 — Name every transcript drop

`apps/orchestrator/src/classroomController.ts`

Add above `ingestTranscript`:

```ts
/**
 * One place every discarded transcript turn passes through.
 *
 * Six guards in `ingestTranscript` drop a turn and return, none of them logged,
 * and the route replies {ok:true} either way — so a dropped turn was
 * indistinguishable from a stored one both from the browser AND from the server
 * logs. This makes every drop attributable to a named guard without changing
 * what any of them do.
 */
type DropReason =
  | 'unchanged'
  | 'duplicate'
  | 'system-directive'
  | 'unknown-uid'
  | 'not-final'
  | 'self-echo';

function dropTranscript(
  session: ClassroomSession,
  reason: DropReason,
  uid: string,
  text: string,
  turnId?: number,
): void {
  console.info(
    `[transcript] drop reason=${reason} session=${session.sessionId} ` +
      `uid=${uid} turn=${turnId ?? '-'} text=${JSON.stringify(text.slice(0, 60))}`,
  );
}
```

Then add one call before each of the six returns:

| Line | Call to insert before the `return` |
|---|---|
| 624 | `dropTranscript(session, 'unchanged', uid, text, turnId);` |
| 638 | `dropTranscript(session, 'duplicate', uid, text, turnId);` |
| 676 | `dropTranscript(session, 'system-directive', uid, text, turnId);` |
| 679 | `dropTranscript(session, 'unknown-uid', uid, text, turnId);` |
| 723 | `dropTranscript(session, 'not-final', uid, text, turnId);` |
| 733 | `dropTranscript(session, 'self-echo', uid, text, turnId);` |

And one line on the success path, just after `appendTranscript`:

```ts
console.info(
  `[transcript] keep session=${session.sessionId} uid=${uid} turn=${turnId ?? '-'} ` +
    `speaker=${participant.role} conf=${attributionConfidence ?? '-'}`,
);
```

`console.info`, not `warn` — most of these are normal. The grep-able `[transcript]`
prefix is the point.

> **Note on line 679 (`unknown-uid`).** This fires for a second reason worth
> knowing: sessions live in a plain in-memory `Map` (`sessionRegistry.ts:287`).
> Any orchestrator restart wipes `uidToParticipantId`, after which *every*
> relayed turn lands here while the room still looks connected. On Render, deploys
> and spin-downs do this. If you see a burst of `unknown-uid` with nothing else,
> check the deploy timestamps before debugging anything else.

### 0.2 — Surface why the history poll finds nothing

`apps/orchestrator/src/agent/agentLifecycle.ts`

Replace `assistantTurns` (line 581) with a version that distinguishes the failure
modes. This is the single most valuable diagnostic in the plan:

```ts
async function assistantTurns(
  agentSession: AgentSession,
): Promise<string[]> {
  const history = (await agentSession.getHistory()) as { contents?: HistoryItem[] };
  const contents = history.contents ?? [];
  const turns = contents
    .filter((c) => c.role === 'assistant' && typeof c.content === 'string')
    .map((c) => c.content as string)
    .filter((t) => t.trim().length > 0);

  // Distinguishes the four ways this can come back useless: the endpoint threw
  // (caught by the caller), `contents` absent, `contents` present with no
  // assistant role, or assistant entries whose content is not a string. All
  // four previously looked identical — an empty array — and produced the same
  // "(no turn)" that made a dead quiz set indistinguishable from a quiet one.
  if (turns.length === 0) {
    console.info(
      `[quiz] history: ${contents.length} entries, 0 usable assistant turns` +
        (contents.length > 0
          ? ` (roles=${[...new Set(contents.map((c) => c.role))].join(',')}` +
            ` contentTypes=${[...new Set(contents.map((c) => typeof c.content))].join(',')})`
          : ' (contents absent or empty)'),
    );
  }
  return turns;
}
```

Then the two bare catches.

`assistantTurnSnapshot` (line 597):

```ts
} catch (error) {
  console.warn(
    `[quiz] getHistory failed taking the pre-turn snapshot in session ${sessionId}:`,
    error,
  );
  return new Set();
}
```

`pollForPayloadTurn` (line 651) — needs a flag so 16 iterations don't spam the log.
Add `let loggedPollError = false;` beside `let newestSeen` (line 639), then:

```ts
} catch (error) {
  // The history endpoint 404s briefly right after start / between turns, so
  // this stays non-fatal — but it must not stay invisible. A persistent failure
  // here is indistinguishable from "the agent said nothing", which is what made
  // a dead quiz set look like a quiet one. Logged once per poll, not per tick.
  if (!loggedPollError) {
    loggedPollError = true;
    console.warn(
      `[quiz] getHistory failed during payload poll for session ${sessionId} ` +
        `(further errors this poll suppressed):`,
      error,
    );
  }
}
```

### 0.3 — One-time transcript payload probe

`apps/web/components/classroom/ClassroomAudio.tsx`

Add a ref beside the other relay refs:

```ts
const loggedTranscriptShape = useRef(false);
```

and at the top of `onTranscript`, inside the `for (const item of items)` loop
after the empty-text guard:

```ts
// One-time probe. The engine documents a `user_id` on user transcriptions,
// which would replace the volume-level guess below outright. The toolkit
// overwrites `item.uid` with "0" for every human turn (it was built for 1:1
// calls) but preserves the raw message in `metadata`, so the real uid should
// survive there. Logged once so a single session settles whether it is actually
// populated in a multi-party channel.
if (!loggedTranscriptShape.current) {
  loggedTranscriptShape.current = true;
  console.info('[classroom] transcript item shape', JSON.stringify(item));
}
```

### Phase 0 verification

Run one classroom: teacher + 2 students, some back-and-forth, then one
**Start Quiz**. Then read the logs.

| What you see | What it means |
|---|---|
| `[transcript] drop reason=self-echo` appearing after Athena speaks | Fault A confirmed in production → Phase 1 is correct and urgent |
| `[transcript] drop reason=unknown-uid` in bursts | Session state was lost — check Render deploy times first |
| `[quiz] getHistory failed …` with an error | Fault H is an exception; the error names the cause |
| `[quiz] history: 0 entries (contents absent or empty)` | Agora genuinely returns nothing → the poll can never be relied on |
| `[quiz] history: N entries, roles=user` | Assistant turns are being withheld — `think()`-injected turns may be special-cased |
| `user_id` present in `[classroom] transcript item shape` | **Phase 2 is unblocked** |
| `user_id` absent or `"0"` | Skip Phase 2.1; do Phase 2.2 only |

---

## Phase 1 — Stop the echo filter eating student answers

**Fault A. Highest value change in this document.** Two constants and one
denominator. `apps/orchestrator/src/agent/echo.ts`.

### 1.1 — Raise the bar for a *whole-turn* drop

Add beside `MIN_MATCH_LENGTH`:

```ts
/**
 * Below this, discarding an ENTIRE turn as echo is not safe.
 *
 * `MIN_MATCH_LENGTH` (6) governs whether a string is worth comparing at all.
 * This governs the much stronger claim that a turn is *entirely* Athena's voice
 * and should be thrown away. Six characters of overlap is "yes", "four",
 * "option b", "a common denominator" — the exact shape of a student answering a
 * question, and every one of those is a literal substring of something she said
 * moments earlier. A partial cut is still allowed below this length; only the
 * all-or-nothing drop is gated.
 */
const MIN_WHOLE_TURN_DROP_LENGTH = 25;
```

Then guard the two whole-turn drops in `stripSelfEcho` (lines 152 and 159):

```ts
const dropWholeTurnAllowed = normKept.length >= MIN_WHOLE_TURN_DROP_LENGTH;

// Whole-turn match: nothing left but echo, or the echo swallows the turn.
if (a.includes(normKept)) {
  if (dropWholeTurnAllowed) return '';
  continue;   // too short to attribute to her with any confidence — keep it
}
if (normKept.includes(a)) {
  kept = cutSpan(kept, a);
  continue;
}
// Fuzzy whole-turn match: ASR mangled the echo enough that no exact span
// exists, so there is nothing left to salvage either.
if (dropWholeTurnAllowed && trigramSimilarity(a, normKept) > FUZZY_MATCH_THRESHOLD) {
  return '';
}
```

### 1.2 — Fix the similarity denominator

This is the deeper bug of the two.

```ts
function trigramSimilarity(a: string, b: string): number {
  const setA = trigrams(a);
  const setB = trigrams(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  for (const g of setA) if (setB.has(g)) shared += 1;
  // Union, not min. Dividing by the SMALLER set makes this a containment ratio
  // rather than a similarity: every trigram of a four-word student answer can
  // appear somewhere in a long agent sentence and score a clean 1.0, which is
  // how "the answer is four" was classified as Athena's own voice. Jaccard
  // requires the two utterances to be comparable in SIZE as well as
  // overlapping, which is what "this is the same sentence" actually means.
  return shared / (setA.size + setB.size - shared);
}
```

`FUZZY_MATCH_THRESHOLD` stays at `0.6` — a genuine echo scores near 1.0 under
Jaccard, so the existing threshold still separates cleanly.

### 1.3 — Lock it down with the reproduction

Append to `apps/orchestrator/scripts/echo.test.ts`, following the existing `t()`
pattern:

```ts
t('a short student answer built from her words is NOT dropped', () => {
  const session = createSession('test');
  rememberAgentUtterance(session, 'So, can anyone tell me what a common denominator is?');
  rememberAgentUtterance(session, 'A fraction has a numerator on top and a denominator on the bottom.');
  rememberAgentUtterance(session, "That's right, the answer is four. Well done!");

  // Every one of these was silently destroyed before the MIN_WHOLE_TURN_DROP
  // and Jaccard fixes. They are the ordinary shape of a student answering.
  for (const answer of [
    'a common denominator',
    'the answer is four',
    "Yes, that's right",
    'a numerator on top',
    'the denominator on the bottom',
    'what is a common denominator',
  ]) {
    assert.equal(stripSelfEcho(session, answer), answer, `dropped: ${answer}`);
  }
});
```

**The three existing echo tests must still pass unchanged** — they use full-sentence
echoes (58 normalised characters), comfortably above the new threshold and scoring
near 1.0 under Jaccard. If any of them go red, the change is wrong; stop.

```bash
node --env-file=.env --import tsx apps/orchestrator/scripts/echo.test.ts
pnpm --filter @echosphere/orchestrator verify
```

> **Deliberately not doing:** gating the whole filter on `AGENT_SPEAKING`.
> Tempting, but TTS leaks into a mic with a delay, so a strict floor-state gate
> would miss real echoes at the tail of her turn. 1.1 + 1.2 fix all six
> reproduced cases without touching the timing logic at all. If Phase 0 logs
> still show `reason=self-echo` on genuine student speech afterwards, add a
> wake-phrase exemption then — not pre-emptively.

---

## Phase 2 — Use the speaker identity the engine already sends

**Faults B and E.** Strictly additive: if `user_id` is absent the behaviour is
byte-identical to today.

### 2.1 — Prefer `user_id`, keep the volume guess as fallback

> **Gate:** only do this if Phase 0.3 showed a populated `user_id`. If it showed
> `"0"` or absent, skip to 2.2.

`apps/web/components/classroom/ClassroomAudio.tsx`, inside `onTranscript`:

```ts
// The engine identifies the speaker on the transcription payload itself. The
// toolkit overwrites `item.uid` with "0" for every human turn — it was built for
// a 1:1 call and has no notion of several people — but it preserves the raw
// message in `metadata`, so the real RTC uid survives there. Preferred over the
// volume poll below, which can only ever guess, and which misattributes a quiet
// mic, a short answer, or a fast handoff. The guess stays as the fallback.
const reportedUid =
  typeof item.metadata?.user_id === 'string' &&
  item.metadata.user_id.trim().length > 0 &&
  item.metadata.user_id.trim() !== '0'
    ? item.metadata.user_id.trim()
    : undefined;

const speakerUid =
  existing?.speakerUid ??
  (isAgent ? agentUid : (reportedUid ?? dominantSpeakerRef.current ?? uid));

// A reported uid is a fact, not a guess — it is not scored against a runner-up.
const attributionConfidence =
  existing?.attributionConfidence ??
  (isAgent ? undefined : reportedUid ? 1 : attributionConfidenceRef.current);
```

Leave the volume poll in place. It still drives the roster's speaking glow via
`onSpeakingChange`, which is a separate consumer.

### 2.2 — Stop two speakers collapsing into one turn

Same file, the pending-turn key at line 509:

```ts
// `stream_id` distinguishes two speakers inside one turn_id. The toolkit keys
// its own history on turn_id + stream_id + uid and correctly holds two separate
// items; keying on turn_id alone collapsed them onto one entry here, where they
// overwrote each other and both were attributed to whoever spoke first.
const streamId = typeof item.stream_id === 'number' ? item.stream_id : 0;
const key = `${turnId ?? `${item.uid}:${text}`}:${streamId}:${isAgent ? 'agent' : 'human'}`;
```

### 2.3 — Server-side turn matching *(only after 2.1 is confirmed live)*

`findTurn` (`classroomController.ts:1907`) deliberately ignores uid, because
attribution used to get revised mid-turn and matching on uid would have produced
two rows under two names. With `user_id`, attribution no longer gets revised, so
matching on it becomes both safe and necessary:

```ts
// uid is part of the key again now that attribution comes from the engine
// rather than a volume guess. It could not be before: a revised guess would
// land the same turn as a second row under a second name. Agent turns still
// match on side alone — a turn started by an injected instruction legitimately
// carries both her reply and the instruction under one turn_id.
if (
  segment.turnId === turnId &&
  (segment.speaker === 'agent') === wantAgent &&
  (wantAgent || segment.uid === uid)
) {
  return segment;
}
```

**Do not do 2.3 speculatively.** If `user_id` turns out to be absent, this change
makes fault E *worse*, not better.

---

## Phase 3 — Make quiz sets independent of the history poll

**Faults F and G.** The architectural fix. `classroomController.ts`.

### 3.1 — Record the quiz against the set from *either* delivery path

This is the whole fix in one function. Add near `findRecentQuizByPayload`:

```ts
/**
 * Records a freshly issued quiz against the running set, whichever delivery path
 * produced it.
 *
 * This used to happen only inside `issueSetQuestion`, on the history-poll path.
 * But the same payload also arrives through the RTM relay, and when the relay
 * won the race the card went up, the class answered it, and the set held no
 * record of it — so `maybeAdvanceQuizSet` refused to advance and every quiz set
 * silently stopped at its first question. Idempotent, because both paths call it
 * for the same quiz and either may arrive first.
 */
function recordQuizInSet(session: ClassroomSession, quiz: QuizQuestion): void {
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
```

Call it from **both** branches of `applyControl`'s `control.quiz` block:

```ts
const alreadyIssued = findRecentQuizByPayload(session, control.quiz);
if (alreadyIssued) {
  recordQuizInSet(session, alreadyIssued);      // ← the other path got here first
  return { quiz: alreadyIssued };
}
...
broadcastQuiz(session, quiz);
scheduleQuizClose(session, quiz.quizId, quiz.deadline);
recordQuizInSet(session, quiz);                 // ← this path got here first
return { quiz };
```

The existing `set.quizIds.push(...)` inside `issueSetQuestion` becomes redundant
but harmless — `recordQuizInSet` is guarded by `includes`. **Leave it.** Belt and
braces, and removing it is exactly the kind of tidying that caused the original bug.

The `set && set.total > 1` block that sets `setIndex` / `setTotal` in `applyControl`
also becomes redundant. Leave that too.

### 3.2 — Don't destroy a set that already delivered

Replace the give-up branch at line 1712:

```ts
// Give up on this question — but not on a set that has already delivered it.
// `think()` succeeded, so the question may well have been asked and landed via
// the relay path while this poll was failing. Tearing the set down here is what
// turned a recoverable poll failure into a silently truncated quiz: the card was
// on screen, the class answered it, and the set had already been nulled.
const deliveredAnyway =
  session.activeQuizSet === set && set.quizIds.length >= set.asked;

if (!deliveredAnyway && session.activeQuizSet === set) {
  session.activeQuizSet = null;
  publishToTeachers(session.sessionId, {
    kind: 'echosphere:agent-blocked',
    reason: 'QUIZ_PAYLOAD_MISSING',
    at: Date.now(),
  });
}
```

Requires adding `'QUIZ_PAYLOAD_MISSING'` to the blocked-reason union in
`packages/shared-types` and a label wherever the teacher panel renders it.
`SILENCE_GAP_TOO_SHORT` was actively lying to you here — it has nothing to do with
silence gaps.

### 3.3 — Stop a retry hijacking a different set

```ts
async function issueSetQuestion(
  session: ClassroomSession,
  attempt = 1,
  // The set this call is for. Captured by the caller rather than re-read from
  // the session, so a retry cannot silently switch to a DIFFERENT set the
  // teacher started while it was in flight — which is how a retry for a
  // photosynthesis quiz ended up issuing an alphabet one.
  forSet: ClassroomSession['activeQuizSet'] = session.activeQuizSet,
): Promise<boolean> {
  const set = forSet;
  if (!set || session.activeQuizSet !== set) return false;
  ...
  if (attempt < 2 && session.activeQuizSet === set) {
    return issueSetQuestion(session, attempt + 1, set);   // ← pass it through
  }
```

### 3.4 — In-flight guard

Add `issuing?: boolean` to the `activeQuizSet` type in `sessionRegistry.ts`, then
at the top of `issueSetQuestion`:

```ts
// Two concurrent issuances share one `session.pendingQuiz` slot and race for the
// same history turn; the loser used to null the set the winner had just filled.
if (set.issuing) {
  console.warn(
    `[quiz] issueSetQuestion re-entered while in flight for session ${session.sessionId} — ignoring`,
  );
  return true;
}
set.issuing = true;
try {
  // ... existing body ...
} finally {
  set.issuing = false;
}
```

### 3.5 — Shorten the poll *(only after 3.1 is confirmed working)*

With the relay carrying the set, the poll is a backstop rather than a dependency.
At the `pollForPayloadTurn` call site:

```ts
const text = await pollForPayloadTurn(session.sessionId, before, {
  // Was 25s. The relay path now records the quiz against the set independently
  // (`recordQuizInSet`), so this is a backstop for the case where the relay is
  // down — not the thing the feature hangs on. Two attempts at 25s put 50
  // seconds of dead air in front of a teacher with no UI feedback at all.
  timeoutMs: 8_000,
});
```

Removes ~34 seconds of silence per failed question. **Do not do this before 3.1 is
verified live** — until then, the poll is still load-bearing.

### Phase 3 verification

```bash
pnpm --filter @echosphere/orchestrator verify   # quiz.test.ts must stay green
```

Then one live **Start Quiz**. Success looks like:

```
[quiz] payload recovered from agent history …     ← or not; no longer required
[quiz] advancing to question 2 of 3 …
[quiz] advancing to question 3 of 3 …
[quiz] set complete (3 questions) …
```

The point: **`advancing` must now appear even when both `attempt N … (no turn)`
lines do.** That is the whole fix.

---

## Phase 4 — Give the relay a failure state

**Fault C.** The relay genuinely cannot run reliably in a hidden tab — Chrome
clamps timers to once per minute after five minutes hidden, and both the settle
timer and the 150 ms attribution poll run on them. This surfaces it rather than
pretending otherwise.

`ClassroomAudio.tsx` — add an `onRelayHiddenChange?: (hidden: boolean) => void`
prop and:

```ts
// The relay runs on setTimeout/setInterval, which Chrome clamps to >=1s in a
// hidden tab and to once per MINUTE after five minutes hidden. So a backgrounded
// teacher tab freezes the transcript for the entire room — silently, because
// every other signal (RTC, RTM, SSE) stays perfectly healthy. Reported rather
// than worked around: there is no way to run this reliably in a hidden tab.
useEffect(() => {
  if (!isRelay) return;
  const onVis = () => onRelayHiddenChange?.(document.hidden);
  document.addEventListener('visibilitychange', onVis);
  onVis();
  return () => document.removeEventListener('visibilitychange', onVis);
}, [isRelay, onRelayHiddenChange]);
```

Teacher page renders a banner while hidden — *"Transcription is paused while this
tab is in the background. Keep it visible to keep the class transcript live."*

Optional improvement in the same effect: flush all pending turns immediately on
hide, so whatever was mid-sentence survives.

---

## Phase 5 — Explicitly deferred

Listed so nobody re-derives them. **None of these are in scope for this pass.**

| Item | Why not now |
|---|---|
| Changing `remoteUids`, `turnDetection`, `audio_scenario` | Join-config. The current values are the product of a lot of tuning documented in `agentLifecycle.ts:10-36`, and changing them risks the agent itself. The suspected mixed-stream turn-merging under 3–4 open mics is *inferred, not measured* — measure it before touching it. |
| Webhooks instead of in-memory `AgentSession` | The correct production pattern per Agora's docs for stateless deploys, and the real fix for state loss on Render restarts. Substantial change; needs its own plan. |
| Moving relaying off a single browser tab | The right long-term answer to fault C. Needs a server-side RTM consumer, which the browser-only RTM SDK does not currently allow. |
| `ENABLE_AUDIO_PTS` naming | The docs specify `ENABLE_AUDIO_PTS_METADATA`, set *before* `createClient()`; the code sets `ENABLE_AUDIO_PTS` after. Irrelevant in `TEXT` render mode, which is what this app uses. Leave it. |

---

## Execution order & effort

| Phase | Fixes | Risk | Ship separately? |
|---|---|---|---|
| **0** — observability | — | None (no logic change) | **Yes — deploy and run one session before anything else** |
| **1** — echo filter | A | Low, test-covered | Yes |
| **2** — `user_id` + `stream_id` | B, E | Low, additive; 2.1 gated on Phase 0 | Yes |
| **3** — quiz-set independence | F, G | Medium — touches `applyControl` | Yes |
| **4** — relay visibility | C | Low, UI only | Yes |

Phase 0 is non-negotiable and comes first. Everything after it is independently
shippable and independently revertable — if a phase misbehaves, roll back that
phase alone.

After each: `pnpm --filter @echosphere/orchestrator verify`.

---

## What "fixed" looks like

- A student answering a question Athena just asked appears in the transcript,
  under **their own name**, and Athena responds to it.
- **Start Quiz** delivers three questions, every time, whether or not the history
  poll returns anything.
- When something does fail, the orchestrator log names the guard that dropped it
  and the teacher sees a reason that describes what actually happened.

That last one is the real deliverable. The system currently has no way to
represent "this failed" — every failure is byte-identical to "nothing has
happened yet", which is why a teacher can only stand there and wait. Phase 0 is
what changes that, and it is why it goes first.
