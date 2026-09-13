/**
 * Teacher-only tool bag — a floating button that expands into icon
 * shortcuts for the handful of features that used to live as separate tabs
 * inside ClassroomDrawer (Absent Dispatcher, 3D Models, Digital Library,
 * Quiz, Gaps). Only ever rendered from the teacher page, so nothing here
 * re-checks role.
 *
 * Each icon glows on hover and shows its title in a small label that
 * fades/slides in next to it. The bag itself has a slow idle pulse so it
 * reads as a distinct, special control rather than blending into the rest
 * of the header.
 */

'use client';

import { useState } from 'react';

function BagIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="8" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 8V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M3 12h18" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function AbsentIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="m4 7 8 6 8-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ModelsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 3 4 7.5v9L12 21l8-4.5v-9L12 3Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M4 7.5 12 12l8-4.5M12 12v9" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function QuizIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="4" y="3" width="16" height="18" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 8h8M8 12h8M8 16h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function GapsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 19V5M4 19h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M8 15v-3m4 3V8m4 7v-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function LibraryIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 4.5h6.5a2 2 0 0 1 2 2v13a1.5 1.5 0 0 0-1.5-1.5H4V4.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M20 4.5h-6.5a2 2 0 0 0-2 2v13a1.5 1.5 0 0 1 1.5-1.5H20V4.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

interface ToolItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  accent: string;
}

export function TeacherToolsBag({
  onOpenAbsentDispatcher,
  onOpenModels,
  onOpenQuiz,
  onOpenGaps,
  onOpenLibrary,
}: {
  onOpenAbsentDispatcher: () => void;
  onOpenModels: () => void;
  onOpenQuiz: () => void;
  onOpenGaps: () => void;
  onOpenLibrary: () => void;
}) {
  const [open, setOpen] = useState(false);

  const items: ToolItem[] = [
    { key: 'absent', label: 'Absent Dispatcher', icon: <AbsentIcon />, onClick: onOpenAbsentDispatcher, accent: 'var(--eco-glow)' },
    { key: 'models', label: '3D Models', icon: <ModelsIcon />, onClick: onOpenModels, accent: 'var(--eco-blue)' },
    { key: 'library', label: 'Digital Library', icon: <LibraryIcon />, onClick: onOpenLibrary, accent: 'var(--eco-amber)' },
    { key: 'quiz', label: 'Quiz', icon: <QuizIcon />, onClick: onOpenQuiz, accent: 'var(--eco-amber)' },
    { key: 'gaps', label: 'Gaps', icon: <GapsIcon />, onClick: onOpenGaps, accent: 'var(--eco-red)' },
  ];

  return (
    <>
      <style>{`
        .ttb-wrap {
          position: fixed;
          left: 1.25rem;
          top: 1.25rem;
          z-index: 30;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.75rem;
        }
        .ttb-bag {
          width: 3.5rem;
          height: 3.5rem;
          border-radius: 9999px;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 2px solid var(--eco-athena);
          background: color-mix(in srgb, var(--eco-athena) 18%, transparent);
          color: var(--eco-athena);
          cursor: pointer;
          animation: ttb-pulse 3.2s ease-in-out infinite;
          transition: transform 0.15s ease;
        }
        .ttb-bag:hover { transform: scale(1.06); }
        .ttb-bag[data-open='true'] { animation: none; transform: scale(1.04); }
        @keyframes ttb-pulse {
          0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--eco-athena) 45%, transparent); }
          50% { box-shadow: 0 0 0 10px color-mix(in srgb, var(--eco-athena) 0%, transparent); }
        }

        .ttb-item {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          opacity: 0;
          transform: translateY(8px) scale(0.9);
          animation: ttb-in 0.22s ease forwards;
        }
        @keyframes ttb-in {
          to { opacity: 1; transform: translateY(0) scale(1); }
        }

        .ttb-icon-btn {
          width: 2.75rem;
          height: 2.75rem;
          border-radius: 9999px;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 2px solid var(--eco-rule);
          background: var(--eco-ink-sunken);
          color: var(--eco-cream-dim);
          cursor: pointer;
          transition: box-shadow 0.15s ease, border-color 0.15s ease, color 0.15s ease, transform 0.15s ease;
        }
        .ttb-icon-btn:hover {
          transform: scale(1.08);
        }

        .ttb-label {
          font-size: 0.75rem;
          font-weight: 600;
          white-space: nowrap;
          padding: 0.3rem 0.7rem;
          border-radius: 9999px;
          background: var(--eco-ink-sunken);
          border: 1px solid var(--eco-rule);
          color: var(--eco-cream);
          opacity: 0;
          transform: translateX(-6px);
          transition: opacity 0.15s ease, transform 0.15s ease;
          pointer-events: none;
        }
        .ttb-item:hover .ttb-label {
          opacity: 1;
          transform: translateX(0);
        }
      `}</style>

      <div className="ttb-wrap">
        <button
          type="button"
          data-open={open}
          onClick={() => setOpen((o) => !o)}
          className="ttb-bag"
          aria-label={open ? 'Close teacher tools' : 'Open teacher tools'}
          title="Teacher tools"
        >
          <BagIcon />
        </button>

        {open &&
          items.map((item, i) => (
            <div key={item.key} className="ttb-item" style={{ animationDelay: `${i * 45}ms` }}>
              <button
                type="button"
                onClick={() => {
                  item.onClick();
                  setOpen(false);
                }}
                className="ttb-icon-btn"
                style={{ '--hover-accent': item.accent } as React.CSSProperties}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = item.accent;
                  e.currentTarget.style.color = item.accent;
                  e.currentTarget.style.boxShadow = `0 0 12px 1px color-mix(in srgb, ${item.accent} 45%, transparent)`;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--eco-rule)';
                  e.currentTarget.style.color = 'var(--eco-cream-dim)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
                aria-label={item.label}
                title={item.label}
              >
                {item.icon}
              </button>
              <span className="ttb-label">{item.label}</span>
            </div>
          ))}
      </div>
    </>
  );
}