/**
 * Orchestrator configuration, resolved once at boot.
 *
 * Agora credentials are the only required values, and they are the only
 * credentials this project has: speech recognition, the model and the voice are
 * all resold through the Agora project, so there is no second vendor key to
 * manage, rotate, or leak. `agora project env write` produces everything below.
 */

export type LlmVendor = 'agora' | 'groq';

function llmVendor(): LlmVendor {
  const value = process.env.LLM_VENDOR ?? 'agora';
  if (value === 'agora' || value === 'groq') return value;
  throw new Error(
    `LLM_VENDOR="${value}" is not supported. Use "agora" (resold OpenAI model) or "groq".`,
  );
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        `Run \`agora project env write .env\` in apps/orchestrator to populate Agora credentials.`,
    );
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? '0.0.0.0',

  agoraAppId: required('NEXT_PUBLIC_AGORA_APP_ID'),
  agoraAppCertificate: required('NEXT_AGORA_APP_CERTIFICATE'),

  /**
   * Which LLM drives the in-call agent.
   *
   *   'agora' (default) — an OpenAI model Agora resells under its own billing
   *                       preset, named by LLM_MODEL. No vendor key involved.
   *   'groq'            — bring-your-own Groq key, model named by
   *                       GROQ_AGENT_MODEL. Adopted because the Anam avatar's
   *                       lip-sync drifted against Agora on the resold GPT-5
   *                       path, and Anam recommends gpt-oss-120b on Groq for
   *                       Agora pipelines.
   *
   * Anything else is refused at boot rather than silently mapped to a default:
   * a typo here would otherwise run a different model than the one the operator
   * believes they configured, which is the exact failure `modelResolution()`
   * exists to surface.
   */
  llmVendor: llmVendor(),

  /**
   * Agora-resold model, used when LLM_VENDOR is 'agora'. Must be one of the
   * presets: gpt-4o-mini, gpt-4.1-mini, gpt-5-nano, gpt-5-mini. Anything else
   * falls back to gpt-4o-mini (see resellerModel()).
   */
  llmModel: process.env.LLM_MODEL ?? 'gpt-4o-mini',

  /**
   * Groq credentials for the in-call agent, used when LLM_VENDOR is 'groq'.
   *
   * Deliberately a separate key from GROQ_API_KEY, which serves the
   * orchestrator's own out-of-call calls (board, quizzes, catch-up). Groq rate
   * limits are per key, and a live voice turn must not queue behind a board
   * illustration. The key is required rather than borrowed from GROQ_API_KEY
   * for the same reason.
   */
  groqAgentApiKey: process.env.LLM_VENDOR === 'groq' ? required('GROQ_AGENT_API_KEY') : '',
  groqAgentModel: process.env.GROQ_AGENT_MODEL ?? 'openai/gpt-oss-120b',

  /**
   * Deepgram language for ASR.
   *
   * Defaults to 'en' because that is what both the official quickstart and the
   * sibling Athena project run, and it is verified working. 'multi' — Deepgram's
   * code-switching mode, which §3.7 wants — is accepted by the join call but
   * produces no transcription at all through Agora's resold Deepgram: the agent
   * starts, reports RUNNING, and silently hears nothing. Change this only with
   * `pnpm --filter @echosphere/web test:speech` to prove words still come back.
   */
  sttLanguage: process.env.STT_LANGUAGE ?? 'en',
  ttsVoiceId: process.env.TTS_VOICE_ID ?? 'English_captivating_female1',

  /** Comma-separated browser origins allowed to call this service. */
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  debugAgora: process.env.DEBUG_AGORA === '1',

  /* Sarvam AI configuration */
  sarvamApiKey: process.env.SARVAM_API_KEY ?? 'mock_sarvam_api_key',
  sarvamSpeaker: process.env.SARVAM_SPEAKER ?? 'anushka',
  sarvamTargetLanguageCode: process.env.SARVAM_TARGET_LANGUAGE_CODE ?? 'hi-IN',

  /* Direct LLM Provider Keys */
  geminiApiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
  geminiModel: process.env.GEMINI_MODEL ?? 'gemini-3.6-flash',
  openaiApiKey: process.env.OPENAI_API_KEY,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY,

  /**
   * Postgres connection string for durable session/report storage (see
   * db/schema.ts). Optional: unset means persistence is a no-op, same
   * graceful-fallback posture as every other integration here. A session
   * still works end-to-end without it — it just isn't flushed anywhere once
   * it ends.
   */
  databaseUrl: process.env.DATABASE_URL,

  /**
   * Supabase project URL, e.g. https://<ref>.supabase.co
   *
   * Used only to locate the project's public JWKS endpoint, so teacher tokens
   * can be verified. No key, secret, or service-role credential is needed or
   * accepted — see auth/supabaseAuth.ts. Unset means tokens cannot be verified
   * and every request is treated as anonymous.
   */
  supabaseUrl: process.env.SUPABASE_URL ?? '',

  /**
   * Whether teacher-owned actions refuse anonymous callers.
   *
   * Defaults to false so that adding the auth gate to a route is a no-op until
   * this is deliberately switched on: the deployed app currently has no login
   * screen, and defaulting this to true would lock every existing user out on
   * the next deploy. Turn it on once the frontend's sign-in flow is live.
   */
  authRequired: process.env.AUTH_REQUIRED === '1',
  resendApiKey: process.env.RESEND_API_KEY,

  /**
   * Sender address for outbound mail.
   *
   * Defaults to Resend's shared sandbox sender, which only reliably delivers to
   * the Resend account owner and has poor reputation with consumer inboxes —
   * set MAIL_FROM to an address on a domain verified in Resend to make delivery
   * dependable.
   */
  mailFrom: process.env.MAIL_FROM ?? 'Athena AI <onboarding@resend.dev>',

  /**
   * Optional SMTP fallback (nodemailer), used when Resend is unset or its send
   * fails. Dormant unless host, user and pass are all provided.
   */
  smtpHost: process.env.SMTP_HOST,
  smtpPort: Number(process.env.SMTP_PORT ?? 587),
  smtpUser: process.env.SMTP_USER,
  smtpPass: process.env.SMTP_PASS,
  smtpFrom: process.env.SMTP_FROM,

  /**
   * Excalidraw+ MCP, which backs Athena's "draw me a diagram" path.
   *
   * The orchestrator is the MCP client here: it calls `create_diagram` and
   * `get_scene_content` on Excalidraw's server directly, and the model's only
   * job is deciding what the diagram should say — which goes through
   * `tryComplete` on whatever provider is already configured. So this needs no
   * second model vendor; the Excalidraw key is the only new credential.
   *
   * Optional, and dormant if unset: `illustrationConfigured()` gates the
   * feature, so a deployment without a key still runs a full lesson, just
   * without diagrams.
   *
   * The scratch scene is where diagrams are laid out before their elements are
   * copied onto the classroom board. Left blank, one is created per classroom
   * session on first use and remembered for the rest of it (see
   * board/boardAgent.ts); setting it pins every session to one shared scene.
   */
  excalidrawMcpApiKey: process.env.EXCALIDRAW_MCP_API_KEY ?? '',
  excalidrawMcpUrl:
    process.env.EXCALIDRAW_MCP_URL ?? 'https://api.excalidraw.com/api/v1/mcp',
  excalidrawScratchSceneId: process.env.EXCALIDRAW_SCRATCH_SCENE_ID ?? '',

  /**
   * Collection the scratch scene is created in. `create_scene` requires one.
   * A personal API key can use the literal 'private' (the default); a
   * workspace key cannot reach private collections and needs a real id.
   */
  excalidrawCollectionId: process.env.EXCALIDRAW_COLLECTION_ID ?? '',

  /** Ceiling on one end-to-end illustrate request, tool round trips included. */
  illustrationTimeoutMs: Number(process.env.ILLUSTRATION_TIMEOUT_MS ?? 20_000),

  /**
   * Anam AI avatar credentials for Athena's silent video overlay.
   *
   * Voice stays entirely on Agora ConvoAI (STT/LLM/TTS, as above); Anam only
   * renders a lip-flapping loop, nudged by `talk()` when Agora reports Athena
   * is actually speaking (see agent/anam.ts). It never owns audio: the
   * client mutes Anam's video element and passes `disableInputAudio: true`
   * so it never opens the mic either.
   *
   * Optional, and dormant if unset: `anamConfigured()` gates the feature, so
   * a deployment without it still runs — Athena just stays on the existing
   * Lottie loop. Same graceful-fallback posture as WHITEBOARD_* above.
   */
  anamApiKey: process.env.ANAM_API_KEY ?? '',
  anamPersonaId: process.env.ANAM_PERSONA_ID ?? '',

  /**
   * Model used for the "what should this diagram say" step, if it should differ
   * from the deployment's ordinary completion model.
   *
   * That step is the only thing that decides diagram quality — Excalidraw+ does
   * the layout and cannot improve the content it is handed — so it is worth
   * being able to point somewhere better without moving every other completion
   * in the orchestrator at the same time.
   *
   * Left blank, the board step uses exactly the provider chain everything else
   * uses, which is the current behaviour. Set, it overrides the model on the
   * PRIMARY provider only (see `CompleteOptions.model`), so a name that
   * provider rejects falls through to the normal chain rather than taking
   * diagrams down.
   *
   * Note that a name here must belong to whichever vendor is first in
   * `resolveProviders`. On this deployment that is Groq, whose key exposes
   * `openai/gpt-oss-120b` (the default and the strongest available),
   * `openai/gpt-oss-20b`, `qwen/qwen3.6-27b` and `qwen/qwen3.8-27b`.
   */
  boardLlmModel: process.env.BOARD_LLM_MODEL ?? '',
} as const;