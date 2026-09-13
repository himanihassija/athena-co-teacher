'use client';

import { useEffect, useRef, useState } from 'react';
import { AnamAvatarSession, type AnamStatus } from '@/lib/anam';

const VIDEO_ELEMENT_ID = 'anam-avatar-video';

/**
 * Connects Athena's Anam avatar once she's present, and feeds it Agora's
 * real speaking state to drive the (silent, muted) lip-flap loop.
 *
 * `status` stays 'error' — and the caller should keep rendering the existing
 * Lottie loop — whenever Anam isn't configured on this deployment or the
 * connection fails. This hook never throws.
 */
export function useAnamAvatar(
  sessionId: string,
  enabled: boolean,
  speaking: boolean,
): { status: AnamStatus; videoElementId: string } {
  const [status, setStatus] = useState<AnamStatus>('idle');
  const sessionRef = useRef<AnamAvatarSession | null>(null);

  useEffect(() => {
    if (!enabled) {
      sessionRef.current?.disconnect();
      sessionRef.current = null;
      setStatus('idle');
      return;
    }

    const session = new AnamAvatarSession();
    sessionRef.current = session;
    void session.connect(sessionId, VIDEO_ELEMENT_ID, setStatus);

    return () => {
      session.disconnect();
      sessionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, sessionId]);

  useEffect(() => {
    if (status === 'connected') {
      sessionRef.current?.setSpeaking(speaking);
    }
  }, [speaking, status]);

  return { status, videoElementId: VIDEO_ELEMENT_ID };
}
