/**
 * Browser-only wrapper around ParticipantGrid.
 *
 * ParticipantGrid pulls in useAnamAvatar -> lib/anam.ts -> @anam-ai/js-sdk,
 * which touches `self` at module-evaluation time. `'use client'` does not
 * prevent Next from server-rendering a client component's module tree, so
 * importing ParticipantGrid statically from a page evaluates the Anam SDK on
 * the server and crashes the whole route with "ReferenceError: self is not
 * defined". Same reason ScreenShareStage and ClassroomAudio are lazy-loaded;
 * see ScreenShareStageLazy.tsx / ClassroomAudioLazy.tsx.
 */

'use client';

import dynamic from 'next/dynamic';
import type { ComponentProps } from 'react';
import type { ParticipantGrid as ParticipantGridType } from './ParticipantGrid';

const ParticipantGridImpl = dynamic(
  () => import('./ParticipantGrid').then((m) => m.ParticipantGrid),
  {
    ssr: false,
    loading: () => <p className="sr-only">Loading participants...</p>,
  },
);

export function ParticipantGrid(props: ComponentProps<typeof ParticipantGridType>) {
  return <ParticipantGridImpl {...props} />;
}
