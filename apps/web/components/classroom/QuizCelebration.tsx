/**
 * "Perfect quiz score" celebration — PS31 §3.6 extension.
 *
 * Fires when this student answers every question in a quiz set correctly
 * (`echosphere:quiz-set-perfect`, scoped server-side to just them). Renders a
 * confetti + rising-balloons overlay and plays a short celebratory sound.
 *
 * The audio is a static file served straight from the web app's own /public
 * folder (apps/web/public/celebration.mp3) — no backend or TTS call involved,
 * so it plays instantly and works with zero extra setup.
 */

'use client';

import { useEffect, useState } from 'react';
import type { CelebrationTrigger } from '@/hooks/useClassroom';

const CONFETTI_COLORS = ['#f4c95d', '#ff8a5c', '#6bc5a0', '#5aa9e6', '#e07a9e'];
const CONFETTI_COUNT = 36;
const BALLOON_COUNT = 6;

/** How long the overlay stays on screen before it dismisses itself. */
const VISIBLE_MS = 6500;

/** Place your file here: apps/web/public/celebration.mp3 */
const CELEBRATION_AUDIO_SRC = '/celebration.mp3';

interface ConfettiPiece {
  id: number;
  left: number;
  delay: number;
  duration: number;
  color: string;
  rotate: number;
}

interface Balloon {
  id: number;
  left: number;
  delay: number;
  duration: number;
  color: string;
}

/**
 * The randomised layouts are built here rather than during render.
 *
 * `Math.random()` in a render path — including inside `useMemo`, which is a
 * caching hint and not a guarantee — lets React recompute different positions
 * on any re-render it chooses to make, so the shower could visibly reshuffle
 * mid-animation. Building them in the effect that already responds to a new
 * celebration keeps render pure and pins each shower's geometry for its whole
 * run.
 */
function rollConfetti(): ConfettiPiece[] {
  return Array.from({ length: CONFETTI_COUNT }, (_, id) => ({
    id,
    left: Math.random() * 100,
    delay: Math.random() * 1.2,
    duration: 3.8 + Math.random() * 2.2,
    color: CONFETTI_COLORS[id % CONFETTI_COLORS.length] ?? '#f4c95d',
    rotate: Math.random() * 360,
  }));
}

function rollBalloons(): Balloon[] {
  return Array.from({ length: BALLOON_COUNT }, (_, id) => ({
    id,
    left: 10 + id * (80 / BALLOON_COUNT) + (Math.random() * 6 - 3),
    delay: Math.random() * 1.0,
    duration: 5.0 + Math.random() * 2.0,
    color: CONFETTI_COLORS[(id + 2) % CONFETTI_COLORS.length] ?? '#5aa9e6',
  }));
}

export interface QuizCelebrationProps {
  celebration: CelebrationTrigger | null;
}

export function QuizCelebration({ celebration }: QuizCelebrationProps) {
  const [visible, setVisible] = useState(false);
  // Held together so one celebration's confetti and balloons are always rolled
  // from the same trigger.
  const [shower, setShower] = useState<{
    confetti: ConfettiPiece[];
    balloons: Balloon[];
  }>({ confetti: [], balloons: [] });

  useEffect(() => {
    if (!celebration) return;
    // Re-rolled only when a new celebration actually fires, so the shower looks
    // fresh each time rather than replaying identical positions. Batched with
    // `setVisible`, so no frame renders an empty shower.
    setShower({ confetti: rollConfetti(), balloons: rollBalloons() });
    setVisible(true);

    // Best-effort playback. A missing file (404) or a browser autoplay
    // restriction must never block the visual celebration.
    const audio = new Audio(CELEBRATION_AUDIO_SRC);
    audio.play().catch(() => undefined);

    const timer = window.setTimeout(() => setVisible(false), VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [celebration]);

  if (!celebration || !visible) return null;

  const { confetti, balloons } = shower;

  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        pointerEvents: 'none',
        overflow: 'hidden',
      }}
    >
      <style>{`
        @keyframes eco-confetti-fall {
          0% { transform: translateY(-10vh) rotate(0deg); opacity: 1; }
          100% { transform: translateY(110vh) rotate(360deg); opacity: 0.9; }
        }
        @keyframes eco-balloon-rise {
          0% { transform: translateY(20vh) scale(0.9); opacity: 0; }
          15% { opacity: 1; }
          100% { transform: translateY(-120vh) scale(1); opacity: 0; }
        }
      `}</style>

      {confetti.map((piece) => (
        <span
          key={piece.id}
          style={{
            position: 'absolute',
            top: 0,
            left: `${piece.left}%`,
            width: '0.5rem',
            height: '0.9rem',
            background: piece.color,
            borderRadius: '1px',
            transform: `rotate(${piece.rotate}deg)`,
            animation: `eco-confetti-fall ${piece.duration}s ease-in ${piece.delay}s forwards`,
          }}
        />
      ))}

      {balloons.map((balloon) => (
        <span
          key={balloon.id}
          style={{
            position: 'absolute',
            bottom: 0,
            left: `${balloon.left}%`,
            width: '2.4rem',
            height: '3rem',
            background: balloon.color,
            borderRadius: '50% 50% 50% 50% / 60% 60% 40% 40%',
            animation: `eco-balloon-rise ${balloon.duration}s ease-out ${balloon.delay}s forwards`,
            boxShadow: '0 0 12px -2px rgba(0,0,0,0.25)',
          }}
        />
      ))}

      <div
        style={{
          position: 'absolute',
          top: '18%',
          left: '50%',
          transform: 'translateX(-50%)',
          padding: '0.6rem 1.2rem',
          borderRadius: '999px',
          background: 'color-mix(in srgb, var(--eco-athena) 20%, var(--eco-ink))',
          border: '1px solid var(--eco-athena)',
          color: 'var(--eco-cream)',
          fontSize: '0.95rem',
          fontWeight: 600,
        }}
      >
        Perfect score on {celebration.topic}! </div>
    </div>
  );
}
