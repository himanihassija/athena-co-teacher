# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Athena Echosphere** — PS31 hackathon project (SIH 2026, PS 26207, AICTE Smart Education): an audio-first live classroom where a teacher, students, and an AI co-teacher ("Athena") share one Agora voice channel, whiteboard, and sticky-note workspace. Built on Agora's `agent-quickstart-nextjs` as a base. `README.md` is the full feature list; `docs/SYSTEM-DESIGN.md` is the architecture reference (read it before non-trivial changes); `docs/HANDOFF.md` is the current engineering state; `docs/BUILD-LOG.md` is the bug history. `apps/web/` has its own `AGENTS.md` with web-app-specific rules — it applies to everything under `apps/web/`.

## Commands

pnpm workspace, Node >= 22 (`.nvmrc` pins 24). Run from repo root.

```bash
pnpm install
pnpm dev                 # web only (localhost:3000)
pnpm dev:classroom       # web + orchestrator in parallel — the normal dev loop
pnpm build               # web only (next build); orchestrator has NO build step, it runs TS via tsx
pnpm lint                # recursive (orchestrator lint is a no-op echo)
pnpm typecheck           # recursive

# Orchestrator tests (~127 pure-logic checks, no browser needed):
pnpm --filter @echosphere/orchestrator test
pnpm --filter @echosphere/orchestrator test   # run ALL; individual suites:
node --import tsx apps/orchestrator/scripts/floorMachine.test.ts   # single test file
node --env-file=.env --import tsx apps/orchestrator/scripts/quiz.test.ts  # suites needing .env

# Web e2e (Playwright):
pnpm --filter @echosphere/web test:e2e         # real browser, both servers, fake mic
pnpm --filter @echosphere/web test:roundtrip   # LIVE agent, spends Agora minutes — the one that matters
pnpm --filter @echosphere/web doctor           # env/credential check
```

Every serious bug in this project passed typecheck/lint/unit tests and only surfaced in `test:roundtrip` — run it for any change touching the transcript, floor, or agent paths.

## Environment

Only Agora creds are required: `NEXT_PUBLIC_AGORA_APP_ID` + `NEXT_AGORA_APP_CERTIFICATE` in `apps/web/.env.local` and `apps/orchestrator/.env` (`config.ts` enforces exactly these two; ConvoAI runs in App Credentials mode — README's `AGORA_CUSTOMER_ID/SECRET` are NOT used by the code). `agora project env write .env.local` generates them. Orchestrator runs on **:8787**; point the web app at it with `NEXT_PUBLIC_ORCHESTRATOR_URL` (defaults to `http://localhost:8787`). `SARVAM_API_KEY` (Indian-language STT/TTS), `RESEND_API_KEY` (absent-student email dispatch), `DATABASE_URL` (Postgres), and vendor LLM keys are all graceful no-ops when unset.

**Two separate model paths that do not share a key:** Athena's in-call voice is Agora ConvoAI (everything billed through the Agora project; `LLM_MODEL` must be an Agora-resold model). Everything outside the call (catch-up chatbot, reports, translation) goes through `apps/orchestrator/src/llm/complete.ts`, which picks a provider by **first key present in fixed order: Gemini → Anthropic → OpenAI → Groq → DeepSeek → Sarvam**. No provider setting — if a feature answers in an unexpected style, check which key is set.

## Architecture: the two channels

Everything is one of two flows, and they must never be merged:

- **Audio path** — Agora RTC (speech) + RTM (Athena's transcript/state), owned by Agora's cloud.
- **Control path** — orchestrator's own SSE (`GET /api/sessions/:id/events`) down to browsers + HTTP POSTs up. Owned by the orchestrator process.

RTM **cannot** carry control events: Agora's RTM SDK is browser-only, no server variant. This also forces the **transcript relay**: the teacher's browser tab is the only always-present place Athena's transcript can be observed, so it POSTs transcripts/agent-state to the orchestrator (`isRelay` in `ClassroomAudio.tsx`). Exactly one relay — two relays duplicate every student turn under two names.

**The orchestrator (`apps/orchestrator`) is one long-lived process, not serverless**: the floor state machine needs a single authoritative writer, and the `agora-agents` `AgentSession` handle must stay in memory for `interrupt()/think()/update()/getHistory()`. State is in-memory; flushed to Postgres once at session end.

**Browsers never compute state.** `useClassroom` only applies SSE events; the teacher's mute and the students' view can't disagree because derivation lives solely in the orchestrator.

Beyond the voice core, the feature surfaces (README has the full list) map to: `orchestrator/src/{board,whiteboard,workspace,support,catchup}` + `web/components/{workspace,support,meraki}` — whiteboard (Excalidraw, agent-writable), sticky-note workspace, absent-student packet dispatch (Resend/WhatsApp), 1:1 catch-up booking, targeted reading, and the teacher-only copilot chat.

## Turn-taking: two non-redundant layers

The core safety property — no code path lets Athena speak while muted:

1. **System prompt** (`agent/prompt.ts`) — advisory, shapes *what* she says.
2. **Floor machine + speak permit** (`floor/floorMachine.ts`, `classroomController.ts`) — binding, decides *whether* she may speak at all. `decideSpeak()` is pure and the only permission-granter; `requestFloor()` is its single caller — one door. Because ConvoAI answers on its own initiative, enforcement is a permit (TTL 15s) + after-the-fact `interruptAgent()` in `handleAgentState`; once authorized, `authorizedTurnInProgress` covers the turn to completion — only explicit revocation (mute, barge-in, floor close) ends it early. Never rely on prompt wording to keep Athena quiet.

## The control channel & quiz payloads

Athena appends one JSON object per spoken turn; MiniMax `skipPatterns:[5]` strips braces before TTS so it's never spoken. **The same stripping removes it from the relayed RTM transcript** — quiz payloads must be read from `agentSession.getHistory()` (raw LLM output) via `pollForPayloadTurn`, not the relay. `{to}`/`{gap}` on ordinary turns stay relay-based (best-effort).

Gotchas that cost real debugging time (details in SYSTEM-DESIGN.md §14): agent RTC uid is the constant `123456`; `agentSession.update()` overwrites `params` wholesale — always repeat `model`; run `next build && next start` for demos (`next dev` Fast Refresh desyncs the RTM client); wake-word matching accepts mis-hearings ("Xena", "Tina").

## Demo/hosting constraint

The web app deploys to Vercel, but the orchestrator **cannot** — it needs a long-lived process. Deploy it separately (see `Dockerfile.orchestrator`); point the web app at it with `NEXT_PUBLIC_ORCHESTRATOR_URL`.

## Git conventions (from apps/web/AGENTS.md, applies repo-wide)

Conventional commits (`feat:`/`fix:`/`chore:`/`test:`/`docs:`, lowercase, present tense, PR number appended). Branches `type/short-description`. **No AI tool names in commit messages, no `Co-Authored-By` trailers, no `--no-verify`, no git config changes.**

Note: `apps/web/AGENTS.md` warns this is Next.js 16 with breaking changes vs. training data — read `node_modules/next/dist/docs/` (from `apps/web/`) before writing web-app code.
