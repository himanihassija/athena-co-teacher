# Athena — Voice AI Co-Teacher

A live, **audio-only** classroom where a teacher, several students, and an AI
co-teacher named **Athena** share one Agora voice channel. Athena listens to the
whole lesson, answers when she's called on, runs spoken quizzes, tracks who is
struggling, and hands the teacher a post-class summary — while the teacher keeps
a hard mute and override at all times.

Built for PS31 against
[`docs/PS31-ai-co-teacher-implementation-plan.md`](docs/PS31-ai-co-teacher-implementation-plan.md).
For the full story of every bug and fix, see [`docs/BUILD-LOG.md`](docs/BUILD-LOG.md).

**No API keys beyond Agora.** Speech recognition, the language model, and the
voice are all resold through the Agora project — Deepgram, `gpt-4o-mini`, and
MiniMax behind one agent. Nothing here calls OpenAI, or any other vendor,
directly.

---

## Quick start

### 1. Credentials

You need one Agora project with **RTC + RTM + Conversational AI** enabled.

```bash
agora login
agora project create classroom-coteacher --feature rtc --feature convoai   # convoai implies rtm
agora project use classroom-coteacher
agora project env --with-secrets                                            # prints App ID + App Certificate
```

Then **hand-edit both env files** with those two values (the CLI's
`agora project env write` emits `AGORA_APP_ID` / `AGORA_APP_CERTIFICATE`, but
this repo reads the `NEXT_`-prefixed names):

`apps/web/.env.local`
```
NEXT_PUBLIC_AGORA_APP_ID=<App ID>
NEXT_AGORA_APP_CERTIFICATE=<App Certificate>
NEXT_PUBLIC_ORCHESTRATOR_URL=http://localhost:8787
```

`apps/orchestrator/.env`
```
NEXT_PUBLIC_AGORA_APP_ID=<App ID>
NEXT_AGORA_APP_CERTIFICATE=<App Certificate>
PORT=8787
CORS_ORIGINS=http://localhost:3000
LLM_MODEL=gpt-4o-mini
```

No Customer ID / Secret is needed — the `agora-agents` SDK runs in App
Credentials mode and mints the ConvoAI token itself.

> **After changing credentials, fully restart both servers.** `NEXT_PUBLIC_*` is
> baked in when the web server starts.

### 2. Install and run

```bash
pnpm install
```

**Start both (one terminal):**
```bash
pnpm run dev:classroom      # orchestrator :8787 + web :3000, in parallel
```

**Or one each, if you want their logs separate:**
```bash
# Terminal 1 — orchestration backend on :8787
pnpm --filter @echosphere/orchestrator dev

# Terminal 2 — web app on :3000
pnpm --filter @echosphere/web dev
```

Open <http://localhost:3000/join>.

**Stop both:**
```bash
pkill -f "src/server.ts"     # orchestrator
pkill -f "src/server.ts"          # web
```

Confirm they are actually down before restarting — a half-dead process holding
a port is the usual reason a fresh start fails with `EADDRINUSE`:
```bash
lsof -nP -iTCP:8787 -sTCP:LISTEN   # orchestrator; no output = stopped
lsof -nP -iTCP:3000 -sTCP:LISTEN   # web
```

> **Ctrl-C on the orchestrator does not always finish.** It runs under
> `tsx --watch`, and an open SSE connection from a browser tab keeps the process
> alive, so shutdown can hang at `Waiting for graceful termination...`. The same
> applies to the automatic restart after you edit a file under
> `apps/orchestrator/src/` — it can stall instead of coming back, leaving
> nothing listening on :8787. If that happens, `pkill -f "src/server.ts"` and
> start it again.

> **Restarting the orchestrator wipes every live classroom.** Sessions, the
> transcript, quizzes and the whiteboard scene are held in memory in
> `sessionRegistry.ts`, not in Postgres, so a restart ends any lesson in
> progress. Avoid editing orchestrator source while a session you care about is
> running.

### 3. For a demo or when sharing — run production, not dev

`next dev`'s Fast Refresh re-evaluates modules on every edit, which over a long
session desyncs the RTM client and produces `Ins id is 2` / `Offset is outside
the bounds of the DataView` errors in the console. For anything you're showing
or sharing, run the production build instead:

```bash
pnpm --filter @echosphere/web build
pnpm --filter @echosphere/web start     # :3000, no Fast Refresh
```

### 4. Sharing the frontend with someone else

It's a **two-service app** — the other person's browser must reach both `:3000`
(web) *and* `:8787` (orchestrator). Agora audio/transcripts connect
browser→Agora directly, so those work across machines automatically.

**Same wifi:** set `NEXT_PUBLIC_ORCHESTRATOR_URL=http://<your-lan-ip>:8787` in
`apps/web/.env.local`, add `http://<your-lan-ip>:3000` to `CORS_ORIGINS`,
restart both, share `http://<your-lan-ip>:3000/join`.

**Anywhere (tunnel):**
```bash
brew install cloudflared
cloudflared tunnel --url http://localhost:8787   # -> ORCHESTRATOR url
cloudflared tunnel --url http://localhost:3000   # -> WEB url
```
Then point `NEXT_PUBLIC_ORCHESTRATOR_URL` at the orchestrator tunnel, add the
web tunnel origin to `CORS_ORIGINS` (exact, `https://`, no trailing slash),
restart both. Both must be tunnelled — an `https://` page can't call
`http://localhost`.

---

## Running a lesson

1. **Teacher** joins in one browser profile (`/join` → name → *Teacher* → *Start
   fractions demo (LCD)* or type a title). Lands on `/teacher/<id>`.
2. **Students** join in separate profiles / incognito windows (each needs a
   distinct browser session — Agora rejects a duplicated identity). They land on
   `/classroom/<id>`.
3. Teacher presses **Bring Athena in**. Her greeting plays in every browser and
   appears in the transcript.
4. By default the floor is **closed to students** — Athena listens and builds
   context but only the teacher can call on her. Toggle **Let students ask** to
   open it; then a student saying *"Athena, …"* gets an answer.
5. **Start Quiz** (with a topic) → Athena asks a **set of 3 questions**, one at a
   time. Each pops a card for every student with a 15-second countdown; when
   everyone answers or the timer runs out it reveals the answer and advances.
6. **Mute Athena** cuts her off mid-sentence and is an absolute veto until you
   press Resume.
7. **End lesson** generates the post-class summary inline.

Athena being *tuned in and listening but silent* is the design — a lesson where
she says nothing is a success, not a failure.

---

## Architecture at a glance

```
apps/web           Next.js frontend (extended from the Agora ConvoAI quickstart)
apps/orchestrator  Long-lived Node service — the brain:
                     roles · floor state machine · lesson material · quiz engine
                     · gap detector · post-class report
packages/shared-types  Domain types shared by both
```

**Audio** flows over Agora RTC. Every browser subscribes to every other
participant plus Athena; there is no video anywhere.

**Athena** is a single `agora-agents` ConvoAI agent (Deepgram → `gpt-4o-mini` →
MiniMax) that the teacher's browser starts. She joins with `remoteUids: ['*']`
so she hears the whole room.

**The control path is SSE, not RTM.** Agora's RTM SDK is browser-only, so the
orchestrator can't publish to the channel. It fans classroom events
(roster, floor state, quiz cards, gaps, policy) out over
`GET /api/sessions/:id/events` and takes commands back over plain HTTP. RTM is
still used for what it's good at — carrying Athena's own transcripts and state
from Agora's engine to the browser, which the teacher's tab relays back to the
orchestrator.

**Everything Athena knows lives in her system prompt.** With no custom LLM
endpoint, the orchestrator composes the whole classroom — roster with each
student's level, teacher policy, lesson material — into the prompt and re-pushes
it with `session.update()` whenever any of it changes. Inspect the live prompt
with `GET /api/sessions/:id/prompt`.

**Structured data comes back through the agent's history.** Athena appends one
JSON object per turn — the quiz she just asked, a gap she noticed, who she's
answering. MiniMax `skipPatterns: [5]` keeps it out of the spoken audio. The
orchestrator reads it from `agentSession.getHistory()` (the raw LLM output),
because the engine also strips it from the RTM transcript the browser relays.

### Turn-taking

The rule the plan cares most about — *no code path can let Athena speak while
muted* — is structural:

- `decideSpeak` in [`floor/floorMachine.ts`](apps/orchestrator/src/floor/floorMachine.ts)
  is the only function that grants permission; it checks `policy.muted` first
  and returns a discriminated union, not a boolean.
- `requestFloor` in [`classroomController.ts`](apps/orchestrator/src/classroomController.ts)
  is its only caller — one door for every path that can make Athena talk.
- Denials are broadcast to the teacher panel, so a blocked attempt is visible.

The floor machine is a pure function of `(snapshot, policy, input)`, tested
without an Agora connection ([`floor.test.ts`](apps/orchestrator/scripts/floor.test.ts),
[`floorMachine.test.ts`](apps/orchestrator/scripts/floorMachine.test.ts)).

Two things the plan didn't anticipate:

- **ConvoAI answers on its own initiative** — it never asks the orchestrator
  first. The orchestrator's lever is after the fact: the browser relays
  `AGENT_STATE_CHANGED`, and `handleAgentState` interrupts a turn that had no
  permit. A turn once *authorized* runs to completion — only an explicit mute,
  barge-in, or floor-close ends it early, never a stale clock read.
- **The engine can't tell the teacher from a student** (it has no speaker
  identity), so with the floor closed it stays silent even for the teacher. When
  the orchestrator sees the *teacher* address Athena by name it drives the reply
  explicitly with a `[classroom:system]` directive.

### Engine-level barge-in is not speaker-scoped

`interrupt_duration_ms` fires for *any* subscribed uid — a multi-party room
needs `remoteUids: ['*']`, so a student's stray "okay" mid-answer is
indistinguishable at the engine level from a teacher barging in. Both VAD
thresholds are pinned to Agora's documented ceiling to make the misfire rare;
the orchestrator's own `interruptAgent()`, gated to the teacher in
`onTeacherBargeIn`, is the one barge-in path that *is* speaker-scoped. A
platform limitation, mitigated not fixed.

---

## Verification

```bash
pnpm -r typecheck
pnpm -r lint
pnpm --filter @echosphere/orchestrator test     # 80 checks — control parser, floor/permit, quiz set, tokens
pnpm --filter @echosphere/web build
pnpm --filter @echosphere/web test:e2e          # real browser, both servers up, fake mic
pnpm --filter @echosphere/web test:roundtrip    # live agent: she speaks, words + quiz card come back (Agora minutes)
```

`test:roundtrip` is the one that matters. It puts a **student** in the room
(which triggers `session.update()`), starts the agent, and asserts her words —
and a quiz card, with its countdown — come back through the full pipeline. Every
serious bug in this project passed typecheck, lint, and the API tests and only
showed up here.

---

## What works, and what doesn't

| Area | State |
|---|---|
| Multi-party RTC, teacher/student roles, identity | ✅ |
| Turn-taking — mute, floor, teacher override, per-turn authorization | ✅ solid |
| Spoken quizzes — 3-question sets, 15s timer, voice or tap answers, auto-advance | ✅ |
| Lesson grounding — teacher's material in the prompt, her terminology | ✅ |
| Per-student explanation depth — level tags in the roster, live retag | ✅ |
| Post-class summary — per-student stats, gaps, concept mastery | ✅ (narrative is templated, not LLM-written — nothing to call) |
| Multilingual | ⚠️ one language at a time via `STT_LANGUAGE` (`hi`, `es`, …). Deepgram's `multi` code-switch mode returns nothing through the resale path — do not use it. |
| `{to}` / `{gap}` on ordinary turns | ⚠️ still read from the RTM relay, which strips them — so live "who is she answering" attribution and agent-noticed gaps are unreliable. Quiz payloads are read from history and work. |
| Restraint Meter | the orb reflects real floor decisions (listening / speaking / held-back); the LLM "intervention gate" behind it stays dormant (needs a public tunnel + BYOK key). |
| Persistence | in-memory; lost on orchestrator restart unless `DATABASE_URL` is set (Postgres schema + migration exist). A second replica would need sticky routing by `sessionId`. |
| Transcription quality | the browser tests use a fake tone, so they prove the pipeline connects but not how well real speech transcribes. |

The quickstart's original 1:1 routes (`app/api/invite-agent`, etc.) are still
present and still work, but aren't wired to any page — kept as the proven
baseline reference.
