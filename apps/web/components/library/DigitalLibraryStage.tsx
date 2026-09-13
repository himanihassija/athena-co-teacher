'use client';

import React, { useState, useEffect, useCallback } from 'react';
import type {
  LibraryBook,
  LibraryPublicState,
  PublicParticipant,
  Role,
} from '@echosphere/shared-types';
import { FlipBook } from './FlipBook';
import { ShelfView } from './ShelfView';
import { isSoundEnabled, setSoundEnabled } from './sound';
import { Volume2, VolumeX, Library, ArrowLeft, Lock, Unlock, Sparkles, ChevronLeft, ChevronRight, X } from 'lucide-react';

export interface DigitalLibraryStageProps {
  sessionId: string;
  participantId: string;
  role: Role;
  library: LibraryPublicState | null;
  book: LibraryBook;
  books?: LibraryBook[];
  participants: PublicParticipant[];
  onTurnPage: (page: number) => Promise<void>;
  onToggleLock: (locked: boolean) => Promise<void>;
  onSelectBook?: (bookId: string) => Promise<void>;
  onAddBook?: (book: LibraryBook) => Promise<void>;
  onRemoveBook?: (bookId: string) => Promise<void>;
  onCloseStage?: () => void;
}

export function DigitalLibraryStage({
  sessionId,
  participantId,
  role,
  library,
  book,
  books = [book],
  participants,
  onTurnPage,
  onToggleLock,
  onSelectBook,
  onAddBook,
  onRemoveBook,
  onCloseStage,
}: DigitalLibraryStageProps) {
  const isTeacher = role === 'teacher';
  const isLocked = library?.isLocked ?? true;
  const teacherPage = library?.currentPage ?? 0;

  const [viewMode, setViewMode] = useState<'reader' | 'shelf'>('reader');
  const [localPage, setLocalPage] = useState(teacherPage);
  const [soundActive, setSoundActive] = useState(true);

  useEffect(() => {
    setSoundActive(isSoundEnabled());
  }, []);

  const handleToggleSound = () => {
    const next = !soundActive;
    setSoundActive(next);
    setSoundEnabled(next);
  };

  // Sync to teacher's page whenever locked or when teacher changes page, or when book/page count changes
  useEffect(() => {
    const maxPage = Math.max(0, (book?.pages?.length ?? 1) - 1);
    const targetPage = Math.min(teacherPage, maxPage);
    if (isLocked || isTeacher) {
      setLocalPage((prev) => (prev === targetPage ? prev : targetPage));
    } else {
      setLocalPage((prev) => (prev > maxPage ? maxPage : prev));
    }
  }, [teacherPage, isLocked, isTeacher, book?.id, book?.pages?.length]);

  const handlePageChange = useCallback(
    (newPageIndex: number) => {
      if (!isTeacher && isLocked) return;
      setLocalPage(newPageIndex);
      void onTurnPage(newPageIndex);
    },
    [isTeacher, isLocked, onTurnPage],
  );

  const handleNext = () => {
    if (!isTeacher && isLocked) return;
    if (localPage < book.pages.length - 1) {
      handlePageChange(localPage + (localPage === 0 ? 1 : 2));
    }
  };

  const handlePrev = () => {
    if (!isTeacher && isLocked) return;
    if (localPage > 0) {
      handlePageChange(localPage <= 2 ? 0 : localPage - 2);
    }
  };

  const handleLockToggle = async () => {
    if (!isTeacher) return;
    const nextLock = !isLocked;
    await onToggleLock(nextLock);
  };

  const spreads = Math.ceil(book.pages.length / 2) + 1;
  const currentSpreadIdx = localPage === 0 ? 0 : Math.min(spreads - 1, Math.floor((localPage + 1) / 2));
  const isDesyncedFromTeacher = !isTeacher && !isLocked && localPage !== teacherPage;
  const studentPositions = library?.studentPositions ? Object.values(library.studentPositions) : [];

  return (
    <div className="digital-library-stage">
      {/* Top Bar */}
      <div className="stage-top-bar">
        <div className="stage-left-info">
          <div className="stage-brand-pill">
            <span className="dot" />
            <span className="brand-name">Athena Digital Library</span>
          </div>

          <div className="book-breadcrumb">
            <button
              className="shelf-nav-btn"
              onClick={() => setViewMode(viewMode === 'shelf' ? 'reader' : 'shelf')}
            >
              {viewMode === 'shelf' ? (
                <>
                  <ArrowLeft size={14} /> Back to Reader
                </>
              ) : (
                <>
                  <Library size={14} /> View Shelf
                </>
              )}
            </button>
            <span className="sep">/</span>
            <span className="book-title-tag">{book.title}</span>
          </div>
        </div>

        <div className="stage-right-actions">
          {/* Audio toggle */}
          <button
            className="sound-toggle-btn"
            title={soundActive ? 'Mute page flip sound' : 'Enable page flip sound'}
            onClick={handleToggleSound}
          >
            {soundActive ? <Volume2 size={16} /> : <VolumeX size={16} />}
          </button>

          {/* Teacher Lock Toggle */}
          {isTeacher ? (
            <button
              className={`stage-lock-btn ${isLocked ? 'locked' : 'unlocked'}`}
              onClick={handleLockToggle}
            >
              {isLocked ? <Lock size={14} /> : <Unlock size={14} />}
              <span>{isLocked ? 'Locked to Teacher' : 'Student Free Read'}</span>
            </button>
          ) : (
            <div className={`student-lock-indicator ${isLocked ? 'locked' : 'unlocked'}`}>
              {isLocked ? <Lock size={12} /> : <Unlock size={12} />}
              <span>{isLocked ? 'Teacher controlling page' : 'Free reading enabled'}</span>
            </div>
          )}

          {/* Close stage button */}
          {onCloseStage && (
            <button className="stage-close-btn" onClick={onCloseStage} title="Close Library Stage">
              <X size={18} />
            </button>
          )}
        </div>
      </div>

      {viewMode === 'shelf' ? (
        <ShelfView
          books={books}
          activeBookId={book.id}
          userRole={role}
          onSelectBook={async (bookId) => {
            if (onSelectBook) await onSelectBook(bookId);
            setViewMode('reader');
          }}
          onAddBook={async (newBook) => {
            if (onAddBook) await onAddBook(newBook);
            if (onSelectBook) await onSelectBook(newBook.id);
            setViewMode('reader');
          }}
          onRemoveBook={async (bookId) => {
            if (onRemoveBook) await onRemoveBook(bookId);
          }}
        />
      ) : (
        <div className="stage-main-content">
          {/* Left Column: Chapter Navigator & Contents */}
          <aside className="stage-sidebar">
            <div className="sidebar-section-title">CHAPTER CONTENTS</div>
            <div className="chapter-chips-list">
              {book.pages.map((p, idx) => {
                if (p.isCover) return null;
                const isCurrent = localPage > 0 && (idx === localPage || idx === localPage + 1);
                return (
                  <button
                    key={idx}
                    className={`chapter-chip ${isCurrent ? 'on' : ''}`}
                    data-c={p.sectionColor || 'gold'}
                    onClick={() => handlePageChange(idx)}
                  >
                    <span className="chip-swatch" />
                    <span className="chip-title">{p.heading || p.sectionTitle || `Page ${idx + 1}`}</span>
                    <span className="chip-pnum">{idx + 1}</span>
                  </button>
                );
              })}
            </div>
          </aside>

          {/* Center Stage: Interactive FlipBook */}
          <main className="stage-center-book">
            <div className="flipbook-outer-box">
              <FlipBook
                book={book}
                currentPage={localPage}
                glowPage={library?.glowPage}
                onPageFlip={handlePageChange}
                canFlip={isTeacher || !isLocked}
              />
            </div>

            {/* Turn Controls & Spread Progress Dots */}
            <div className="stage-turn-controls">
              <button
                className="nav-arrow-btn"
                onClick={handlePrev}
                disabled={localPage <= 0 || (!isTeacher && isLocked)}
              >
                <ChevronLeft size={18} /> Prev
              </button>

              <div className="spread-dots-box">
                {Array.from({ length: spreads }).map((_, idx) => (
                  <div
                    key={idx}
                    className={`spread-dot ${idx === currentSpreadIdx ? 'on' : ''}`}
                  />
                ))}
              </div>

              <button
                className="nav-arrow-btn"
                onClick={handleNext}
                disabled={localPage >= book.pages.length - 1 || (!isTeacher && isLocked)}
              >
                Next <ChevronRight size={18} />
              </button>
            </div>

            {/* Live Student Readers Banner (visible to teacher during Free Read mode) */}
            {isTeacher && !isLocked && (
              <div
                className="mt-3 flex flex-wrap items-center justify-center gap-2 rounded-xl border p-2.5 text-xs animate-in fade-in"
                style={{
                  borderColor: 'var(--eco-rule)',
                  background: 'var(--eco-panel, var(--eco-ink-sunken))',
                }}
              >
                <span className="flex items-center gap-1 font-semibold text-[var(--eco-cream-dim)]">
                  <Sparkles size={13} className="text-[var(--eco-amber)]" />
                  Student Readers:
                </span>
                {studentPositions.length === 0 ? (
                  <span className="italic text-[var(--eco-cream-faint)]">
                    All students currently reading with you on Page {localPage + 1}
                  </span>
                ) : (
                  studentPositions.map((pos) => (
                    <button
                      key={pos.participantId}
                      type="button"
                      onClick={() => handlePageChange(pos.page)}
                      className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition hover:scale-105"
                      style={{
                        borderColor: 'color-mix(in srgb, var(--eco-amber) 40%, transparent)',
                        background: 'color-mix(in srgb, var(--eco-amber) 12%, transparent)',
                        color: 'var(--eco-cream)',
                      }}
                      title={`Click to jump to ${pos.displayName}'s view (Page ${pos.page + 1})`}
                    >
                      <span>{pos.displayName}:</span>
                      <span className="font-bold text-[var(--eco-amber)]">Pg {pos.page + 1}</span>
                      <span className="text-[10px] text-[var(--eco-cream-faint)]">↗ Jump</span>
                    </button>
                  ))
                )}
              </div>
            )}

            {/* Student Catchup Banner if desynced */}
            {isDesyncedFromTeacher && (
              <div className="desync-catchup-banner">
                <span>Teacher is on page {teacherPage + 1}</span>
                <button
                  className="catchup-action-btn"
                  onClick={() => handlePageChange(teacherPage)}
                >
                  Jump to Teacher (Page {teacherPage + 1})
                </button>
              </div>
            )}
          </main>
        </div>
      )}
    </div>
  );
}
