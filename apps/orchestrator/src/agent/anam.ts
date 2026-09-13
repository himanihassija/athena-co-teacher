/**
 * Anam AI session-token minting.
 *
 * Athena's voice, STT and LLM all stay on Agora ConvoAI (see agent/*) — Anam
 * is used purely as a silent, muted video overlay: a lip-flapping loop
 * triggered on Athena's real (Agora-reported) speaking state, not a
 * word-accurate lip sync. See apps/web/lib/anam.ts for the client side of
 * that split.
 *
 * The API key never reaches the browser: the client asks this orchestrator
 * for a short-lived session token, same pattern as mintTokens() in
 * routes/tokens.ts for Agora.
 */

import { config } from '../config.js';

const ANAM_SESSION_TOKEN_URL = 'https://api.anam.ai/v1/auth/session-token';

/** Whether both Anam credentials are present. */
export function anamConfigured(): boolean {
  return Boolean(config.anamApiKey.trim() && config.anamPersonaId.trim());
}

export async function mintAnamSessionToken(): Promise<string> {
  if (!anamConfigured()) {
    throw new Error('Anam is not configured (ANAM_API_KEY / ANAM_PERSONA_ID missing)');
  }

  const response = await fetch(ANAM_SESSION_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.anamApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personaConfig: { personaId: config.anamPersonaId },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Anam session-token request failed (${response.status}): ${detail.slice(0, 200)}`,
    );
  }

  const data = (await response.json()) as { sessionToken: string };
  return data.sessionToken;
}
