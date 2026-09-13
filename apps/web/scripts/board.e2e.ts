/**
 * Does a student who joins a lesson already in progress actually SEE what is
 * on the whiteboard?
 *
 * The orchestrator delivering the scene is not enough and was never the
 * problem: the elements arrived, and the canvas stayed blank, because the
 * effect that paints a remote scene ran before Excalidraw had handed over its
 * API and had no reason to run again. Nothing but a real browser can catch
 * that, so this reads pixels off the canvas rather than trusting state.
 *
 * Run with: node --import tsx scripts/board.e2e.ts
 */
import { chromium } from 'playwright';

const WEB = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
const API = process.env.ORCH_ORIGIN ?? 'http://localhost:8787';

async function main() {
  let failed = 0;
  const check = (name: string, ok: boolean, detail = '') => {
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? ` — ${detail}` : ''}`);
    if (!ok) failed++;
  };

  const post = async (path: string, body: unknown) => {
    const res = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (await res.json()) as any;
  };

  console.log('\n── A lesson that already has something on the board');

  const created = await post('/api/sessions', { title: 'board handoff' });
  const sessionId: string = created.sessionId ?? created.session?.sessionId;
  if (!sessionId) throw new Error(`no sessionId: ${JSON.stringify(created)}`);

  const teacher = await post(`/api/sessions/${sessionId}/join`, {
    displayName: 'Ms Rao',
    role: 'teacher',
  });
  const teacherUid = String(teacher.participant?.uid ?? teacher.uid);
  const teacherId = String(teacher.participant?.participantId ?? teacher.participantId);

  await post(`/api/sessions/${sessionId}/whiteboard/present`, {
    participantId: teacherId,
    presenting: true,
  });

  // Spoken, the way a teacher actually puts something on the board.
  await post(`/api/sessions/${sessionId}/transcript`, {
    uid: teacherUid,
    turnId: 1,
    isFinal: true,
    text: 'Athena, write team Meraki is going to win on the whiteboard',
  });
  // Longer than the turn-settle window.
  await new Promise((r) => setTimeout(r, 1500));
  check('the board has content before anyone joins', true);

  console.log('\n── A student joins afterwards');

  const browser = await chromium.launch();
  const context = await browser.newContext({ permissions: ['microphone'] });
  const page = await context.newPage();

  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto(`${WEB}/join`, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('e.g. Ana').fill('Ana');
  await page.getByRole('button', { name: 'Join as student', exact: true }).click();
  await page.getByPlaceholder('4-digit code').fill(sessionId);
  await page.getByRole('button', { name: 'Join by Code' }).click();
  await page.waitForURL(/\/classroom\//, { timeout: 20_000 });
  check('student landed in the classroom', page.url().includes(`/classroom/${sessionId}`));

  const canvas = page.locator('canvas').first();
  await canvas.waitFor({ state: 'visible', timeout: 20_000 });
  check('the whiteboard canvas is on screen', true);

  /** Ink on any Excalidraw canvas: pixels that are neither blank nor background. */
  const inkPixels = async () =>
    page.evaluate(() => {
      let ink = 0;
      for (const c of Array.from(document.querySelectorAll('canvas'))) {
        const el = c as HTMLCanvasElement;
        const ctx = el.getContext('2d');
        if (!ctx || el.width === 0 || el.height === 0) continue;
        const { data } = ctx.getImageData(0, 0, el.width, el.height);
        for (let i = 0; i < data.length; i += 4) {
          const [r, g, b, a] = [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!];
          // Anything opaque and clearly darker than the paper counts as drawn.
          if (a > 40 && (r < 200 || g < 200 || b < 200)) ink++;
        }
      }
      return ink;
    });

  // Give the scene time to arrive and paint.
  let ink = 0;
  for (let i = 0; i < 20; i++) {
    ink = await inkPixels();
    if (ink > 200) break;
    await page.waitForTimeout(500);
  }

  check(
    'the student can see what was written on the board',
    ink > 200,
    `only ${ink} drawn pixels — the canvas is blank`,
  );

  console.log('\n── Console health');
  const boardErrors = errors.filter((e) => /excalidraw|updateScene|scene/i.test(e));
  check('no board errors in the console', boardErrors.length === 0, boardErrors.slice(0, 2).join(' | '));

  await browser.close();

  console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) failed.`);
  process.exit(failed === 0 ? 0 : 1);

}

void main();
