#!/usr/bin/env node
/**
 * Generates the spoken-WAV fixture `scripts/speech.e2e.ts` needs, without
 * requiring macOS.
 *
 * `speech.e2e.ts`'s own header comment only documents a macOS path (`say` +
 * `afconvert`), which is why the README lists real-speech transcription as
 * "unverified" — there was no way to produce the fixture on any other
 * platform. This adds a Windows path using SAPI (`System.Speech`, built into
 * Windows — no new dependency, no API key), matching the same format the
 * macOS instructions target: PCM, 16-bit, mono, 48kHz (LEI16@48000), which is
 * what Chromium's `--use-file-for-fake-audio-capture` expects.
 *
 * Usage:
 *   node scripts/generate-speech-fixture.mjs [outFile] ["text to speak"]
 *
 * Defaults to <repo>/apps/web/.tmp/speech-fixture.wav and the same phrase
 * speech.e2e.ts's own comment uses, so `pnpm test:speech` (which forwards its
 * argv on) needs no extra typing for the common case.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_TEXT = 'Hey Athena. Can you explain what a common denominator is?';
const DEFAULT_OUT = resolve(__dirname, '..', '.tmp', 'speech-fixture.wav');

const outFile = resolve(process.argv[2] ?? DEFAULT_OUT);
const text = process.argv[3] ?? DEFAULT_TEXT;

mkdirSync(dirname(outFile), { recursive: true });

if (process.platform === 'win32') {
  // Single-quoted PowerShell literals avoid any escaping issue with the
  // spoken text; only the two literal single quotes in it need doubling.
  const psText = text.replace(/'/g, "''");
  const psPath = outFile.replace(/'/g, "''");

  const script = [
    'Add-Type -AssemblyName System.Speech',
    '$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    "$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(48000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)",
    `$synth.SetOutputToWaveFile('${psPath}', $fmt)`,
    `$synth.Speak('${psText}')`,
    '$synth.Dispose()',
  ].join('; ');

  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    console.error(`\nSAPI synthesis failed (exit ${result.status}).`);
    process.exit(1);
  }

  console.log(`\nWrote ${outFile}`);
  console.log(`Run: pnpm --filter @echosphere/web test:speech ${outFile}`);
} else if (process.platform === 'darwin') {
  console.log('macOS: generate the fixture with the built-in `say` + `afconvert` tools:\n');
  console.log(`  say -o /tmp/speech.aiff '${text}'`);
  console.log(`  afconvert -f WAVE -d LEI16@48000 -c 1 /tmp/speech.aiff '${outFile}'`);
  console.log(`\nThen: pnpm --filter @echosphere/web test:speech ${outFile}`);
} else {
  console.error(
    'No built-in TTS path for this platform. Bring your own WAV: PCM, 16-bit, mono, 48kHz ' +
      '(LEI16@48000) — the format Chromium\'s --use-file-for-fake-audio-capture expects.',
  );
  process.exit(1);
}
