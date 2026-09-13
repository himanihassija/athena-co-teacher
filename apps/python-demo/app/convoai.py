"""
Agora Conversational AI Engine — REST client.

There's no official Python SDK for the ConvoAI engine (the Node ecosystem has
`agora-agents`; this repo's own apps/orchestrator uses it). This talks to the
same REST API that SDK wraps, reverse-engineered from its compiled output:

  POST {base}/v2/projects/{appId}/join
  POST {base}/v2/projects/{appId}/agents/{agentId}/leave

Auth: "app-credentials" mode — no separate Customer ID/Secret needed, just
the App Certificate already used to mint RTC/RTM tokens. Each request carries
`Authorization: agora token=<AccessToken2 RTC+RTM token>`.

STT/LLM/TTS are Agora-hosted presets (`preset` field below), so this demo
needs no third-party vendor API keys — same "no OpenAI key involved, billed
through the Agora project" posture as apps/orchestrator.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

import httpx

from .agora_token import ROLE_PUBLISHER, build_rtc_rtm_token

CONVOAI_BASE_URL = "https://api.agora.io/api/conversational-ai-agent"

# deepgram_nova_2 (ASR) + openai_gpt_4o_mini (LLM) + minimax_speech_2_6_turbo (TTS),
# all resold through the Agora project — see agora-agents' `AgentPresets`.
DEFAULT_PRESET = "deepgram_nova_2,openai_gpt_4o_mini,minimax_speech_2_6_turbo"

DEFAULT_INSTRUCTIONS = (
    "You are a friendly, concise voice assistant demoing Agora's "
    "Conversational AI Engine. Keep answers short — this is a live voice "
    "conversation, not a chat window."
)
DEFAULT_GREETING = "Hi! I'm your AI co-pilot for this demo. What's on your mind?"

# ConvoAI tokens are AccessToken2 like any other; 24h is the platform max.
TOKEN_TTL_SECONDS = 4 * 60 * 60


@dataclass
class AgentStartResult:
    agent_id: str


def _auth_header(app_id: str, app_certificate: str, channel: str, agent_uid: str) -> dict[str, str]:
    token = build_rtc_rtm_token(
        app_id,
        app_certificate,
        channel,
        agent_uid,
        ROLE_PUBLISHER,
        TOKEN_TTL_SECONDS,
    )
    return {"Authorization": f"agora token={token}"}


async def start_agent(
    app_id: str,
    app_certificate: str,
    channel: str,
    agent_uid: str,
    remote_uid: str,
) -> AgentStartResult:
    """Starts a ConvoAI agent in `channel`, listening for `remote_uid`."""
    agent_token = build_rtc_rtm_token(
        app_id,
        app_certificate,
        channel,
        agent_uid,
        ROLE_PUBLISHER,
        TOKEN_TTL_SECONDS,
    )
    body = {
        "appid": app_id,
        "name": f"python-demo-{int(time.time() * 1000)}",
        "preset": DEFAULT_PRESET,
        "properties": {
            "channel": channel,
            "token": agent_token,
            "agent_rtc_uid": agent_uid,
            "remote_rtc_uids": [remote_uid],
            "idle_timeout": 30,
            "llm": {
                "system_messages": [{"role": "system", "content": DEFAULT_INSTRUCTIONS}],
                "greeting_message": DEFAULT_GREETING,
                "max_history": 20,
            },
        },
    }

    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.post(
            f"{CONVOAI_BASE_URL}/v2/projects/{app_id}/join",
            json=body,
            headers=_auth_header(app_id, app_certificate, channel, agent_uid),
        )
        response.raise_for_status()
        data = response.json()

    agent_id = data.get("agent_id")
    if not agent_id:
        raise RuntimeError(f"ConvoAI /join did not return an agent_id: {data!r}")
    return AgentStartResult(agent_id=agent_id)


async def stop_agent(app_id: str, app_certificate: str, channel: str, agent_uid: str, agent_id: str) -> None:
    """Stops a running agent. Already-stopped (404) is treated as success."""
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.post(
            f"{CONVOAI_BASE_URL}/v2/projects/{app_id}/agents/{agent_id}/leave",
            headers=_auth_header(app_id, app_certificate, channel, agent_uid),
        )
        if response.status_code == 404:
            return
        response.raise_for_status()
