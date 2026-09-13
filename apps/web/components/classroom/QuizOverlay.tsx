/**
 * The student's live quiz card — PS31 §3.6.
 *
 * When Athena asks a question, the orchestrator broadcasts it with a `deadline`.
 * The card appears as soon as she reports the question, but the countdown does
 * not start until she stops speaking — the server re-broadcasts the quiz with a
 * pushed-out deadline at that point, so the window is not spent listening to
 * the four options being read out. This renders it as a centered takeover with
 * a countdown, students tap an answer *or say it out loud*, and it reveals the
 * correct option once everyone answers or the timer runs out.
 *
 * A spoken answer is scored on the server and comes back on `quiz-result`, so
 * it shows here as the chosen option exactly like a tap does.
 *
 * The teacher keeps the sidebar `QuizCards` (live results, history); only
 * students get this overlay, and only while a question is actually open.
 */

'use client';

import { useEffect, useState } from 'react';
import type { QuizCardState } from '@/hooks/useClassroom';

const LETTERS = ['A', 'B', 'C', 'D'];

/** How long the revealed answer stays on screen before the overlay dismisses. */
const REVEAL_LINGER_MS = 4500;

/**
 * Fallback span for the ring, used only until the real window is measured on
 * the first render of a card. The ring is otherwise drawn against however long
 * this question's window actually is — see `windowMs` below — rather than a
 * number copied from the server, which is what used to let the ring empty while
 * the server was still accepting answers.
 */
const FALLBACK_WINDOW_MS = 15_000;

export interface QuizOverlayProps {
  quizzes: QuizCardState[];
  onAnswer: (quizId: string, option: string) => void;
}

export function QuizOverlay({ quizzes, onAnswer }: QuizOverlayProps) {
  const card = quizzes[quizzes.length - 1];
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReducedMotion(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  const pending = card !== undefined && card.quiz.quizId !== dismissedId;
  const activeId = pending && card ? card.quiz.quizId : null;

  // How long this question's answer window is, measured from the deadline the
  // server sent rather than assumed. Re-measured whenever the deadline changes,
  // which it does once when Athena stops reading the options aloud and the
  // countdown actually starts — so the ring restarts full instead of resuming
  // part-drained.
  const deadlineKey = card ? `${card.quiz.quizId}:${card.quiz.deadline}` : '';
  const [window_, setWindow] = useState<{ key: string; ms: number } | null>(null);
  useEffect(() => {
    if (!card || !deadlineKey) return;
    setWindow({
      key: deadlineKey,
      ms: Math.max(1000, card.quiz.deadline - Date.now()),
    });
    // Keyed on the deadline, so this re-runs exactly when the window changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadlineKey]);

  // Keep `now` live. Re-seeded whenever a new card becomes active, so the next
  // question's countdown never renders off a stale timestamp from the gap
  // between questions.
  useEffect(() => {
    if (!activeId) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [activeId]);

  // Once the answer is revealed, linger briefly then dismiss.
  useEffect(() => {
    if (!card?.correctAnswer) return;
    const quizId = card.quiz.quizId;
    const t = window.setTimeout(() => setDismissedId(quizId), REVEAL_LINGER_MS);
    return () => window.clearTimeout(t);
  }, [card?.correctAnswer, card?.quiz.quizId]);

  if (!pending || !card) return null;

  const WINDOW_MS =
    window_ && window_.key === deadlineKey ? window_.ms : FALLBACK_WINDOW_MS;

  const { quiz, myAnswer, myResult, correctAnswer } = card;
  const revealed = Boolean(correctAnswer);
  const remainingMs = Math.max(0, quiz.deadline - now);
  const secs = Math.ceil(remainingMs / 1000);
  const expired = remainingMs <= 0;

  // A quiz whose window (plus the reveal linger) is long gone — e.g. the page
  // was reloaded after it finished — should not reappear.
  if (expired && !revealed && now > quiz.deadline + WINDOW_MS) return null;

  const locked = myAnswer !== undefined || expired || revealed;
  const frac = Math.max(0, Math.min(1, remainingMs / WINDOW_MS));
  const RADIUS = 22;
  const CIRCUM = 2 * Math.PI * RADIUS;
  const myLetter =
    myAnswer !== undefined
      ? LETTERS[(quiz.options ?? []).indexOf(myAnswer)] ?? ''
      : '';

  const status = revealed
    ? myResult === 'correct'
      ? 'Correct.'
      : myResult === 'incorrect'
        ? 'Not quite.'
        : 'Answer revealed.'
    : myAnswer !== undefined
      ? `Locked in: ${myLetter}`.trimEnd()
      : expired
        ? 'Time’s up.'
        : 'Tap an answer — or say it out loud.';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Pop quiz"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.5rem',
        background: 'color-mix(in srgb, var(--eco-ink) 80%, transparent)',
        backdropFilter: 'blur(4px)',
      }}
    >
      <div
        className="eco-panel"
        style={{
          width: '100%',
          maxWidth: '40rem',
          padding: '1.5rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '1rem',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            <span
              className="eco-label"
              style={{ color: 'var(--eco-athena)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                <path d="M2 5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5Zm3 1.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2ZM4 11h8v-1H4v1Z" />
              </svg>
              {quiz.setIndex && quiz.setTotal
                ? `Pop quiz · Question ${quiz.setIndex} of ${quiz.setTotal}`
                : 'Pop quiz'}
            </span>
            <p style={{ margin: 0, fontSize: '1.05rem', color: 'var(--eco-cream)' }}>
              {quiz.question}
            </p>
          </div>
          <div
            style={{ position: 'relative', width: '3.5rem', height: '3.5rem', flexShrink: 0 }}
            aria-label={expired ? 'Time is up' : `${secs} seconds left`}
          >
            <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden>
              <circle cx="28" cy="28" r={RADIUS} fill="none" stroke="var(--eco-rule)" strokeWidth="3" />
              {!expired && (
                <circle
                  cx="28"
                  cy="28"
                  r={RADIUS}
                  fill="none"
                  stroke={secs <= 5 ? 'var(--eco-red)' : 'var(--eco-athena)'}
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeDasharray={CIRCUM}
                  strokeDashoffset={CIRCUM * (1 - frac)}
                  transform="rotate(-90 28 28)"
                  style={{
                    transition: reducedMotion ? 'none' : 'stroke-dashoffset 0.25s linear',
                  }}
                />
              )}
            </svg>
            <span
              className="eco-numerals"
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.8rem',
                color: expired ? 'var(--eco-red)' : 'var(--eco-cream)',
              }}
            >
              {expired ? '0s' : `${secs}s`}
            </span>
          </div>
        </div>

        <ul
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
          }}
        >
          {(quiz.options ?? []).map((option, i) => {
            const chosen = myAnswer === option;
            const isCorrect = correctAnswer === option;
            const showCorrect = revealed && isCorrect;
            const showWrong = revealed && chosen && !isCorrect;
            return (
              <li key={option}>
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => onAnswer(quiz.quizId, option)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    textAlign: 'left',
                    borderRadius: '0.6rem',
                    border: '1px solid',
                    padding: '0.7rem 0.85rem',
                    fontSize: '0.9rem',
                    cursor: locked ? 'default' : 'pointer',
                    transition: 'border-color 0.15s, background 0.15s',
                    borderColor: showCorrect
                      ? 'var(--eco-athena)'
                      : showWrong
                        ? 'var(--eco-red)'
                        : chosen
                          ? 'var(--eco-athena)'
                          : 'var(--eco-rule)',
                    background: showCorrect
                      ? 'var(--eco-athena-dim)'
                      : showWrong
                        ? 'var(--eco-red-dim)'
                        : chosen
                          ? 'color-mix(in srgb, var(--eco-athena) 12%, var(--eco-ink-sunken))'
                          : 'var(--eco-ink-sunken)',
                    color: 'var(--eco-cream)',
                    boxShadow: showCorrect
                      ? '0 0 14px -2px color-mix(in srgb, var(--eco-athena) 55%, transparent)'
                      : 'none',
                  }}
                >
                  <span
                    aria-hidden
                    className="eco-numerals"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '1.6rem',
                      height: '1.6rem',
                      borderRadius: '999px',
                      flexShrink: 0,
                      fontSize: '0.8rem',
                      border: `1px solid ${
                        showCorrect || chosen ? 'var(--eco-athena)' : 'var(--eco-rule)'
                      }`,
                      color:
                        showCorrect || chosen
                          ? 'var(--eco-athena)'
                          : 'var(--eco-cream-dim)',
                    }}
                  >
                    {LETTERS[i] ?? '?'}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>{option}</span>
                  {showCorrect && (
                    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
                      <path
                        d="M3 8.5 6.5 12 13 4"
                        stroke="var(--eco-athena)"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </button>
              </li>
            );
          })}
        </ul>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '1rem',
            borderTop: '1px solid var(--eco-rule)',
            paddingTop: '0.75rem',
            fontSize: '0.8rem',
            color: revealed && myResult
              ? myResult === 'correct'
                ? 'var(--eco-athena)'
                : 'var(--eco-red)'
              : 'var(--eco-cream-faint)',
          }}
        >
          <span>{status}</span>
          {!revealed && !expired && myAnswer === undefined && (
            <span className="eco-numerals">{secs}s left</span>
          )}
        </div>
      </div>
    </div>
  );
}
