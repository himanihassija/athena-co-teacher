# Agora ConvoAI — Python demo

A minimal, single-page conversational AI demo: a FastAPI backend mints Agora
RTC tokens and starts/stops an Agora Conversational AI Engine agent; the
browser (plain HTML/JS + the Agora Web SDK, loaded from Agora's CDN) does the
actual audio join/publish/playback. There's no browser-capable RTC SDK for
Python, so the client side has to be JS regardless of backend language.

No third-party LLM/STT/TTS keys required — the agent uses Agora-hosted
presets (`deepgram_nova_2,openai_gpt_4o_mini,minimax_speech_2_6_turbo`),
billed through your Agora project, same as `apps/orchestrator`.

## Setup

```bash
cd apps/python-demo
python -m venv .venv
.venv/Scripts/activate   # Windows; use `source .venv/bin/activate` on macOS/Linux
pip install -r requirements.txt
cp .env.example .env     # then fill in AGORA_APP_ID / AGORA_APP_CERTIFICATE
```

The App ID/Certificate are the same ones in `apps/orchestrator/.env` or
`apps/web/.env.local` — this is the same Agora project, just a different
client.

## Run

```bash
python -m uvicorn app.main:app --reload --port 8000
```

Open http://localhost:8000, click **Start conversation**, allow microphone
access, and talk. Click **End** to stop the agent and leave the channel.

## How it fits together

- `app/agora_token.py` — a Python port of `agora-token`'s AccessToken2 (v007)
  token format. There's no official Agora Python package for the current
  token format, so this mints tokens directly: a signed, zlib-compressed,
  base64 payload, ported field-for-field from the JS source apps/orchestrator
  already depends on (`agora-token`).
- `app/convoai.py` — calls Agora's Conversational AI Engine REST API
  (`POST .../v2/projects/{appId}/join` and `.../leave`) to start and stop the
  agent. Reverse-engineered from `agora-agents`' (the Node SDK apps/
  orchestrator uses) compiled output rather than guessed, since there's no
  public Python SDK for it either.
- `app/main.py` — two routes: `POST /api/join` (mint a browser token, start
  the agent, return both) and `POST /api/leave` (stop the agent).
- `app/static/index.html` — the whole frontend: join/leave buttons, an Agora
  RTC client via the Web SDK, and a status indicator.

## What this doesn't do

This is intentionally minimal — no transcript, no multi-participant rooms, no
teacher/student roles. For all of that, see `apps/orchestrator` +
`apps/web`, which implement the fuller classroom app on the same Agora
Conversational AI Engine.
