/**
 * Proves the agent's speech round trip, without depending on a microphone.
 *
 * The path under test: the agent speaks -> Agora publishes the turn to RTM ->
 * the browser's toolkit emits TRANSCRIPT_UPDATED -> the relay POSTs it to the
 * orchestrator -> the control braces are stripped and the payload applied.
 *
 * That whole chain was dead for a long while because `subscribeMessage` was
 * never called, and nothing in the stack said so. Driving it from the agent side
 * (a forced utterance) rather than the microphone side removes speech
 * recognition from the picture, so a failure here is unambiguously the relay.
 *
 * Run with: node --import tsx scripts/roundtrip.e2e.ts
 */

import { chromium } from 'playwright';

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const API = process.env.ORCHESTRATOR_URL ?? 'http://localhost:8787';

interface Segment {
  speaker: string;
  text: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

async function segments(sessionId: string): Promise<Segment[]> {
  return (await (
    await fetch(`${API}/api/sessions/${sessionId}/transcript`)
  ).json()) as Segment[];
}

/** Polls until the agent has produced at least `n` turns, or the budget runs out. */
async function waitForAgentTurns(
  sessionId: string,
  n: number,
  budgetMs: number,
): Promise<Segment[]> {
  const deadline = Date.now() + budgetMs;
  let segs: Segment[] = [];
  while (Date.now() < deadline) {
    segs = await segments(sessionId);
    if (segs.filter((s) => s.speaker === 'agent').length >= n) return segs;
    await sleep(2000);
  }
  return segs;
}

async function main(): Promise<void> {
  const browser = await chromium.launch({
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  const ctx = await browser.newContext({ permissions: ['microphone'] });
  const page = await ctx.newPage();
  const llmErrors: string[] = [];
  const watch = (p: import('playwright').Page, label: string) => {
    p.on('console', (m) => {
      if (m.type() !== 'error') return;
      const t = m.text();
      // The engine reports a broken pipeline through these; "model parameter"
      // is what a wiped llm.params looks like from the outside.
      if (/model parameter|invalid_request_error|agent error/i.test(t)) {
        llmErrors.push(`${label}: ${t.slice(0, 200)}`);
      }
      console.log(`  [console:${label}]`, t.slice(0, 150));
    });
  };
  watch(page, 'teacher');

  console.log('\n── Teacher joins a fresh lesson');
  await page.goto(`${WEB}/join`, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('e.g. Ana').fill('Ms Rao');
  await page.getByRole('button', { name: 'Join as teacher', exact: true }).click();
  await page.getByPlaceholder(/Lesson title/).fill('Common denominators');
  await page.getByRole('button', { name: /Create/ }).click();
  await page.waitForURL(/\/teacher\//, { timeout: 20_000 });
  const sessionId = (page.url().split('/teacher/')[1] ?? '').split(/[?#]/)[0] as string;
  const participantId = await page.evaluate(() => {
    try {
      return JSON.parse(sessionStorage.getItem('echosphere.participant') ?? '{}')
        .participantId as string;
    } catch {
      return '';
    }
  });
  const teacherUid = await page.evaluate(() => {
    try {
      return JSON.parse(sessionStorage.getItem('echosphere.participant') ?? '{}')
        .uid as string;
    } catch {
      return '';
    }
  });
  console.log(`   session ${sessionId}`);

  // A student joining rewrites the agent's system prompt via session.update().
  // That call is where `llm.params` gets replaced wholesale, so a room with a
  // student in it exercises a code path a teacher-only room never touches —
  // and it was silently breaking the model.
  console.log('\n── A student joins (this rewrites the agent prompt)');
  const studentCtx = await browser.newContext({ permissions: ['microphone'] });
  const student = await studentCtx.newPage();
  watch(student, 'student');
  await student.goto(`${WEB}/join`, { waitUntil: 'networkidle' });
  await student.getByPlaceholder('e.g. Ana').fill('Ana');
  await student.getByRole('button', { name: /^Join$/ }).first().click();
  await student.waitForURL(/\/classroom\//, { timeout: 20_000 });
  check('student joined', student.url().includes(sessionId));
  const studentUid = await student.evaluate(() => {
    try {
      return JSON.parse(sessionStorage.getItem('echosphere.participant') ?? '{}')
        .uid as string;
    } catch {
      return '';
    }
  });

  console.log('\n── Bring Athena in, and wait for her greeting');
  await page.getByRole('button', { name: /Bring Athena in/ }).click();
  let segs = await waitForAgentTurns(sessionId, 1, 45_000);
  const greeting = segs.filter((s) => s.speaker === 'agent');
  check('the greeting reached the orchestrator', greeting.length > 0);
  if (greeting[0]) console.log(`     "${greeting[0].text.slice(0, 120)}"`);

  console.log('\n── Teacher asks her to explain something');
  await fetch(`${API}/api/sessions/${sessionId}/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      participantId,
      command: { type: 'FORCE_AGENT_SPEAK', topic: 'common denominators' },
    }),
  });

  segs = await waitForAgentTurns(sessionId, greeting.length + 1, 45_000);
  const agentTurns = segs.filter((s) => s.speaker === 'agent');
  check('she answered the teacher', agentTurns.length > greeting.length);
  const answer = agentTurns[agentTurns.length - 1];
  if (answer) console.log(`     "${answer.text.slice(0, 200)}"`);

  console.log('\n── Control channel');
  check(
    'no braces leaked into any stored turn',
    !segs.some((s) => s.text.includes('{')),
  );
  check(
    'she actually said something, not just a payload',
    agentTurns.every((s) => s.text.trim().length > 0),
  );

  check(
    'she did not fall back to the failure message',
    !agentTurns.some((s) => /^one moment\.?$/i.test(s.text.trim())),
  );
  check('no LLM pipeline errors were reported', llmErrors.length === 0, llmErrors[0] ?? '');

  console.log('\n── Timed quiz: the card reaches the student, with a countdown');
  // START_QUIZ rides the same think() path as FORCE_AGENT_SPEAK above, so the
  // agent actually asks the question and appends the {quiz} control payload.
  // The student's overlay appearing is the whole pipeline proven at once:
  // agent asked it -> payload relayed -> orchestrator recorded it -> SSE ->
  // overlay rendered with the server deadline.
  await fetch(`${API}/api/sessions/${sessionId}/quiz`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ participantId, topic: 'common denominators' }),
  });

  const overlay = student.getByRole('dialog', { name: 'Pop quiz' });
  const quizShown = await overlay
    .waitFor({ state: 'visible', timeout: 45_000 })
    .then(() => true)
    .catch(() => false);
  check('the quiz card appeared for the student', quizShown);

  if (quizShown) {
    const optionCount = await overlay.getByRole('button').count();
    check('the card carries answer options', optionCount >= 2, `${optionCount} options`);

    const ring = (await overlay.locator('svg + span').first().textContent().catch(() => '')) ?? '';
    check('the countdown is ticking', /^\d+s$/.test(ring.trim()), ring.trim());

    // Sole active student -> answering closes it and reveals to the room.
    await overlay.getByRole('button').nth(1).click();
    const resolved = await overlay
      .getByText(/Correct|Not quite|revealed/i)
      .waitFor({ state: 'visible', timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    check('the card resolves once the student answers', resolved);
  }

  // START_QUIZ runs a set that auto-advances; stop it so later checks aren't
  // disturbed by another quiz turn firing mid-test. Mute cancels the set; resume
  // puts her back to normal.
  for (const type of ['MUTE_AGENT', 'RESUME_AGENT']) {
    await fetch(`${API}/api/sessions/${sessionId}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participantId, command: { type } }),
    });
  }
  await sleep(1500);

  console.log('\n── The student is subscribed to the other participants');
  // `useJoin` and `usePublish` get audio in and out of the channel but play
  // nothing back; without <RemoteUser> the room is mute in both directions and
  // Athena is inaudible even though she is speaking.
  //
  // What is asserted here is subscription — the student can see the teacher and
  // the agent as remote users. Playback itself is not checked: the SDK routes
  // audio through Web Audio rather than a DOM media element, so there is
  // nothing in the page to count. Audibility was confirmed by ear.
  const roomStatus = await student
    .locator('[aria-live="polite"]')
    .first()
    .textContent();
  const others = Number(/with (\d+) other/.exec(roomStatus ?? '')?.[1] ?? 0);
  check('student is subscribed to teacher and agent', others >= 2,
    (roomStatus ?? '').trim());

  console.log('\n── One utterance is logged once, under one name');
  const byText = new Map<string, Set<string>>();
  for (const seg of segs) {
    const key = seg.text.trim().toLowerCase();
    if (!byText.has(key)) byText.set(key, new Set());
    byText.get(key)?.add(seg.speaker);
  }
  const doubled = [...byText.entries()].filter(([, who]) => who.size > 1);
  check('no utterance attributed to two speakers', doubled.length === 0,
    doubled[0] ? `"${doubled[0][0].slice(0, 40)}" → ${[...doubled[0][1]].join(', ')}` : '');

  console.log('\n── She stays out of speech that is not addressed to her');
  // The failure this guards: a teacher asking the class "can you hear me?" and
  // Athena answering, as though she were a fourth person in the room.
  const beforeChatter = (await segments(sessionId)).filter(
    (s) => s.speaker === 'agent',
  ).length;
  const chatter = [
    'Can everyone hear me at the back?',
    'Right, today we are doing integers.',
    'Who can tell me what a negative number is?',
  ];
  for (const line of chatter) {
    await fetch(`${API}/api/sessions/${sessionId}/transcript`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: teacherUid, text: line, isFinal: true }),
    });
    await sleep(1500);
  }
  await sleep(8000);
  const afterChatter = (await segments(sessionId)).filter(
    (s) => s.speaker === 'agent',
  ).length;
  check('she did not answer the teacher addressing the class',
    afterChatter === beforeChatter,
    `${afterChatter - beforeChatter} unsolicited turn(s)`);

  console.log('\n── The teacher gate, in both positions');
  const sayAsStudent = async (text: string) => {
    await fetch(`${API}/api/sessions/${sessionId}/transcript`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: studentUid, text, isFinal: true }),
    });
  };
  const agentCount = async () =>
    (await segments(sessionId)).filter((s) => s.speaker === 'agent').length;

  // Closed (the default): her name is heard and deliberately not acted on.
  const beforeClosed = await agentCount();
  await sayAsStudent('Hey Athena, what is an integer?');
  await sleep(10_000);
  check('floor closed: a student calling her gets no answer',
    (await agentCount()) === beforeClosed);

  const closedPolicy = await (
    await fetch(`${API}/api/sessions/${sessionId}`)
  ).json();
  check('floor is closed by default', closedPolicy.policy.studentsMayInvoke === false);

  // Open: the same words now earn a permit.
  //
  // Whether she *speaks* cannot be driven from here — the engine only replies
  // to audio it actually heard, and a transcript posted over HTTP was never
  // spoken. What is checked instead is the decision the orchestrator makes when
  // the engine does begin a turn, which is the thing this feature changes.
  // Voice invocation end to end is confirmed by ear, not here.
  await fetch(`${API}/api/sessions/${sessionId}/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      participantId,
      command: { type: 'SET_STUDENT_INVOCATION', enabled: true },
    }),
  });
  await sayAsStudent('Hey Athena, what is an integer?');
  const allowed = await fetch(`${API}/api/sessions/${sessionId}/agent-state`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: 'thinking' }),
  }).then((r) => r.json());
  check('floor open: her reply is allowed to proceed',
    allowed.interrupted === false);

  // And closing it again revokes that permission immediately.
  await fetch(`${API}/api/sessions/${sessionId}/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      participantId,
      command: { type: 'SET_STUDENT_INVOCATION', enabled: false },
    }),
  });
  await sayAsStudent('Hey Athena, are you there?');
  const refused = await fetch(`${API}/api/sessions/${sessionId}/agent-state`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: 'thinking' }),
  }).then((r) => r.json());
  check('floor closed again: her reply is interrupted',
    refused.interrupted === true);

  console.log('\n── Mute stops her mid-flight');
  await fetch(`${API}/api/sessions/${sessionId}/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ participantId, command: { type: 'MUTE_AGENT' } }),
  });
  const blocked = await fetch(`${API}/api/sessions/${sessionId}/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      participantId,
      command: { type: 'FORCE_AGENT_SPEAK', topic: 'anything' },
    }),
  }).then((r) => r.json());
  check('a muted agent refuses to speak', blocked.ok === false, blocked.detail ?? '');

  await fetch(`${API}/api/sessions/${sessionId}/agent/stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  }).catch(() => undefined);
  await fetch(`${API}/api/sessions/${sessionId}`, { method: 'DELETE' }).catch(
    () => undefined,
  );
  await browser.close();

  console.log(failures === 0 ? '\nRound trip works.' : `\n${failures} failed.`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error('Harness error:', e);
  process.exitCode = 1;
});
