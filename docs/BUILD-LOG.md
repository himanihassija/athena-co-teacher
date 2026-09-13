# Echosphere — build log

Everything built in this repository, in the order it happened, with the reason
for each decision and every bug found and fixed along the way. The
[README](../README.md) is the reference for how the system works today; this
file is the narrative of how it got there — useful when a design choice looks
strange out of context and you want to know what it's actually protecting
against.

---

## 1. Scaffold

Started from the official Agora Conversational AI Next.js quickstart, cloned
via the `agora` CLI skill rather than written from scratch — the skill's own
rule is that Agora and RTM code must never be invented from memory, since wrong
field names fail *silently* (a bad token mints fine and then nothing connects;
a missing RTM flag means transcripts just never arrive).

- Created a new Agora project (`athena-echosphere`) with `rtc`, `rtm`, and
  `convoai` features enabled.
- Structured as a pnpm workspace: `apps/web` (the quickstart, extended),
  `apps/orchestrator` (new — the backend the plan calls for), and
  `packages/shared-types` (types shared between them).
- Proved the baseline before customising anything: a stock agent joined a
  channel and held a conversation, using the quickstart's own scaffolding.

## 2. The architecture the plan asked for, adjusted against real constraints

The [implementation plan](PS31-ai-co-teacher-implementation-plan.md) assumed
GPT-4o Realtime and a custom LLM endpoint. Both were reconsidered against what
Agora's platform actually supports and against what credentials this project
has:

- **No OpenAI key exists in this project.** Speech recognition, the language
  model, and the voice are all resold through Agora's own billing —
  Deepgram, `gpt-4o-mini`, and MiniMax behind one agent — mirroring how the
  sibling Athena project runs. This ruled out a custom LLM endpoint outright:
  there is no key to call one with, and no server for Agora's cloud to reach
  even if there were.
- **Consequence: everything the agent knows lives in the system prompt.**
  [`agent/prompt.ts`](../apps/orchestrator/src/agent/prompt.ts) composes it
  fresh — roster with each student's proficiency tag, teacher policy, lesson
  material — and [`agentLifecycle.ts`](../apps/orchestrator/src/agent/agentLifecycle.ts)'s
  `pushInstructions` re-sends it via `session.update()` whenever the classroom
  changes.
- **Structured data comes back out through a side channel, not a custom
  endpoint.** The agent runs with MiniMax `skipPatterns: [5]`, so the engine
  strips `{ }` content before speech synthesis while the RTM transcript still
  carries the full text. The agent appends one JSON object per turn — who it's
  answering, a detected learning gap, a quiz question — inaudible to the room,
  visible to the orchestrator. Contract in `prompt.ts`, reader in
  [`agent/control.ts`](../apps/orchestrator/src/agent/control.ts).
- **RTM is client-side only.** Agora's RTM SDK has no server variant, so the
  orchestrator cannot publish control events to it. The control path is
  **SSE** (`/api/sessions/:id/events`) instead; RTM is still used for what it's
  good at, carrying the agent's own transcripts and state to the browser.
- **The pipeline is cascading (Deepgram → LLM → MiniMax), not GPT-4o
  Realtime.** Realtime is an MLLM with no custom-LLM hook and no `/speak`,
  which would have cost the entire control channel and forced-speech path.

## 3. Core systems

- **Floor state machine** — [`floor/floorMachine.ts`](../apps/orchestrator/src/floor/floorMachine.ts).
  A pure function `(snapshot, policy, trigger) → decision`. `decideSpeak` is
  the only function that grants permission to speak; every caller in the
  codebase goes through `requestFloor` in
  [`classroomController.ts`](../apps/orchestrator/src/classroomController.ts),
  so a mute can never be bypassed by a code path that forgot to check it.
- **Quiz engine** — [`quiz/quizEngine.ts`](../apps/orchestrator/src/quiz/quizEngine.ts).
  Quiz JSON arrives on the control channel rather than a separate structured
  call, so the spoken question and the on-screen card are guaranteed to match.
  Voice answers are normalised (letter, number, or spoken option text) and
  scored the same as a tapped answer.
- **Gap detector** — [`gaps/gapDetector.ts`](../apps/orchestrator/src/gaps/gapDetector.ts).
  Clusters wrong quiz answers and confused-sounding questions by topic;
  surfaces a class-wide gap to the teacher dashboard and, separately, to the
  floor machine as a legitimate reason for the agent to interject during a
  silence.
- **Post-class report** — [`report/summary.ts`](../apps/orchestrator/src/report/summary.ts).
  Deterministic, not a batch LLM call — there is nothing to call it with.
  Every number in it (who struggled, with what, how often) was already
  structured data by the time the lesson ended.
- **Lesson material** — [`lesson/lessonStore.ts`](../apps/orchestrator/src/lesson/lessonStore.ts).
  Keyword-overlap retrieval, not embeddings, for the same reason: no key for a
  vector call. Material that fits the prompt budget goes in whole.

## 4. Bugs found and fixed, in the order they surfaced

Each of these was found by tracing actual behaviour — either a live symptom
reported during testing, or a specific claim verified against Agora's own REST
docs — not guessed at.

### Plumbing / infrastructure

- **Turbopack couldn't resolve `next` from `apps/web`.** In a pnpm workspace,
  `next` lives in the workspace root's `node_modules/.pnpm` store; a
  `turbopack.root` pointed at the app directory couldn't follow that link.
  Fixed by pointing it at the workspace root.
- **`pnpm --filter @echosphere/orchestrator dev` never loaded `.env`.** The
  script was bare `tsx watch src/server.ts`; every restart in this session had
  been done by hand with `--env-file=.env`, but the actual script never got
  fixed until a user ran the documented command and hit
  `Missing required environment variable`. Fixed with Node's native
  `--env-file-if-exists`, which doesn't hard-fail when the file is absent
  (CI, or real env vars injected another way).
- **The SSE control route had no CORS headers.** Writing directly to
  `reply.raw` bypasses Fastify's reply object, and with it everything
  `@fastify/cors` would have attached. Every ordinary route worked; the one
  route the browser opens as an `EventSource` was silently refused, which
  looked like permanent "reconnecting…". Fixed by setting the headers
  explicitly on that one response.
- **Teacher controls were hidden behind the RTM connection.** The whole
  control panel was nested inside `ClassroomShell`'s render callback, which
  shows "Connecting…" until RTM resolves — so an RTM hiccup hid the one
  button (mute) that could have fixed it. Starting/muting the agent is plain
  HTTP and needs no RTM; `ClassroomShell` now wraps only the audio component.

### The audio/transcript pipeline

- **Nobody could hear anyone.** `useJoin` and `usePublish` get audio in and
  out of the RTC channel but play nothing back. The official quickstart
  renders `<RemoteUser>` per remote participant, which is what actually
  subscribes and plays; it had been dropped in the classroom rewrite. Fixed
  by rendering `<RemoteUser playAudio>` for every remote user.
- **The room was silent with no transcripts at all, including Athena's own
  greeting.** `AgoraVoiceAI.init()` does not subscribe to anything — a
  separate `subscribeMessage(channel)` call binds the toolkit's RTC/RTM
  handlers and starts the transcript renderer. It had been dropped in the same
  rewrite. Nothing errored; the pipeline just never started.
- **The greeting arrived as `"Hi everyone,"` and stopped.** The client
  deduped relayed turns by `turn_id` on first sight, but the toolkit re-emits
  a turn as more of it arrives — the same `turn_id`, longer text each time.
  Fixed by holding a turn until its text stops changing (a 1.2s debounce) with
  a 2.5s ceiling so a long, unbroken answer still updates live instead of
  staying invisible until the speaker finally pauses.
- **One utterance showed up twice, under two different names.** The toolkit
  reports every human turn as uid `"0"` — built for a 1:1 call, no notion of
  who among several people is talking — so whichever browser relayed it
  claimed it as its own speech. Fixed by having only the teacher's browser
  relay, and resolving the real speaker by polling `getVolumeLevel()` on the
  local mic and every remote track (Agora's built-in `volume-indicator` event
  is fixed at a 2-second interval by the SDK, confirmed in its own typings —
  too coarse for a fast handoff between speakers).
- **Athena's own answer was logged as the teacher speaking.** When a turn is
  started by an injected instruction (`FORCE_AGENT_SPEAK`), the engine treats
  that instruction as user input and her reply comes back on the *same*
  `turn_id`, under uid `"0"`. Pending turns were keyed on `turn_id` alone, so
  her reply inherited the instruction's attribution. Fixed by keying on
  `turn_id` **and** which side spoke (`metadata.object`, the actual
  discriminator — not `uid`), on both client and server.
- **The RTM client crashed the page (`Invalid typed array length`).**
  `subscribeMessage` was being called once per mount on a *shared, singleton*
  toolkit instance, double-binding its RTM chunk reassembler and desyncing
  partial-message state. Fixed by binding it once, inside the singleton's own
  lifecycle, not per mount.
- **A duplicate-RTM-instance warning, escalating to "already connected
  somewhere else."** React StrictMode's discarded mount ran cleanup
  *synchronously*, before the real mount finished — so a naive per-mount
  teardown released a connection the real mount was still using. Fixed with a
  module-level, reference-counted client registry (for both the RTM client and
  the `AgoraVoiceAI` toolkit instance) with a short grace period before actual
  teardown, so a remount rejoins the live connection instead of racing it.

### Turn-taking and permissions

- **A real, long answer was interrupted mid-sentence for no visible reason.**
  Enforcement (`handleAgentState` in `classroomController.ts`) re-validated a
  speaking permit's TTL against every `AGENT_STATE_CHANGED` event, including
  ones that fire mid-turn. ASR settle + LLM generation + several seconds of
  speech routinely outlives a short window. Fixed by separating "may this
  turn *begin*" (bounded by the TTL) from "is this turn *already running*"
  (`authorizedTurnInProgress`) — once a turn starts, only an explicit mute,
  barge-in, or floor-close can end it early, never a stale clock read.
- **The greeting itself was cut off at "Hi everyone,"** by the same
  enforcement, because it had no permit at all — nobody had "addressed" the
  agent to summon it, it happens automatically when she joins. Fixed by
  granting a permit at the moment the agent is started.
- **The teacher could never address the agent by voice, even with the floor
  open.** The wake-word check only ran inside a `role === 'student'` branch;
  a teacher saying "Athena, can you hear me?" was logged and then silently
  ignored. `studentsMayInvoke` was meant to gate *student* self-service
  access to the floor; it was accidentally gating the teacher's own. Fixed by
  moving the addressing check above the role branch — the teacher may always
  call on the agent; the gate applies only to students.
- **The engine's own barge-in fires for any participant, not just the
  teacher.** Verified against Agora's live REST docs rather than assumed:
  `interrupt_duration_ms` triggers on *any* subscribed remote uid, with no
  per-participant scoping in the API — a platform limitation, not a bug in
  this codebase. A student's one-word backchannel could silence Athena
  mid-answer exactly like a real teacher interruption. Mitigated, not solved:
  both `interrupt_duration_ms` and `silence_duration_ms` are set to Agora's
  documented ceiling (`1200`ms / `2000`ms) to make the misfire rarer. The
  orchestrator's own `interruptAgent()` call, gated to the teacher's role in
  `onTeacherBargeIn`, remains the one barge-in path that is actually
  speaker-scoped.
- **`session.update()` silently erased the model.** Agora's `/update`
  endpoint replaces `llm.params` wholesale rather than merging it; a call that
  omitted `model` deleted it from the running agent. This runs whenever the
  roster changes — so the agent worked perfectly alone and broke the instant
  a second person joined, answering every turn with the configured failure
  message. Fixed by including the full `params` object, `model` included,
  on every `pushInstructions` call.
- **A student's repeated question was silently dropped.** The transcript
  duplicate-filter treated identical text within the last 30 segments as a
  relay artefact — but people repeat themselves, especially when the first
  attempt wasn't answered. Fixed by bounding the text-match duplicate check to
  a 4-second window; only `(uid, turnId)` matches are treated as unconditional
  duplicates.

## 5. Ported from a sibling Agora ConvoAI project

A second hackathon project on the same stack (`subinsk/kkt`, a live game show
with an AI host and three phone-in contestants) was cloned and read for
comparison. Two of its patterns were adapted here — not copied outright, since
neither its exact palette nor its per-device telemetry maps onto this
project's architecture:

- **Self-echo filtering** — [`agent/echo.ts`](../apps/orchestrator/src/agent/echo.ts).
  Athena's TTS, played out of a shared speaker, can be picked up by an open mic
  and misread as human speech — the setup this project assumes (a teacher and
  students in one room on laptop speakers) makes this a real risk, not a
  hypothetical one. The core lesson carried over from their own documented bug
  history: a boolean "is this an echo" throws away a real answer spoken over
  the tail of Athena's sentence along with the echo. This returns the
  *remainder* instead, cutting only the matched span.
- **Confidence-scored, contested attribution.** Their solution has each
  contestant's own phone self-report its mic level over HTTP; this project has
  no equivalent per-participant channel, only one listening browser's view of
  everyone else's remote tracks. What was ported honestly is the *output
  shape* — track the runner-up candidate, not only the winner, and compute
  confidence as `best / (best + second)` — applied to the signal this project
  actually has. A close call now reaches the transcript tagged with
  `attributionConfidence`, and the UI marks it "unclear who" rather than
  presenting a guess as settled fact.

## 6. UI / UX

Built the same way their design system was: two concrete reference points,
stated explicitly, rather than a mood board of adjectives.

- **A community radio broadcast desk** — the product is audio-only by
  decision, so the interface should look like it belongs to something that
  transmits sound, not a video-call client with the video removed.
- **A study lamp on a desk at night** — pulls it back from cold broadcast
  chrome toward something a classroom can actually sit in.

The accent color is a tube-radio "magic eye" tuning glow — the one color idea
that is load-bearing for the product metaphor, since Athena being *tuned in
and listening* is the whole turn-taking design. Warm near-black ground (never
blue-black), soft rounded panels everywhere except the one deliberately
circular mic button, tabular numerals for anything that counts, and a
persistent seat color per participant so a name is never the only thing
distinguishing two people in a fast-moving transcript.

Tokens and utility classes in [`app/globals.css`](../apps/web/app/globals.css)
(`--eco-*` custom properties, additive — the original quickstart's unrouted
landing page still reads its own token set undisturbed). Fonts: Big Shoulders
for display type, IBM Plex Sans for the transcript's continuous reading text.
Seat-color assignment in [`lib/seatColor.ts`](../apps/web/lib/seatColor.ts).

Every page and shared panel was restyled: [`join/page.tsx`](../apps/web/app/join/page.tsx),
[`components/classroom/panels.tsx`](../apps/web/components/classroom/panels.tsx)
(floor indicator, roster, transcript, quiz cards, gap panel, blocked-attempts
log), [`TeacherControlPanel.tsx`](../apps/web/components/classroom/TeacherControlPanel.tsx),
and both `[sessionId]` page shells — logic and handlers untouched throughout,
only presentation.

## 7. Testing infrastructure

None of this existed at the start; all of it was built specifically because
static checks kept missing real, live-only failures.

| Suite | What it proves | Needs |
|---|---|---|
| [`control.test.ts`](../apps/orchestrator/scripts/control.test.ts) | The brace control-channel parser: strips payloads, survives apostrophes and malformed JSON, never reads two objects | nothing |
| [`floor.test.ts`](../apps/orchestrator/scripts/floor.test.ts) | Permit/enforcement logic, including the exact mid-turn-cutoff and teacher-addressing regressions | nothing |
| [`echo.test.ts`](../apps/orchestrator/scripts/echo.test.ts) | Self-echo filtering, including the mixed-turn case (real answer spoken over an echo) | nothing |
| [`classroom.e2e.ts`](../apps/web/scripts/classroom.e2e.ts) | A real browser joins as teacher and student; catches duplicate RTM instances, CORS-refused SSE, hidden controls | both servers running |
| [`roundtrip.e2e.ts`](../apps/web/scripts/roundtrip.e2e.ts) | A live agent speaks and its words come back through RTM, with a student in the room (the step that triggers `session.update()`) and the teacher gate exercised both ways | both servers, Agora minutes |
| [`speech.e2e.ts`](../apps/web/scripts/speech.e2e.ts) | Real synthesised speech through a fake microphone, proving ASR actually transcribes | both servers, Agora minutes, a `.wav` fixture |

Run everything:

```bash
pnpm -r typecheck
pnpm --filter @echosphere/orchestrator test
pnpm --filter @echosphere/web lint
pnpm --filter @echosphere/web build
pnpm --filter @echosphere/web test:e2e
pnpm --filter @echosphere/web test:roundtrip
```

## 8. Where things stand

All of the above is implemented and currently passing: 27 static tests across
three files, 20 browser-driven checks, 11 live round-trip checks against a
real agent, clean typecheck across all three workspace packages, clean lint,
clean build.

What is explicitly **not** done, and why — see the README's own "Known gaps"
section for the fuller list:

- State is in-process and lost on orchestrator restart; nothing is persisted.
- Engine-level barge-in cannot be scoped to the teacher — an Agora platform
  limit, mitigated but not solved (§4 above).
- The post-class narrative is computed from structured data, not written by a
  model — there is no key to write it with.
- Retrieval is keyword overlap, not embeddings, for the same reason.
