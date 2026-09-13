'use client';

import { useState, type CSSProperties } from 'react';
import type {
  MiroWorkspaceState,
  StickyNoteCategory,
  StickyNoteColor,
  Role,
} from '@echosphere/shared-types';
import { orchestratorClient } from '@/lib/orchestrator';

interface MiroWorkspacePaneProps {
  sessionId: string;
  participantId: string;
  role: Role;
  workspace: MiroWorkspaceState | null;
  onRefresh?: () => void;
}

const CATEGORY_LABELS: Record<StickyNoteCategory, { label: string; bg: string; text: string }> = {
  'held-back-doubt': { label: 'Held-Back Doubt (Athena)', bg: 'bg-[color-mix(in_srgb,var(--eco-amber)_20%,transparent)]', text: 'text-[var(--eco-amber)]' },
  'student-question': { label: 'Student Question', bg: 'bg-[color-mix(in_srgb,var(--eco-blue)_20%,transparent)]', text: 'text-[var(--eco-blue)]' },
  'core-concept': { label: 'Core Concept', bg: 'bg-[color-mix(in_srgb,var(--eco-athena)_20%,transparent)]', text: 'text-[var(--eco-athena)]' },
  'teacher-insight': { label: 'Teacher Insight', bg: 'bg-[color-mix(in_srgb,var(--eco-green)_20%,transparent)]', text: 'text-[var(--eco-green)]' },
  'key-takeaway': { label: 'Key Takeaway', bg: 'bg-[color-mix(in_srgb,var(--eco-blue)_20%,transparent)]', text: 'text-[var(--eco-blue)]' },
};

/**
 * Per-note hue. Surfaces are built from this in `globals.css` (`.eco-sticky`)
 * by mixing the hue against the themed surface token, rather than being baked
 * in as fixed dark gradients — otherwise every note is a black card on the
 * light theme. `--eco-*` tokens are used where the palette already has the hue.
 */
const NOTE_HUE: Record<StickyNoteColor, string> = {
  yellow: '#e0b341',
  amber: 'var(--eco-amber)',
  coral: '#e07a9e',
  cyan: 'var(--eco-blue)',
  purple: 'var(--eco-athena)',
  green: 'var(--eco-green)',
};

export function MiroWorkspacePane({
  sessionId,
  participantId,
  role,
  workspace,
  onRefresh,
}: MiroWorkspacePaneProps) {
  const [activeFilter, setActiveFilter] = useState<StickyNoteCategory | 'all'>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [newTopic, setNewTopic] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newCategory, setNewCategory] = useState<StickyNoteCategory>('student-question');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [explainingId, setExplainingId] = useState<string | null>(null);

  const notes = workspace?.notes ?? [];
  const filteredNotes = activeFilter === 'all'
    ? notes
    : notes.filter((n) => n.category === activeFilter);

  const heldBackCount = notes.filter((n) => n.isHeldBackDoubt).length;

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newContent.trim()) return;
    setIsSubmitting(true);
    try {
      await orchestratorClient.addStickyNote(sessionId, {
        topic: newTopic.trim() || 'Class Discussion',
        content: newContent.trim(),
        category: newCategory,
        authorRole: role,
        authorParticipantId: participantId,
      });
      setNewContent('');
      setNewTopic('');
      setShowAddModal(false);
      onRefresh?.();
    } catch (err) {
      console.error('Failed to add sticky note', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVote = async (noteId: string) => {
    try {
      await orchestratorClient.voteStickyNote(sessionId, noteId, participantId);
      onRefresh?.();
    } catch (err) {
      console.error('Vote failed', err);
    }
  };

  const handleResolve = async (noteId: string, currentStatus: string) => {
    try {
      const nextStatus = currentStatus === 'resolved' ? 'pending' : 'resolved';
      await orchestratorClient.resolveStickyNote(sessionId, noteId, nextStatus);
      onRefresh?.();
    } catch (err) {
      console.error('Resolve failed', err);
    }
  };

  const handleExplain = async (noteId: string) => {
    setExplainingId(noteId);
    try {
      await orchestratorClient.explainStickyNote(sessionId, noteId);
      onRefresh?.();
    } catch (err) {
      console.error('Explain failed', err);
    } finally {
      setTimeout(() => setExplainingId(null), 2500);
    }
  };

  return (
    <section
      className="eco-panel flex min-h-[22rem] flex-col overflow-hidden rounded-xl border border-[var(--eco-rule)] bg-[var(--eco-panel)] shadow-xl"
      aria-label="Shared Miro Workspace"
    >
      {/* Header Bar */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--eco-rule)] bg-[var(--eco-ink-sunken)] px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-[var(--eco-amber)] to-[var(--eco-amber)] font-bold text-[var(--eco-ink)] shadow-md">
            M
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="eco-display text-base font-semibold tracking-wide text-[var(--eco-cream)]">
                Live Shared Workspace
              </h2>
              {heldBackCount > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--eco-amber)_20%,transparent)] px-2 py-0.5 text-xs font-medium text-[var(--eco-amber)] ring-1 ring-amber-500/40">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--eco-amber)]" />
                  {heldBackCount} {heldBackCount === 1 ? 'Held-Back Doubt' : 'Held-Back Doubts'}
                </span>
              )}
            </div>
            <p className="text-xs text-[var(--eco-cream-faint)]">
              Miro-style live board · synchronized doubts, questions & co-teacher insights
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 rounded-lg bg-[color-mix(in_srgb,var(--eco-amber)_20%,transparent)] px-3 py-1.5 text-xs font-semibold text-[var(--eco-amber)] ring-1 ring-amber-400/40 transition hover:bg-[color-mix(in_srgb,var(--eco-amber)_30%,transparent)] hover:ring-amber-300"
          >
            <span className="text-base leading-none">+</span> Pin Sticky Note
          </button>
        </div>
      </header>

      {/* Filter Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--eco-rule)]/60 bg-[var(--eco-ink-sunken)] px-4 py-2 text-xs">
        <span className="mr-1 text-[var(--eco-cream-faint)] font-medium">Filter:</span>
        <button
          type="button"
          onClick={() => setActiveFilter('all')}
          className={`rounded-md px-2.5 py-1 transition ${
            activeFilter === 'all'
              ? 'bg-[var(--eco-rule)] font-semibold text-[var(--eco-cream)]'
              : 'text-[var(--eco-cream-faint)] hover:text-[var(--eco-cream)]'
          }`}
        >
          All ({notes.length})
        </button>
        {(Object.keys(CATEGORY_LABELS) as StickyNoteCategory[]).map((cat) => {
          const count = notes.filter((n) => n.category === cat).length;
          return (
            <button
              key={cat}
              type="button"
              onClick={() => setActiveFilter(cat)}
              className={`rounded-md px-2.5 py-1 transition ${
                activeFilter === cat
                  ? 'bg-[var(--eco-rule)] font-semibold text-[var(--eco-cream)]'
                  : 'text-[var(--eco-cream-faint)] hover:text-[var(--eco-cream)]'
              }`}
            >
              {CATEGORY_LABELS[cat].label} ({count})
            </button>
          );
        })}
      </div>

      {/* Workspace Board Canvas */}
      <div className="relative min-h-[16rem] flex-1 overflow-y-auto p-4">
        {filteredNotes.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center rounded-xl border border-dashed border-[var(--eco-rule)]/60 bg-[var(--eco-ink-sunken)] p-6 text-center text-sm text-[var(--eco-cream-faint)]">
            <p className="font-medium text-[var(--eco-cream)]">No sticky notes in this view yet</p>
            <p className="mt-1 max-w-sm text-xs">
              When Athena restrains an intervention or when students ask questions, notes are automatically pinned here live.
            </p>
            <button
              type="button"
              onClick={() => setShowAddModal(true)}
              className="mt-3 rounded-lg bg-[color-mix(in_srgb,var(--eco-amber)_20%,transparent)] px-3 py-1.5 text-xs font-semibold text-[var(--eco-amber)] ring-1 ring-amber-400/40 hover:bg-[color-mix(in_srgb,var(--eco-amber)_30%,transparent)]"
            >
              + Add First Sticky Note
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredNotes.map((note) => {
              const catMeta = CATEGORY_LABELS[note.category] ?? CATEGORY_LABELS['student-question'];
              const noteHue = NOTE_HUE[note.color] ?? NOTE_HUE.yellow;
              const hasVoted = note.votedBy?.includes(participantId);
              const isResolved = note.status === 'resolved' || note.status === 'addressed';

              return (
                <div
                  key={note.id}
                  style={{ '--note-hue': noteHue } as CSSProperties}
                  className={`eco-sticky group relative flex min-w-0 flex-col justify-between overflow-hidden rounded-xl p-4 shadow-lg transition duration-200 hover:-translate-y-1 hover:shadow-2xl ${
                    isResolved ? 'opacity-70 saturate-50' : ''
                  }`}
                >
                  {/* Category Header */}
                  <div className="min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`inline-block rounded-md px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase ${catMeta.bg} ${catMeta.text}`}>
                        {catMeta.label}
                      </span>
                      {note.isHeldBackDoubt && note.restraintScore !== undefined && (
                        <span className="text-[10px] font-mono text-[var(--eco-amber)]/80" title="Restraint Score">
                          Restraint: {Math.round(note.restraintScore * 100)}%
                        </span>
                      )}
                    </div>

                    <h3 className="mt-2 min-w-0 break-words text-sm font-semibold text-[var(--eco-cream)]">
                      {note.topic}
                    </h3>

                    <p className="mt-1.5 min-w-0 break-words text-xs leading-relaxed text-[var(--eco-cream)]/90">
                      {note.content}
                    </p>

                    {note.suggestedAnswer && (
                      <div className="mt-2 min-w-0 break-words rounded-lg bg-[var(--eco-ink-sunken)] p-2 text-[11px] text-[var(--eco-amber)]/90 border border-[color-mix(in_srgb,var(--eco-amber)_20%,transparent)]">
                        <span className="font-semibold text-[var(--eco-amber)]">Suggested by Athena: </span>
                        {note.suggestedAnswer}
                      </div>
                    )}

                    {note.heldBackReason && (
                      <p className="mt-2 min-w-0 break-words text-[10px] italic text-[var(--eco-cream-faint)]">
                        Reason held back: {note.heldBackReason}
                      </p>
                    )}
                  </div>

                  {/* Footer & Actions */}
                  <div className="mt-4 border-t border-[var(--eco-rule)]/40 pt-3">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-[10px] text-[var(--eco-cream-faint)]">
                        by {note.authorName}
                      </span>

                      <div className="flex items-center gap-1.5">
                        {/* Vote Button */}
                        <button
                          type="button"
                          onClick={() => handleVote(note.id)}
                          className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold transition ${
                            hasVoted
                              ? 'bg-[var(--eco-amber)] text-[var(--eco-ink)]'
                              : 'bg-[var(--eco-ink-sunken)] text-[var(--eco-cream)] hover:bg-[color-mix(in_srgb,var(--eco-ink)_50%,transparent)] ring-1 ring-[var(--eco-rule)]'
                          }`}
                          title="Vote this doubt for classroom discussion"
                        >
                          <span>▲</span>
                          <span>{note.votes || 0}</span>
                        </button>

                        {/* Ask Athena to Explain Button */}
                        <button
                          type="button"
                          onClick={() => handleExplain(note.id)}
                          disabled={explainingId === note.id}
                          className="flex items-center gap-1 rounded-md bg-[color-mix(in_srgb,var(--eco-athena)_20%,transparent)] px-2 py-0.5 text-xs font-medium text-[var(--eco-athena)] ring-1 ring-purple-400/40 hover:bg-[color-mix(in_srgb,var(--eco-athena)_30%,transparent)] transition disabled:opacity-50"
                          title="Ask Athena to speak this doubt out loud"
                        >
                          {explainingId === note.id ? 'Addressing...' : 'Explain'}
                        </button>

                        {/* Resolve Button (Teacher or Author) */}
                        {role === 'teacher' && (
                          <button
                            type="button"
                            onClick={() => handleResolve(note.id, note.status)}
                            className={`rounded-md px-2 py-0.5 text-xs transition ${
                              isResolved
                                ? 'bg-[color-mix(in_srgb,var(--eco-green)_20%,transparent)] text-[var(--eco-green)] ring-1 ring-emerald-500/40'
                                : 'bg-[var(--eco-ink-sunken)] text-[var(--eco-cream-faint)] hover:text-[var(--eco-cream)]'
                            }`}
                          >
                            {isResolved ? '✓ Done' : 'Resolve'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add Sticky Note Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[color-mix(in_srgb,var(--eco-ink)_70%,transparent)] p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-xl border border-[var(--eco-rule)] bg-[var(--eco-panel)] p-6 shadow-2xl">
            <h3 className="eco-display text-lg font-semibold text-[var(--eco-cream)]">
              Pin New Sticky Note to Shared Workspace
            </h3>
            <p className="mt-1 text-xs text-[var(--eco-cream-faint)]">
              Broadcasts instantly to all students and the teacher.
            </p>

            <form onSubmit={handleAddNote} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-[var(--eco-cream)]">Category</label>
                <select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value as StickyNoteCategory)}
                  className="mt-1 w-full rounded-lg border border-[var(--eco-rule)] bg-[var(--eco-ink-sunken)] px-3 py-2 text-xs text-[var(--eco-cream)] focus:border-[var(--eco-amber)] focus:outline-none"
                >
                  <option value="student-question">Student Question / Doubt</option>
                  <option value="core-concept">Core Concept Note</option>
                  <option value="teacher-insight">Teacher Insight</option>
                  <option value="key-takeaway">Key Takeaway</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--eco-cream)]">Topic / Concept</label>
                <input
                  type="text"
                  placeholder="e.g. Least Common Multiple (LCM)"
                  value={newTopic}
                  onChange={(e) => setNewTopic(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--eco-rule)] bg-[var(--eco-ink-sunken)] px-3 py-2 text-xs text-[var(--eco-cream)] placeholder-[var(--eco-cream-faint)]/50 focus:border-[var(--eco-amber)] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--eco-cream)]">Content / Question *</label>
                <textarea
                  required
                  rows={3}
                  placeholder="What is confusing or what insight would you like to share with the room?"
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--eco-rule)] bg-[var(--eco-ink-sunken)] px-3 py-2 text-xs text-[var(--eco-cream)] placeholder-[var(--eco-cream-faint)]/50 focus:border-[var(--eco-amber)] focus:outline-none"
                />
              </div>

              <div className="mt-5 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="rounded-lg px-3 py-1.5 text-xs text-[var(--eco-cream-faint)] hover:text-[var(--eco-cream)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !newContent.trim()}
                  className="rounded-lg bg-[var(--eco-amber)] px-4 py-1.5 text-xs font-semibold text-[var(--eco-ink)] hover:bg-[var(--eco-amber)] disabled:opacity-50"
                >
                  {isSubmitting ? 'Pinning...' : 'Pin to Board'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
