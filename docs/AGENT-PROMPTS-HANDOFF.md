# Athena — Agent Prompts and Configuration Handoff

Everything that governs what Athena says, when she says it, and why she sometimes says
nothing. Written to be read by someone taking this over cold.

Companion to [HANDOFF.md](./HANDOFF.md), which covers the wider system. This file covers
only the agent: the prompt, the ConvoAI configuration, and the failure modes of both.

**Every claim below is tagged by how it is known.** An earlier revision of this file
stated several things confidently that were assumption rather than fact, so:

- **[verified]** — observed directly against running code or a live service, in this repo
- **[code]** — read straight out of the source, with the file and line given
- **[unverified]** — plausible and acted on, but never actually tested
- **[unknown]** — genuinely not established; do not build on it

---

## 0. What is broken right now

**Symptom:** the teacher presses "Explain", the UI shows Athena speaking, no audio is
heard, and nothing appears in the transcript.

**[verified] The model is returning empty completions.** The live agent's own history for
session `6650` on the deployed orchestrator:

```
turns: 7
  assistant -> "Hi everyone,I'm Athena. ..."      <- the greeting
  assistant -> 'Hi everyone,I'                    <- truncated mid-word
  user      -> '[classroom:system] ... explain "explain fractions" ...'   (x5)
```

Five explain directives reached the model. It produced **zero** assistant turns in
response, and the one turn it did produce was cut off mid-word.

**[unverified] The likely cause is the completion budget.** `LLM_MODEL` was set to
`gpt-5-mini`, which is a reasoning model. Reasoning tokens are charged against the
completion budget but never appear in the returned content, so at
`max_completion_tokens: 700` the model can spend the whole budget thinking and return
nothing. The truncated turn is consistent with this. It has **not** been proven by
raising the cap and re-testing — that is the first thing to do.

`HANDOFF.md` already carried a section titled "Reasoning models can return an empty
string" describing this exact failure. It was not applied when the model was switched.
Note that the `isReasoningModel` guard it refers to lives in `llm/complete.ts` and covers
the orchestrator's *own* LLM calls (reports, gap detection). **It does not cover the
ConvoAI agent** — the agent's parameters are set independently in `agentLifecycle.ts`
`llmParams()`.

### Fix, in order of preference

**Fastest, no code change.** On the Render orchestrator set `LLM_MODEL=gpt-4.1-mini`,
restart, and send Athena out and back in. `gpt-4.1-mini` is not a reasoning model, so it
avoids the trap entirely, and `llmParams()` already sends it the correct `max_tokens`
set. **[unverified]** — this specific model has not been run in this project.

**To stay on `gpt-5-mini`,** raise the cap in `agentLifecycle.ts` `llmParams()`
(`apps/orchestrator/src/agent/agentLifecycle.ts`):

```ts
return resellerModel().startsWith('gpt-5')
  ? { max_completion_tokens: 700 }   // suspected too small
  : { max_tokens: 700, temperature: 0.4, top_p: 0.9 };
```

Try `3000`. Whatever you choose, **confirm with the agent history endpoint** (§7) that an
assistant turn actually appears — the test suite will not tell you (§6).

### The four models available

**[code]** `RESELLER_MODELS` in `agentLifecycle.ts`. Anything else silently falls back to
`gpt-4o-mini`.

| Model | Parameter set | Notes |
|---|---|---|
| `gpt-4o-mini` | `max_tokens` | Original. Weakest at following the restraint rules. |
| `gpt-4.1-mini` | `max_tokens` | Suggested next step. Not a reasoning model. **[unverified]** |
| `gpt-5-mini` | `max_completion_tokens` | Reasoning model. Currently failing (§0). |
| `gpt-5-nano` | `max_completion_tokens` | Reasoning model, smaller. **[unverified]** |

---

## 1. Where the prompt lives

**[code]** All of it is in `apps/orchestrator/src/agent/prompt.ts` (379 lines). Nothing
else writes prompt text.

```
prompt.ts
├── PERSONA                     static system prompt (identity + restraint rules)
├── CONTROL_CONTRACT            the JSON side-channel spec
├── buildClassroomInstructions  assembles the full system prompt per session
├── getGreetingForLanguage      the opening line
└── *Directive functions        one-off instructions injected mid-lesson
```

**[code]** `buildClassroomInstructions(session)` runs on agent start and on every
`pushInstructions()` — whenever roster, policy, language or lesson material changes. It
concatenates, in order:

1. `PERSONA`
2. a language block, **only if** the lesson language is not English
3. `# This lesson` — the title
4. `# Students in the room` — roster with each student's proficiency and recent struggles
5. `# Teacher's current instructions` — verbosity, whether students may invoke her,
   blocked topics
6. `# The teacher's lesson material` — uploaded notes, capped at `MAX_LESSON_CHARS`
   (6000); beyond that it retrieves the 8 most relevant chunks against recent talk
7. `CONTROL_CONTRACT`

---

## 2. The restraint design

The central idea: **Athena is silent by default.** She speaks only when someone says her
name, or the turn begins with `[classroom:system]` from the teacher's control panel.

**[code]** Enforced in three independent places — a bug can live in any of them:

| Layer | Where | What it does |
|---|---|---|
| Prompt | `PERSONA` → "Silence is your default" | Asks her not to speak. Advisory only. |
| Floor machine | `classroomController.ts` | Interrupts un-permitted turns via a REST call. Authoritative but slow — the code comment records it as measured at over three seconds. |
| Engine VAD | `agentLifecycle.ts` `turnDetection` | Decides when a human turn starts and ends. |

### How "stay quiet" is expressed

A silent turn is **an empty control object and nothing else**: `{}`

**[code]** MiniMax TTS runs with `skipPatterns: [5]`, which strips curly-brace content
before synthesis. The comment at `agentLifecycle.ts:539` states it strips from the TTS
*and* from the RTM transcript the browser relays.

**[verified]** In a wake-word-free harness run, the only agent transcript entry was the
greeting — she produced no visible entry for the turns she stayed quiet on.

**This is the sharp edge.** "Correctly staying quiet" and "the model returned nothing"
look identical from outside: the agent state goes to `speaking` in both cases, and
neither produces audio or a transcript entry. **The UI cannot distinguish them.** Use the
agent history endpoint (§7): an assistant turn containing `{}` is restraint working; *no
assistant turn at all* is a fault.

### The "Silence." bug, for context

**[verified]** Before the current prompt, `gpt-4o-mini` answered the silence instruction
by saying the word *"Silence."* aloud, then copied itself from history for the rest of
the lesson. The prompt now shows the silent turn literally as `{}`, forbids placeholder
words by name, and tells her to ignore such turns in her own history.

**[unknown]** Whether that correction pushes too far toward silence. It has not been run
against a working model end to end. If Athena becomes too quiet — not answering when
directly addressed — that section is the first place to look; the `[classroom:system]`
rule ("**always say something out loud**") is what is supposed to override it.

---

## 3. The control channel

**[code]** After her spoken words Athena appends **one** JSON object; `agent/control.ts`
reads it. The prompt comment at `prompt.ts:110` states the engine skips only the first
outermost brace pair — **so two objects in one turn means the second is read aloud.**

| Field | Purpose |
|---|---|
| `to` | Name of the student being answered |
| `gap` | `{"topic":"...","students":[...]}` — shared confusion |
| `board` | `{"action":"write","text":"..."}` — one short line for the board |
| `illustrate` | `{"illustrate":{"topic":"..."}}` — triggers an Excalidraw diagram |
| `quiz` | Question, four options, answer letter, difficulty |

Two known traps, both from `HANDOFF.md` and both still live:

- **The quiz answer key is generated, not computed.** Nothing server-side validates it.
  It once anchored on a hardcoded `"B"` in the example and marked correct students wrong.
  The durable fix is to have her state the correct option's *text*, not its letter.
- **`illustrate` must never be the whole turn** — it leaves the room staring at a picture
  nobody introduced.

---

## 4. Agent configuration

**[code]** All in `agentLifecycle.ts` `startAgent()`. Each differs deliberately from the
official quickstart.

| Setting | Value | Why |
|---|---|---|
| `remoteUids` | `['*']` | Hears every participant; quickstart uses one requester. |
| `idleTimeout` | `0` | A class can sit silent through written work. |
| `skipPatterns` | `[5]` | Opens the brace control channel. |
| `end_of_speech` | `semantic` | Replaced a flat 2000 ms timer that charged every turn a 2 s wait. |
| `interruption` | `keywords` | Intended so only her name or "stop" cuts her off. |
| `audio_scenario` | `aiserver` | Agora's own conversational-agent profile — latency *and* network resilience. Was `chorus`, which trades resilience away. |
| ~~`sal`~~ | *removed* | **[verified]** never ran: `advanced_features.enable_sal` was never sent, so the `sal` block was inert. See §4. |

### Settings that are not confirmed

Two were changed on a reading of the SDK type definitions rather than vendor
documentation. **Re-check both against the official ConvoAI docs before trusting them.**

- **`interruption: { mode: 'keywords' }` — [unknown].** Documented in code as governing
  barge-in only. The SDK's deprecation note on `start_of_speech.mode: 'keywords'` says to
  "use `interruption.mode = 'keywords'` instead", which suggests it may also gate when a
  user turn *starts*. **[verified]** plain speech with no wake word is still transcribed,
  so it does not gate transcription — but the full semantics are unestablished.
- **`sal: { sal_mode: 'recognition' }` — RESOLVED, and it was never running.**
  **[verified]** against the ConvoAI OpenAPI spec and the SDK source: `sal` is gated by
  `advanced_features.enable_sal` (*"Enable Selective Attention Locking (SAL). When
  enabled, configure the `sal` field…"*, default `false`). `agentLifecycle.ts` sent
  `advancedFeatures: { enable_rtm, enable_tools }` and never that flag, and
  `Agent.buildStartRequest` passes `advanced_features` through verbatim — so a `sal`
  block was sent for a disabled feature. **No voice separation has ever happened in this
  deployment**, and `SAL_MODE=recognition` and `SAL_MODE=off` were the same deployment.

  It has now been **removed entirely** rather than enabled, because enabling it cannot
  work here either: the spec says `sal.sample_urls` supports *"Only one voiceprint URL"*,
  so `recognition` mode can enrol exactly one speaker — useless for a rotating classroom
  roster. Cross-talk is a known, unmitigated property of this deployment. `SAL_MODE` is
  no longer read; remove it from any deployment env.

Revert `interruption` to the known-good ConvoAI default with `interruption: { enable: true }`.

---

## 5. Directives — the `[classroom:system]` channel

**[code]** The orchestrator makes Athena speak via `agentSession.think()`. The engine
treats injected text as *user* input, so it appears in her history as a `user` turn
prefixed `[classroom:system]`.

| Function | Fired by |
|---|---|
| `addressedByTeacherDirective` | Teacher says her name |
| `forceSpeakDirective` | "Explain" button |
| `quizDirective` | "Quiz" button |
| `gapInterjectionDirective` | Gap detector |

**[code]** Two things matter:

1. `think()` must pass `on_listening_action: 'interrupt'`. Listening is her resting
   state, so omitting it means "Explain" silently does nothing.
2. These turns are stripped before storage (`classroomController.ts:471`), or
   `[classroom:system] …` would show in front of students.

---

## 6. Testing — and a blind spot that matters

The harness is `apps/web/scripts/speech.e2e.ts`: real Chromium, a WAV file as the
microphone, assertions on what reaches the orchestrator.

```bash
pnpm --filter @echosphere/orchestrator dev     # :8787
pnpm --filter @echosphere/web dev              # :3000
pnpm --filter @echosphere/web test:speech apps/web/.tmp/speech-fixture.wav   # wake word
pnpm --filter @echosphere/web test:speech apps/web/.tmp/speech-nowake.wav    # no wake word
```

### ⚠ The "Athena replied" assertion does not mean Athena replied

**[verified]** `speech.e2e.ts:121` asserts `agent.length > 0`, where `agent` is every
transcript segment with `speaker === 'agent'`. **The greeting is such a segment**, and it
is delivered by the engine from `greetingMessage` config without any LLM call. So the
assertion passes whenever the agent joins at all — even if the model never produces a
single word.

This is not theoretical. In the harness runs used to sign off the `gpt-5-mini` switch,
the only agent line in the transcript was the greeting. The suite reported
`ok Athena replied` while the model was in fact returning nothing — which is exactly the
fault that then appeared in the live classroom. **Those runs did not verify what they
appeared to verify.**

**Fix this before trusting the suite again:** assert that an agent segment exists which is
*not* the greeting — for example `agent.some(s => !s.text.startsWith("Hi everyone"))` —
or assert directly against the agent history endpoint.

Both fixtures matter for a second reason: the original one says *"Hey Athena. Can you
explain…"* and contains the wake word, so on its own it cannot distinguish "plain speech
is transcribed" from "only wake-word speech is transcribed".

Regenerate a fixture on macOS:

```bash
say -o out.aiff "your sentence here"
afconvert -f WAVE -d LEI16@48000 -c 1 out.aiff fixture.wav
```

Full gate: `pnpm -r typecheck`, `pnpm --filter @echosphere/orchestrator test`,
`pnpm --filter @echosphere/web verify`. **None of these can see a model returning empty.**

---

## 7. Debugging checklist

Cheapest first; each step rules out a layer. **[code]** all six endpoints exist.

1. **`GET /health`** — which model is configured. Note it reports the raw `LLM_MODEL` env
   value, not what `resellerModel()` resolves to; they differ if the value is unsupported.
2. **`GET /api/sessions`** — is the session live, how many participants.
3. **`GET /api/sessions/:id/agent/history`** — *the highest-value endpoint.* What the
   model received and produced. `user` turns prefixed `[classroom:system]` with no
   `assistant` turn after them means the model returned nothing.
4. **`GET /api/sessions/:id/transcript`** — what the orchestrator stored. Agent entries
   but no human ones means the engine never heard the room.
5. **`GET /api/sessions/:id`** — if `floor.lastHumanSpeechAt` still equals session
   creation time, no human turn has ever been processed.
6. **`GET /api/sessions/:id/prompt`** — the exact system prompt in force.

**[verified]** Step 3 alone identified the §0 fault in one request, after steps 1 and 2
showed everything nominally healthy.

---

## 8. Open risks

- **[verified] A model returning empty is undetectable.** No alert, no log, no failing
  assertion — and per §6 the suite actively reports success. It presents only as "the UI
  says she is speaking but there is no sound." Cheapest guard: log a warning when an
  assistant turn is empty or whitespace-only.
- **[code] Speaker attribution is a guess.** The toolkit reports every human turn as uid
  `"0"`; `ClassroomAudio.tsx` polls remote track volume every 150 ms and credits the
  loudest. Wrong under cross-talk. SAL was never going to fix this and is now removed
  (§4) — no speaker identity reaches the browser transcript. Note the fallback at
  `ClassroomAudio.tsx:503` is the *relaying browser's own uid*, so a student below the
  0.06 level threshold is filed as the teacher rather than dropped.
- **[code] Only the teacher's browser relays transcripts.** `isRelay` is hardcoded:
  `teacher/[sessionId]/page.tsx:850` passes it, `classroom/[sessionId]/page.tsx:429`
  passes `false`. If that tab reloads or is backgrounded, transcripts stop for everyone.
  No failover.
- **[code] `evaluateGate` is dead code.** `routes/completions.ts` is registered in
  `server.ts`, but the agent's `new OpenAI({...})` has no `url`, so it talks to Agora's
  resold endpoint and the restraint-scoring gate never runs.
- **[code] The quiz answer key is unvalidated** (§3).
- **Non-English lessons are untested — [unknown], not broken.** `LanguageCode` allows
  `en, hi, es, fr, de, ta, te`, and `session.language` is passed straight to
  `DeepgramSTT({ model: 'nova-3', language })`. The code comment claims nova-3 supports
  all of those natively; that claim has not been checked against Deepgram's own docs and
  no non-English lesson has been run. What **[verified]** is recorded in `config.ts` is
  narrower: `'multi'` is accepted by the join call but produces no transcription at all.
  Sarvam is the alternate vendor and activates only with `SARVAM_API_KEY`, which is unset.
  *(An earlier revision of this file asserted nova-3 does not support `ta`/`te`. That was
  not established and has been removed.)*

- **[verified] Semantic end-of-turn always runs an English model, whatever the lesson
  language is.** `turn_detection.language` is never set in `agentLifecycle.ts`, and the
  SDK fills it in with its own default rather than leaving it absent:
  `DEFAULT_TURN_DETECTION_LANGUAGE = "en-US"` at `Agent.mjs:12`, applied in
  `_resolveTurnDetectionConfig()` at `Agent.mjs:727-733`. Confirmed on the wire with
  `pnpm --filter @echosphere/orchestrator dump:join`, which prints
  `turn_detection.language: "en-US"` for an `en` session and would print the same for any
  other. **ASR itself is unaffected** — `DeepgramSTT` puts its language in
  `asr.params.language`, and the join schema says a vendor-specific code there takes
  precedence over `asr.language` (which the SDK also overwrites with `en-US`). So a Hindi
  or Tamil lesson is still transcribed in the right language; what runs in English is the
  *semantic end-of-speech decision* — the model deciding whether an utterance is finished.
  This supersedes the older `[unknown]` nova-3 note above, which guessed at the wrong
  layer: the open question was never Deepgram's language coverage, it is that a
  turn-taking model is being asked to judge sentence completion in a language it was not
  given. Not fixed, and not measured in a non-English room.

- **[code] The classroom is a raw N-microphone mix into a pipeline Agora documents as
  single-subscriber, with no separation mechanism at all.** `remoteUids: ['*']`
  (`agentLifecycle.ts`) subscribes the agent to every participant, while the join schema
  says of `remote_rtc_uids`: *"Only subscribed users can interact with the agent.
  Currently, only one user ID is supported."* The SAL block that was supposed to offset
  this has been removed rather than repaired (§4) — it never ran, and `recognition` mode
  could not have covered a rotating roster anyway, since `sal.sample_urls` supports
  *"Only one voiceprint URL"*. **This is now the honest baseline, not a misconfigured
  mitigation.** Everything downstream that struggles with cross-talk — speaker
  attribution guessing from mic level, bug B's restraint layer having no engine-side
  notion of who is talking — is working around this property of the deployment, not
  around a setting somebody got wrong. Any future fix has to add separation, not restore
  a config that was inert.

---

## 9. Change log for this session

| Change | Actual status |
|---|---|
| Supabase Postgres wired; migrations applied | **[verified]** end to end |
| Teacher auth (Supabase JWKS, ES256, no secrets) | **[verified]** rejects forged/`alg:none`/anonymous tokens; **[unknown]** positive path — no account was ever created |
| `end_of_speech` → semantic | **[unverified]** — see §6; the sign-off runs proved less than they appeared to |
| `interruption` → keywords | **[unknown]** semantics (§4) |
| ~~`sal_mode` → recognition~~ | **[verified] inert, now removed** — `enable_sal` was never sent (§4) |
| `audio_scenario` → `aiserver` | **[verified]** on the wire via `pnpm --filter @echosphere/orchestrator dump:join` |
| Prompt: `{}` silent turn, placeholder ban, name precedence | **[unknown]** — never run against a model that was producing output |
| `LLM_MODEL` → `gpt-5-mini` | Cap raised 700 → 2500 via the shared reasoning guard; **[verified]** on the wire, **[unverified]** in a live room |
| GPT-5 parameter names in `llmParams()` | **[verified]** accepted by the API on both start and update paths; the cap value is still suspect |

### Calls that were got wrong, so they are not repeated

1. A no-transcript fault was diagnosed as the `interruption: keywords` gate blocking
   speech. A wake-word-free fixture disproved it. The real cause of that session was
   never established — most likely the microphone never published.
2. `gpt-5-mini` was adopted without applying the reasoning-model warning already written
   in `HANDOFF.md`, with a 700-token cap that reasoning appears to consume entirely.
3. **The sign-off for changes 3–7 above rested on a harness assertion that cannot fail
   for the reason it claims** (§6). Several rows in this table were previously marked
   "working" on that basis. They are not known to work.
