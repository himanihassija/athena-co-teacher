/**
 * Anam AI client wrapper — silent, muted video overlay for Athena's avatar.
 *
 * Agora ConvoAI stays the source of truth for Athena's voice: this module
 * never lets Anam's own audio reach the speakers (the `<video>` element is
 * rendered `muted`, and `disableInputAudio: true` stops Anam listening to
 * the teacher's mic). All this buys is a lip-flapping loop, nudged by
 * `talk()` whenever Agora reports Athena is actually speaking — it is
 * deliberately not a word-accurate lip sync to what she's saying.
 */

import { createClient, AnamEvent } from '@anam-ai/js-sdk';
import { orchestrator } from '@/lib/orchestrator';

export type AnamStatus = 'idle' | 'connecting' | 'connected' | 'error';

// Short, meaningless filler phrases. Only their rhythm matters — the video
// is muted, so nobody hears them — but re-triggering one every few seconds
// while Athena is speaking keeps the mouth moving for the length of her turn.
const FILLERS = [
  "Mm-hm, let's see.",
  'Okay, so.',
  'Right, and then.',
  'Mm, go on.',
  'I see, yes.',
];

const TALK_RETRIGGER_MS = 2600;

export class AnamAvatarSession {
  private client: ReturnType<typeof createClient> | null = null;
  private talkInterval: ReturnType<typeof setInterval> | null = null;
  private fillerIndex = 0;

  async connect(
    sessionId: string,
    videoElementId: string,
    onStatusChange: (status: AnamStatus) => void,
  ): Promise<void> {
    onStatusChange('connecting');
    try {
      const { sessionToken } = await orchestrator.getAnamToken(sessionId);
      const client = createClient(sessionToken, { disableInputAudio: true });
      this.client = client;

      client.addListener(AnamEvent.CONNECTION_CLOSED, (reason: unknown) => {
        console.warn('Anam connection closed:', reason);
        onStatusChange('error');
      });

      await client.streamToVideoElement(videoElementId);
      onStatusChange('connected');
    } catch (error) {
      // Covers both "Anam not configured on this deployment" (501 from the
      // orchestrator) and any real connection failure — either way the
      // caller falls back to the existing Lottie loop.
      console.warn('Anam avatar unavailable, falling back to Lottie loop:', error);
      onStatusChange('error');
    }
  }

  /** Call whenever Agora's reported speaking state for Athena changes. */
  setSpeaking(speaking: boolean): void {
    if (!this.client) return;

    if (speaking && !this.talkInterval) {
      const nudge = () => {
        this.fillerIndex = (this.fillerIndex + 1) % FILLERS.length;
        this.client?.talk(FILLERS[this.fillerIndex]).catch(() => {
          // best-effort — a dropped nudge just means one shorter idle beat
        });
      };
      nudge();
      this.talkInterval = setInterval(nudge, TALK_RETRIGGER_MS);
    } else if (!speaking && this.talkInterval) {
      clearInterval(this.talkInterval);
      this.talkInterval = null;
    }
  }

  disconnect(): void {
    if (this.talkInterval) {
      clearInterval(this.talkInterval);
      this.talkInterval = null;
    }
    try {
      this.client?.stopStreaming();
    } catch {
      // best-effort — the component is unmounting either way
    }
    this.client = null;
  }
}
