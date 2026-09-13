'use client';

import { useEffect, useRef, useState } from 'react';

export type RestraintState = 'listening' | 'ready' | 'held-back' | 'speaking';

export interface RestraintMeterProps {
  state: RestraintState;
  score?: number;
}

/**
 * Athena's presence — a small animated character, not a static orb. A glowing
 * "tuning eye": an aperture that breathes while she listens, ripples while she
 * speaks, and contracts, cooled, when the floor machine holds her back. Driven
 * entirely by `state` (see classroomController's setRestraintMeter); the
 * speaking ripple is procedural, so no audio-amplitude plumbing is needed.
 *
 * Pure Canvas — no 3D engine, no asset, no dependency. The props and the call
 * site are unchanged from the plain orb it replaces.
 */

interface Params {
  aperture: number; // pupil openness, 0..1
  glow: number; // bloom intensity, 0..1
  warmth: number; // 0 = held-back red, 1 = amber
  speak: number; // 0..1 speaking-ness
}

const TARGETS: Record<RestraintState, Params> = {
  listening: { aperture: 0.52, glow: 0.36, warmth: 1, speak: 0 },
  ready: { aperture: 0.42, glow: 0.3, warmth: 0.62, speak: 0 },
  'held-back': { aperture: 0.16, glow: 0.14, warmth: 0, speak: 0 },
  speaking: { aperture: 0.72, glow: 0.74, warmth: 1, speak: 1 },
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Parse `rgb()/#hex` from a computed CSS value into [r,g,b]. */
function rgb(value: string, fallback: [number, number, number]): [number, number, number] {
  const v = value.trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(v);
  if (hex) {
    const n = parseInt(hex[1] as string, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = /rgba?\(([^)]+)\)/.exec(v);
  if (m) {
    const [r, g, b] = (m[1] as string).split(',').map((x) => parseFloat(x));
    return [r ?? fallback[0], g ?? fallback[1], b ?? fallback[2]];
  }
  return fallback;
}

const mix = (
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): string => `${Math.round(lerp(a[0], b[0], t))}, ${Math.round(lerp(a[1], b[1], t))}, ${Math.round(lerp(a[2], b[2], t))}`;

export function RestraintMeter({ state, score }: RestraintMeterProps) {
  const [reducedMotion, setReducedMotion] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReducedMotion(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cs = getComputedStyle(canvas);
    const amber = rgb(cs.getPropertyValue('--eco-athena') || '#EFB65C', [239, 182, 92]);
    const red = rgb(cs.getPropertyValue('--eco-red') || '#B85C38', [184, 92, 56]);
    const sunken = rgb(cs.getPropertyValue('--eco-ink-sunken') || '#101013', [16, 16, 19]);

    const SIZE = 132;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = SIZE * dpr;
    canvas.height = SIZE * dpr;
    ctx.scale(dpr, dpr);

    const p: Params = { ...TARGETS[stateRef.current] };
    let irisAngle = 0;
    let raf = 0;
    let last = performance.now();

    // With reduced motion, still run the loop so a state *change* (her aperture
    // contracting when held back) is shown — but freeze every idle animation.
    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      const target = TARGETS[stateRef.current];
      const k = reducedMotion ? 1 : 1 - Math.pow(0.001, dt); // smoothing
      p.aperture = lerp(p.aperture, target.aperture, k);
      p.glow = lerp(p.glow, target.glow, k);
      p.warmth = lerp(p.warmth, target.warmth, k);
      p.speak = lerp(p.speak, target.speak, k);

      const t = now / 1000;
      const breath = reducedMotion ? 0 : Math.sin(t * 1.6) * 0.5 + 0.5; // 0..1
      if (!reducedMotion) irisAngle += dt * (0.35 + p.speak * 2.2);

      const cx = SIZE / 2;
      const cy = SIZE / 2;
      const accent = mix(red, amber, p.warmth);

      ctx.clearRect(0, 0, SIZE, SIZE);

      // outer bloom
      const bloomR = 30 + p.glow * 34 + breath * 4 + p.speak * 6;
      const bloom = ctx.createRadialGradient(cx, cy, 4, cx, cy, bloomR);
      bloom.addColorStop(0, `rgba(${accent}, ${0.42 * p.glow})`);
      bloom.addColorStop(1, `rgba(${accent}, 0)`);
      ctx.fillStyle = bloom;
      ctx.fillRect(0, 0, SIZE, SIZE);

      // head sphere — light from top-left for a dimensional read
      const headR = 40 + breath * 1.6 - p.speak * 0.5;
      const body = ctx.createRadialGradient(cx - 14, cy - 16, 4, cx, cy, headR * 1.15);
      body.addColorStop(0, `rgba(${sunken[0] + 14}, ${sunken[1] + 13}, ${sunken[2] + 16}, 1)`);
      body.addColorStop(0.55, `rgba(${sunken[0]}, ${sunken[1]}, ${sunken[2]}, 1)`);
      body.addColorStop(1, `rgba(6, 6, 8, 1)`);
      ctx.beginPath();
      ctx.arc(cx, cy, headR, 0, Math.PI * 2);
      ctx.fillStyle = body;
      ctx.fill();

      // rim light
      ctx.beginPath();
      ctx.arc(cx, cy, headR - 0.6, Math.PI * 0.9, Math.PI * 1.55);
      ctx.strokeStyle = `rgba(${accent}, ${0.5 + p.glow * 0.3})`;
      ctx.lineWidth = 1.4;
      ctx.stroke();

      // clip to the head for the internals
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, headR - 1, 0, Math.PI * 2);
      ctx.clip();

      // speaking ripple across the equator
      if (p.speak > 0.03 && !reducedMotion) {
        ctx.beginPath();
        for (let x = -headR; x <= headR; x += 2) {
          const w =
            Math.sin(x * 0.22 + t * 9) * 3 +
            Math.sin(x * 0.5 - t * 13) * 2 +
            Math.sin(x * 0.09 + t * 5) * 4;
          const y = cy + w * p.speak;
          if (x === -headR) ctx.moveTo(cx + x, y);
          else ctx.lineTo(cx + x, y);
        }
        ctx.strokeStyle = `rgba(${accent}, ${0.55 * p.speak})`;
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }

      // iris — two rotating arcs
      const irisR = 11 + p.aperture * 9 + p.speak * breath * 1.5;
      for (let i = 0; i < 2; i += 1) {
        const a0 = irisAngle * (i === 0 ? 1 : -0.7) + i * Math.PI;
        ctx.beginPath();
        ctx.arc(cx, cy, irisR + i * 3, a0, a0 + Math.PI * 1.35);
        ctx.strokeStyle = `rgba(${accent}, ${(i === 0 ? 0.85 : 0.4) * (0.5 + p.glow)})`;
        ctx.lineWidth = i === 0 ? 2 : 1.2;
        ctx.lineCap = 'round';
        ctx.stroke();
      }

      // pupil
      const pupilR = Math.max(1.5, 2 + p.aperture * 7);
      ctx.beginPath();
      ctx.arc(cx, cy, pupilR, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(4, 4, 6, 0.95)`;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx, cy, pupilR + 0.8, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${accent}, ${0.6 + p.glow * 0.4})`;
      ctx.lineWidth = 1;
      ctx.stroke();

      // glint — a bit of life
      ctx.beginPath();
      ctx.arc(cx - pupilR * 0.5, cy - pupilR * 0.5, Math.max(0.7, pupilR * 0.28), 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 244, 224, 0.75)';
      ctx.fill();

      ctx.restore();

      // scanning motes while listening (calm), gone while held back
      if (!reducedMotion && p.speak < 0.2 && p.glow > 0.2) {
        for (let i = 0; i < 3; i += 1) {
          const a = t * (0.5 + i * 0.2) + i * 2.1;
          const rr = headR + 5 + Math.sin(t + i) * 2;
          ctx.beginPath();
          ctx.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 1.1, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${accent}, ${0.35 * p.glow})`;
          ctx.fill();
        }
      }

      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [reducedMotion]);

  const heldBack = state === 'held-back';
  const speaking = state === 'speaking';
  const evaluating = state === 'ready';
  const hue = heldBack ? 'var(--eco-red)' : 'var(--eco-athena)';

  const label = speaking
    ? 'Speaking'
    : heldBack
      ? 'Held back'
      : evaluating
        ? 'Evaluating'
        : 'Listening';
  const sub = speaking
    ? 'Athena has the floor.'
    : heldBack
      ? 'A turn was blocked by your controls.'
      : 'Tuned in, waiting for a reason to speak.';

  return (
    <div className="eco-panel flex flex-col items-center gap-3 p-6 text-center">
      <span className="eco-label" style={{ color: 'var(--eco-athena)' }}>
        Athena
      </span>

      <div className="relative flex h-[132px] w-[132px] items-center justify-center">
        <canvas
          ref={canvasRef}
          width={132}
          height={132}
          style={{ width: 132, height: 132 }}
          role="img"
          aria-label={`Athena — ${label.toLowerCase()}`}
        />
        {heldBack && score !== undefined && (
          <span
            className="eco-numerals absolute text-[0.7rem] font-semibold"
            style={{ color: hue, transform: 'translateY(30px)' }}
          >
            {score.toFixed(2)}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium tracking-wide" style={{ color: hue }}>
          {label}
        </span>
        <span className="text-xs text-[var(--eco-cream-faint)]">{sub}</span>
      </div>
    </div>
  );
}
