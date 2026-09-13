/**
 * Ambient space background for the live classroom room (teacher + student).
 *
 * Deliberately much lighter than SpaceJoinBackground: no globe, no big
 * title, fewer stars, since this has to coexist with live WebRTC video and
 * ClassroomAudio's visualizer canvas — it should read as ambient texture,
 * not compete for attention the way the join screen's hero can.
 *
 * Always renders the same dark starfield as the join page, by design — the
 * room should look like a continuation of "outside" rather than its own
 * separate theme, so this does not branch on data-eco-theme.
 *
 * Same integration pattern as SpaceJoinBackground: renders a fixed
 * full-viewport layer behind `children`, which render untouched in normal
 * flow on top of it.
 */

'use client';

import { useEffect, useRef } from 'react';

interface Star {
  x: number;
  y: number;
  r: number;
  baseAlpha: number;
  twinkleSpeed: number;
  phase: number;
  driftSpeed: number;
}

// Deliberately sparser than the join page — this runs alongside live video.
const LAYER_CONFIG = [
  { density: 22000, rMin: 0.4, rMax: 0.9, alphaMin: 0.12, alphaMax: 0.3, speed: 0.005 },
  { density: 34000, rMin: 0.6, rMax: 1.3, alphaMin: 0.22, alphaMax: 0.45, speed: 0.012 },
];

export function ClassroomSpaceBackground({ children }: { children: React.ReactNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    let layers: Star[][] = [];
    let raf = 0;

    function resize() {
      canvas!.width = window.innerWidth;
      canvas!.height = window.innerHeight;
      layers = LAYER_CONFIG.map((cfg) => {
        const count = Math.floor((canvas!.width * canvas!.height) / cfg.density);
        const stars: Star[] = [];
        for (let i = 0; i < count; i++) {
          stars.push({
            x: Math.random() * canvas!.width,
            y: Math.random() * canvas!.height,
            r: Math.random() * (cfg.rMax - cfg.rMin) + cfg.rMin,
            baseAlpha: Math.random() * (cfg.alphaMax - cfg.alphaMin) + cfg.alphaMin,
            twinkleSpeed: Math.random() * 0.012 + 0.003,
            phase: Math.random() * Math.PI * 2,
            driftSpeed: cfg.speed * (Math.random() * 0.6 + 0.7),
          });
        }
        return stars;
      });
    }

    function draw(t: number) {
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);
      for (const stars of layers) {
        for (const s of stars) {
          const alpha = Math.max(0, s.baseAlpha + Math.sin(t * s.twinkleSpeed + s.phase) * 0.2);
          ctx!.beginPath();
          ctx!.arc(s.x, s.y, s.r, 0, Math.PI * 2);
          ctx!.fillStyle = `rgba(255,255,255,${alpha})`;
          ctx!.fill();
          s.y += s.driftSpeed;
          if (s.y > canvas!.height) {
            s.y = 0;
            s.x = Math.random() * canvas!.width;
          }
        }
      }
      raf = requestAnimationFrame(draw);
    }

    resize();
    window.addEventListener('resize', resize);
    raf = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(raf);
    };
  }, []);

  // Cursor glow, carried over from the join screen for a consistent feel.
  useEffect(() => {
    const glow = glowRef.current;
    if (!glow) return;
    function move(e: MouseEvent) {
      glow!.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    }
    window.addEventListener('mousemove', move);
    return () => window.removeEventListener('mousemove', move);
  }, []);

  return (
    <>
      <style>{`
        .csb-stage {
          position: fixed;
          inset: 0;
          z-index: 0;
          overflow: hidden;
          background:
            radial-gradient(ellipse 60% 40% at 60% 5%, color-mix(in srgb, var(--eco-glow) 20%, transparent) 0%, transparent 60%),
            radial-gradient(ellipse 120% 90% at 50% -10%, #0e1a42 0%, #080b1e 55%, #04050f 100%);
        }
        .csb-canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
        .csb-cursor-glow {
          position: fixed;
          top: 0;
          left: 0;
          width: 22px;
          height: 22px;
          margin-left: -11px;
          margin-top: -11px;
          border-radius: 50%;
          pointer-events: none;
          z-index: 9999;
          background: radial-gradient(circle, color-mix(in srgb, var(--eco-glow) 80%, white) 0%, transparent 70%);
          mix-blend-mode: screen;
          will-change: transform;
          opacity: 0.8;
        }
        .csb-content { position: relative; z-index: 1; }
      `}</style>

      <div className="csb-stage">
        <canvas ref={canvasRef} className="csb-canvas" />
      </div>

      <div ref={glowRef} className="csb-cursor-glow" />

      <div className="csb-content">{children}</div>
    </>
  );
}