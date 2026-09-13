'use client';

import { useState } from 'react';
import type { TargetedReadingItem, Role } from '@echosphere/shared-types';
import { orchestratorClient } from '@/lib/orchestrator';

interface TargetedReadingPanelProps {
  sessionId: string;
  participantId: string;
  role: Role;
  readings: TargetedReadingItem[];
  onRefresh?: () => void;
}

export function TargetedReadingPanel({
  sessionId,
  participantId,
  role,
  readings,
  onRefresh,
}: TargetedReadingPanelProps) {
  const [selectedReading, setSelectedReading] = useState<TargetedReadingItem | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const pendingCount = readings.filter((r) => r.status === 'pending-approval').length;
  const displayReadings = role === 'teacher'
    ? readings
    : readings.filter((r) => r.status === 'approved');

  const handleApprove = async (readingId: string) => {
    setProcessingId(readingId);
    try {
      await orchestratorClient.approveTargetedReading(sessionId, readingId, participantId);
      onRefresh?.();
    } catch (err) {
      console.error('Approve failed', err);
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (readingId: string) => {
    setProcessingId(readingId);
    try {
      await orchestratorClient.rejectTargetedReading(sessionId, readingId, participantId);
      onRefresh?.();
    } catch (err) {
      console.error('Reject failed', err);
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <div className="eco-panel flex flex-col rounded-xl border border-[var(--eco-rule)] bg-[var(--eco-panel)] shadow-xl overflow-hidden">
      <header className="flex items-center justify-between border-b border-[var(--eco-rule)] bg-[var(--eco-ink-sunken)] px-4 py-3">
        <div className="flex items-center gap-2">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="eco-display text-sm font-semibold text-[var(--eco-cream)]">
                Targeted Reading {role === 'teacher' ? '(Teacher Review)' : '(Approved for You)'}
              </h3>
              {role === 'teacher' && pendingCount > 0 && (
                <span className="rounded-full bg-[color-mix(in_srgb,var(--eco-amber)_20%,transparent)] px-2 py-0.5 text-[10px] font-semibold text-[var(--eco-amber)] ring-1 ring-amber-500/40">
                  {pendingCount} Pending Review
                </span>
              )}
            </div>
            <p className="text-[11px] text-[var(--eco-cream-faint)]">
              Curated reading materials tailored to detected classroom misconceptions
            </p>
          </div>
        </div>
      </header>

      <div className="p-4 space-y-3 max-h-80 overflow-y-auto">
        {displayReadings.length === 0 ? (
          <div className="p-6 text-center text-xs text-[var(--eco-cream-faint)]">
            No targeted reading materials generated yet.
          </div>
        ) : (
          displayReadings.map((item) => {
            const isPending = item.status === 'pending-approval';
            const isApproved = item.status === 'approved';

            return (
              <div
                key={item.id}
                className={`rounded-xl border p-3.5 transition ${
                  isPending
                    ? 'border-[color-mix(in_srgb,var(--eco-amber)_30%,transparent)] bg-[color-mix(in_srgb,var(--eco-amber)_8%,var(--eco-ink-sunken))]'
                    : 'border-[var(--eco-rule)] bg-[var(--eco-ink-sunken)] hover:border-[var(--eco-rule)]/80'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-[color-mix(in_srgb,var(--eco-athena)_20%,transparent)] px-2 py-0.5 text-[10px] font-medium text-[var(--eco-athena)]">
                        {item.topic}
                      </span>
                      <span className="text-[10px] text-[var(--eco-cream-faint)]">
                        ⏱{item.estimatedReadTime}
                      </span>
                      {isPending && (
                        <span className="rounded bg-[color-mix(in_srgb,var(--eco-amber)_20%,transparent)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--eco-amber)]">
                          Needs Approval
                        </span>
                      )}
                      {isApproved && (
                        <span className="rounded bg-[color-mix(in_srgb,var(--eco-green)_20%,transparent)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--eco-green)]">
                          ✓ Approved by {item.approvedBy}
                        </span>
                      )}
                    </div>

                    <h4 className="mt-1.5 text-xs font-semibold text-[var(--eco-cream)]">
                      {item.title}
                    </h4>

                    <p className="mt-1 text-[11px] text-[var(--eco-cream)]/80 leading-relaxed">
                      {item.summary}
                    </p>

                    <p className="mt-1 text-[10px] italic text-[var(--eco-cream-faint)]">
                      Why: {item.relevanceReason}
                    </p>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between border-t border-[var(--eco-rule)]/30 pt-2.5">
                  <button
                    type="button"
                    onClick={() => setSelectedReading(item)}
                    className="text-xs font-semibold text-[var(--eco-amber)] hover:text-[var(--eco-amber)]"
                  >
                    Read Guide →
                  </button>

                  {role === 'teacher' && isPending && (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleReject(item.id)}
                        disabled={processingId === item.id}
                        className="rounded-md px-2.5 py-1 text-xs text-[var(--eco-cream-faint)] hover:text-[var(--eco-red)]"
                      >
                        Dismiss
                      </button>
                      <button
                        type="button"
                        onClick={() => handleApprove(item.id)}
                        disabled={processingId === item.id}
                        className="rounded-md bg-[color-mix(in_srgb,var(--eco-green)_20%,transparent)] px-3 py-1 text-xs font-semibold text-[var(--eco-green)] ring-1 ring-emerald-500/40 hover:bg-[color-mix(in_srgb,var(--eco-green)_30%,transparent)]"
                      >
                        {processingId === item.id ? 'Approving...' : '✓ Approve for Students'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Reading Detail Modal */}
      {selectedReading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[color-mix(in_srgb,var(--eco-ink)_70%,transparent)] p-4 backdrop-blur-sm animate-in fade-in">
          <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-xl border border-[var(--eco-rule)] bg-[var(--eco-panel)] shadow-2xl overflow-hidden">
            <header className="flex items-center justify-between border-b border-[var(--eco-rule)] bg-[var(--eco-ink-sunken)] px-5 py-3">
              <div>
                <span className="text-[10px] font-semibold text-[var(--eco-amber)] uppercase tracking-wider">
                  {selectedReading.topic} · {selectedReading.estimatedReadTime} read
                </span>
                <h3 className="eco-display text-base font-semibold text-[var(--eco-cream)]">
                  {selectedReading.title}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedReading(null)}
                className="text-lg text-[var(--eco-cream-faint)] hover:text-[var(--eco-cream)]"
              >
                ✕
              </button>
            </header>

            <div className="flex-1 overflow-y-auto p-5 text-xs text-[var(--eco-cream)]/90 leading-relaxed space-y-3 whitespace-pre-line">
              {selectedReading.contentMarkdown}
            </div>

            <footer className="border-t border-[var(--eco-rule)] bg-[var(--eco-ink-sunken)] px-5 py-3 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedReading(null)}
                className="rounded-lg bg-[var(--eco-rule)] px-4 py-1.5 text-xs font-semibold text-[var(--eco-cream)]"
              >
                Close
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
