# PS31 — Voice AI Co-Teacher: Implementation Plan

**Prepared for:** Claude Code build session  
**Stack decisions locked in:** Agora Conversational AI Engine + OpenAI GPT-4o Realtime as the voice/LLM backend · Audio-only classroom (no video tiles) · 1–2+ week build window

---

## 0. Ground rules for whoever builds this (read first)

- This plan is written from the public `AgoraIO/skills` README and Agora's public press material on the GPT-4o Realtime integration. It does **not** assume exact function names, config keys, or RTM payload shapes inside Agora's Conversational AI Engine — those live in `skills/agora/SKILL.md` and the official sample repo the skill clones for you.
- **First real step of the build is literally the Quick Start prompt you already have** — run it in Claude Code so it installs the skill, logs into Agora, creates a project, and clones the official Conversational AI sample. Everything below assumes that sample is your starting scaffold, not something built from scratch.
- Wherever this plan says "verify against docs" — stop and check the cloned sample / `SKILL.md` before writing that piece. Don't let an agent invent an Agora API surface.

---

## 1. What we're building

A browser-based, audio-only "live classroom" where:

- A **teacher** and **multiple students** join a shared Agora RTC voice channel.
- An **AI co-teacher agent** (Agora Conversational AI Engine, backed by GPT-4o Realtime) is a silent-by-default participant in that same channel.
- A **thin web UI** (chat log, live transcript, quiz cards, teacher control panel) sits alongside the audio, built on Next.js like the Agora sample.
- A **backend orchestration layer** (separate from Agora's engine) owns everything Agora doesn't: role/identity, lesson context, turn-taking policy, gap detection, quiz state, and post-class reports.

This is *not* "record video and add a Zoom clone" — audio-only was the explicit choice, so the surface area is: RTC audio channel + RTM/data messaging + a web dashboard, no video SDK work at all.

---

## 2. High-level architecture

```text
┌─────────────────────────────────────────────────────────────────┐
│                         Browser (Next.js)                        │
│  Teacher view          Student view (×N)                         │
│  - mic control         - mic control                             │
│  - live transcript     - live transcript                         │
│  - AI control panel    - quiz card UI                            │
│  - gap dashboard       - "ask AI" push-to-talk button             │
└───────────────┬───────────────────────────┬───────────────────────┘
                │ Agora RTC (audio)          │ Agora RTM / data channel
                ▼                           ▼
        ┌────────────────────────────────────────┐
        │        Agora Channel (per classroom)     │
        │  participants: teacher, students, AGENT  │
        └───────────────┬──────────────────────────┘
                         │ Conversational AI Engine
                         ▼
        ┌────────────────────────────────────────┐
        │   Agora Conversational AI Engine         │
        │   (STT + turn detection + TTS built in)  │
        │   LLM backend: OpenAI GPT-4o Realtime    │
        └───────────────┬──────────────────────────┘
                         │ tool calls / function calls
                         ▼
        ┌────────────────────────────────────────┐
        │     Orchestration Backend (Node/Python)  │
        │  - session + role registry               │
        │  - turn-taking / floor state machine      │
        │  - lesson context store (RAG over slides) │
        │  - per-student profile & proficiency      │
        │  - quiz engine + scoring                  │
        │  - gap detector (clusters repeated errors) │
        │  - teacher override / control API          │
        │  - post-class summary generator            │
        └───────────────┬───────────────────────────┘
                         │
                         ▼
                 ┌───────────────┐
                 │   Database     │
                 │ (Postgres/     │
                 │  Supabase)     │
                 └───────────────┘
```

Two channels of communication matter:

1. **Audio path** — Agora RTC, handled almost entirely by Agora's Conversational AI Engine (STT in, TTS out, VAD/turn-detection).
2. **Control/data path** — Agora RTM (or a data-channel equivalent, confirm which the sample uses) carries structured events: role assignment, teacher override commands, quiz card payloads, transcript deltas for the UI, gap alerts to the teacher dashboard.

---

## 3. Feature-by-feature design (mapped to the 10 required capabilities)

### 3.1 Real-time participation in a live classroom

The agent joins the Agora channel as a normal (audio-only) participant the moment a classroom session starts, via the Conversational AI Engine's agent-join flow from the sample. It listens continuously; it does not need to be invited into the channel per turn — only invited *to speak*.

### 3.2 Awareness of teacher and student roles

- Every join request goes through your own auth/session endpoint first, which assigns `role: teacher | student` and a `studentId`/`profile` if applicable, before minting the Agora token.
- Role + profile travel with the participant as user metadata over RTM, so the orchestration layer (and therefore the agent's system prompt) always knows who is in the room and who is currently speaking.
- Practical effect: the agent's behavior policy branches on role — e.g., "never speak while `activeSpeakerRole == teacher` unless explicitly addressed."

### 3.3 Appropriate turn-taking

This is the piece most worth being disciplined about, since "don't interrupt the teacher" is the hardest requirement to get right and the one judges will test first.

- Maintain a **floor state machine** in the orchestration backend with states: `TEACHER_HOLDS_FLOOR`, `OPEN_FLOOR`, `AGENT_SPEAKING`, `STUDENT_QUESTION_PENDING`.
- Use Agora's built-in VAD/turn-detection signals (confirm exact event names in the cloned sample) to detect: teacher speaking, silence gaps, a student directly addressing the agent (wake phrase, e.g. "Hey [agent name]" — confirm whether Agora's engine supports a configurable wake word or whether this needs to be done in your own STT-transcript listener).
- Default policy: the agent may only take the floor when (a) directly addressed, or (b) a silence gap exceeds a threshold **and** the gap-detector has flagged a repeated misconception worth surfacing, or (c) the teacher explicitly invokes it via the control panel.
- The teacher's floor always wins: if the teacher starts speaking while the agent is mid-utterance, the orchestration layer should immediately signal the engine to stop TTS output (barge-in). Confirm this is exposed as a "stop agent speech" control in the sample.

### 3.4 Contextual answers based on the ongoing lesson

- Before class, teacher uploads lesson material (slides/notes/syllabus) through the web UI.
- Backend chunks and embeds this into a small vector store (even an in-memory one is fine for a hackathon-scale demo; Postgres+pgvector if you want it persistent).
- During class, maintain a rolling transcript (from Agora's STT output) as short-term context.
- When the agent is invoked, its system prompt/tool context is assembled from: (rolling transcript window) + (top-k retrieved lesson chunks relevant to the current question) + (student's profile, see 3.5).

### 3.5 Different explanation levels for different students

- Each student profile carries a lightweight `proficiencyTag` (e.g., beginner/intermediate/advanced) — settable by the teacher, or inferred over time from quiz performance (see 3.6).
- When the agent responds to a specific student (identified by 3.7), inject that student's tag into the prompt: e.g., "Explain at a beginner level, avoid jargon, use a concrete analogy" vs. "Give the concise formal explanation."

### 3.6 Spoken quizzes / interactive exercises

- Orchestration exposes a `startQuiz(topic, targetStudents)` action, triggerable by the teacher or by the gap-detector.
- The LLM is asked (function-calling / structured output — confirm Agora's engine supports passing tool/function definitions through to GPT-4o Realtime, or whether this needs to be handled by your orchestration layer intercepting the LLM's text output) to produce a small quiz-question object: `{ question, options?, correctAnswer, difficulty }`.
- This object goes over RTM to the frontend as a quiz card; the question is also spoken via TTS.
- Students answer by voice (transcribed) or by tapping an option in the UI. Score + which students got it wrong feed directly into the gap-detector (3.9) and update `proficiencyTag`.

### 3.7 Multilingual / code-switched conversations

- GPT-4o Realtime handles multilingual input/output natively, and code-switching is primarily a prompting concern: instruct the agent's system prompt to mirror the student's language/register mid-response rather than force a single language.
- Confirm in the sample which layer does speech-to-text — if Agora's engine's STT has a fixed source-language setting, you may need to configure it for multilingual/auto-detect explicitly rather than assuming it's automatic.

### 3.8 Student identification through session or user identity

- Each participant authenticates (even a lightweight "enter your name/ID" join screen is enough for a hackathon demo) and gets a stable `studentId` mapped to their Agora RTC UID.
- Because Agora RTC gives you per-participant audio tracks, the orchestration layer knows *which* UID's audio just produced a given transcript segment — that UID maps straight back to the student profile, so "who asked this" and "who this misconception belongs to" are never ambiguous.

### 3.9 Post-class summaries / learning insights

- Every transcript segment, quiz result, and detected misconception is logged with a timestamp + studentId (where applicable) during the session.
- The gap-detector clusters similar wrong-answer patterns or repeated confused questions across students in real time (simple approach: cluster by topic tag + keyword/embedding similarity of the question; doesn't need to be fancy for a demo).
- At session end, a single batch LLM call over the full session log produces a structured report: topics covered, common misconceptions and which students showed them, per-student performance snapshot, and suggested follow-up for the teacher. Rendered as a page in the web UI, exportable as text/PDF if time allows.

### 3.10 Teacher control / override mechanism

The control panel (teacher-only UI) sends commands over RTM: `MUTE_AGENT`, `FORCE_AGENT_SPEAK(topic)`, `END_AGENT_TURN`, `ADJUST_VERBOSITY(level)`, `DISABLE_TOPIC(topic)`, `RESUME_AGENT`.

The orchestration layer's floor state machine treats an active `MUTE_AGENT` flag as an absolute veto checked before every agent utterance — no code path should be able to let the agent speak while muted.

This is worth demoing explicitly as its own moment in the hackathon presentation: mute the AI mid-explanation live, show it stop instantly.

---

## 4. Suggested tech stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js (matches what the Agora sample clones for Web) | Reuse the sample's Agora client wiring instead of rebuilding it |
| Audio transport | Agora RTC SDK | Given |
| AI voice engine | Agora Conversational AI Engine | Given |
| LLM | OpenAI GPT-4o Realtime, plugged into Agora's engine | Your stated choice |
| Control/data messaging | Agora RTM (or whatever data-channel mechanism the sample uses — confirm) | Needed for role metadata, quiz cards, override commands |
| Orchestration backend | Node.js (keeps one language with the Next.js frontend) or Python if the sample's server-side piece is Python | Match whatever language the cloned sample's backend uses, to avoid maintaining two stacks |
| Database | Postgres (Supabase is a fast hackathon-friendly option with auth built in) | Session logs, profiles, quiz results, transcripts |
| Vector store for lesson context | pgvector extension on the same Postgres, or in-memory for the demo | Keeps infra minimal |

---

## 5. Suggested repo structure

```text
/apps
  /web              # Next.js frontend (from Agora sample, extended)
    /app
      /classroom/[sessionId]   # main room UI
      /teacher-dashboard       # control panel + gap insights + post-class report
      /join                    # role/identity entry
  /orchestrator     # backend service (role registry, floor state machine,
                    #   quiz engine, gap detector, summary generator)
/packages
  /shared-types     # TS types shared between web + orchestrator
/docs
  PS31-ai-co-teacher-implementation-plan.md   # this file
```

---

## 6. Phased build plan (1–2+ week window)

### Phase 0 — Scaffold (day 1)

- Run the Agora skill quick start in Claude Code: skill install → Agora CLI login → project creation → clone official Conversational AI sample (Web/Next.js target) → run locally, confirm you can talk to a stock voice agent.
- Read `skills/agora/SKILL.md` and the sample's own README fully before changing anything — confirm real names for: turn-detection config, barge-in/stop-speech control, RTM vs. data-channel messaging, and whether tool/function calling is supported end-to-end through to GPT-4o Realtime.

### Phase 1 — Multi-party classroom shell (days 2–4)

- Extend the sample from 1:1 (user + agent) to N participants in one channel: teacher + multiple students + agent.
- Build the join flow: role selection, student identity, token minting.
- Get the agent's default behavior to "listen, don't speak unless addressed" working with a *hardcoded* wake phrase, before touching anything more complex.

### Phase 2 — Turn-taking + teacher override (days 5–7)

- Build the floor state machine and the teacher control panel (mute/resume/force-speak).
- Get barge-in working: teacher speaking always immediately stops agent TTS.
- This is the feature most worth over-testing — it's the one a live demo can visibly fail on.

### Phase 3 — Lesson context + differentiated explanations (days 7–9)

- Add lesson material upload + chunking/embedding.
- Wire rolling transcript + retrieved context into the agent's prompt.
- Add per-student proficiency tags and verify the same question gets a different explanation depth for a "beginner" vs. "advanced" tagged student.

### Phase 4 — Quizzes + gap detection (days 9–11)

- Structured quiz generation + spoken delivery + scoring.
- Gap-detector clustering repeated wrong answers/questions across students.
- Teacher-facing live "who needs help" indicator.

### Phase 5 — Multilingual pass + post-class summary (days 11–13)

- Verify code-switching behavior with a real bilingual test script.
- Build the post-class batch summary job and its UI page.

### Phase 6 — Polish + demo script (days 13–14+)

- Rehearse the example scenario end to end: multiple students struggle with the same math concept live → agent detects the repeated gap → picks a natural pause → gives a simpler explanation → teacher dashboard shows which students need follow-up.
- Have a fallback recorded demo in case of live network/audio flakiness — standard hackathon insurance.

---

## 7. Open items to verify against the real Agora skill/docs before building (do not assume)

- Exact mechanism for stopping agent TTS mid-utterance (barge-in) — name of the control call.
- Whether wake-word / addressed-to-agent detection is a built-in engine feature or something you must implement by watching the STT transcript stream yourself.
- Whether function/tool calling passes through Agora's engine to GPT-4o Realtime, or whether structured outputs (like quiz JSON) need to be parsed out of plain text by your orchestration layer instead.
- Whether RTM is the actual data-channel mechanism the current sample uses, or if it's been replaced by something else in the latest version of the skill.
- Rate limits / cost implications of running GPT-4o Realtime continuously for a full class session vs. only invoking it on-demand — worth confirming whether Agora's engine supports a "listening but not transcribing to the model until addressed" mode to control cost.

---

## 8. What to tell Claude Code first

When you hand this to Claude Code, the first message should be close to:

> Install the Agora skill from https://github.com/AgoraIO/skills and use it. I want to build a voice AI agent demo using Agora's Conversational AI Engine with OpenAI's GPT-4o Realtime API as the backend. Walk me through the full setup, then read `skills/agora/SKILL.md` fully before we touch the classroom-specific build in `PS31-ai-co-teacher-implementation-plan.md`.

That gets the real scaffold running first, and puts this document in front of it as the spec for everything beyond the stock sample.
