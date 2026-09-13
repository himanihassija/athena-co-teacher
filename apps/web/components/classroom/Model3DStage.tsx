'use client';

import '@google/model-viewer';
import { getModel, modelFileUrl } from '@/lib/models3d';
/**
 * The actual full-bleed 3D viewer, shown on the main stage in place of
 * ParticipantGrid — same role Whiteboard/ScreenShareStage already play.
 * The "Stop" control lives in the page header (mirroring "Stop Whiteboard"),
 * not in here, so this component only renders, it doesn't manage presence.
 */
export function Model3DStage({ modelId }: { modelId: string }) {
  const model = getModel(modelId);

  if (!model) {
    return (
      <div className="flex h-full w-full items-center justify-center text-sm text-[var(--eco-cream-faint)]">
        This model is no longer available.
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <model-viewer
        src={modelFileUrl(model)}
        alt={model.name}
        camera-controls
        auto-rotate
        autoplay
        reveal="auto"
        loading="eager"
        exposure="1"
        environment-image="legacy"
        zoom-sensitivity="5"
        shadow-intensity="1"
        style={{ width: '100%', height: '100%', background: '#000000' }}
      />
      <div
        className="absolute bottom-3 left-3 flex flex-col gap-0.5 rounded-lg px-3 py-2 backdrop-blur-sm"
        style={{ background: 'color-mix(in srgb, var(--eco-ink) 55%, transparent)' }}
      >
        <span className="text-sm font-semibold text-[var(--eco-cream)]">{model.name}</span>
        <span className="text-xs text-[var(--eco-cream-faint)]">{model.subject}</span>
      </div>
    </div>
  );
}