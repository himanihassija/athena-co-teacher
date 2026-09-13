/**
 * Drives one real illustrate request end to end: model -> Excalidraw+ -> elements.
 *
 * The unit suite (`illustrate.test.ts`) covers the parsing, the redelivery
 * guard and the placement maths, all without a network call. What it cannot
 * cover is the half that actually breaks: Excalidraw+'s MCP tool schemas are
 * public beta, so an argument shape that was right last month can start being
 * rejected without anything in this repo changing. This script is what tells
 * you that has happened, and `excalidraw.probe.ts` is what tells you the new
 * shape.
 *
 * It writes into the real workspace — one scratch scene, one diagram.
 *
 * Run with: node --env-file=.env --import tsx scripts/illustrate.live.ts [topic]
 */

import {
  generateIllustration,
  illustrationConfigured,
  placeBeside,
} from '../src/board/boardAgent.ts';
import { parseAgentTurn } from '../src/agent/control.ts';
import { applyControl, releaseIllustrationState } from '../src/classroomController.ts';
import { createSession } from '../src/state/sessionRegistry.ts';
import { subscribe } from '../src/state/eventBus.ts';

const topic = process.argv[2] ?? 'the water cycle';

if (!illustrationConfigured()) {
  console.error('EXCALIDRAW_MCP_API_KEY is not set in apps/orchestrator/.env');
  process.exit(1);
}

console.log(`asking for: "${topic}"`);
const result = await generateIllustration('illustrate-live', topic);

if (!result.ok) {
  console.error(
    `\nFAIL: stage=${result.stage} after ${result.ms}ms — ${result.detail}`,
  );
  process.exit(1);
}

const elements = result.elements;
console.log(`\nok: ${elements.length} elements in ${result.ms}ms, kind=${result.kind}`);

const kinds = new Map<string, number>();
for (const el of elements) {
  const type = String(el.type ?? 'unknown');
  kinds.set(type, (kinds.get(type) ?? 0) + 1);
}
console.log(`shapes: ${[...kinds].map(([k, n]) => `${k}×${n}`).join(', ')}`);

const labels = elements
  .map((el) => (typeof el.text === 'string' ? el.text : ''))
  .filter((text) => text.length > 0);
console.log(`labels: ${labels.join(' | ') || '(none — a diagram with no words is a bug)'}`);

// The two invariants the scene merge depends on. A miss here is silent in
// production: the element simply never appears on the board.
const bad = elements.filter((el) => typeof el.id !== 'string' || typeof el.version !== 'number');
console.log(`merge-safe: ${bad.length === 0 ? 'yes' : `NO — ${bad.length} element(s) missing id/version`}`);
console.log(`provenance: ${elements.every((el) => el.athena === true) ? 'all tagged athena' : 'MISSING on some'}`);

// Placement is what stops a diagram landing on top of the teacher's drawing.
const occupied = [{ id: 'existing', version: 1, type: 'rectangle', x: 0, y: 0, width: 400, height: 200 }];
const shifted = placeBeside(occupied, elements);
const leftmost = Math.min(...shifted.map((el) => (typeof el.x === 'number' ? el.x : Infinity)));
console.log(`placement: leftmost x=${leftmost} (must clear 400)`);

// A second request must not re-return the first diagram's elements.
console.log('\nsecond request on the same session, to prove the diff...');
const secondResult = await generateIllustration('illustrate-live', `${topic} in more detail`);
const again = secondResult.ok ? secondResult.elements : [];
if (!secondResult.ok) {
  console.log(`  second request failed: stage=${secondResult.stage} — ${secondResult.detail}`);
}
const overlap = again.filter((el) => elements.some((first) => first.id === el.id));
console.log(`  ${again.length} new elements, ${overlap.length} repeated from the first (must be 0)`);

/*
 * The seam itself. Everything above proves the board agent; this proves that a
 * spoken turn carrying the payload actually lands elements on the session's
 * scene and broadcasts them, which is the part a unit test cannot reach because
 * the generation step is a network call.
 */
console.log('\nfull path: spoken turn -> applyControl -> scene + broadcast');

const session = createSession('illustrate-live-seam');
const seen: string[] = [];
const stop = subscribe(session.sessionId, {
  subscriberId: 'illustrate-live',
  participantId: 'illustrate-live',
  role: 'teacher',
  send: (event) => seen.push(event.kind),
  close: () => undefined,
});

const { spoken, control } = parseAgentTurn(
  'Photosynthesis turns light into sugar. {"illustrate":{"topic":"photosynthesis"}}',
);
console.log(`  spoken (braces stripped): "${spoken}"`);
applyControl(session, control ?? {});

/*
 * applyControl deliberately does not await the drawing, so poll for it.
 *
 * Wait on the broadcast rather than on the scene: the elements are merged
 * first and published a tick later, so a loop that stops as soon as the scene
 * fills unsubscribes in the gap between the two and sees no event.
 */
const deadline = Date.now() + 40_000;
const painted = () => seen.filter((k) => k === 'echosphere:whiteboard-scene').length;
while (painted() === 0 && Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 250));
}
stop();

const drawn = session.whiteboard.scene.length;
const broadcast = painted();
console.log(`  scene: ${drawn} elements, board open: ${session.whiteboard.open}`);
console.log(`  broadcast: ${broadcast} whiteboard-scene event(s) (must be 1)`);

releaseIllustrationState(session.sessionId);

if (
  bad.length > 0 ||
  overlap.length > 0 ||
  leftmost < 400 ||
  drawn === 0 ||
  broadcast !== 1 ||
  !session.whiteboard.open
) {
  process.exit(1);
}
console.log('\nall checks passed');
