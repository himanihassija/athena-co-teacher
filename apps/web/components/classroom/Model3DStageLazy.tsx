/**
 * Browser-only wrapper around Model3DStage.
 *
 * Model3DStage does `import '@google/model-viewer'` at module scope, which
 * registers the <model-viewer> custom element and touches `self` while doing
 * it. `'use client'` does not stop Next from server-rendering a client
 * component's module tree, so importing Model3DStage statically from a page
 * evaluates that side effect on the server and crashes the whole route with
 * "ReferenceError: self is not defined". Same reason ParticipantGrid and
 * ScreenShareStage are lazy-loaded; see ParticipantGridLazy.tsx.
 */

'use client';

import dynamic from 'next/dynamic';
import type { ComponentProps } from 'react';
import type { Model3DStage as Model3DStageType } from './Model3DStage';

const Model3DStageImpl = dynamic(
  () => import('./Model3DStage').then((m) => m.Model3DStage),
  {
    ssr: false,
    loading: () => <p className="sr-only">Loading 3D model...</p>,
  },
);

export function Model3DStage(props: ComponentProps<typeof Model3DStageType>) {
  return <Model3DStageImpl {...props} />;
}
