'use client';

/**
 * Athena's 3D avatar, replacing the Anam video/Lottie tile.
 *
 * Built on met4citizen/TalkingHead — a Three.js class that renders a
 * Ready Player Me GLB avatar with lip-sync. TalkingHead is normally driven by
 * TTS providers that expose phoneme/viseme timing (ElevenLabs, Azure, Google,
 * HeadTTS). Agora's resold TTS gives us none of that — only a raw live audio
 * track — so lip movement here is driven by the track's real-time volume
 * level instead of true visemes. It's an approximation (mouth opens with
 * loudness, not per-phoneme shape), the same category of trade-off as the
 * muted-video approach before it, just on a real 3D head instead of a flat
 * clip.
 *
 * This component is dynamically imported with `ssr: false` wherever it's
 * used — importing `three`/TalkingHead at module scope crashes under SSR the
 * same way `agora-rtc-react` did (see ParticipantGrid.tsx's history).
 */

import { useEffect, useRef, useState } from 'react';

/** Default Ready Player Me sample avatar — replace with your own .glb URL any time. */
const DEFAULT_AVATAR_URL = '/athena-avatar.glb';

export interface AthenaTalkingHeadProps {
  /** Athena's live remote audio track (from ClassroomAudio / useRemoteAudioTracks). */
  audioTrack: any;
  /** Whether she's actively speaking right now — pauses idle animation when true. */
  speaking?: boolean;
  /** Optional: override the default sample avatar with your own RPM .glb URL. */
  avatarUrl?: string;
}

export function AthenaTalkingHead({
  audioTrack,
  speaking = false,
  avatarUrl = DEFAULT_AVATAR_URL,
}: AthenaTalkingHeadProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<any>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the TalkingHead instance and the avatar once, on mount.
  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const { TalkingHead } = await import('@met4citizen/talkinghead');
        if (cancelled || !containerRef.current) return;

        const head = new TalkingHead(containerRef.current, {
          ttsEndpoint: null, // we drive audio ourselves — no built-in TTS provider
          lipsyncModules: [],
          cameraView: 'head',
        });

        await head.showAvatar({
          url: avatarUrl,
          body: 'F',
          avatarMood: 'neutral',
        });

        if (cancelled) {
          head.dispose?.();
          return;
        }

        headRef.current = head;
        setLoaded(true);
      } catch (err) {
        console.error('[AthenaTalkingHead] failed to load:', err);
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Avatar failed to load');
        }
      }
    }

    void init();

    return () => {
      cancelled = true;
      headRef.current?.dispose?.();
      headRef.current = null;
      setLoaded(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avatarUrl]);

  // Wire up a Web Audio analyser on Athena's live track, and drive the
  // avatar's mouth-open amount from real-time volume — this is the
  // amplitude-based lip-sync approximation described above.
  useEffect(() => {
    if (!loaded || !audioTrack) return;

    let cancelled = false;

    async function connectAnalyser() {
      try {
        const mediaStreamTrack: MediaStreamTrack | undefined =
          audioTrack.getMediaStreamTrack?.();
        if (!mediaStreamTrack) return;

        const stream = new MediaStream([mediaStreamTrack]);
        const audioCtx = new AudioContext();
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.6;
        source.connect(analyser);

        if (cancelled) {
          audioCtx.close();
          return;
        }

        audioCtxRef.current = audioCtx;
        analyserRef.current = analyser;

        const data = new Uint8Array(analyser.frequencyBinCount);

        const tick = () => {
          const head = headRef.current;
          const an = analyserRef.current;
          if (!head || !an) return;

          an.getByteFrequencyData(data);
          const avg = data.reduce((s, v) => s + v, 0) / data.length;
          // Normalise to a 0–1 mouth-open amount, with a floor so silence
          // fully closes the mouth and a cap so clipping audio doesn't force
          // an unnaturally wide-open jaw.
          const mouthOpen = Math.min(1, Math.max(0, (avg - 8) / 60));

          try {
            head.setMouthAudioLevel?.(mouthOpen);
            // Fallback if the installed TalkingHead version doesn't expose
            // setMouthAudioLevel directly (API surface has moved between
            // releases) — the morph target it drives internally.
          } catch {
            // Non-fatal: the avatar just idles without lip movement.
          }

          rafRef.current = requestAnimationFrame(tick);
        };
        tick();
      } catch (err) {
        console.error('[AthenaTalkingHead] audio analyser setup failed:', err);
      }
    }

    void connectAnalyser();

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      analyserRef.current?.disconnect();
      analyserRef.current = null;
      void audioCtxRef.current?.close();
      audioCtxRef.current = null;
    };
  }, [loaded, audioTrack]);

  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center text-xs text-[var(--eco-cream-faint)]">
        Avatar unavailable
      </div>
    );
  }

  return <div ref={containerRef} className="h-full w-full" />;
}