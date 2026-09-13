/**
 * Browser end-to-end check for a live classroom.
 *
 * This exists because the failures that actually bit during development —
 * duplicate RTM instances, an SSE stream refused for CORS, controls hidden
 * behind a connection that never came up — are all invisible to typecheck,
 * lint, and the API-level tests. They only appear in a real browser, so this
 * drives one.
 *
 * Chromium runs with a fake microphone, so RTC join and publish are exercised
 * for real. Speech is a test tone rather than words, so this proves the pipeline
 * connects; it cannot prove transcription quality.
 *
 * Run with: node --import tsx scripts/classroom.e2e.ts
 * Pass --start-agent to also bring the ConvoAI agent in (uses Agora minutes).
 */

import { chromium, type ConsoleMessage, type Page } from 'playwright';

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const API = process.env.ORCHESTRATOR_URL ?? 'http://localhost:8787';
const START_AGENT = process.argv.includes('--start-agent');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

/** Console noise that is expected and not worth failing a run over. */
const BENIGN = [
  /favicon/i,
  /Download the React DevTools/i,
  /\[Fast Refresh\]/i,
];

interface Collected {
  rtmDuplicateInstance: string[];
  rtmAlreadyInUse: string[];
  corsBlocked: string[];
  otherErrors: string[];
}

function collect(page: Page, into: Collected, label: string): void {
  const record = (text: string) => {
    if (BENIGN.some((r) => r.test(text))) return;
    // "Ins id is N" with N > 1 means a second RTM client exists in this page.
    if (/Ins id is [2-9]/.test(text)) into.rtmDuplicateInstance.push(`${label}: ${text}`);
    else if (/-10027|already in use/i.test(text)) into.rtmAlreadyInUse.push(`${label}: ${text}`);
    else if (/CORS|Access-Control-Allow-Origin/i.test(text)) into.corsBlocked.push(`${label}: ${text}`);
    else into.otherErrors.push(`${label}: ${text}`);
  };

  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error') record(m.text());
  });
  page.on('pageerror', (e) => record(e.message));
}

async function main(): Promise<void> {
  const browser = await chromium.launch({
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });

  const collected: Collected = {
    rtmDuplicateInstance: [],
    rtmAlreadyInUse: [],
    corsBlocked: [],
    otherErrors: [],
  };

  // Separate contexts, because sessionStorage is per-context — this is the
  // supported way to have two participants, and the thing duplicating a tab
  // fails to do.
  const teacherCtx = await browser.newContext({ permissions: ['microphone'] });
  const studentCtx = await browser.newContext({ permissions: ['microphone'] });
  const teacher = await teacherCtx.newPage();
  const student = await studentCtx.newPage();
  collect(teacher, collected, 'teacher');
  collect(student, collected, 'student');

  console.log('\n── Join page');
  await teacher.goto(`${WEB}/join`, { waitUntil: 'networkidle' });
  check(
    'join page loads',
    await teacher.locator('.eco-wordmark').first().isVisible(),
  );

  // The empty state must offer a way forward rather than a dead end — but it
  // only renders when there are genuinely no live classrooms, so a leftover
  // session from an earlier run would otherwise fail an unrelated assertion.
  const hasLiveRooms = (await teacher.getByRole('button', { name: /^Join$/ }).count()) > 0;
  if (hasLiveRooms) {
    console.log('  skip live classrooms already exist, empty state not applicable');
  } else {
    // The page opens on the student role, so the student variant of the empty
    // state is what renders by default; the teacher variant appears after
    // switching role. Either satisfies "explains what to do".
    const emptyHint = teacher.getByText(
      /A teacher needs to start one|Give your lesson a title|Ask your teacher for the 4-digit code/,
    );
    check('empty state explains what to do', (await emptyHint.count()) > 0);
  }

  console.log('\n── Create a lesson as teacher');
  await teacher.getByPlaceholder('e.g. Ana').fill('Ms Rao');
  await teacher.getByRole('button', { name: 'Join as teacher', exact: true }).click();
  await teacher.getByPlaceholder(/Lesson title/).fill('Adding unlike fractions');
  await teacher.getByRole('button', { name: /Create/ }).click();
  await teacher.waitForURL(/\/teacher\//, { timeout: 15_000 });

  const sessionId = (teacher.url().split('/teacher/')[1] ?? '').split(/[?#]/)[0] as string;
  check('landed on teacher dashboard', sessionId.length > 0, `session ${sessionId}`);

  console.log('\n── SSE control path');
  // This is the CORS regression: the header goes out on reply.raw, so it is
  // easy to lose again and invisible everywhere except a real browser.
  await teacher.waitForFunction(
    () => !document.body.innerText.includes('reconnecting'),
    undefined,
    { timeout: 20_000 },
  ).catch(() => undefined);
  const teacherText = await teacher.innerText('body');
  check('teacher shows connected, not reconnecting', teacherText.includes('connected') && !teacherText.includes('reconnecting'));

  console.log('\n── Teacher controls are reachable');
  // Since the Meet-style redesign the controls live behind the app menu rather
  // than on the page, so "reachable" now means "reachable after opening it" —
  // which is also what a teacher actually does.
  await teacher.getByRole('button', { name: 'Open menu' }).click();
  const controlsTab = teacher.getByRole('button', { name: 'Controls', exact: true });
  if ((await controlsTab.count()) > 0) await controlsTab.first().click();
  await teacher.waitForTimeout(400);

  const bringIn = teacher.getByRole('button', { name: /Bring Athena in/ });
  await bringIn.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined);
  check('"Bring Athena in" is visible', await bringIn.count() > 0);
  check('mute control is visible', await teacher.getByRole('button', { name: /Mute Athena/ }).count() > 0);
  check('lesson upload is visible', await teacher.getByPlaceholder(/Paste the lesson text/).count() > 0);
  check('agent-absent notice shown', teacherText.includes('Athena is not in the room yet'));

  console.log('\n── Lesson material');
  await teacher.getByPlaceholder(/Source name/).fill('fractions-notes');
  await teacher.getByPlaceholder(/Paste the lesson text/).fill(
    'To add fractions with unlike denominators, first find the least common denominator. The denominator never changes when you add.',
  );
  await teacher.getByRole('button', { name: 'Index material' }).click();
  await teacher.waitForTimeout(1500);
  check('lesson indexed', (await teacher.innerText('body')).includes('Indexed'));

  console.log('\n── Student joins the same lesson');
  await student.goto(`${WEB}/join`, { waitUntil: 'networkidle' });
  await student.getByPlaceholder('e.g. Ana').fill('Ana');
  await student.getByRole('button', { name: 'Join as student', exact: true }).click();
  // Joining is by share code, and the code is the session id.
  await student.getByPlaceholder('4-digit code').fill(sessionId);
  await student.getByRole('button', { name: 'Join by Code' }).click();
  await student.waitForURL(/\/classroom\//, { timeout: 15_000 });
  check('student landed in the classroom', student.url().includes(`/classroom/${sessionId}`));

  await student.waitForTimeout(3000);
  const studentText = await student.innerText('body');
  // The floor starts closed, so the student is told she is listening only —
  // the wake-phrase hint would be a lie until the teacher opens it.
  check('student is told Athena is listening only',
    studentText.includes('Athena is listening only'));
  check('student shows connected', studentText.includes('connected') && !studentText.includes('reconnecting'));

  console.log('\n── Roster syncs both ways');
  await teacher.waitForTimeout(2000);
  check('teacher sees the student', (await teacher.innerText('body')).includes('Ana'));

  console.log('\n── RTC audio actually joined');
  // Waited for rather than sampled once. Join time varies with how much client
  // JS the route carries and with network conditions; a single count() right
  // after a fixed pause asserts "connects within N seconds", which is not the
  // property under test and fails for reasons that are not regressions.
  const rtcStatus = student.locator('text=Connected to classroom audio');
  await rtcStatus.waitFor({ state: 'attached', timeout: 20_000 }).catch(() => undefined);
  check('student RTC connected', (await rtcStatus.count()) > 0);

  if (START_AGENT) {
    console.log('\n── Bringing the agent in (uses Agora minutes)');
    await bringIn.click();
    await teacher.waitForTimeout(12_000);
    const afterText = await teacher.innerText('body');
    check('agent-absent notice cleared', !afterText.includes('Athena is not in the room yet'));
    const room = await (await fetch(`${API}/api/sessions/${sessionId}`)).json();
    check('orchestrator recorded an agentId', Boolean(room.agentId), String(room.agentId));

    // The regression that made Athena deaf: AgoraVoiceAI is a singleton, so a
    // discarded StrictMode mount destroying it in cleanup killed the live
    // instance. No error surfaced anywhere — the room just went quiet. These
    // two assertions are the only automated way to catch it.
    const teacherBody = await teacher.innerText('body');
    const studentBody = await student.innerText('body');
    check(
      'teacher transcript pipeline is live',
      !teacherBody.includes('Connecting the transcript pipeline') &&
        !teacherBody.includes('Transcription could not start'),
    );
    check(
      'student transcript pipeline is live',
      !studentBody.includes('Connecting the transcript pipeline') &&
        !studentBody.includes('Transcription could not start'),
    );
    await fetch(`${API}/api/sessions/${sessionId}/agent/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    console.log('  (agent stopped)');
  }

  console.log('\n── Reload does not collide with its own RTM session');
  await student.reload({ waitUntil: 'networkidle' });
  await student.waitForTimeout(6000);
  const afterReload = await student.innerText('body');
  check('no duplicate-identity panel after reload', !afterReload.includes('already connected somewhere else'));

  console.log('\n── Console health');
  check('no duplicate RTM instances', collected.rtmDuplicateInstance.length === 0, collected.rtmDuplicateInstance[0] ?? '');
  check('no "already in use" RTM errors', collected.rtmAlreadyInUse.length === 0, collected.rtmAlreadyInUse[0] ?? '');
  check('no CORS failures', collected.corsBlocked.length === 0, collected.corsBlocked[0] ?? '');
  if (collected.otherErrors.length > 0) {
    console.log('  other console errors (not failing the run):');
    for (const e of collected.otherErrors.slice(0, 6)) console.log(`    · ${e.slice(0, 160)}`);
  }

  await fetch(`${API}/api/sessions/${sessionId}`, { method: 'DELETE' }).catch(() => undefined);
  await browser.close();

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error('\nHarness error:', error);
  process.exitCode = 1;
});
