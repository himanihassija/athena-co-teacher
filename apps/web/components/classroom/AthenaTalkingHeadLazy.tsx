'use client';

import dynamic from 'next/dynamic';

/**
 * Client-only wrapper — same reasoning as ClassroomAudioLazy.tsx. Importing
 * three.js / TalkingHead at module scope touches `window`/WebGL at load
 * time, which crashes under Next.js SSR (ParticipantGrid is rendered
 * server-side first, same failure mode we hit with agora-rtc-react earlier).
 */
export const AthenaTalkingHead = dynamic(
  () => import('./AthenaTalkingHead').then((m) => m.AthenaTalkingHead),
  { ssr: false },
);