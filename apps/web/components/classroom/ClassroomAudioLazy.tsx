/**
 * Browser-only wrapper around ClassroomAudio.
 *
 * `agora-rtc-react` touches `window` at module-evaluation time, so importing
 * ClassroomAudio statically from a page crashes server rendering. The official
 * quickstart lazy-loads its conversation component for the same reason; this is
 * the classroom equivalent.
 */

'use client';

import dynamic from 'next/dynamic';
import type { ClassroomAudioProps } from './ClassroomAudio';

const ClassroomAudioImpl = dynamic(
  () => import('./ClassroomAudio').then((m) => m.ClassroomAudio),
  {
    ssr: false,
    loading: () => (
      <p className="sr-only">Loading classroom audio…</p>
    ),
  },
);

export function ClassroomAudio(props: ClassroomAudioProps) {
  return <ClassroomAudioImpl {...props} />;
}
