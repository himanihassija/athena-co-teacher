"""
FastAPI backend for a minimal Agora Conversational AI Engine demo.

Split of responsibilities (mirrors apps/orchestrator, minus the classroom
features): this process only ever does two things over HTTP —

  1. Mint a short-lived RTC token so the browser can join an Agora channel.
  2. Call Agora's ConvoAI REST API to start/stop the AI agent in that channel.

Everything else — joining the channel, publishing the mic, playing the
agent's audio back — happens client-side via the Agora Web SDK (there is no
browser-capable RTC SDK for Python), served as a static page below.
"""

from __future__ import annotations

import os
import random
import string
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import convoai
from .agora_token import ROLE_PUBLISHER, build_rtc_token

load_dotenv(Path(__file__).parent.parent / ".env")

APP_ID = os.environ.get("AGORA_APP_ID", "")
APP_CERTIFICATE = os.environ.get("AGORA_APP_CERTIFICATE", "")

if not APP_ID or not APP_CERTIFICATE:
    raise RuntimeError(
        "AGORA_APP_ID and AGORA_APP_CERTIFICATE must be set (see .env.example). "
        "This app's own .env can copy the values already in apps/orchestrator/.env."
    )

STATIC_DIR = Path(__file__).parent / "static"
BROWSER_TOKEN_TTL_SECONDS = 60 * 60  # 1 hour — plenty for a demo session
AGENT_UID = "1000"  # fixed, distinct from any browser uid we generate below

app = FastAPI(title="Agora ConvoAI Python Demo")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


def _random_channel() -> str:
    suffix = "".join(random.choices(string.ascii_lowercase + string.digits, k=8))
    return f"convoai-demo-{suffix}"


def _random_uid() -> str:
    # Agora numeric UIDs: 1 to (2^32 - 1). Kept well clear of AGENT_UID.
    return str(random.randint(100_000, 999_999_999))


class JoinRequest(BaseModel):
    display_name: str | None = None


class JoinResponse(BaseModel):
    app_id: str
    channel: str
    uid: str
    token: str
    agent_id: str
    agent_uid: str


class LeaveRequest(BaseModel):
    channel: str
    agent_uid: str
    agent_id: str


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.post("/api/join", response_model=JoinResponse)
async def join(_: JoinRequest) -> JoinResponse:
    channel = _random_channel()
    uid = _random_uid()

    token = build_rtc_token(
        APP_ID,
        APP_CERTIFICATE,
        channel,
        uid,
        ROLE_PUBLISHER,
        BROWSER_TOKEN_TTL_SECONDS,
    )

    try:
        result = await convoai.start_agent(
            APP_ID,
            APP_CERTIFICATE,
            channel,
            AGENT_UID,
            remote_uid=uid,
        )
    except Exception as error:  # noqa: BLE001 — surfaced to the caller as-is
        raise HTTPException(status_code=502, detail=f"Could not start the ConvoAI agent: {error}") from error

    return JoinResponse(
        app_id=APP_ID,
        channel=channel,
        uid=uid,
        token=token,
        agent_id=result.agent_id,
        agent_uid=AGENT_UID,
    )


@app.post("/api/leave")
async def leave(body: LeaveRequest) -> dict[str, bool]:
    try:
        await convoai.stop_agent(APP_ID, APP_CERTIFICATE, body.channel, body.agent_uid, body.agent_id)
    except Exception as error:  # noqa: BLE001 — best-effort cleanup, log and move on
        # The browser has already left the channel by the time this fires;
        # failing to stop the agent shouldn't block the user from leaving.
        print(f"[convoai] stop_agent failed for {body.agent_id}: {error}")
    return {"ok": True}
