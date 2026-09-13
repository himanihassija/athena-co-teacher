# Deep Dives Index

| Document | Summary | Load When |
| --- | --- | --- |
| [conversation_lifecycle.md](conversation_lifecycle.md) | End-to-end start, join, streaming, renewal, and teardown sequence | Changing session bootstrap, token flow, agent invite, or teardown logic |
| [from_scratch_bootstrap.md](from_scratch_bootstrap.md) | Official baseline implementation map for recreating the Next.js quickstart recipe | Implementing a new baseline repo from this official recipe |
| [invite_agent_config.md](invite_agent_config.md) | Managed agent prompt, VAD, model/provider chain, and session options | Editing agent behavior, BYOK provider wiring, or voice config |
| [strict_mode_lifecycle.md](strict_mode_lifecycle.md) | React StrictMode-safe RTC/toolkit initialization patterns | Modifying `useJoin`, mic track lifecycle, or `AgoraVoiceAI.init` timing |
| [token_model.md](token_model.md) | RTC+RTM token build/renewal model and failure modes | Changing token minting, renewal, UID/channel semantics, or expiry |
| [transcript_pipeline.md](transcript_pipeline.md) | Transcript/event normalization from AgoraVoiceAI and RTM fallback parsing | Changing transcript rendering, metrics/error handling, or RTM integration |
