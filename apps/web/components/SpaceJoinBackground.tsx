/**
 * Animated space backdrop for the join screen: twinkling starfield, a slowly
 * rotating illustrated Earth, a big ATHENA title, a small "Powered by Agora"
 * constellation, a soft cursor glow, and a synthesized click sound.
 *
 * Renders as a fixed, full-viewport layer behind whatever is passed as
 * `children` — the real join form (header / eco-glass panels / footer)
 * renders completely untouched in normal flow on top of it. Uses the
 * existing --font-display and --eco-* tokens from globals.css so it matches
 * the rest of the app, but adds nothing to globals.css itself — all styling
 * here is scoped under the `sjb-` prefix to avoid any class collisions.
 *
 * This background is intentionally always dark/space-themed regardless of
 * the site's light/dark theme toggle — a "light mode starfield" doesn't
 * make sense, so it does not read `data-eco-theme`.
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
  glow: boolean;
  tint: string;
}

const LAYER_CONFIG = [
  { density: 11000, rMin: 0.3, rMax: 0.7, alphaMin: 0.12, alphaMax: 0.32, speed: 0.006, glow: false },
  { density: 16000, rMin: 0.5, rMax: 1.1, alphaMin: 0.25, alphaMax: 0.55, speed: 0.015, glow: false },
  { density: 34000, rMin: 0.8, rMax: 1.7, alphaMin: 0.4, alphaMax: 0.8, speed: 0.03, glow: true },
];
const TINTS = ['255,255,255', '210,225,255', '255,240,220'];

export function SpaceJoinBackground({ children }: { children: React.ReactNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);

  // Starfield: three depth layers, twinkling + slow drift.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    let layers: Star[][] = [];
    let raf = 0;

    interface ShootingStar {
      x: number;
      y: number;
      vx: number;
      vy: number;
      len: number;
      life: number;
      maxLife: number;
    }
    let shootingStars: ShootingStar[] = [];
    let nextShootAt = 0;

    function maybeSpawnShootingStar(now: number) {
      if (now < nextShootAt) return;
      // next one somewhere between 1.2s and 3s from now — frequent, but staggered
      nextShootAt = now + 1200 + Math.random() * 1800;
      const fromLeft = Math.random() < 0.5;
      const startX = fromLeft ? -20 : canvas!.width + 20;
      const startY = Math.random() * canvas!.height * 0.5;
      const speed = 6 + Math.random() * 4;
      const angle = fromLeft ? (Math.PI / 6) : Math.PI - Math.PI / 6;
      shootingStars.push({
        x: startX,
        y: startY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        len: 60 + Math.random() * 40,
        life: 0,
        maxLife: 60,
      });
    }

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
            twinkleSpeed: Math.random() * 0.015 + 0.003,
            phase: Math.random() * Math.PI * 2,
            driftSpeed: cfg.speed * (Math.random() * 0.6 + 0.7),
            glow: cfg.glow && Math.random() < 0.1,
            tint: TINTS[Math.floor(Math.random() * TINTS.length)],
          });
        }
        return stars;
      });
    }

    function draw(t: number) {
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);
      for (const stars of layers) {
        for (const s of stars) {
          const alpha = Math.max(0, s.baseAlpha + Math.sin(t * s.twinkleSpeed + s.phase) * 0.22);
          if (s.glow) {
            const grad = ctx!.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 5);
            grad.addColorStop(0, `rgba(${s.tint},${alpha * 0.45})`);
            grad.addColorStop(1, `rgba(${s.tint},0)`);
            ctx!.beginPath();
            ctx!.arc(s.x, s.y, s.r * 5, 0, Math.PI * 2);
            ctx!.fillStyle = grad;
            ctx!.fill();
          }
          ctx!.beginPath();
          ctx!.arc(s.x, s.y, s.r, 0, Math.PI * 2);
          ctx!.fillStyle = `rgba(${s.tint},${alpha})`;
          ctx!.fill();
          s.y += s.driftSpeed;
          if (s.y > canvas!.height) {
            s.y = 0;
            s.x = Math.random() * canvas!.width;
          }
        }
      }

      maybeSpawnShootingStar(t);
      shootingStars = shootingStars.filter((s) => s.life < s.maxLife);
      for (const s of shootingStars) {
        const progress = s.life / s.maxLife;
        const fadeAlpha = progress < 0.15 ? progress / 0.15 : 1 - (progress - 0.15) / 0.85;
        const tailX = s.x - s.vx * (s.len / 10);
        const tailY = s.y - s.vy * (s.len / 10);
        const grad = ctx!.createLinearGradient(s.x, s.y, tailX, tailY);
        grad.addColorStop(0, `rgba(255,255,255,${0.9 * fadeAlpha})`);
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx!.strokeStyle = grad;
        ctx!.lineWidth = 1.5;
        ctx!.beginPath();
        ctx!.moveTo(s.x, s.y);
        ctx!.lineTo(tailX, tailY);
        ctx!.stroke();
        s.x += s.vx;
        s.y += s.vy;
        s.life += 1;
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

  // Cursor glow: purely decorative, never intercepts clicks.
  useEffect(() => {
    const glow = glowRef.current;
    if (!glow) return;
    function move(e: MouseEvent) {
      glow!.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    }
    window.addEventListener('mousemove', move);
    return () => window.removeEventListener('mousemove', move);
  }, []);

  // Click sound: a short synthesized blip — no audio file to host or load.
  useEffect(() => {
    let audioCtx: AudioContext | null = null;
    function playClick() {
      if (!audioCtx) {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        audioCtx = new Ctx();
      }
      const now = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.exponentialRampToValueAtTime(520, now + 0.06);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.12, now + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.1);
    }
    document.addEventListener('click', playClick, { capture: true });
    return () => document.removeEventListener('click', playClick, { capture: true });
  }, []);

  return (
    <>
      <style>{`
        .sjb-stage {
          position: fixed;
          inset: 0;
          z-index: 0;
          overflow: hidden;
          background:
            radial-gradient(ellipse 60% 40% at 60% 5%, color-mix(in srgb, var(--eco-glow) 20%, transparent) 0%, transparent 60%),
            radial-gradient(ellipse 120% 90% at 50% -10%, #0e1a42 0%, #080b1e 55%, #04050f 100%);
        }
        .sjb-canvas { position: absolute; inset: 0; width: 100%; height: 100%; }

        .sjb-title-wrap {
          position: absolute;
          top: 4%;
          left: 50%;
          transform: translateX(-50%);
          text-align: center;
          pointer-events: none;
          width: 100%;
        }
        .sjb-title {
          font-family: var(--font-display), ui-sans-serif, system-ui, sans-serif;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.03em;
          font-size: clamp(44px, 8.5vw, 96px);
          line-height: 0.95;
          color: #e4f0f7;
          text-shadow:
            1px 1px 0 var(--eco-glow),
            2px 2px 0 var(--eco-glow),
            3px 3px 0 color-mix(in srgb, var(--eco-glow) 55%, black),
            4px 5px 14px rgba(0,0,0,0.5);
        }
        .sjb-subtitle {
          margin-top: 8px;
          font-family: var(--font-body), ui-sans-serif, system-ui, sans-serif;
          font-weight: 600;
          font-size: 12px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: var(--eco-athena);
          opacity: 0.9;
        }

        .sjb-globe-wrap {
          position: absolute;
          bottom: -60%;
          left: 50%;
          transform: translateX(-50%);
          width: min(62vw, 950px);
          pointer-events: none;
        }
        .sjb-globe-wrap svg { width: 100%; height: auto; display: block; filter: drop-shadow(0 25px 45px rgba(0,0,0,0.5)); }
        .sjb-globe-land { animation: sjb-rotate 130s linear infinite; transform-origin: 200px 200px; }
        @keyframes sjb-rotate { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

        .sjb-constellation {
          position: absolute;
          bottom: 20px;
          left: 24px;
          z-index: 1;
          width: 190px;
          height: 90px;
          pointer-events: none;
          opacity: 0.75;
        }
        .sjb-clabel {
          font-family: var(--font-body), ui-sans-serif, system-ui, sans-serif;
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.22em;
          fill: #e4f0f7;
          opacity: 0.8;
        }
        .sjb-cline { stroke: rgba(228,240,247,0.4); stroke-width: 1; fill: none; }
        .sjb-cstar { fill: #ffffff; animation: sjb-ctwinkle 1.7s ease-in-out infinite; }
        .sjb-cstar.s2 { animation-delay: 0.25s; }
        .sjb-cstar.s3 { animation-delay: 0.5s; }
        .sjb-cstar.s4 { animation-delay: 0.75s; }
        .sjb-cstar.s5 { animation-delay: 1s; }
        @keyframes sjb-ctwinkle { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }

        .sjb-cursor-glow {
          position: fixed;
          top: 0;
          left: 0;
          width: 26px;
          height: 26px;
          margin-left: -13px;
          margin-top: -13px;
          border-radius: 50%;
          pointer-events: none;
          z-index: 9999;
          background: radial-gradient(circle, color-mix(in srgb, var(--eco-glow) 85%, white) 0%, transparent 70%);
          mix-blend-mode: screen;
          will-change: transform;
        }

        .sjb-moon {
          animation: sjb-moon-drift 9s ease-in-out infinite;
          transform-origin: center;
        }
        .sjb-moon-2 { animation-duration: 12s; animation-delay: 0.6s; }
        @keyframes sjb-moon-drift {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-8px); }
        }

        .sjb-float-body {
          position: absolute;
          pointer-events: none;
        }
        .sjb-ringed-planet {
          top: 10%;
          left: 6%;
          width: 68px;
          animation: sjb-float-drift-a 14s ease-in-out infinite;
        }
        .sjb-rocky-moon {
          top: 14%;
          right: 8%;
          width: 54px;
          animation: sjb-float-drift-b 11s ease-in-out infinite;
        }
        .sjb-comet {
          top: 34%;
          right: 20%;
          width: 40px;
          animation: sjb-float-drift-c 8s ease-in-out infinite;
        }
        @keyframes sjb-float-drift-a {
          0%, 100% { transform: translateY(0px) rotate(0deg); }
          50% { transform: translateY(-14px) rotate(4deg); }
        }
        @keyframes sjb-float-drift-b {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(10px); }
        }
        @keyframes sjb-float-drift-c {
          0%, 100% { transform: translate(0px, 0px) rotate(0deg); }
          50% { transform: translate(-10px, 8px) rotate(-6deg); }
        }

        .sjb-content { position: relative; z-index: 1; }
      `}</style>

      <div className="sjb-stage">
        <canvas ref={canvasRef} className="sjb-canvas" />

        <div className="sjb-title-wrap">
          <div className="sjb-title">ATHENA</div>
          <div className="sjb-subtitle">Your AI Co-Teacher</div>
        </div>

        <div className="sjb-globe-wrap">
          <svg viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <radialGradient id="sjbOcean" cx="38%" cy="30%" r="85%">
                <stop offset="0%" stopColor="#cdeefb" />
                <stop offset="30%" stopColor="#6fc0e6" />
                <stop offset="65%" stopColor="#2f86bd" />
                <stop offset="100%" stopColor="#1c5a8c" />
              </radialGradient>
              <radialGradient id="sjbRimGlow" cx="38%" cy="30%" r="60%">
                <stop offset="62%" style={{ stopColor: 'var(--eco-glow)', stopOpacity: 0 }} />
                <stop offset="88%" style={{ stopColor: 'var(--eco-glow)', stopOpacity: 0.25 }} />
                <stop offset="100%" style={{ stopColor: 'var(--eco-glow)', stopOpacity: 0 }} />
              </radialGradient>
              <radialGradient id="sjbSpecular" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="rgba(255,255,255,0.55)" />
                <stop offset="60%" stopColor="rgba(255,255,255,0.12)" />
                <stop offset="100%" stopColor="rgba(255,255,255,0)" />
              </radialGradient>
              <linearGradient id="sjbLand1" x1="10%" y1="0%" x2="90%" y2="100%">
                <stop offset="0%" stopColor="#b8f0b0" />
                <stop offset="45%" stopColor="#6fbf6e" />
                <stop offset="100%" stopColor="#3a8f52" />
              </linearGradient>
              <linearGradient id="sjbLand2" x1="10%" y1="0%" x2="90%" y2="100%">
                <stop offset="0%" stopColor="#a3e0a0" />
                <stop offset="100%" stopColor="#4a9a5a" />
              </linearGradient>
              <linearGradient id="sjbLand3" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#d9c383" />
                <stop offset="100%" stopColor="#b89257" />
              </linearGradient>
              <clipPath id="sjbSphereClip"><circle cx="200" cy="200" r="150" /></clipPath>
              <radialGradient id="sjbTerminator" cx="70%" cy="55%" r="85%">
                <stop offset="45%" stopColor="rgba(5,15,30,0)" />
                <stop offset="100%" stopColor="rgba(5,15,30,0.38)" />
              </radialGradient>
              <radialGradient id="sjbMoon" cx="35%" cy="30%" r="75%">
                <stop offset="0%" stopColor="#d8d5ea" />
                <stop offset="100%" stopColor="#726d90" />
              </radialGradient>
              <filter id="sjbCloudNoise" x="-20%" y="-20%" width="140%" height="140%">
                <feTurbulence type="fractalNoise" baseFrequency="0.014 0.02" numOctaves={5} seed={11} result="noise" />
                <feColorMatrix
                  in="noise"
                  type="matrix"
                  values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 3.2 -1.55"
                />
              </filter>
              <filter id="sjbLandGrain" x="-20%" y="-20%" width="140%" height="140%">
                <feTurbulence type="fractalNoise" baseFrequency={0.35} numOctaves={2} seed={4} result="grain" />
                <feColorMatrix
                  in="grain"
                  type="matrix"
                  values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.14 0"
                />
              </filter>
              <filter id="sjbOceanGrain" x="-20%" y="-20%" width="140%" height="140%">
                <feTurbulence type="fractalNoise" baseFrequency="0.06 0.09" numOctaves={3} seed={8} result="grain" />
                <feColorMatrix
                  in="grain"
                  type="matrix"
                  values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.08 0"
                />
              </filter>
            </defs>

            <circle cx="200" cy="200" r="168" fill="url(#sjbRimGlow)" />

            <g className="sjb-moon" transform="translate(340,100)">
              <circle r="15" fill="url(#sjbMoon)" stroke="#0a1c2c" strokeWidth={2.5} />
              <circle cx="-4" cy="-3" r="3" fill="rgba(20,20,40,0.2)" />
            </g>
            <g className="sjb-moon sjb-moon-2" transform="translate(28,268)">
              <circle r="11" fill="url(#sjbMoon)" stroke="#0a1c2c" strokeWidth={2.2} />
            </g>

            <circle cx="200" cy="200" r="150" fill="url(#sjbOcean)" stroke="#0a1c2c" strokeWidth={3} />
            <circle cx="200" cy="200" r="150" fill="url(#sjbOceanGrain)" clipPath="url(#sjbSphereClip)" style={{ mixBlendMode: 'overlay' }} />

            <g className="sjb-globe-land">
              <g clipPath="url(#sjbSphereClip)">
                <path
                  d="M96 72 Q112 60 128 66 Q144 52 160 60 Q172 50 186 56 Q198 46 212 54 Q228 48 240 62 Q252 56 262 68 Q272 78 268 94 Q278 100 272 114 Q276 128 258 132 Q262 144 244 148 Q236 158 220 150 Q210 164 192 156 Q182 168 166 158 Q152 168 138 156 Q122 162 114 146 Q102 148 96 132 Q84 128 86 112 Q76 106 82 92 Q78 80 96 72 Z"
                  fill="url(#sjbLand1)" stroke="#0a1c2c" strokeWidth={2.2} strokeLinejoin="round"
                />
                <path
                  d="M150 150 Q164 140 178 148 Q190 138 204 148 Q218 142 228 154 Q240 150 236 166 Q246 172 238 186 Q244 196 228 202 Q230 214 214 216 Q210 228 194 222 Q184 232 172 220 Q158 226 154 212 Q142 214 140 198 Q130 196 134 182 Q124 176 132 164 Q136 154 150 150 Z"
                  fill="url(#sjbLand2)" stroke="#0a1c2c" strokeWidth={2.2} strokeLinejoin="round"
                />
                <path
                  d="M74 190 Q86 182 96 190 Q108 184 114 196 Q124 202 118 214 Q124 224 110 228 Q104 236 92 230 Q80 234 74 222 Q64 218 68 206 Q66 196 74 190 Z"
                  fill="#a3e0a0" stroke="#0a1c2c" strokeWidth={2} strokeLinejoin="round"
                />
                <path
                  d="M266 160 Q278 152 288 160 Q298 156 300 170 Q304 180 292 186 Q286 194 274 188 Q264 190 262 176 Q258 166 266 160 Z"
                  fill="#5aab5f" stroke="#0a1c2c" strokeWidth={1.9} strokeLinejoin="round"
                />
                <path
                  d="M250 118 Q262 110 274 116 Q286 110 292 122 Q298 132 288 142 Q292 152 278 156 Q268 164 258 154 Q248 148 250 136 Q244 126 250 118 Z"
                  fill="url(#sjbLand3)" stroke="#0a1c2c" strokeWidth={2.2} strokeLinejoin="round"
                />
                <path
                  d="M50 50 Q80 34 112 38 Q142 28 170 46 Q156 60 132 58 Q112 68 92 60 Q68 70 50 50 Z"
                  fill="#f5fbfc" stroke="#0a1c2c" strokeWidth={2} strokeLinejoin="round"
                />
                <path
                  d="M56 300 Q88 320 122 314 Q150 328 176 320 Q160 304 136 306 Q116 296 96 300 Q76 294 56 300 Z"
                  fill="#f5fbfc" stroke="#0a1c2c" strokeWidth={2} strokeLinejoin="round"
                />
                <circle cx="200" cy="200" r="150" fill="url(#sjbLandGrain)" style={{ mixBlendMode: 'multiply' }} />
                <rect x="0" y="0" width="400" height="400" filter="url(#sjbCloudNoise)" opacity={0.8} />
                <circle cx="200" cy="200" r="150" fill="url(#sjbTerminator)" />
              </g>
            </g>

            <ellipse cx="150" cy="130" rx="46" ry="30" fill="url(#sjbSpecular)" clipPath="url(#sjbSphereClip)" style={{ mixBlendMode: 'screen' }} />

            <circle cx="200" cy="200" r="150" fill="none" stroke="#0a1c2c" strokeWidth={3} />
          </svg>
        </div>

        <svg className="sjb-float-body sjb-ringed-planet" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <radialGradient id="sjbRingedPlanet" cx="35%" cy="30%" r="75%">
              <stop offset="0%" stopColor="#e8c98a" />
              <stop offset="100%" stopColor="#9a6f3a" />
            </radialGradient>
          </defs>
          <ellipse cx="50" cy="50" rx="46" ry="12" fill="none" stroke="#e8c98a" strokeWidth={2.5} opacity={0.6} transform="rotate(-18 50 50)" />
          <circle cx="50" cy="50" r="26" fill="url(#sjbRingedPlanet)" stroke="#0a1c2c" strokeWidth={2} />
        </svg>

        <svg className="sjb-float-body sjb-rocky-moon" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <radialGradient id="sjbRockyMoon" cx="35%" cy="30%" r="75%">
              <stop offset="0%" stopColor="#e0a99a" />
              <stop offset="100%" stopColor="#8a4a3a" />
            </radialGradient>
          </defs>
          <circle cx="50" cy="50" r="32" fill="url(#sjbRockyMoon)" stroke="#0a1c2c" strokeWidth={2.2} />
          <circle cx="38" cy="40" r="6" fill="rgba(20,20,30,0.2)" />
          <circle cx="60" cy="58" r="4" fill="rgba(20,20,30,0.18)" />
        </svg>

        <svg className="sjb-float-body sjb-comet" viewBox="0 0 100 60" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="sjbCometTail" x1="100%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="rgba(255,255,255,0.85)" />
              <stop offset="100%" stopColor="rgba(255,255,255,0)" />
            </linearGradient>
          </defs>
          <path d="M85 15 L10 50" stroke="url(#sjbCometTail)" strokeWidth={4} strokeLinecap="round" />
          <circle cx="88" cy="12" r="5" fill="#ffffff" />
        </svg>

        <svg className="sjb-constellation" viewBox="0 0 190 90" xmlns="http://www.w3.org/2000/svg">
          <path className="sjb-cline" d="M14 20 L42 12 L70 26 L98 14 L120 28 L146 18" />
          <circle className="sjb-cstar s1" cx="14" cy="20" r="2.2" />
          <circle className="sjb-cstar s2" cx="42" cy="12" r="1.8" />
          <circle className="sjb-cstar s3" cx="70" cy="26" r="2.4" />
          <circle className="sjb-cstar s4" cx="98" cy="14" r="1.6" />
          <circle className="sjb-cstar s5" cx="120" cy="28" r="2" />
          <circle className="sjb-cstar s2" cx="146" cy="18" r="1.8" />
          <text x="8" y="52" className="sjb-clabel">POWERED BY</text>
          <text x="8" y="66" className="sjb-clabel" style={{ fontSize: 13, letterSpacing: '0.14em', opacity: 0.95 }}>AGORA</text>
        </svg>
      </div>

      <div ref={glowRef} className="sjb-cursor-glow" />

      <div className="sjb-content">{children}</div>
    </>
  );
}