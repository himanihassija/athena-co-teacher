/**
 * The audio and transcript-relay layer of a classroom.
 *
 * Two jobs:
 *   1. Join the Agora RTC channel and publish the microphone (PS31 §3.1).
 *   2. Watch Agora's RTM transcript stream and relay finalised segments to the
 *      orchestrator (§3.4, §3.8, §3.9).
 *
 * Job 2 exists because Agora's RTM SDK is browser-only — there is no server
 * variant — so the browser is the only place the agent's ASR output can be
 * observed. Every client in the room sees the same stream, so any of them could
 * relay; the orchestrator de-duplicates by (uid, turnId).
 *
 * The StrictMode guards below are taken from the official quickstart. Removing
 * them causes a double RTC join and a duplicated microphone track.
 *
 * Also exposes Athena's own live remote audio track (via `onAthenaAudioTrack`)
 * so the TalkingHead 3D avatar can analyse it for amplitude-driven lip-sync.
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import AgoraRTC, {
  RemoteAudioTrack,
  useJoin,
  useLocalMicrophoneTrack,
  usePublish,
  useRTCClient,
  useRemoteAudioTracks,
  useRemoteUsers,
} from 'agora-rtc-react';
import {
  AgoraVoiceAI,
  AgoraVoiceAIEvents,
  MessageType,
  TranscriptHelperMode,
  type AgentState,
  type AgentTranscription,
  type TranscriptHelperItem,
  type UserTranscription,
} from 'agora-agent-client-toolkit';
import type { RTMClient } from 'agora-rtm';
import { orchestrator } from '@/lib/orchestrator';
import { normalizeTranscriptSpacing } from '@/lib/conversation';

export interface ClassroomAudioProps {
  sessionId: string;
  channel: string;
  appId: string;
  uid: string;
  rtcToken: string;
  rtmClient: RTMClient;
  /** RTC uid of the AI co-teacher, so its turns can be told from a human's. */
  agentUid: string;
  /**
   * Whether this client relays transcripts to the orchestrator.
   *
   * Exactly one client must, and it has to be the teacher's. Human turns carry
   * no speaker identity of their own, so attribution comes from this browser's
   * volume indicator — two relays would mean two different browsers each
   * guessing a speaker for the same words, and the transcript would show every
   * utterance twice under two names.
   */
  isRelay: boolean;
  micEnabled: boolean;
  onAgentStateChange?: (state: AgentState | null) => void;
  onConnectionStateChange?: (state: string) => void;
  /**
   * The live loudest speaker's RTC uid (or null when the room is quiet), from
   * the same 150ms volume poll that drives transcript attribution. Drives the
   * roster's speaking glow. Fires only on change.
   */
  onSpeakingChange?: (speakerUid: string | null) => void;
  /** Fires once the transcript pipeline is live. */
  onToolkitReady?: (ready: boolean) => void;
  /** Fires when transcription could not be started at all. */
  onToolkitError?: (message: string) => void;
  /**
   * Fires when the local microphone track could not be created — most
   * commonly no microphone hardware/device present (DEVICE_NOT_FOUND) or the
   * browser permission was denied. The room stays usable in listen-only mode
   * either way; this just lets the page explain why.
   */
  onMicError?: (message: string) => void;
  /**
   * Fires on the relay client when this tab is hidden or shown again.
   *
   * Only meaningful when `isRelay` — see the effect below for why a hidden tab
   * stops the room's transcript.
   */
  onRelayHiddenChange?: (hidden: boolean) => void;
  /**
   * Fires with Athena's own live remote audio track whenever it's available
   * (or `undefined` if she's not currently publishing audio). Consumed by
   * AthenaTalkingHead to drive amplitude-based lip-sync — Agora's resold TTS
   * exposes no phoneme/viseme timing, so this raw track is the only signal
   * available for mouth movement.
   */
  onAthenaAudioTrack?: (track: any) => void;
}

/** A human-readable reason for `useLocalMicrophoneTrack`'s error, if any. */
function describeMicError(error: { message: string; rtcError: unknown }): string {
  const code =
    error.rtcError && typeof error.rtcError === 'object' && 'code' in error.rtcError
      ? String((error.rtcError as { code: unknown }).code)
      : undefined;

  if (code === 'DEVICE_NOT_FOUND') {
    return 'No microphone was found on this device.';
  }
  if (code === 'PERMISSION_DENIED') {
    return 'Microphone access was denied.';
  }
  if (code === 'NOT_READABLE') {
    return 'The microphone is already in use by another application.';
  }
  return error.message || 'The microphone could not be started.';
}

type AgoraRtcWithParameters = typeof AgoraRTC & {
  setParameter?: (key: string, value: unknown) => void;
};

/**
 * How long a turn's text must stay unchanged before it is treated as finished.
 *
 * Comfortably longer than the gap between two ASR snapshots of the same turn,
 * short enough that the transcript still feels live.
 */
const TURN_SETTLE_MS = 1200;

/**
 * Longest a still-growing turn may go unpublished.
 *
 * Speech without a pause never settles, so the debounce alone would hide a long
 * answer completely until the speaker stopped. This publishes the turn so far
 * and lets the server update the same row in place.
 */
const TURN_MAX_HOLD_MS = 2500;

type ToolkitItem = TranscriptHelperItem<
  Partial<UserTranscription | AgentTranscription>
>;

function normalizeTurnId(turnId: unknown): number | undefined {
  if (typeof turnId === 'number' && Number.isFinite(turnId)) return turnId;
  if (typeof turnId === 'string' && turnId.trim().length > 0) {
    const parsed = Number(turnId);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/**
 * `AgoraVoiceAI` is a process-wide singleton, which makes naive per-mount
 * teardown actively destructive: `init()` hands every caller the same object,
 * so a discarded StrictMode mount calling `destroy()` in its cleanup kills the
 * instance the real mount is using. Handlers stay attached to a dead object,
 * TRANSCRIPT_UPDATED never fires again, and the room goes silent with no error
 * anywhere — which is exactly the failure this replaces.
 *
 * So ownership is reference-counted here, with the same grace period as the RTM
 * client, and mounts attach/detach their own listeners with on/off rather than
 * disposing the shared instance.
 */
let voiceAiPromise: Promise<VoiceAiInstance> | null = null;
let voiceAiRefs = 0;
let voiceAiDisposeTimer: ReturnType<typeof setTimeout> | null = null;

type VoiceAiInstance = Awaited<ReturnType<typeof AgoraVoiceAI.init>>;

function acquireVoiceAI(
  rtcEngine: Parameters<typeof AgoraVoiceAI.init>[0]['rtcEngine'],
  rtmEngine: RTMClient,
  channel: string,
): Promise<VoiceAiInstance> {
  if (voiceAiDisposeTimer !== null) {
    clearTimeout(voiceAiDisposeTimer);
    voiceAiDisposeTimer = null;
  }
  voiceAiRefs += 1;

  if (!voiceAiPromise) {
    voiceAiPromise = AgoraVoiceAI.init({
      rtcEngine,
      rtmConfig: { rtmEngine },
      renderMode: TranscriptHelperMode.TEXT,
      enableLog: false,
    }).then((ai) => {
      // Bound here, once per instance, rather than per mount.
      //
      // subscribeMessage binds the toolkit's own RTC and RTM handlers and
      // starts the chunk reassembler. Calling it twice on a shared instance
      // binds everything twice, so every RTM frame is fed through reassembly
      // twice and the partial-message state goes out of sync — which surfaces
      // as `new Uint8Array(-25446)` deep inside the SDK rather than as
      // anything resembling a double-subscription.
      ai.subscribeMessage(channel);
      return ai;
    });
    // A failed init must not be cached, or the room can never recover.
    voiceAiPromise.catch(() => {
      voiceAiPromise = null;
      voiceAiRefs = 0;
    });
  }

  return voiceAiPromise;
}

function releaseVoiceAI(): void {
  voiceAiRefs = Math.max(0, voiceAiRefs - 1);
  if (voiceAiRefs > 0 || voiceAiDisposeTimer !== null) return;

  voiceAiDisposeTimer = setTimeout(() => {
    voiceAiDisposeTimer = null;
    if (voiceAiRefs > 0) return;
    const pending = voiceAiPromise;
    voiceAiPromise = null;
    pending
      ?.then((ai) => {
        ai.unsubscribe();
        ai.destroy();
      })
      .catch(() => undefined);
  }, 3000);
}

export function ClassroomAudio({
  sessionId,
  channel,
  appId,
  uid,
  rtcToken,
  rtmClient,
  agentUid,
  isRelay,
  micEnabled,
  onAgentStateChange,
  onConnectionStateChange,
  onSpeakingChange,
  onToolkitReady,
  onToolkitError,
  onMicError,
  onRelayHiddenChange,
  onAthenaAudioTrack,
}: ClassroomAudioProps) {
  const client = useRTCClient();
  const remoteUsers = useRemoteUsers();
  // Subscribe to and play every remote participant's audio. In an audio-only
  // classroom `<RemoteUser>` is wrong — it renders a video-player div (a black
  // box) and, hidden, its playback became unreliable. `useRemoteAudioTracks`
  // does the subscription and `<RemoteAudioTrack>` renders nothing.
  const { audioTracks } = useRemoteAudioTracks(remoteUsers);

  // Athena's own track, singled out for the TalkingHead avatar's amplitude
  // analyser. Reported up via onAthenaAudioTrack whenever it changes.
  const athenaAudioTrack = audioTracks.find(
    (track) => String(track.getUserId()) === agentUid,
  );

  useEffect(() => {
    onAthenaAudioTrack?.(athenaAudioTrack);
  }, [athenaAudioTrack, onAthenaAudioTrack]);

  // StrictMode guard from the quickstart: React's simulated unmount fires
  // cleanup synchronously before any setTimeout callback, so only the real
  // mount's timer survives and useJoin runs exactly once.
  const [isReady, setIsReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const id = setTimeout(() => {
      if (!cancelled) setIsReady(true);
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(id);
      setIsReady(false);
    };
  }, []);

  const { isConnected: joinSuccess } = useJoin(
    { appid: appId, channel, token: rtcToken, uid: parseInt(uid, 10) },
    isReady,
  );

  const { localMicrophoneTrack, error: micTrackError } =
    useLocalMicrophoneTrack(isReady);
  usePublish(localMicrophoneTrack ? [localMicrophoneTrack] : []);

  // Mute via setEnabled only — unpublishing here would fight usePublish.
  useEffect(() => {
    if (!localMicrophoneTrack) return;
    void localMicrophoneTrack.setEnabled(micEnabled);
  }, [localMicrophoneTrack, micEnabled]);

  // No mic track means no publish, silently — the room otherwise looks
  // connected with no indication the user's audio was never sent. Surfaced
  // once per failure so a device-not-found machine can still join to listen.
  useEffect(() => {
    if (!micTrackError) return;
    onMicError?.(describeMicError(micTrackError));
  }, [micTrackError, onMicError]);

  /**
   * Who spoke most recently, by RTC uid, plus how sure we are.
   *
   * The toolkit reports every human turn as uid "0" — it was built for a 1:1
   * call, so it has no notion of which of several people is talking. Without
   * another signal, whichever browser relays a turn claims it as its own, which
   * is how one student's question showed up twice: once as them, once as the
   * teacher.
   *
   * A sibling Agora ConvoAI project (a 3-contestant game show with the same
   * "who actually spoke" problem) solves it with each participant's own device
   * self-reporting its mic level over HTTP — the loudest self-report wins, and
   * a too-close call is surfaced as a first-class "contested" result rather
   * than a confident guess. This project has no separate per-participant
   * device to ask, only whatever a single listening browser can measure of
   * everyone else's remote track — so the SIGNAL here is necessarily weaker.
   * What is worth carrying over is the OUTPUT shape: track the runner-up, not
   * only the winner, and attach a confidence score using their
   * `best / (best + second)` formula, so a close call reaches the transcript
   * marked uncertain instead of stated as fact.
   */
  const dominantSpeakerRef = useRef<string | null>(null);
  const attributionConfidenceRef = useRef<number>(1);
  const lastSpeakingUidRef = useRef<string | null>(null);
  /** Guards the one-time payload-shape probe in `onTranscript`. */
  const loggedTranscriptShape = useRef(false);

  /**
   * Drains every pending turn immediately.
   *
   * Populated by the transcript effect below so the visibility handler can
   * flush before this tab's timers are throttled, without either effect
   * depending on the other's lifecycle.
   */
  const flushPendingTurnsRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!joinSuccess) return;

    // Deliberately NOT client.enableAudioVolumeIndicator(): that event is
    // fixed by the SDK at a 2-second reporting interval with no way to
    // configure it — confirmed against the SDK's own typings, not assumed.
    // Attribution is decided once, at the first sight of a new turn_id, so a
    // stale 2-second-old reading can misattribute the opening of a fast
    // handoff (teacher finishes, a student answers within that window).
    //
    // Each remote track's own `getVolumeLevel()` is real-time and pollable at
    // any rate — its own doc comment recommends it over the indicator event
    // for exactly this reason. Polled here at 150ms, well under the ~2s VAD
    // silence gap that opens a new turn, so the reading is fresh by the time
    // one does.
    const POLL_MS = 150;
    const LEVEL_THRESHOLD = 0.06;

    const id = window.setInterval(() => {
      const candidates: { speakerUid: string; level: number }[] = [];

      // The local track is a candidate too. Only the teacher's browser runs
      // this relay, so "local" here means the teacher's own mic — without
      // checking it, a student's turn ending would leave dominantSpeakerRef
      // pointing at that student even after the teacher starts talking again,
      // misattributing the teacher's own next turn to whoever spoke last.
      const localLevel = localMicrophoneTrack?.getVolumeLevel() ?? 0;
      if (localLevel >= LEVEL_THRESHOLD) {
        candidates.push({ speakerUid: uid, level: localLevel });
      }

      for (const user of remoteUsers) {
        const track = user.audioTrack;
        if (!track) continue;
        const level = track.getVolumeLevel();
        if (level < LEVEL_THRESHOLD) continue;
        candidates.push({ speakerUid: String(user.uid), level });
      }

      const [best, second] = candidates.sort((a, b) => b.level - a.level);

      // Surface the live loudest speaker (agent included) for the roster's
      // speaking glow. Only fires on change, not every 150ms tick. This is the
      // one place this signal is observed; the transcript-attribution logic
      // below is untouched.
      const speakingUid = best?.speakerUid ?? null;
      if (speakingUid !== lastSpeakingUidRef.current) {
        lastSpeakingUidRef.current = speakingUid;
        onSpeakingChange?.(speakingUid);
      }

      if (!best || best.speakerUid === agentUid) return;

      dominantSpeakerRef.current = best.speakerUid;
      // Confidence only reflects a genuine two-way comparison. With nobody else
      // audible there is nothing to be uncertain against, so it reads as 1 —
      // matching the source project's own "only one candidate, a fact not a
      // score" case.
      attributionConfidenceRef.current = second
        ? best.level / (best.level + second.level)
        : 1;
    }, POLL_MS);

    return () => window.clearInterval(id);
  }, [joinSuccess, remoteUsers, agentUid, uid, localMicrophoneTrack, onSpeakingChange]);

  /**
   * Reports when the relaying tab goes into the background.
   *
   * Relaying runs on `setTimeout` (the turn settle and max-hold below) and a
   * 150ms `setInterval` (the attribution poll above). Chrome clamps both to
   * >=1s in a hidden tab, and to once per MINUTE after five minutes hidden. So
   * a backgrounded teacher tab freezes the transcript for the ENTIRE room and
   * lets attribution go stale — silently, because every other signal (RTC, RTM,
   * SSE) stays perfectly healthy and nothing anywhere reports an error.
   *
   * Reported rather than worked around: there is no way to run this reliably in
   * a hidden tab. Pending turns are flushed on the way out so whatever was
   * mid-sentence still lands.
   */
  useEffect(() => {
    if (!isRelay) return;
    const onVisibility = () => {
      if (document.hidden) flushPendingTurnsRef.current?.();
      onRelayHiddenChange?.(document.hidden);
    };
    document.addEventListener('visibilitychange', onVisibility);
    onVisibility();
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      onRelayHiddenChange?.(false);
    };
  }, [isRelay, onRelayHiddenChange]);

  // Module-level SDK parameter; must be set before publishing for the
  // transcript timestamps to line up with the audio.
  useEffect(() => {
    try {
      (AgoraRTC as AgoraRtcWithParameters).setParameter?.('ENABLE_AUDIO_PTS', true);
    } catch {
      // Non-fatal: transcripts still arrive, timings are just coarser.
    }
  }, []);

  useEffect(() => {
    onConnectionStateChange?.(joinSuccess ? 'CONNECTED' : 'CONNECTING');
  }, [joinSuccess, onConnectionStateChange]);

  /**
   * Turns waiting to settle before they are relayed.
   *
   * The toolkit's transcript item is a cumulative buffer, not a finished turn:
   * it re-emits the same `turn_id` over and over with the text grown by a few
   * words, and every one of those snapshots carries a settled status. Relaying
   * on each emit therefore produced dozens of requests for one sentence, each a
   * longer prefix of the last — which is what made the transcript read as
   * stuttering fragments.
   *
   * So a turn is held until its text stops changing, and only then sent. The
   * speaker is decided once, when the turn is first seen, and never revised:
   * recomputing it per snapshot let a single sentence drift between two people.
   */
  const pendingTurnsRef = useRef<
    Map<
      string,
      {
        text: string;
        speakerUid: string;
        turnId: number | undefined;
        /** Undefined for the agent's own turns — there is nothing to guess there. */
        attributionConfidence: number | undefined;
        /** When this turn was last published, for the max-hold ceiling. */
        lastFlushAt: number;
        timer: ReturnType<typeof setTimeout>;
      }
    >
  >(new Map());

  useEffect(() => {
    const pending = pendingTurnsRef.current;
    return () => {
      for (const entry of pending.values()) clearTimeout(entry.timer);
      pending.clear();
    };
  }, []);

  useEffect(() => {
    if (!isReady || !joinSuccess) return;
    let cancelled = false;
    let acquired = false;

    // Held so they can be removed individually on unmount. Destroying the
    // shared instance here instead would take the transcript stream away from
    // every other mount using it.
    const onState = (_: unknown, event: { state: AgentState }) => {
      onAgentStateChange?.(event.state);
      // Only the relay reports this. Two clients reporting the same transition
      // would ask the orchestrator to adjudicate the same turn twice.
      if (isRelay) {
        void orchestrator
          .postAgentState(sessionId, String(event.state))
          .catch(() => undefined);
      }
    };

    const onAgentError = (agentUserId: string, error: { message?: string }) => {
      console.warn('[classroom] agent notice', agentUserId, error);
      if (error && typeof error.message === 'string' && error.message.trim().length > 0) {
        onToolkitError?.(error.message);
      }
    };

    const onMessageError = (agentUserId: string, error: { message?: string }) => {
      console.warn('[classroom] agent message notice', agentUserId, error);
      if (error && typeof error.message === 'string' && error.message.trim().length > 0) {
        onToolkitError?.(error.message);
      }
    };

    const flushTurn = (key: string, keepGrowing = false) => {
      const entry = pendingTurnsRef.current.get(key);
      if (!entry) return;

      if (keepGrowing) {
        // An interim publish of a turn still being spoken. The entry stays so
        // the final version still lands when the speaker stops.
        entry.lastFlushAt = Date.now();
      } else {
        clearTimeout(entry.timer);
        pendingTurnsRef.current.delete(key);
      }

      void orchestrator
        .postTranscript(sessionId, {
          uid: entry.speakerUid,
          // Some TTS and ASR output runs sentences together — "everyone,I'm" —
          // so punctuation spacing is repaired before the turn is stored.
          text: normalizeTranscriptSpacing(entry.text),
          isFinal: true,
          turnId: entry.turnId,
          attributionConfidence: entry.attributionConfidence,
        })
        .catch((error) => {
          console.warn('[classroom] transcript relay failed:', error);
          onToolkitError?.(
            error instanceof Error ? error.message : 'Transcript relay failed',
          );
        });
    };

    // Exposed for the visibility handler above. Keyed off the same `flushTurn`,
    // so a drained turn takes the identical path a settled one would.
    flushPendingTurnsRef.current = () => {
      for (const key of [...pendingTurnsRef.current.keys()]) flushTurn(key);
    };

    const onTranscript = (items: ToolkitItem[]) => {
      if (!isRelay) return;
      const now = Date.now();

      for (const item of items) {
        const text = typeof item.text === 'string' ? item.text.trim() : '';
        if (text.length === 0) continue;

        // One-time probe. The engine documents a `user_id` on user
        // transcriptions, which would replace the volume-level guess below
        // outright. The toolkit overwrites `item.uid` with "0" for every human
        // turn (it was built for a 1:1 call) but preserves the raw message in
        // `metadata`, so the real uid should survive there. Logged once so a
        // single session settles whether it is populated in a multi-party
        // channel.
        if (!loggedTranscriptShape.current) {
          loggedTranscriptShape.current = true;
          console.info('[classroom] transcript item shape', JSON.stringify(item));
        }

        // `metadata.object` is the only reliable discriminator. The agent's uid
        // is not: when a turn was started by an injected instruction, the engine
        // treats that instruction as user input and her reply comes back on the
        // same turn under uid "0" — so a uid check labelled Athena's own answer
        // as the teacher's speech.
        const isAgent =
          item.metadata?.object === MessageType.AGENT_TRANSCRIPTION ||
          String(item.uid) === agentUid;
        const turnId = normalizeTurnId(item.turn_id);
        if (turnId === undefined) {
          console.warn('[classroom] transcript item missing numeric turn_id', item);
        }
        // The agent and a human can share a turn_id: a turn started by an
        // injected instruction holds both that instruction and her reply. Keyed
        // on turn_id alone they collided, and because the speaker is fixed at
        // first sight, her answer inherited the instruction's attribution and
        // was logged as the teacher speaking.
        // `stream_id` distinguishes two speakers inside one turn_id. The toolkit
        // keys its own history on turn_id + stream_id + uid and correctly holds
        // two separate items when two people speak within one turn; keying on
        // turn_id alone collapsed them onto one entry here, where they
        // overwrote each other and both were attributed to whoever spoke first.
        const streamId = typeof item.stream_id === 'number' ? item.stream_id : 0;
        const key = `${turnId ?? `${item.uid}:${text}`}:${streamId}:${isAgent ? 'agent' : 'human'}`;
        const existing = pendingTurnsRef.current.get(key);

        if (existing && existing.text === text) continue;
        if (existing) clearTimeout(existing.timer);

        // The engine identifies the speaker on the transcription payload
        // itself. The toolkit overwrites `item.uid` with "0" for every human
        // turn — it was built for a 1:1 call and has no notion of several
        // people — but it preserves the raw message in `metadata`, so the real
        // RTC uid survives there. Preferred over the volume poll below, which
        // can only ever guess, and which misattributes a quiet mic, a short
        // answer, or a fast handoff. Falls back to the guess when absent, so a
        // payload without it behaves exactly as before.
        const reportedUid =
          typeof item.metadata?.user_id === 'string' &&
          item.metadata.user_id.trim().length > 0 &&
          item.metadata.user_id.trim() !== '0'
            ? item.metadata.user_id.trim()
            : undefined;

        // Attribution is fixed at first sight. Where the engine did not name
        // the speaker, the loudest recent speaker stands in — but only once, or
        // the sentence would change owner as it grows.
        const speakerUid =
          existing?.speakerUid ??
          (isAgent ? agentUid : (reportedUid ?? dominantSpeakerRef.current ?? uid));
        // A reported uid is a fact, not a guess, so it is not scored against a
        // runner-up the way the volume reading is.
        const attributionConfidence =
          existing?.attributionConfidence ??
          (isAgent
            ? undefined
            : reportedUid
              ? 1
              : attributionConfidenceRef.current);

        // A newer turn means every earlier one is definitively finished.
        for (const [otherKey, otherEntry] of pendingTurnsRef.current) {
          if (
            otherEntry.turnId !== undefined &&
            turnId !== undefined &&
            otherEntry.turnId < turnId
          ) {
            flushTurn(otherKey);
          }
        }

        pendingTurnsRef.current.set(key, {
          text,
          speakerUid,
          turnId,
          attributionConfidence,
          // Seeded with the current time, not zero: a fresh turn has nothing
          // worth publishing yet, and starting the clock at zero made the
          // ceiling fire on the very first fragment of every turn.
          lastFlushAt: existing?.lastFlushAt ?? now,
          timer: setTimeout(() => flushTurn(key), TURN_SETTLE_MS),
        });

        // Someone speaking without pause would otherwise stay invisible: the
        // settle timer keeps being pushed back and the turn is never published.
        // Publishing on a ceiling keeps the transcript live during a long
        // answer; the server replaces the row rather than adding one, so the
        // reader just sees the sentence extend.
        const entry = pendingTurnsRef.current.get(key);
        if (entry && now - entry.lastFlushAt >= TURN_MAX_HOLD_MS) {
          flushTurn(key, true);
        }
      }
    };

    acquireVoiceAI(client, rtmClient, channel)
      .then((ai) => {
        if (cancelled) {
          releaseVoiceAI();
          return;
        }
        acquired = true;
        ai.on(AgoraVoiceAIEvents.AGENT_STATE_CHANGED, onState);
        ai.on(AgoraVoiceAIEvents.TRANSCRIPT_UPDATED, onTranscript);
        // The engine reports its own pipeline failures — an LLM call that
        // errored, an ASR module that fell over — only through these. Ignoring
        // them is why a broken agent looked exactly like a silent one.
        ai.on(AgoraVoiceAIEvents.AGENT_ERROR, onAgentError);
        ai.on(AgoraVoiceAIEvents.MESSAGE_ERROR, onMessageError);
        onToolkitReady?.(true);
      })
      .catch((error) => {
        if (cancelled) return;
        // Previously this only reached the console, so a failed init looked
        // exactly like a quiet room. It is the difference between "nobody has
        // spoken" and "nothing can be heard", so it has to be visible.
        console.error('[classroom] AgoraVoiceAI init failed:', error);
        onToolkitError?.(
          error instanceof Error ? error.message : 'Transcription unavailable',
        );
      });

    return () => {
      cancelled = true;
      flushPendingTurnsRef.current = null;
      if (!acquired) return;
      const ai = AgoraVoiceAI.getInstance();
      if (ai) {
        ai.off(AgoraVoiceAIEvents.AGENT_STATE_CHANGED, onState);
        ai.off(AgoraVoiceAIEvents.TRANSCRIPT_UPDATED, onTranscript);
        ai.off(AgoraVoiceAIEvents.AGENT_ERROR, onAgentError);
        ai.off(AgoraVoiceAIEvents.MESSAGE_ERROR, onMessageError);
      }
      releaseVoiceAI();
    };
  }, [
    isReady,
    joinSuccess,
    client,
    channel,
    agentUid,
    onToolkitReady,
    onToolkitError,
    rtmClient,
    isRelay,
    sessionId,
    uid,
    onAgentStateChange,
  ]);

  return (
    <>
      {/*
        Subscribing is not playing. `useJoin`/`usePublish` get this client into
        the channel and its mic out, but nothing plays what comes back — without
        this the room is mute both ways: nobody hears another student, nobody
        hears Athena. `<RemoteAudioTrack>` plays each remote track and renders
        nothing (no video container, so no black box, and no visibility rules
        to trip). The volume poll above reads user.audioTrack, which
        `useRemoteAudioTracks` populates by subscribing.
      */}
      {audioTracks.map((track) => (
        <RemoteAudioTrack key={track.getUserId()} play track={track} />
      ))}
      <div className="sr-only" aria-live="polite">
        {joinSuccess
          ? `Connected to classroom audio with ${remoteUsers.length} other participants.`
          : 'Connecting to classroom audio…'}
      </div>
    </>
  );
}