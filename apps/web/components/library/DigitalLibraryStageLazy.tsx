'use client';

import dynamic from 'next/dynamic';
import type { DigitalLibraryStageProps } from './DigitalLibraryStage';

export const DigitalLibraryStage = dynamic<DigitalLibraryStageProps>(
  () => import('./DigitalLibraryStage').then((mod) => mod.DigitalLibraryStage),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full min-h-[460px] flex-1 items-center justify-center rounded-2xl border border-[var(--eco-rule)] bg-[var(--eco-ink)] p-8 text-sm text-[var(--eco-cream-dim)]">
        <div className="flex items-center gap-3">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--eco-amber)] border-t-transparent" />
          <span>Opening Athena Digital Library…</span>
        </div>
      </div>
    ),
  },
);
