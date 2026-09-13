'use client';

import { useState } from 'react';
import { searchModels, type Model3D } from '@/lib/models3d';

/**
 * Search bar + tile grid, shown as a modal overlay when the teacher clicks
 * "3D Models" in the header. Picking a tile calls onSelect and the parent
 * closes this and switches the main stage to Model3DStage — this component
 * only picks, it doesn't render the model itself.
 */
export function Model3DPicker({
  isOpen,
  onClose,
  onSelect,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (modelId: string) => void;
}) {
  const [query, setQuery] = useState('');

  if (!isOpen) return null;

  const results = searchModels(query);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'color-mix(in srgb, var(--eco-ink) 70%, transparent)' }}
      onClick={onClose}
    >
      <div
        className="eco-panel flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between border-b px-4 py-3"
          style={{ borderColor: 'var(--eco-rule)' }}
        >
          <h2 className="eco-label">3D Model Library</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-[var(--eco-cream-faint)] hover:text-[var(--eco-cream)]"
            aria-label="Close 3D model library"
            title="Close"
          >
            ✕
          </button>
        </div>

        <div className="border-b p-3" style={{ borderColor: 'var(--eco-rule)' }}>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search models — heart, atom, solar system…"
            className="w-full rounded-lg border px-3 py-2 text-sm text-[var(--eco-cream)] outline-none transition-colors focus:border-[var(--eco-glow)]"
            style={{ borderColor: 'var(--eco-rule)', background: 'var(--eco-ink-sunken)' }}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {results.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--eco-cream-faint)]">
              No models match “{query}”.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {results.map((model) => (
                <ModelTile key={model.id} model={model} onClick={() => onSelect(model.id)} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ModelTile({ model, onClick }: { model: Model3D; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors hover:border-[var(--eco-glow)]"
      style={{ borderColor: 'var(--eco-rule)', background: 'var(--eco-ink-sunken)' }}
    >
      <span
        className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
        style={{ background: 'var(--eco-glow-dim)', color: 'var(--eco-glow-bright)' }}
      >
        {model.subject}
      </span>
      <span className="text-sm font-semibold text-[var(--eco-cream)]">{model.name}</span>
      <span className="text-xs text-[var(--eco-cream-faint)]">{model.description}</span>
    </button>
  );
}