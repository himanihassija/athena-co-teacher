# Athena Echosphere — Engineering Handoff

A live, audio-first classroom on Agora. A teacher, several students, and an AI co-teacher named
**Athena** share one voice channel, one whiteboard, and one sticky-note workspace. Athena hears
the whole lesson and speaks only when invited — the teacher keeps a hard mute and override at
all times.

| | |
|---|---|
| **Branch** | `merge-himani-fixes` |
| **Head** | `c20ef22` (pushed; `origin/merge-himani-fixes` is identical) |
| **Contains** | all of `master`, `exali`, `himani` — 69 commits ahead of `master`, 0 behind |
| **Orchestrator tests** | 127 passing, 11 suites |
| **Typecheck** | clean (3 workspaces) |
| **Lint** | clean (web only; orchestrator has no lint) |
| **Production build** | passing, 8 routes |

Every figure above was produced by running the command shown in §7 against the working tree at
`c20ef22`. Anything unverified is called out as such.

---

## 1. Read this first

The four things that will otherwise cost you an afternoon.

**There are two separate model paths, and they do not share a key.** Athena's *in-call voice*
runs through Agora ConvoAI — speech recognition, model and voice are all billed through the
Agora project, and the model must be one Agora resells (`LLM_MODEL`, default `gpt-4o-mini`).
Everything *outside* the call — the catch-up chatbot, teaching assistant, absent-student packet,
targeted readings, translation, end-of-session report — goes through
`orchestrator/src/llm/complete.ts`, which takes a direct vendor key. Changing `LLM_MODEL` does
not change the chatbot, and setting `GEMINI_API_KEY` does not change Athena's voice.

**The direct LLM layer picks a provider by first key present, in a fixed order:** Gemini →
Anthropic → OpenAI → Groq → DeepSeek → Sarvam. There is no provider setting; if two keys are in
`.env`, the earlier one silently wins. If a feature is answering in an unexpected style, check
which key is set before touching prompts.

**The orchestrator has no build step.** It runs TypeScript directly through `tsx`.
`pnpm --filter @echosphere/orchestrator build` fails because no such script exists, not because
anything is broken. Only the Next.js app builds.

**Turn-taking is enforced in two independent layers, and they are not redundant.** The floor
state machine decides whether a request to speak is issued at all; the prompt only shapes what
gets said once permission exists. The prompt is advisory, the state machine is binding. Never
rely on prompt wording to keep Athena quiet.

---

## 2. Getting it running

Two processes. Roughly five minutes from a clean clone.

```bash
pnpm install
pnpm run dev:classroom   # orchestrator :8787 + web :3000
```

Then open <http://localhost:3000/join>. Open the teacher in one browser profile and each student
in another — see the tab-duplication trap in §5.

### Credentials

Both apps read Agora credentials. The orchestrator reads `NEXT_`-prefixed names to match the web
app — a known wart, noted in its own `.env`.

| Variable | Where | Required | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_AGORA_APP_ID` | both | **yes** | |
| `NEXT_AGORA_APP_CERTIFICATE` | both | **yes** | server-side only |
| `NEXT_PUBLIC_ORCHESTRATOR_URL` | web | **yes** | |
| `PORT` / `CORS_ORIGINS` | orchestrator | **yes** | CORS defaults to `http://localhost:3000` |
| `LLM_MODEL` | orchestrator | defaulted | Athena's in-call model; must be Agora-resold |
| `GEMINI_API_KEY` (or `ANTHROPIC_`/`OPENAI_`/`GROQ_`/`DEEPSEEK_`/`SARVAM_API_KEY`) | orchestrator | optional | out-of-call features; first one present wins |
| `SARVAM_API_KEY` | orchestrator | optional | also switches Athena's STT+TTS to Hindi |
| `RESEND_API_KEY` | orchestrator | optional | absent-student packets actually email |
| `DATABASE_URL` | orchestrator | optional | Postgres persistence; unset = no-op |
| `NEXT_LLM_API_KEY` / `NEXT_LLM_URL` | web | optional | only for the custom-LLM ConvoAI route |

`LLM_MODEL` must be one Agora resells: `gpt-4o-mini`, `gpt-4.1-mini`, `gpt-5-nano` or
`gpt-5-mini`. Everything optional degrades gracefully — no key means the feature falls back to a
template or a no-op rather than erroring.

---

## 3. How a quiz actually works

The most load-bearing and least obvious path in the system.

There is no second model call. Athena appends a JSON object to her spoken turn, and the TTS
engine's `skipPatterns` strips curly-brace content before speech synthesis. So the object never
reaches the room's ears but does reach the orchestrator. **One brace pair per turn only** — the
engine skips the first outermost pair, so a second object would be read aloud.

That payload reaches `applyControl` by **two independent paths**:

1. the agent-history poll in `issueSetQuestion`
2. the relayed RTM transcript in `ingestAgentTurn`

Neither can be removed — the poll is the reliable one for a teacher-started quiz set, but a quiz
Athena poses unprompted is only ever seen via the relay. They are de-duplicated on the payload
itself.

> **If quiz cards start duplicating again,** that de-duplication is the first place to look:
> `isDuplicateQuizPayload` in `classroomController.ts`. Both delivery paths mint their own
> `quizId`, so without the guard one spoken turn becomes two cards carrying the same
> "Question N of M". The `quiz` suite has four tests pinning this behaviour.

---

## 4. The whiteboard is Excalidraw, not Netless

Worth knowing before you read `src/whiteboard/`.

The client canvas is `@excalidraw/excalidraw`, rendered in `ExcalidrawBoard.tsx` and presented
like a screen share. Excalidraw's open-source package is a *local* canvas — multiplayer is not
included and the host owns the transport — so sync runs over the same SSE bus as everything
else: local edits are throttled to ~10 posts/second and POSTed, the orchestrator merges them
into the authoritative scene and rebroadcasts, and remote edits arrive back through
`updateScene`. Two guards matter: only genuinely changed elements are sent (compared by
Excalidraw's own `version` counter), and writes are suppressed while a remote scene is being
applied, or applying one would echo straight back as a fresh local edit.

The old Agora Interactive Whiteboard/Netless integration has been removed. The classroom board
is Excalidraw rendered locally and synchronized through the orchestrator's SSE scene events, so
there are no `WHITEBOARD_*` credentials or separate room tokens to configure.

---

## 5. Traps that have already cost time

Each of these was diagnosed the slow way. None is obvious from the code.

### The dev server and the production build use different bundlers

`next dev --webpack` uses webpack; `next build` on Next 16 defaults to **Turbopack**. A
`webpack:` key in `next.config.mjs` is therefore *silently ignored at build time*. This is
exactly how an earlier whiteboard branch shipped code that ran perfectly in dev and failed every
production build. If something works locally and dies in CI, check this first.

### The dev server caches `tailwind.config.ts`

Editing `fontFamily` or theme values does not hot-reload reliably. A browser check once reported
the *old* font stack and looked like a genuine failure until the server was restarted. Restart
`dev` before trusting any config-level styling result.

### Duplicating a browser tab breaks Agora RTM

Duplicating copies `sessionStorage`, and therefore the stored identity. Agora permits each
participant one connection, so the second tab collides (`-10027`). `ClassroomShell`
reference-counts one RTM client per `(app, uid, channel)` with a 3 s dispose grace period,
because React StrictMode runs the fake unmount's cleanup *synchronously* before the real mount.
Use a separate browser profile or a private window for a second student.

### RTM socket timeouts are a network problem, not a code problem

`socket connection error, errorInfo: Timeout has occurred` means the SDK could not reach an
Agora edge before its connect timeout. Auth failures look different (`-10005` / `-10008` at
login). It is almost always a firewall, VPN or campus network that does not allowlist Agora. The
SDK retries; a single occurrence followed by a successful connect is harmless. If RTM never
connects the room degrades to silent-classroom-over-HTTP rather than failing outright.

### Neural TTS mangles isolated letters

A bare `"D."` carries almost no context, so the engine falls back to whatever letter-name
reading is most probable — on a multilingual voice that can be another language's inventory
entirely (a live session produced "shahar" for D). The quiz directive instructs Athena to say
**"Option A"**, never a bare letter. Full option text was never affected.

### Reasoning models can return an empty string

Reasoning tokens are charged against the completion budget without ever appearing in `content`,
so at a tight `maxTokens` cap a model can spend the whole budget thinking and reply blank —
which reads as a broken provider rather than too small a cap. `isReasoningModel` in
`llm/complete.ts` matches `gpt-oss|qwen3|reasoner|thinking` and grants extra headroom. **If you
add a reasoning model whose name does not match that pattern, add it** — the symptom is a
feature that silently produces nothing.

### The quiz answer key is generated, not computed

Nothing server-side can validate it without a second model call. The control contract once
hardcoded `"answer":"B"` in both the schema and its only worked example, and the model anchored
on it — marking correct students wrong. The example now answers `C` and the model is told to
count its own options. **This is mitigation, not a fix.** If wrong answer keys recur, the robust
change is to have Athena state the correct option's *text* rather than its letter, so position
errors become impossible.

---

## 6. Recent work

The last stretch, newest first.

| Commit | What it did |
|---|---|
| `c20ef22` | Groq retired `llama-3.3-70b-versatile`, so the hardcoded default 404'd for anyone without `GROQ_MODEL` set; now `openai/gpt-oss-120b`. Added the reasoning-token headroom described above. |
| `b200033` | Sticky-note text overflow, absent-dispatcher email actually sent via Resend, UI layout, Athena avatar Lottie animation. |
| `e6b408e` | "exali integration" — floor handling in `classroomController`, agent lifecycle, and `board.e2e.ts`, which reads pixels off the canvas to prove a mid-lesson joiner sees the board. |
| `76b3700` | Blank whiteboard for students joining mid-lesson: the scene arrived, but the effect that paints it ran before Excalidraw handed over its API and never re-ran. |
| `4e4d593`, `56f2516` | One agent turn stored many times; duplicate React key in the blocked-attempts list. |
| `276e29f` | A gap in agent state was cutting off an already-authorised turn. |
| `12a07b9`, `1683847` | Native Gemini 3.6/3.7 Flash support, then `maxOutputTokens` raised so reasoning truncation stopped clipping replies. |
| `612b0ae` and around | The Excalidraw board: shared scene, presented like a screen share, with Athena able to annotate. |

Feature surface now spans the voice classroom, quizzes, shared whiteboard, sticky-note workspace,
screen share, hand-raise, catch-up chatbot and booking, absent-student packets, teaching
assistant, targeted readings, gap detection and an end-of-session report — roughly 50 orchestrator
routes in `src/routes/classroom.ts`.

---

## 7. Verifying a change

Run the narrowest thing that covers what you touched, then the gate. All four pass at `c20ef22`.

```bash
pnpm run typecheck                              # all 3 workspaces
pnpm run lint                                   # web only; orchestrator has none
pnpm --filter @echosphere/orchestrator test     # 127 tests, needs .env
pnpm --filter @echosphere/web build             # catches Turbopack-only failures
```

| Suite | Tests | Covers |
|---|---:|---|
| `floorMachine` | 25 | Turn-taking transitions in isolation |
| `floor` | 25 | Floor requests against a live session |
| `quiz` | 16 | Answer resolution, set advance, duplicate payloads |
| `control` | 11 | Control-channel parsing |
| `errors` | 10 | Error mapping, including a ZodError from a second zod copy |
| `voice` | 9 | Spoken board commands |
| `echo` | 8 | Stripping Athena's own speech re-entering by mic |
| `gate` | 8 | Speak-permit gating |
| `board` | 7 | Whiteboard session state |
| `tokens` | 5 | RTC + RTM token minting |
| `catchup` | 3 | Catch-up answer grounding |

Several suites need `.env` (`--env-file=.env`), so they fail confusingly on a fresh clone with
no credentials.

Browser-only defects — hydration mismatches, theme regressions, clipped layouts, canvases that
never paint — are invisible to all of the above. Four Playwright scripts exist for exactly that
class of bug and are worth running against a live pair of processes:

```bash
pnpm --filter @echosphere/web test:e2e         # classroom, fake mic, asserts on console errors
pnpm --filter @echosphere/web test:board       # mid-lesson joiner sees the board (reads pixels)
pnpm --filter @echosphere/web test:roundtrip
pnpm --filter @echosphere/web test:speech      # proves words come back from STT
```

---

## 8. Known gaps

Real, and none of them hidden behind a passing test.

### The language selector is still decorative

`echosphere:language-changed` is defined in `shared-types/src/events.ts` and handled in
`useClassroom.ts:390`, but **nothing emits it** — verified by grep across `apps` and `packages`.
Selecting a language changes the dropdown and nothing else; the catch-up prompt never sees it.
Wiring it is roughly an hour: a route to set `participant.language`, emit the event, read it in
`catchupSystemPrompt`.

### The voice stack is English-only unless Sarvam is keyed

`STT_LANGUAGE` defaults to `en` and `TTS_VOICE_ID` to `English_captivating_female1`, while the
persona invites Athena to reply in whatever language the student used. The Sarvam path (Hindi
STT *and* TTS) exists in `agentLifecycle.ts` but is gated on a real `SARVAM_API_KEY` — the
default is the literal string `mock_sarvam_api_key`, which the gate rejects, so it silently
falls back. Hindi text read by an English voice is what "gargled" words sound like.

Do not switch `STT_LANGUAGE` to Deepgram's `multi` without proof: it is accepted by the join
call but produces no transcription at all through Agora's resold Deepgram — the agent starts,
reports RUNNING, and hears nothing. Prove any change with `test:speech`.

### The newer features have not been exercised in a live classroom

Catch-up chatbot, absent packets, teaching assistant, targeted readings, booking, and the
workspace compile, pass tests and theme correctly. Nobody has confirmed the answers are *good*,
or that a booking round-trips with two real people. That needs a real session with two browser
profiles.

### `merge-himani-fixes` has not been merged to `master`

It is pushed and contains every other branch, but no PR is open. `master` is 69 commits behind.

---

## 9. Where things live

| Path | Responsibility |
|---|---|
| `orchestrator/src/classroomController.ts` | The seam: transcript in, floor decision, control payload out |
| `orchestrator/src/floor/floorMachine.ts` | Turn-taking. The binding layer |
| `orchestrator/src/agent/prompt.ts` | Persona, control contract, per-command directives |
| `orchestrator/src/agent/agentLifecycle.ts` | Agora SDK wrapper; STT/TTS/LLM provider choice |
| `orchestrator/src/llm/complete.ts` | Out-of-call model calls; provider resolution order |
| `orchestrator/src/routes/classroom.ts` | Every classroom HTTP route, including the SSE stream |
| `orchestrator/src/quiz/quizEngine.ts` | Quiz records, answer resolution, broadcast |
| `orchestrator/src/support/` | Absent packets, catch-up slots, teaching assistant, readings, translation |
| `orchestrator/src/whiteboard/` | Board session state; `netless.ts` is dormant (§4) |
| `web/components/classroom/ExcalidrawBoard.tsx` | The shared canvas and its sync guards |
| `web/components/classroom/ClassroomShell.tsx` | RTM client lifecycle and the duplicate-identity guard |
| `web/hooks/useClassroom.ts` | SSE subscription; the single source of room state |
| `web/app/globals.css` | The `--eco-*` design tokens. Both themes |

[`docs/SYSTEM-DESIGN.md`](SYSTEM-DESIGN.md) is the architecture reference and
[`docs/BUILD-LOG.md`](BUILD-LOG.md) the bug-by-bug history.

> Note: `apps/web/AGENTS.md` carries the upstream Agora quickstart's conventions, including some
> that conflict with this repo's git practice — read it as inherited, not authoritative.
