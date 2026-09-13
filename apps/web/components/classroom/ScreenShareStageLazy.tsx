/**
 * Browser-only wrapper around ScreenShareStage.
 *
 * `agora-rtc-react` touches `window` at module-evaluation time, and `'use
 * client'` does not prevent Next from server-rendering a client component — so
 * importing ScreenShareStage statically from a page evaluates that module on the
 * server and 500s the whole route. This is the same reason ClassroomAudio is
 * lazy-loaded; see ClassroomAudioLazy.tsx.
 */

'use client';

import dynamic from 'next/dynamic';
import type { ScreenShareStageProps } from './ScreenShareStage';

const ScreenShareStageImpl = dynamic(
  () => import('./ScreenShareStage').then((m) => m.ScreenShareStage),
  {
    ssr: false,
    loading: () => <p className="sr-only">Loading screen share…</p>,
  },
);

export function ScreenShareStage(props: ScreenShareStageProps) {
  return <ScreenShareStageImpl {...props} />;
}
