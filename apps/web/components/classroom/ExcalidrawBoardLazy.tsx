/**
 * Loads the drawing surface only when the board is actually being presented.
 *
 * Excalidraw is a large client payload — around 60 chunks. Importing
 * ExcalidrawBoard directly from a page pulls that into the page's module graph
 * whether or not anyone opens the board, which measurably slowed hydration:
 * the classroom e2e's "student RTC connected" check, green on sixteen
 * consecutive runs, began failing as soon as the static import was added.
 *
 * Same reason ClassroomAudio and ScreenShareStage are lazy.
 */

'use client';

import dynamic from 'next/dynamic';
import type { ExcalidrawBoardProps } from './ExcalidrawBoard';

const ExcalidrawBoardImpl = dynamic(
  () => import('./ExcalidrawBoard').then((m) => m.ExcalidrawBoard),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center text-sm text-[var(--eco-cream-faint)]">
        Loading the board…
      </div>
    ),
  },
);

export function ExcalidrawBoard(props: ExcalidrawBoardProps) {
  return <ExcalidrawBoardImpl {...props} />;
}
