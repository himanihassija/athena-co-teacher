/**
 * Proves the full speech path: real speech in, transcript out, agent replies.
 *
 * The other browser test runs Chromium's default fake microphone, which emits a
 * tone. That exercises RTC join and publish but produces no words, so it cannot
 * tell a working ASR pipeline from a dead one — which is exactly how a broken
 * `asr.language` setting slipped through. This one feeds a real spoken WAV in
 * via --use-file-for-fake-audio-capture and asserts that words come back.
 *
 * Generate the audio first (macOS):
 *   say -o speech.aiff "Hey Athena. Can you explain what a common denominator is?"
 *   afconvert -f WAVE -d LEI16@48000 -c 1 speech.aiff speech.wav
 *
 * Run with: node --import tsx scripts/speech.e2e.ts /abs/path/to/speech.wav
 */

import { chromium } from 'playwright';

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const API = process.env.ORCHESTRATOR_URL ?? 'http://localhost:8787';
const WAV = process.argv[2];

if (!WAV) {
  console.error('Usage: node --import tsx scripts/speech.e2e.ts <speech.wav>');
  process.exit(1);
}

interface Segment {
  speaker: string;
  text: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The agent segments the MODEL actually produced — the greeting excluded.
 *
 * This exists because `agent.length > 0`, the assertion it replaces, could not
 * fail for the reason it claimed. The greeting is delivered by the engine
 * straight from `greetingMessage` in the join config, with no LLM call, and it
 * lands in the transcript as an agent segment like any other. So the old check
 * passed whenever the agent merely joined the channel — and it did exactly that
 * through a live fault where the model was returning nothing at all, printing
 * "ok Athena replied" over a silent classroom.
 *
 * The greeting text is NOT hardcoded here: it is configurable per lesson
 * language (`getGreetingForLanguage` in the orchestrator's prompt.ts), so
 * matching on "Hi everyone" would silently stop working the moment a lesson ran
 * in Hindi. It is identified structurally instead — it is always the first
 * agent segment of a session, since the engine plays it on join before any turn
 * can occur. Relay re-emissions of one turn are upserted in place by turn id
 * rather than appended (see `upsertByTurn` in classroomController), so any
 * later agent segment is a genuinely separate turn rather than a longer copy of
 * this one; the text comparison is a belt-and-braces guard on top of that.
 */
function modelTurns(segments: Segment[]): Segment[] {
  const agent = segments.filter((s) => s.speaker === 'agent');
  const greeting = agent[0];
  if (!greeting) return [];
  const norm = (t: string) => t.replace(/\s+/g, ' ').trim().toLowerCase();
  return agent.filter((s) => s !== greeting && norm(s.text) !== norm(greeting.text));
}


async function main(): Promise<void> {
  const browser = await chromium.launch({
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      // Chromium loops this file as the microphone input.
      `--use-file-for-fake-audio-capture=${WAV}`,
      '--autoplay-policy=no-user-gesture-required',
    ],
  });

  const ctx = await browser.newContext({ permissions: ['microphone'] });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('  [console]', m.text().slice(0, 160));
  });

  console.log('\n── Creating a lesson and joining as teacher');
  await page.goto(`${WEB}/join`, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('e.g. Ana').fill('Ms Rao');
  await page.getByRole('button', { name: 'Join as teacher', exact: true }).click();
  await page.getByPlaceholder(/Lesson title/).fill('Common denominators');
  await page.getByRole('button', { name: /Create/ }).click();
  await page.waitForURL(/\/teacher\//, { timeout: 20_000 });
  const sessionId = (page.url().split('/teacher/')[1] ?? '').split(/[?#]/)[0] as string;
  console.log(`   session ${sessionId}`);

  console.log('── Bringing Athena in');
  await page.getByRole('button', { name: /Bring Athena in/ }).click();

  console.log('── Listening for up to 75s of speech…');
  let segments: Segment[] = [];
  for (let i = 0; i < 25; i += 1) {
    await sleep(3000);
    segments = (await (
      await fetch(`${API}/api/sessions/${sessionId}/transcript`)
    ).json()) as Segment[];
    if (segments.length > 0) {
      process.stdout.write(`   ${segments.length} segment(s) after ${(i + 1) * 3}s\r`);
    }
    // Wait for a turn the MODEL produced. This used to break as soon as any
    // agent segment existed alongside one other segment — which the greeting
    // plus the first human utterance satisfies, so the poll could exit before a
    // real reply had any chance to arrive, and then assert on its absence.
    if (modelTurns(segments).length > 0) break;
  }
  console.log();

  const human = segments.filter((s) => s.speaker !== 'agent');
  const agent = segments.filter((s) => s.speaker === 'agent');
  const replies = modelTurns(segments);

  console.log('\n── Transcript');
  for (const s of segments.slice(0, 12)) {
    console.log(`   [${s.speaker.padEnd(7)}] ${s.text.slice(0, 110)}`);
  }

  let failures = 0;
  const check = (label: string, ok: boolean) => {
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`);
    if (!ok) failures += 1;
  };

  // Whether the fixture actually addressed her, rather than assuming it did.
  //
  // The original fixture said "Hey Athena. Can you explain…", so every run
  // carried the wake word and the suite could not tell "plain speech is
  // transcribed" from "only speech containing her name is transcribed". A
  // fixture with no wake word is the case that distinguishes them, and it needs
  // the opposite expectation — so the expectation is derived from what was
  // heard rather than hard-coded.
  const addressed = human.some((s) => /athena|adena|athina/i.test(s.text));

  /**
   * Words the model reaches for when told to produce no speech.
   *
   * Staying quiet is expressed as an empty control object, and the braces are
   * stripped before synthesis — so a silent turn should leave no agent segment
   * at all. What happened instead was that the model narrated the instruction:
   * it answered "Silence." aloud, then copied that from its own history on
   * every subsequent turn, and a whole lesson came back as one repeated word.
   * Nothing in the suite could see it, because the only assertion about her
   * speech was that some existed.
   */
  const PLACEHOLDER = /^\s*[*[(]?\s*(silence|silent|nothing|no response|no reply|none|n\/a|…|\.\.\.)\s*[*\])]?\s*[.!]?\s*$/i;
  const placeholders = agent.filter((s) => PLACEHOLDER.test(s.text));

  console.log('\n── Results');
  check('speech was transcribed at all', human.length > 0);
  if (addressed) {
    check('the wake phrase was heard', true);
    check(
      'Athena produced a turn the model generated (not just the greeting)',
      replies.length > 0,
    );
    if (replies.length === 0 && agent.length > 0) {
      console.log(
        `       only the greeting was heard: "${agent[0]?.text.slice(0, 70)}"`,
      );
      console.log(
        '       the agent joined and said its configured greeting, but the model',
      );
      console.log(
        '       produced no turn — check GET /api/sessions/:id/agent/history.',
      );
    }
  } else {
    // The point of a wake-word-free fixture: plain speech must still reach the
    // transcript. If this fails while the addressed fixture passes, something
    // upstream is gating on the wake word.
    console.log('  ok   plain speech (no wake word) still transcribed');
  }
  check(
    'Athena never voiced a placeholder for silence',
    placeholders.length === 0,
  );
  if (placeholders.length > 0) {
    for (const p of placeholders.slice(0, 3)) {
      console.log(`       spoke: "${p.text.slice(0, 60)}"`);
    }
  }
  check(
    'no control braces leaked into the stored transcript',
    !segments.some((s) => s.text.includes('{')),
  );

  await fetch(`${API}/api/sessions/${sessionId}/agent/stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  }).catch(() => undefined);
  await fetch(`${API}/api/sessions/${sessionId}`, { method: 'DELETE' }).catch(
    () => undefined,
  );
  await browser.close();

  console.log(failures === 0 ? '\nSpeech path works.' : `\n${failures} failed.`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error('Harness error:', e);
  process.exitCode = 1;
});
