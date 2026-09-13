/**
 * Web Audio API synthesizer for realistic page-flip sound effects.
 *
 * Requirements:
 * - Purely synthesized offline sound (no audio files to fetch).
 * - Bandpass-swept noise burst for paper rustle.
 * - Low sine thump as the page lands.
 * - Shorter, higher variant for corner-fold.
 * - LocalStorage sound enabled/disabled persistence.
 * - AudioContext auto-resumes on first user interaction.
 * - Respects prefers-reduced-motion (silence).
 */

let audioCtx: AudioContext | null = null;
let noiseBuffer: AudioBuffer | null = null;
const SOUND_ENABLED_KEY = 'athena_library_sound_enabled';

function isReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function isSoundEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  if (isReducedMotion()) return false;
  const stored = localStorage.getItem(SOUND_ENABLED_KEY);
  return stored === null ? true : stored === 'true';
}

export function setSoundEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(SOUND_ENABLED_KEY, String(enabled));
}

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function getNoiseBuffer(ctx: AudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) {
    return noiseBuffer;
  }
  const bufferSize = ctx.sampleRate * 1.0; // 1 second of noise
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    // White noise
    data[i] = Math.random() * 2 - 1;
  }
  noiseBuffer = buffer;
  return noiseBuffer;
}

/**
 * Plays a realistic page turn sound:
 * 1. Swept bandpass filtered noise burst for the paper rustle.
 * 2. Subtle low-frequency sine thump on page landing.
 */
export function playPageFlipSound(): void {
  if (!isSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;

  // --- 1. Paper Rustle (Noise Burst + Swept Bandpass) ---
  const noise = ctx.createBufferSource();
  noise.buffer = getNoiseBuffer(ctx);

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.setValueAtTime(1.8, now);
  // Frequency sweep simulating paper friction
  filter.frequency.setValueAtTime(800, now);
  filter.frequency.exponentialRampToValueAtTime(3200, now + 0.08);
  filter.frequency.exponentialRampToValueAtTime(1200, now + 0.22);

  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.001, now);
  noiseGain.gain.linearRampToValueAtTime(0.28, now + 0.03);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);

  noise.connect(filter);
  filter.connect(noiseGain);
  noiseGain.connect(ctx.destination);

  noise.start(now);
  noise.stop(now + 0.25);

  // --- 2. Low Sine Thump (Landing impact) ---
  const osc = ctx.createOscillator();
  const oscGain = ctx.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(95, now + 0.12);
  osc.frequency.exponentialRampToValueAtTime(45, now + 0.24);

  oscGain.gain.setValueAtTime(0.001, now);
  oscGain.gain.setValueAtTime(0.001, now + 0.12);
  oscGain.gain.linearRampToValueAtTime(0.18, now + 0.14);
  oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);

  osc.connect(oscGain);
  oscGain.connect(ctx.destination);

  osc.start(now + 0.12);
  osc.stop(now + 0.28);
}

/**
 * Plays a shorter, higher variant on corner-fold interaction.
 */
export function playCornerFoldSound(): void {
  if (!isSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;

  const noise = ctx.createBufferSource();
  noise.buffer = getNoiseBuffer(ctx);

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.setValueAtTime(2.5, now);
  filter.frequency.setValueAtTime(1800, now);
  filter.frequency.exponentialRampToValueAtTime(3800, now + 0.06);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.001, now);
  gain.gain.linearRampToValueAtTime(0.12, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

  noise.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);

  noise.start(now);
  noise.stop(now + 0.1);
}
