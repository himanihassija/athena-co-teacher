'use client';

import { useState } from 'react';
import type { SuppressedIntervention } from '@/hooks/useClassroom';

export interface SuppressedInterventionsPanelProps {
  interventions: SuppressedIntervention[];
}

export function SuppressedInterventionsPanel({ interventions }: SuppressedInterventionsPanelProps) {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <section className="eco-panel flex flex-col gap-3 p-4 bg-[#2E3D50]/5 border-[#0F766E]/20">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#B85C38]" />
          <h2 className="eco-label font-bold text-[#EEF1F4]">Restraint Log</h2>
        </div>
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="text-[10px] uppercase tracking-wider text-[var(--eco-cream-faint)] hover:text-[var(--eco-cream)]"
        >
          {isOpen ? 'Collapse' : 'Expand'}
        </button>
      </header>

      {isOpen && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-[var(--eco-cream-faint)] leading-normal font-sans">
            Drafts evaluated by the Intervention Gate but suppressed to maintain classroom flow.
          </p>

          {interventions.length === 0 ? (
            <p className="text-xs italic text-[var(--eco-cream-faint)] py-4 text-center border border-dashed border-[var(--eco-rule)] rounded-lg">
              No interventions suppressed yet.
            </p>
          ) : (
            <div className="flex flex-col gap-2.5 max-h-60 overflow-y-auto pr-1">
              {interventions.map((item, index) => {
                const time = new Date(item.timestamp).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                });
                return (
                  <div
                    key={index}
                    className="flex flex-col gap-1 p-2.5 rounded-lg border border-[var(--eco-rule)] bg-[#16202E]/60 transition-all hover:border-[#B85C38]/20"
                  >
                    <div className="flex items-center justify-between text-[10px] font-mono text-[var(--eco-cream-faint)]">
                      <span>{time}</span>
                      <span className="px-1.5 py-0.5 rounded bg-[#B85C38]/10 text-[#B85C38]">
                        Score: {item.score.toFixed(2)}
                      </span>
                    </div>
                    <p className="text-xs italic text-[var(--eco-cream-dim)] leading-normal">
                      &ldquo;{item.text}&rdquo;
                    </p>
                    <div className="text-[10px] font-mono text-[var(--eco-cream-faint)] border-t border-[var(--eco-rule)] pt-1 mt-1 flex items-center justify-between">
                      <span className="uppercase text-[9px] tracking-wider text-[var(--eco-cream-faint)]">Reason</span>
                      <span className="text-[#B85C38]">{item.reason}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
