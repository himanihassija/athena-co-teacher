/**
 * Isolated before/after measurement for the start-of-speech threshold change
 * (interrupt_duration_ms / prefix_padding_ms).
 *
 * Same harness pattern as speech.e2e.ts — real Chromium, a WAV as the
 * microphone, assertions against what actually reached the orchestrator — but
 * it deliberately does NOT use speech.e2e.ts's "Athena replied" check, which
 * cannot fail for the reason it claims (the greeting is an agent segment
 * delivered without an LLM call).
 *
 * What it measures instead is the only thing the threshold can affect: whether
 * a spoken utterance produces a HUMAN transcript entry at all.
 *
 * Chromium loops the fixture, so each WAV is [500ms silence][utterance][3.5s
 * silence] and one run yields many independent repetitions of the same
 * utterance. The score is entries-created over repetitions-spoken.
 *
 * Run: node --import tsx scripts/fix2-measure.e2e.ts <label> <wav> [<wav>...]
 */

import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const API = process.env.ORCHESTRATOR_URL ?? 'http://localhost:8787';
const LISTEN_MS = Number(process.env.LISTEN_MS ?? 50_000);
/** Sets session.language before the agent joins, so STT/greeting pick it up. */
const LANG_CODE = process.env.LANG_CODE ?? '';

const [label, ...wavs] = process.argv.slice(2);
if (!label || wavs.length === 0) {
  console.error('Usage: fix2-measure.e2e.ts <label> <wav>...');
  process.exit(1);
}

interface Segment { speaker: string; text: string; at: number }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Seconds of audio in a 48kHz mono 16-bit PCM WAV, header included. */
function wavSeconds(path: string): number {
  const b = readFileSync(path);
  return (b.length - 44) / (48_000 * 2);
}

/** The first word we expect to survive if prefix_padding_ms is not clipping. */
const OPENING: Record<string, RegExp> = {
  's1-six': /six/i,
  's2-yeah': /yeah|yep|ya\b/i,
  's3-dontget': /\bi\b/i,
  't1-fractions': /okay|ok\b/i,
  't2-denominator': /\bso\b/i,
  't3-example': /\blet\b/i,
  // Devanagari, with a tolerant fallback for a recogniser that transliterates.
  'hi1-chhah': /छह|chhah|chah/i,
  'hi2-haan': /हाँ|हां|haan|han\b/i,
  'hi3-samajh': /मुझे|mujhe/i,
  'hi4-long': /नमस्ते|namaste/i,
  'hi5-haanonly': /हाँ|हां|haan|han\b/i,
  'hi6-nahin': /नहीं|नही|nahin|nahi/i,
};

async function runOne(wav: string) {
  const name = basename(wav).replace(/\.wav$/, '');
  const loopSeconds = wavSeconds(wav);
  const browser = await chromium.launch({
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${wav}`,
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  const ctx = await browser.newContext({ permissions: ['microphone'] });
  const page = await ctx.newPage();

  await page.goto(`${WEB}/join`, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('e.g. Ana').fill('Ms Rao');
  await page.getByRole('button', { name: 'Join as teacher', exact: true }).click();
  await page.getByPlaceholder(/Lesson title/).fill(`fix2 ${label} ${name}`);
  await page.getByRole('button', { name: /Create/ }).click();
  await page.waitForURL(/\/teacher\//, { timeout: 30_000 });
  const sessionId = (page.url().split('/teacher/')[1] ?? '').split(/[?#]/)[0] as string;

  // Language must be set BEFORE the agent joins: startAgent() reads
  // session.language for the STT language and the greeting, and the /language
  // route only pushes new instructions to an already-running agent.
  if (LANG_CODE) {
    const r = await fetch(`${API}/api/sessions/${sessionId}/language`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: LANG_CODE }),
    });
    const body = await r.json().catch(() => null);
    if (!r.ok) throw new Error(`could not set language: ${r.status} ${JSON.stringify(body)}`);
  }

  // Start the agent through the API rather than the "Bring Athena in" button.
  // Setting the language publishes echosphere:language-changed, the teacher page
  // re-renders on it, and a locator matched on English button text then races
  // that re-render — which is exactly how one run set language=hi, never fired
  // /agent/start at all, and sat listening to a room with no agent in it.
  const room0 = (await (await fetch(`${API}/api/sessions/${sessionId}`)).json()) as any;
  const teacher = (room0.participants ?? []).find((p: any) => p.role === 'teacher');
  if (!teacher) throw new Error('no teacher participant found on the session');
  const started = await fetch(`${API}/api/sessions/${sessionId}/agent/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ participantId: teacher.participantId }),
  });
  if (!started.ok) {
    throw new Error(`agent/start failed: ${started.status} ${await started.text()}`);
  }

  // Only start the clock once the agent is actually running, so every fixture
  // gets the same amount of listening regardless of how long the join took.
  const joinDeadline = Date.now() + 45_000;
  let agentUp = false;
  while (Date.now() < joinDeadline) {
    const s = (await (await fetch(`${API}/api/sessions/${sessionId}/agent`)).json().catch(() => null)) as any;
    if (s?.status === 'running') { agentUp = true; break; }
    await sleep(2000);
  }
  const listenStart = Date.now();
  await sleep(LISTEN_MS);
  const listenedMs = Date.now() - listenStart;

  const room = (await (await fetch(`${API}/api/sessions/${sessionId}`)).json().catch(() => null)) as any;
  const segments = (await (await fetch(`${API}/api/sessions/${sessionId}/transcript`)).json()) as Segment[];
  const human = segments.filter((s) => s.speaker !== 'agent');
  const reps = Math.floor(listenedMs / 1000 / loopSeconds);
  const opening = OPENING[name];
  const openingIntact = opening ? human.filter((s) => opening.test(s.text)).length : 0;

  await fetch(`${API}/api/sessions/${sessionId}/agent/stop`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  }).catch(() => undefined);
  await fetch(`${API}/api/sessions/${sessionId}`, { method: 'DELETE' }).catch(() => undefined);
  await browser.close();

  const row = {
    fixture: name, sessionId, agentUp, language: room?.language ?? '(unknown)',
    loopSeconds: +loopSeconds.toFixed(2),
    repetitions: reps, humanEntries: human.length,
    openingIntact, samples: human.slice(0, 3).map((s) => s.text.slice(0, 60)),
  };
  console.log(
    `  ${name.padEnd(15)} lang=${(room?.language ?? '?').padEnd(2)} agent=${agentUp ? 'up ' : 'DOWN'} reps~${String(reps).padStart(2)} ` +
    `human=${String(human.length).padStart(2)} openingIntact=${openingIntact}` +
    (row.samples.length ? `  e.g. "${row.samples[0]}"` : ''),
  );
  return row;
}

async function main(): Promise<void> {
  const rows = [];
  console.log(`\n══ ${label} — ${LISTEN_MS / 1000}s listening per fixture\n`);
  for (const w of wavs) {
    try {
      rows.push(await runOne(w));
    } catch (e) {
      console.log(`  ${w} FAILED: ${(e as Error).message}`);
      rows.push({ fixture: w, error: (e as Error).message } as any);
    }
  }
  writeFileSync(`/tmp/fix2-${label}.json`, JSON.stringify(rows, null, 2));
  console.log(`\nwrote /tmp/fix2-${label}.json\n`);
}

main().catch((e) => {
  console.error('Harness error:', e);
  process.exitCode = 1;
});
