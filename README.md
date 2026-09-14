# Athena EchoSphere

**An AI co-teacher that joins the classroom, teaches alongside the teacher, and always answers to them.**

Athena isn't a chatbot bolted onto a video call. She's a real-time, voice-driven AI co-teacher who joins a live classroom session, listens, speaks, draws on a shared whiteboard, checks comprehension, tracks who's falling behind, and defers completely to the teacher's authority at every moment. Built end-to-end on Agora's real-time infrastructure.

---

## Table of Contents

- [Core Concept](#core-concept)
- [Features](#features)
  - [Live Voice Co-Teaching](#1-live-voice-co-teaching)
  - [Turn-Taking & Restraint Model](#2-turn-taking--restraint-model)
  - [Shared Whiteboard](#3-shared-whiteboard)
  - [Live Quizzes & Gap Detection](#4-live-quizzes--gap-detection)
  - [Nobody Left Behind](#5-nobody-left-behind)
  - [Teacher Controls](#6-teacher-controls)
  - [Athena AI Assistant (Teacher Copilot)](#7-athena-ai-assistant-teacher-copilot)
  - [Post-Class Report](#8-post-class-report)
  - [Multilingual Support](#9-multilingual-support)
  - [Screen Sharing](#10-screen-sharing)
  - [Avatar & Visual Presence](#11-avatar--visual-presence)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Project Structure](#project-structure)

---

## Core Concept

A teacher creates a session, students join with a share code, and the teacher can bring Athena into the room at any point. From there, Athena behaves like a real co-teacher:

- She **listens** to everything but only speaks when addressed, invited, or when she detects something worth flagging.
- She **explains** concepts live, grounded in whatever lesson material the teacher has uploaded.
- She **draws** what she explains on a shared whiteboard, visible to the whole class.
- She **checks understanding** with live quizzes and flags class-wide misconceptions as they happen, not after the fact.
- She **never overrides the teacher** — she can be muted, interrupted, or removed from the room instantly, at any time.

---

## Features

### 1. Live Voice Co-Teaching

Athena joins the classroom's real-time audio channel as a live participant. She speaks with natural turn-taking, can be addressed by name ("Athena, can you explain...") or invoked directly by the teacher, and responds with grounded, generated explanations — not canned scripts.

- Real-time speech recognition, language model reasoning, and text-to-speech all running through a single pipeline.
- Lesson material the teacher uploads gets chunked and injected into her system prompt, so her answers use the room's own terminology instead of generic textbook language.
- Adjustable verbosity (terse / normal / detailed) so her answers match the pace of the class.

### 2. Turn-Taking & Restraint Model

The hardest part of an AI co-teacher isn't what it says — it's knowing when to stay silent. Athena has a dedicated **floor state machine**, separate from raw voice-activity detection, that governs exactly when she's allowed to speak:

- She waits for a wake phrase or explicit teacher invocation before answering — she doesn't jump in on every sentence.
- A teacher's barge-in is enforced explicitly and instantly: if the teacher starts talking, Athena's current turn is cut off, no exceptions.
- A **restraint meter** visualizes her decisions in real time — `listening`, `held-back`, `speaking` — so the teacher can see not just when she spoke, but when she chose not to.
- Doubts she hears but doesn't answer out loud aren't lost — they're logged as **held-back doubts** and surfaced in the shared workspace instead.
- Turn detection is tuned specifically for a multi-person classroom rather than a 1:1 call — silence thresholds are widened so a teacher pausing mid-explanation isn't mistaken for the end of a turn.

### 3. Shared Whiteboard

A live, collaborative whiteboard (built on Excalidraw) that every participant sees in real time — presented the same way a screen share would be.

- The teacher can annotate it directly.
- Athena can write to it herself, when annotation mode is enabled — turning a spoken explanation into an actual diagram, live, in front of the class.
- Board state syncs instantly across every connected participant.

### 4. Live Quizzes & Gap Detection

Athena doesn't wait until the end of a unit to check understanding.

- She can issue a timed, multiple-choice pop quiz — either on teacher request or automatically, in a set of several questions on a topic.
- Every answer is scored in real time, with results visible to both the student and the teacher.
- If enough students miss the same concept, it's flagged as a **class-wide learning gap**, and the teacher can launch a targeted quiz on just that topic with one click.
- A post-class report ranks each student's concept mastery per topic (mastered / developing / struggling).

### 5. Nobody Left Behind

A cluster of features specifically aimed at the students who don't have the loudest voice in the room, or who weren't in the room at all:

- **Shared workspace / sticky notes** — a live, Miro-style board where student questions, doubts Athena deliberately held back from answering aloud, teacher insights, and key takeaways get pinned in real time, categorized and votable.
- **Targeted reading** — Athena can recommend supplementary reading for a struggling student, which the teacher must explicitly approve before it ever reaches them.
- **1:1 catch-up booking** — students can book real one-on-one time with the teacher (and Athena) directly from their own view — picking an available date/time slot, a focus topic, and a preferred language.
- **Absent-student dispatcher** — for students who missed class entirely, Athena auto-generates a full catch-up packet: an AI-written executive summary of the lesson, key takeaways, flagged misconceptions, and a diagnostic quiz — all built from the actual session transcript and gap data. It can be dispatched via a pre-filled WhatsApp message or delivered as a real email through **Resend**, automatically, without the teacher writing anything by hand.

### 6. Teacher Controls

The teacher retains full, instant authority over Athena at every point in the session:

| Control | Effect |
|---|---|
| **Bring Athena in** | Starts her live agent session and adds her to the room |
| **Mute Athena** | Silences her immediately, mid-sentence if needed |
| **Unmute Athena** | Restores her ability to speak |
| **Send Athena out** | Removes her from the session entirely |
| **Cut off current turn** | Ends whatever she's currently saying |
| **Force speak** | Makes her address a specific topic or student on demand |
| **Disable / enable topic** | Blocks her from discussing a specific subject (e.g. "next week's exam") |
| **Set student invocation** | Controls whether students can address her directly, or only the teacher can |
| **Per-student proficiency** | Tags each student's level so Athena can calibrate explanations accordingly |

None of her actions are unsupervised or irreversible — every override is one click away.

### 7. Athena AI Assistant (Teacher Copilot)

A second, private instance of Athena — visible only to the teacher, separate from the voice agent students hear:

- Suggests check-in questions to gauge the room.
- Generates real-world analogies on the fly.
- Summarizes how the class is actually doing, mid-lesson.
- Drafts board challenge problems in seconds.

This runs as a quiet sidebar chat, so the teacher can consult it without ever interrupting the live lesson happening in front of the class.

### 8. Post-Class Report

When a session ends, everything is compiled into a structured summary rather than left as a raw transcript:

- Key concept grasp percentage across the class.
- Total questions asked to Athena.
- Topics covered.
- Identified learning gaps and common misconceptions, with which students were affected.
- Per-student breakdown: proficiency level, questions asked, quiz performance, and a written note.
- Concept mastery rankings per student, per topic.
- Athena's own narrative read of how the session went.

### 9. Multilingual Support

Real-time translation is available for transcript content, with per-participant language preference — useful for multilingual classrooms where not every student's first language matches the lesson's.

### 10. Screen Sharing

Any permitted participant can share their screen to the room. The teacher grants or revokes screen-share permission per student, and an active share automatically takes over the main stage view for everyone.

### 11. Avatar & Visual Presence

Athena isn't just a voice — she has a visual presence in her tile:

- A one-time animated entrance plays the moment she's brought into the room.
- She settles into a looping idle animation for the rest of the session.
- Speaking state is visually indicated (a glow/pulse effect) so it's clear when she's actively talking versus idle.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Real-time voice & video** | [Agora](https://www.agora.io/) — RTC (audio/video channel), RTM (messaging/transcript relay), and the **Conversational AI Engine** (`agora-agents` SDK) for the voice agent pipeline |
| **Speech-to-text** | Deepgram (via Agora's resold, no-key-required preset) or Sarvam AI (for Indian language support), configurable |
| **Language model** | Agora's resold OpenAI-compatible models (`gpt-4o-mini` / `gpt-4.1-mini` / `gpt-5-nano` / `gpt-5-mini`), billed through the Agora project — no separate OpenAI key required |
| **Text-to-speech** | MiniMax TTS or Sarvam TTS, resold through Agora |
| **Avatar animation** | Lottie (`@lottiefiles/dotlottie-react`) for the idle loop, plus a one-time HTML5 video intro clip |
| **Shared whiteboard** | [Excalidraw](https://excalidraw.com/), synced live across participants |
| **Frontend** | [Next.js](https://nextjs.org/) (App Router), React, TypeScript, Tailwind CSS |
| **Backend orchestrator** | [Fastify](https://fastify.dev/) (Node.js/TypeScript), long-lived process (required to hold live `AgentSession` references for interrupt/say/think/update calls) |
| **Transactional email** | [Resend](https://resend.com/) — for absent-student parent notifications |
| **Persistence (optional)** | PostgreSQL — session/report storage; the app degrades gracefully to in-memory-only if unset |
| **Monorepo tooling** | pnpm workspaces |
| **Shared types** | A dedicated `@echosphere/shared-types` package used by both the frontend and orchestrator |

---

## Architecture

```
┌─────────────────┐         ┌──────────────────────┐         ┌─────────────────┐
│   apps/web       │◄──────►│  apps/orchestrator     │◄──────►│  Agora Cloud     │
│   (Next.js)      │  REST  │  (Fastify, Node.js)    │  REST  │  ConvoAI Engine  │
│                   │  + SSE │                         │        │  RTC / RTM       │
└─────────────────┘         └──────────────────────┘         └─────────────────┘
        │                             │
        │  Agora RTC / RTM (browser)  │  holds live AgentSession
        │  direct connection          │  in memory; relays
        ▼                             ▼  transcript + control events
   Live classroom room          Session state, floor logic,
   (audio, video, board)        quizzes, gaps, reports
```

- The **frontend** connects directly to Agora's RTC/RTM channels for audio and the live transcript stream (Agora's RTM SDK is browser-only, so the browser is the only place the agent's live ASR output can be observed).
- The **orchestrator** is a long-lived Node process — not serverless — because it must hold a live `AgentSession` object in memory to call `interrupt()`, `say()`, `think()`, and `update()` on Athena's running agent.
- A custom **floor state machine** in the orchestrator sits on top of Agora's own voice-activity detection, giving the teacher unconditional, instant barge-in rights that a generic VAD setting alone can't guarantee.

---

## Getting Started

### Prerequisites

- Node.js
- pnpm
- An Agora project (App ID + App Certificate, plus RESTful API Customer ID/Secret for the Conversational AI Engine)
- A Resend API key (optional — only needed for the absent-dispatcher email feature)

### Install

```bash
pnpm install
```

### Run

Two processes run side by side, in separate terminals:

```bash
# Terminal 1 — frontend
pnpm --filter web dev

# Terminal 2 — orchestrator
pnpm --filter @echosphere/orchestrator dev
```

The frontend runs at `http://localhost:3000`, the orchestrator at `http://localhost:8787`.

---

## Environment Variables

Set these in `apps/orchestrator/.env`:

```dotenv
# Required — Agora RTC/RTM credentials
NEXT_PUBLIC_AGORA_APP_ID=
NEXT_AGORA_APP_CERTIFICATE=

# Required — Agora Conversational AI Engine REST credentials
AGORA_CUSTOMER_ID=
AGORA_CUSTOMER_SECRET=

# LLM model resold through Agora (one of: gpt-4o-mini, gpt-4.1-mini, gpt-5-nano, gpt-5-mini)
LLM_MODEL=gpt-4o-mini

# Optional — Sarvam AI (Indian language STT/TTS); falls back to Deepgram/MiniMax if unset
SARVAM_API_KEY=
SARVAM_SPEAKER=
SARVAM_TARGET_LANGUAGE_CODE=

# Optional — absent-student email dispatch
RESEND_API_KEY=

# Optional — durable session/report storage; omit for in-memory-only mode
DATABASE_URL=

# Orchestrator server
PORT=8787
CORS_ORIGINS=http://localhost:3000
```

---

## Project Structure

```
apps/
  web/                     Next.js frontend
    app/
      join/                 Session join flow
      teacher/[sessionId]/  Teacher dashboard
      classroom/[sessionId]/Student classroom view
    components/
      classroom/             Room stage, audio/RTC layer, whiteboard, drawer
      workspace/              Shared sticky-note workspace
      support/                Absent dispatcher, 1:1 booking, targeted reading
      meraki/                 Restraint meter, suppressed-intervention panel
  orchestrator/              Fastify backend
    src/
      agent/                  Agora ConvoAI agent lifecycle, prompt building
      routes/                  REST API (sessions, agent control, quizzes, workspace…)
      support/                 Absent-packet generation + dispatch, targeted reading
      gaps/                    Learning-gap detection
      state/                   In-memory session registry, floor state machine
packages/
  shared-types/              Types shared between frontend and orchestrator
```

---

*Built on Agora's real-time infrastructure. Athena EchoSphere — not an AI running the classroom. A teacher, with a co-teacher who knows exactly when to speak, and when not to.*
