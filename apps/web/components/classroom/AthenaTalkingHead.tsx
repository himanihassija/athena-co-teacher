'use client';

/**
 * Athena's 3D avatar, replacing the Anam video/Lottie tile.
 *
 * Built on met4citizen/TalkingHead — a Three.js class that renders an
 * RPM-format GLB avatar with lip-sync. TalkingHead is normally driven by
 * TTS providers that expose phoneme/viseme timing (ElevenLabs, Azure,
 * Google, HeadTTS). Agora's resold TTS gives us none of that — only a raw
 * live audio track — so lip-sync here is driven by met4citizen's own
 * companion library, HeadAudio: a real-time, audio-driven viseme classifier
 * (MFCC features + Gaussian/Mahalanobis classification) that needs no
 * transcript or timestamps, built specifically for this "raw audio only"
 * case. See https://github.com/met4citizen/HeadAudio.
 *
 * An earlier version of this component called a `head.setMouthAudioLevel()`
 * method that does not exist on TalkingHead — that was a guess, made before
 * the real API was confirmed, and it failed silently (wrapped in a
 * try/catch), which is why the avatar loaded and spoke but never animated
 * its mouth. HeadAudio is the library author's actual intended solution for
 * this scenario and is used here instead.
 *
 * HeadAudio ships as plain JS modules + a small pretrained binary model,
 * not an npm package — self-hosted under /public/headaudio/ rather than
 * fetched from GitHub at runtime, same reasoning as self-hosting the avatar
 * .glb after Ready Player Me's shutdown: no runtime dependency on a
 * third-party host that could change or disappear.
 *
 * This component is dynamically imported with `ssr: false` wherever it's
 * used — importing `three`/TalkingHead at module scope crashes under SSR
 * (see ParticipantGrid.tsx's history with agora-rtc-react for the same
 * failure mode).
 */

import { useEffect, useRef, useState } from 'react';

/** Self-hosted avatar (Ready Player Me's own hosting shut down Jan 2026). */
const DEFAULT_AVATAR_URL = '/athena-avatar.glb';

const HEADAUDIO_MODULE_URL = '/headaudio/headaudio.min.mjs';
const HEADWORKLET_MODULE_URL = '/headaudio/headworklet.min.mjs';
const HEADAUDIO_MODEL_URL = '/headaudio/model-en-mixed.bin';

export interface AthenaTalkingHeadProps {
  /** Athena's live remote audio track (from ClassroomAudio / useRemoteAudioTracks). */
  audioTrack: any;
  /** Whether she's actively speaking right now. Currently unused directly —
   * HeadAudio detects speech activity from the audio itself — kept for a
   * future idle/attention animation hook. */
  speaking?: boolean;
  /** Optional: override the default self-hosted avatar with a different .glb URL. */
  avatarUrl?: string;
}

export function AthenaTalkingHead({
  audioTrack,
  avatarUrl = DEFAULT_AVATAR_URL,
}: AthenaTalkingHeadProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<any>(null);
  const headAudioRef = useRef<any>(null);
  const mediaSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load TalkingHead, the avatar, and the HeadAudio lip-sync engine once, on mount.
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

        // Register the HeadAudio worklet processor on TalkingHead's own
        // AudioContext (head.audioCtx) — HeadAudio's viseme output is wired
        // directly into this same head instance's morph targets, so it must
        // share one audio graph rather than running in a second, separate
        // AudioContext.
        await head.audioCtx.audioWorklet.addModule(HEADWORKLET_MODULE_URL);

        // webpackIgnore: these are runtime browser-URL imports of plain
        // static files under /public, not bundler-resolvable module
        // specifiers — telling webpack not to try to statically analyse them
        // avoids a build-time resolution error for a path that only exists
        // once deployed.
        const { HeadAudio } = await import(
          /* webpackIgnore: true */ HEADAUDIO_MODULE_URL
        );

        const headaudio = new HeadAudio(head.audioCtx, {
          processorOptions: {},
          parameterData: {
            vadGateActiveDb: -40,
            vadGateInactiveDb: -60,
          },
        });
        await headaudio.loadModel(HEADAUDIO_MODEL_URL);

        // Drive the avatar's viseme morph targets directly from HeadAudio's
        // real-time classification output.
        headaudio.onvalue = (key: string, value: number) => {
          const target = head.mtAvatar?.[key];
          if (target) Object.assign(target, { newvalue: value, needsUpdate: true });
        };

        // Link HeadAudio's per-frame update into TalkingHead's own animation
        // loop, so lip movement is timed against the same render loop as the
        // rest of the avatar rather than a separate rAF/interval.
        head.opt.update = headaudio.update.bind(headaudio);

        headAudioRef.current = headaudio;
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
      mediaSourceRef.current?.disconnect();
      mediaSourceRef.current = null;
      headAudioRef.current?.disconnect?.();
      headAudioRef.current = null;
      headRef.current?.dispose?.();
      headRef.current = null;
      setLoaded(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avatarUrl]);

  // Connect Athena's live audio track into HeadAudio once both the avatar
  // and the track are ready. Uses head.audioCtx (not a separate
  // AudioContext) so the MediaStreamSource lives in the same graph HeadAudio
  // was created in.
  useEffect(() => {
    if (!loaded || !audioTrack) return;
    const head = headRef.current;
    const headaudio = headAudioRef.current;
    if (!head || !headaudio) return;

    let cancelled = false;

    try {
      const mediaStreamTrack: MediaStreamTrack | undefined =
        audioTrack.getMediaStreamTrack?.();
      if (!mediaStreamTrack) return;

      const stream = new MediaStream([mediaStreamTrack]);
      const source = head.audioCtx.createMediaStreamSource(stream);
      if (cancelled) return;

      source.connect(headaudio);
      mediaSourceRef.current = source;
    } catch (err) {
      console.error('[AthenaTalkingHead] audio connect failed:', err);
    }

    return () => {
      cancelled = true;
      mediaSourceRef.current?.disconnect();
      mediaSourceRef.current = null;
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