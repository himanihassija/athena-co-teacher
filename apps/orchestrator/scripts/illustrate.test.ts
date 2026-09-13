/**
 * Tests for Athena's diagram path (see board/boardAgent.ts, classroomController.ts).
 *
 * Three failure modes, none of which a live run would show reliably:
 *
 *  - The same spoken turn reaching `applyControl` twice, once from the
 *    agent-history poll and once from the relayed RTM transcript. Without the
 *    guard that is two Excalidraw round trips and the same diagram pasted
 *    beside itself. This is the illustrate analogue of the quiz suite's
 *    duplicate-payload tests.
 *  - A model returning something that is not a usable diagram spec — fenced
 *    JSON, prose in front of it, edges pointing at nodes it never defined.
 *    Each of those has to degrade to "no diagram" rather than to a broken one.
 *  - New elements landing on top of what is already on the board.
 *
 * Run with: node --env-file=.env --import tsx scripts/illustrate.test.ts
 */

import assert from 'node:assert/strict';
import type { BoardElement } from '@echosphere/shared-types';
import { parseAgentTurn } from './../src/agent/control.ts';
import {
  addressedByTeacherDirective,
  buildClassroomInstructions,
  forceSpeakDirective,
  wantsDrawing,
} from './../src/agent/prompt.ts';
import {
  describeContext,
  findElements,
  parseDiagramSpec,
  parseIllustrationPlan,
  placeBeside,
} from './../src/board/boardAgent.ts';
import { parseDrawingShapes, renderDrawing } from './../src/board/shapes.ts';
import { retryDelayMs } from './../src/llm/complete.ts';
import {
  isDuplicateIllustration,
  releaseIllustrationState,
} from './../src/classroomController.ts';
import { AGENT_UID, createSession } from './../src/state/sessionRegistry.ts';
import { ingestTranscript } from './../src/classroomController.ts';

let pass = 0;
const t = (name: string, fn: () => void): void => {
  try { fn(); pass += 1; console.log(`  ok  ${name}`); }
  catch (e) { console.log(`  FAIL ${name}: ${(e as Error).message}`); process.exitCode = 1; }
};

/* ---------------------------------------------------------------- control */

t('reads an illustrate payload off a spoken turn', () => {
  const r = parseAgentTurn(
    'Rain falls, collects, and evaporates again. {"illustrate":{"topic":"the water cycle"}}',
  );
  assert.equal(r.spoken, 'Rain falls, collects, and evaporates again.');
  assert.equal(r.control?.illustrate?.topic, 'the water cycle');
});

t('drops an illustrate payload with no topic', () => {
  const r = parseAgentTurn('Sure. {"illustrate":{"topic":"   "}}');
  assert.equal(r.control?.illustrate, undefined);
});

t('an illustrate payload still strips from the spoken text when malformed', () => {
  const r = parseAgentTurn('Sure. {"illustrate":{}}');
  assert.equal(r.spoken, 'Sure.', 'the braces must never reach the transcript');
  assert.equal(r.control?.illustrate, undefined);
});

/* --------------------------------------------------------------- prompt */

/*
 * A prompt regression is invisible to every other check in this repo: types
 * pass, tests pass, the build passes, and the only symptom is the model
 * behaving differently in a live lesson. These pin the two instructions whose
 * absence has already caused a real failure.
 */

t('the contract tells her to illustrate', () => {
  const prompt = buildClassroomInstructions(createSession('t'));
  assert.ok(prompt.includes('"illustrate"'), 'the field must be documented to the model');
  assert.ok(prompt.includes('{"illustrate":{"topic"'), 'a worked example must be present');
});

t('the contract forbids a wordless illustrate turn', () => {
  const prompt = buildClassroomInstructions(createSession('t'));
  // A live lesson produced `{"illustrate":{"topic":"how Agora works"}}` as the
  // entire turn: the diagram drew, and the room heard silence. The model had
  // read "never say you are drawing it" together with the persona's "reply with
  // the control object and no spoken words whatsoever" and concluded it should
  // say nothing at all.
  assert.ok(
    prompt.includes('must still explain the idea out loud in the same turn'),
    'the model must be told the field never replaces speech',
  );
  assert.ok(
    prompt.includes('never the whole reply'),
    'and told explicitly that a wordless turn is wrong',
  );
});

/* --------------------------------------------------------- relay delivery */

/*
 * The bug a live lesson hit: Athena said "you should be able to see the diagram
 * now" and the board was empty.
 *
 * Her turn reaches the orchestrator as several relays that grow as she speaks,
 * and the control object is appended at the END of a turn — so it exists only
 * in the last and longest one. That relay was taking the `alreadyStored` early
 * return in `ingestTranscript`, and `upsertByTurn` parses the text only to keep
 * the spoken half, so the payload was dropped and `applyControl` was never
 * reached. Quizzes never showed this because the agent-history poll delivers
 * them a second way; a diagram has only the relay.
 */

const relay = (session: ReturnType<typeof createSession>, text: string, turnId: number) =>
  ingestTranscript(session, { uid: AGENT_UID, text, isFinal: true, turnId });

await (async () => {
  await t('a payload arriving in a later relay of the turn is still acted on', async () => {
    const session = createSession('t');

    // Exactly the shape seen live: the object only appears in the final relay.
    await relay(session, 'Photosynthesis involves sunlight,', 7);
    await relay(
      session,
      'Photosynthesis involves sunlight, carbon dioxide and water to produce glucose. {"illustrate":{"topic":"photosynthesis"}}',
      7,
    );

    // The guard registers the topic the moment the payload is acted on, so a
    // topic now marked as a duplicate proves applyControl was reached.
    assert.equal(
      isDuplicateIllustration(session, 'photosynthesis'),
      true,
      'the payload in the final relay must reach applyControl',
    );
    releaseIllustrationState(session.sessionId);
  });

  await t('the same payload repeated across relays is acted on only once', async () => {
    const session = createSession('t');
    await relay(session, 'Short opening,', 9);
    await relay(session, 'Short opening, and more. {"illustrate":{"topic":"the water cycle"}}', 9);
    // Relays keep arriving after the object is complete, each carrying it again.
    await relay(
      session,
      'Short opening, and more, and more still. {"illustrate":{"topic":"the water cycle"}}',
      9,
    );
    assert.equal(session.agentControlAppliedTurns.has(9), true, 'the turn must be marked spent');
    releaseIllustrationState(session.sessionId);
  });

  await t('a half-arrived control object is not mistaken for a payload', async () => {
    const session = createSession('t');
    await relay(session, 'Talking away,', 11);
    // The JSON has not finished arriving; it must not be acted on or marked.
    await relay(session, 'Talking away, and more. {"illustrate":{"top', 11);
    assert.equal(session.agentControlAppliedTurns.has(11), false);
    releaseIllustrationState(session.sessionId);
  });

  await t('an empty payload does not spend the turn', async () => {
    const session = createSession('t');
    await relay(session, 'Just talking,', 13);
    await relay(session, 'Just talking, nothing to report. {}', 13);
    assert.equal(
      session.agentControlAppliedTurns.has(13),
      false,
      'a later relay carrying a real payload must still be able to act',
    );
  });
})();

/* ------------------------------------------------------- drawing intent */

/*
 * A live lesson: the teacher said "Athena, draw diagram for photosynthesis."
 * and got a paragraph. The control contract was correct and the model never
 * used it, because the orchestrator restates what the teacher said as a
 * `[classroom:system]` directive — and that restatement said only "answer them
 * out loud in two or three sentences". The persona tells the model such a turn
 * has already been cleared and must be carried out, so the directive outranked
 * the contract and the drawing intent was gone before the model saw it.
 */

t('recognises the ways a teacher asks for a picture', () => {
  for (const said of [
    'draw diagram for photosynthesis',
    'Athena, can you sketch that',
    'show me an illustration',
    'explain how Agora works using a diagram',
    'make a flowchart of this',
    'can you visualise the water cycle',
  ]) {
    assert.ok(wantsDrawing(said), `must detect: "${said}"`);
  }
});

t('does not see a drawing request in ordinary teaching talk', () => {
  for (const said of [
    'explain photosynthesis to the class',
    'what is a common denominator',
    'can everyone hear me',
    'ask the class a question about fractions',
  ]) {
    assert.equal(wantsDrawing(said), false, `must not fire on: "${said}"`);
  }
});

t('the addressed-by-teacher directive keeps a drawing request intact', () => {
  const directive = addressedByTeacherDirective('draw diagram for photosynthesis.');
  assert.ok(
    directive.includes('illustrate'),
    'the restatement must not flatten a drawing request into prose',
  );
  assert.ok(directive.includes('MUST'), 'and must be binding, not a suggestion');
});

t('the force-speak directive keeps one too', () => {
  assert.ok(forceSpeakDirective('draw the water cycle').includes('illustrate'));
  assert.ok(forceSpeakDirective('draw the water cycle', 'Ana').includes('illustrate'));
});

t('an ordinary explain directive is left alone', () => {
  const directive = addressedByTeacherDirective('what is photosynthesis?');
  assert.ok(!directive.includes('illustrate'), 'must not push a diagram on every answer');
});

/* ------------------------------------------------------------ redelivery */

t('the second delivery of one turn is suppressed', () => {
  const s = createSession('t');
  assert.equal(isDuplicateIllustration(s, 'photosynthesis'), false, 'first must pass');
  assert.equal(isDuplicateIllustration(s, 'photosynthesis'), true, 'second must be blocked');
  releaseIllustrationState(s.sessionId);
});

t('redelivery matching ignores case and surrounding space', () => {
  const s = createSession('t');
  isDuplicateIllustration(s, 'The Water Cycle');
  assert.equal(isDuplicateIllustration(s, '  the water cycle  '), true);
  releaseIllustrationState(s.sessionId);
});

t('a different topic is not treated as a redelivery', () => {
  const s = createSession('t');
  isDuplicateIllustration(s, 'photosynthesis');
  assert.equal(isDuplicateIllustration(s, 'respiration'), false);
  releaseIllustrationState(s.sessionId);
});

t('an empty topic is refused rather than sent to the board agent', () => {
  const s = createSession('t');
  assert.equal(isDuplicateIllustration(s, '   '), true);
  releaseIllustrationState(s.sessionId);
});

t('two sessions do not share a redelivery record', () => {
  const a = createSession('a');
  const b = createSession('b');
  isDuplicateIllustration(a, 'gravity');
  assert.equal(isDuplicateIllustration(b, 'gravity'), false);
  releaseIllustrationState(a.sessionId);
  releaseIllustrationState(b.sessionId);
});

t('releasing a session clears its record, so the topic can be asked again', () => {
  const s = createSession('t');
  isDuplicateIllustration(s, 'gravity');
  releaseIllustrationState(s.sessionId);
  assert.equal(isDuplicateIllustration(s, 'gravity'), false);
  releaseIllustrationState(s.sessionId);
});

/* ------------------------------------------------------------------ spec */

const goodSpec = JSON.stringify({
  title: 'Water cycle',
  nodes: [
    { id: 'a', label: 'Evaporation' },
    { id: 'b', label: 'Condensation' },
  ],
  edges: [{ from: 'a', to: 'b', label: 'rises' }],
});

t('parses a clean spec', () => {
  const spec = parseDiagramSpec(goodSpec);
  assert.equal(spec?.nodes.length, 2);
  assert.equal(spec?.edges.length, 1);
  assert.equal(spec?.title, 'Water cycle');
});

t('parses a spec the model wrapped in a fence and a sentence', () => {
  const spec = parseDiagramSpec("Here you go!\n```json\n" + goodSpec + '\n```');
  assert.equal(spec?.nodes.length, 2, 'fenced JSON must still parse');
});

t('drops edges pointing at nodes that were never defined', () => {
  const spec = parseDiagramSpec(
    JSON.stringify({
      nodes: [{ id: 'a', label: 'One' }, { id: 'b', label: 'Two' }],
      edges: [{ from: 'a', to: 'b' }, { from: 'a', to: 'ghost' }],
    }),
  );
  assert.equal(spec?.edges.length, 1, 'a dangling arrow must not reach the board');
});

t('refuses a spec with fewer than two nodes', () => {
  const spec = parseDiagramSpec(JSON.stringify({ nodes: [{ id: 'a', label: 'One' }] }));
  assert.equal(spec, null);
});

t('refuses prose, an empty reply, and a reasoning model answering blank', () => {
  assert.equal(parseDiagramSpec('I could draw that for you.'), null);
  assert.equal(parseDiagramSpec(''), null);
  // tryComplete returns null when a provider is absent or replies empty.
  assert.equal(parseDiagramSpec(null), null);
});

t('survives malformed JSON rather than throwing', () => {
  assert.equal(parseDiagramSpec('{"nodes":[{"id":"a",'), null);
});

/* -------------------------------------------------------------- elements */

t('finds elements however the beta wrapper nests them', () => {
  const el = { id: 'x1', type: 'rectangle', version: 3, x: 0, y: 0 };
  assert.equal(findElements({ elements: [el] }).length, 1);
  assert.equal(findElements({ scene: { data: { elements: [el] } } }).length, 1);
  assert.equal(findElements([el]).length, 1);
});

t('ignores wrapper objects that merely have an id', () => {
  assert.equal(findElements({ scene: { id: 'scene-1', name: 'board' } }).length, 0);
});

t('gives every element the id and numeric version the merge needs', () => {
  const [el] = findElements({ elements: [{ id: 'x1', type: 'ellipse' }] });
  // mergeSceneElements compares `el.version >= existing.version`; undefined
  // fails that test silently and the element never lands.
  assert.equal(typeof el?.version, 'number');
  assert.equal(el?.athena, true, 'must carry the same provenance flag as her written lines');
  assert.equal(el?.isDeleted, false);
});

/* ------------------------------------------------------------- placement */

const box = (id: string, x: number, width: number): BoardElement =>
  ({ id, version: 1, type: 'rectangle', x, y: 0, width, height: 40 });

t('shifts a diagram clear of existing board content', () => {
  const placed = placeBeside([box('t1', 0, 200)], [box('d1', 0, 100)]);
  assert.equal(placed[0]?.x, 280, 'must start right of the teacher’s drawing plus a margin');
});

t('leaves the layout alone on an empty board', () => {
  const placed = placeBeside([], [box('d1', 0, 100), box('d2', 120, 100)]);
  assert.equal(placed[0]?.x, 0, 'Excalidraw’s own layout is already correct');
  assert.equal(placed[1]?.x, 120);
});

t('preserves the diagram’s internal spacing when it shifts', () => {
  const placed = placeBeside([box('t1', 0, 200)], [box('d1', 0, 100), box('d2', 150, 100)]);
  assert.equal((placed[1]?.x as number) - (placed[0]?.x as number), 150);
});

t('a deleted element does not push the next diagram off to the right', () => {
  const gone = { ...box('t1', 5000, 200), isDeleted: true };
  const placed = placeBeside([gone, box('t2', 0, 100)], [box('d1', 0, 100)]);
  assert.equal(placed[0]?.x, 180, 'an erased shape must not reserve space forever');
});

t('nothing to place is not an error', () => {
  assert.deepEqual(placeBeside([box('t1', 0, 200)], []), []);
});

/* ------------------------------------------------------------ plan kinds */

/*
 * The picture kind is chosen by the model, and the branch that renders it is
 * the one that cannot be exercised live on demand — a topic that produced a
 * drawing yesterday can produce a diagram today. These pin both branches, and
 * more importantly pin the fallback: a drawing reply this build cannot render
 * must degrade to the flowchart it would have produced before drawings
 * existed, never to nothing.
 */

t('reads a drawing plan', () => {
  const plan = parseIllustrationPlan(
    JSON.stringify({
      kind: 'drawing',
      title: 'Three quarters',
      shapes: [{ type: 'partitioned-circle', parts: 4, shaded: 3, caption: '3/4' }],
    }),
  );
  assert.equal(plan?.kind, 'drawing');
  assert.equal(plan?.kind === 'drawing' ? plan.shapes.length : 0, 1);
});

t('reads a diagram plan, with or without the kind field', () => {
  assert.equal(parseIllustrationPlan(goodSpec)?.kind, 'diagram', 'an older reply has no kind');
  assert.equal(
    parseIllustrationPlan(JSON.stringify({ kind: 'diagram', ...JSON.parse(goodSpec) }))?.kind,
    'diagram',
  );
});

t('a drawing whose shapes are all unrecognised falls back to the diagram', () => {
  // The safety property: an unknown shape name must never cost a picture that
  // the previous build would have drawn.
  const plan = parseIllustrationPlan(
    JSON.stringify({
      kind: 'drawing',
      title: 'Water cycle',
      shapes: [{ type: 'holographic-cube', parts: 4 }],
      nodes: [{ id: 'a', label: 'Evaporation' }, { id: 'b', label: 'Condensation' }],
      edges: [{ from: 'a', to: 'b' }],
    }),
  );
  assert.equal(plan?.kind, 'diagram', 'must degrade to boxes, not to nothing');
});

t('a drawing with nothing usable at all is refused', () => {
  assert.equal(
    parseIllustrationPlan(JSON.stringify({ kind: 'drawing', shapes: [{ type: 'nope' }] })),
    null,
  );
});

/* -------------------------------------------------------- shape validation */

t('refuses a fraction shading more parts than exist', () => {
  // 5/4 of a circle is not a picture, it is a bug that would render as a full
  // circle and quietly teach the wrong thing.
  assert.equal(parseDrawingShapes([{ type: 'partitioned-circle', parts: 4, shaded: 5 }]).length, 0);
  assert.equal(parseDrawingShapes([{ type: 'partitioned-circle', parts: 4, shaded: -1 }]).length, 0);
});

t('accepts a whole shaded and a none shaded', () => {
  assert.equal(parseDrawingShapes([{ type: 'partitioned-bar', parts: 4, shaded: 4 }]).length, 1);
  assert.equal(parseDrawingShapes([{ type: 'partitioned-bar', parts: 4, shaded: 0 }]).length, 1);
});

t('refuses a partition into fewer than two parts', () => {
  assert.equal(parseDrawingShapes([{ type: 'partitioned-circle', parts: 1, shaded: 1 }]).length, 0);
});

t('refuses a bar chart with a single bar and a number line that runs backwards', () => {
  assert.equal(parseDrawingShapes([{ type: 'bar-chart', bars: [{ label: 'a', value: 1 }] }]).length, 0);
  assert.equal(parseDrawingShapes([{ type: 'number-line', from: 5, to: 1 }]).length, 0);
});

t('caps a drawing at four shapes', () => {
  const many = Array.from({ length: 9 }, () => ({ type: 'partitioned-bar', parts: 2, shaded: 1 }));
  assert.equal(parseDrawingShapes(many).length, 4);
});

/* ------------------------------------------------------------- geometry */

/*
 * The whole reason the geometry is computed here rather than by the model is
 * that "equal parts" is an arithmetic claim. These check the arithmetic.
 */

const isFilled = (el: Record<string, unknown>): boolean =>
  el.backgroundColor !== 'transparent' && el.backgroundColor !== undefined;

t('a quarter-shaded circle draws the right number of each piece', () => {
  const els = renderDrawing([{ type: 'partitioned-circle', parts: 4, shaded: 3 }]) as Array<
    Record<string, unknown>
  >;
  const wedges = els.filter((el) => el.type === 'line' && Array.isArray(el.points) && (el.points as unknown[]).length > 3);
  const dividers = els.filter((el) => el.type === 'line' && Array.isArray(el.points) && (el.points as unknown[]).length === 2);
  assert.equal(wedges.length, 3, 'three shaded wedges');
  assert.equal(dividers.length, 4, 'a divider on every boundary, shaded or not');
  assert.equal(els.filter((el) => el.type === 'ellipse').length, 1, 'one outline');
  assert.equal(els.filter((el) => el.type === 'text').length, 1, 'one caption');
});

t('the wedges of a circle really are equal', () => {
  for (const parts of [2, 3, 4, 5, 8]) {
    const els = renderDrawing([{ type: 'partitioned-circle', parts, shaded: parts }]) as Array<
      Record<string, unknown>
    >;
    const wedges = els.filter(
      (el) => el.type === 'line' && Array.isArray(el.points) && (el.points as unknown[]).length > 3,
    );
    assert.equal(wedges.length, parts);

    // Each wedge's arc must subtend exactly one part of a full turn.
    for (const w of wedges) {
      const pts = w.points as Array<[number, number]>;
      const first = pts[1] as [number, number];
      const last = pts[pts.length - 2] as [number, number];
      const a0 = Math.atan2(first[1], first[0]);
      const a1 = Math.atan2(last[1], last[0]);
      let swept = a1 - a0;
      while (swept <= 0) swept += Math.PI * 2;
      assert.ok(
        Math.abs(swept - (Math.PI * 2) / parts) < 0.02,
        `a ${parts}-part wedge swept ${swept.toFixed(3)} rad, expected ${((Math.PI * 2) / parts).toFixed(3)}`,
      );
    }
  }
});

t('a partitioned bar divides its width exactly', () => {
  const els = renderDrawing([{ type: 'partitioned-bar', parts: 4, shaded: 3 }]) as Array<
    Record<string, unknown>
  >;
  const cells = els.filter((el) => el.type === 'rectangle');
  assert.equal(cells.length, 4);
  const widths = new Set(cells.map((c) => c.width));
  assert.equal(widths.size, 1, 'every cell must be the same width');
  assert.equal(cells.filter(isFilled).length, 3, 'exactly three filled');
  // And they must tile: no gaps, no overlap.
  const total = cells.reduce((sum, c) => sum + Number(c.width), 0);
  const left = Math.min(...cells.map((c) => Number(c.x)));
  const right = Math.max(...cells.map((c) => Number(c.x) + Number(c.width)));
  assert.ok(Math.abs(total - (right - left)) < 0.5, 'cells must tile the bar exactly');
});

t('two shapes are laid out side by side, not on top of each other', () => {
  const els = renderDrawing([
    { type: 'partitioned-bar', parts: 2, shaded: 1 },
    { type: 'partitioned-bar', parts: 3, shaded: 2 },
  ]) as Array<Record<string, unknown>>;
  const rects = els.filter((el) => el.type === 'rectangle');
  const firstRight = Math.max(...rects.slice(0, 2).map((r) => Number(r.x) + Number(r.width)));
  const secondLeft = Math.min(...rects.slice(2).map((r) => Number(r.x)));
  assert.ok(secondLeft > firstRight, 'the second picture must start clear of the first');
});

t('a number line cannot emit hundreds of ticks', () => {
  const els = renderDrawing([{ type: 'number-line', from: 0, to: 1000, step: 1 }]);
  assert.ok(els.length < 60, `a careless step produced ${els.length} elements`);
});

t('every skeleton carries the fields edit_scene_content requires', () => {
  const els = renderDrawing([
    { type: 'partitioned-circle', parts: 4, shaded: 3 },
    { type: 'bar-chart', bars: [{ label: 'Cats', value: 12 }, { label: 'Dogs', value: 7 }] },
    { type: 'number-line', from: 0, to: 1, step: 0.25, marks: [0.75] },
    { type: 'note', text: 'Three quarters' },
  ]) as Array<Record<string, unknown>>;
  assert.ok(els.length > 0);
  for (const el of els) {
    for (const field of ['type', 'x', 'y', 'width', 'height']) {
      assert.ok(field in el, `a skeleton is missing "${field}": ${JSON.stringify(el).slice(0, 120)}`);
    }
    // The guide is explicit that ids must not appear in an `add` payload.
    assert.equal('id' in el, false, 'skeletons must not carry ids');
    assert.ok(Number.isFinite(el.x) && Number.isFinite(el.y), 'coordinates must be real numbers');
  }
});

/* -------------------------------------------------------------- context */

/*
 * Context is the fix for a topic phrase that does not carry its own meaning.
 * These pin that it reaches the prompt at all, which is otherwise invisible
 * until a live lesson draws the wrong thing.
 */

t('the topic still stands alone when there is no context', () => {
  assert.equal(describeContext('the water cycle', undefined), 'Topic: the water cycle');
});

t('lesson, material and talk all reach the prompt', () => {
  const described = describeContext('flow of synthesis', {
    lessonTitle: 'Organic Chemistry — Class 12',
    language: 'en',
    transcript: ['Mrs Rao: today we are looking at aspirin synthesis'],
    material: ['Aspirin is prepared from salicylic acid and acetic anhydride.'],
  });
  assert.ok(described.includes('flow of synthesis'));
  assert.ok(described.includes('Organic Chemistry'), 'the lesson title disambiguates the topic');
  assert.ok(described.includes('aspirin synthesis'), 'what the class just said must be included');
  assert.ok(described.includes('salicylic acid'), 'the teacher’s own material must be included');
});

t('English is not restated as a language instruction, but another language is', () => {
  assert.ok(!describeContext('x', { language: 'en' }).includes('language'));
  assert.ok(describeContext('x', { language: 'hi' }).includes('language: hi'));
});

/* ---------------------------------------------------------- rate limits */

/*
 * Measured against the real Groq key, a free-tier 429 asks for a wait well
 * under a second and the answer is simply lost without a retry — which was the
 * single largest cause of a diagram never appearing. None of this is reachable
 * from a test without a live 429, hence the pure helper.
 */

const res = (headers: Record<string, string> = {}): Response =>
  new Response('', { status: 429, headers });

t('waits the time Groq asks for, in either unit', () => {
  assert.equal(retryDelayMs(res(), 'Please try again in 4.4925s. Need more tokens?'), 4492.5);
  assert.equal(retryDelayMs(res(), 'Please try again in 75ms.'), 75);
});

t('prefers the retry-after header when there is one', () => {
  assert.equal(retryDelayMs(res({ 'retry-after': '2' }), 'try again in 30s'), 2000);
});

t('refuses to wait out a limit that will not clear soon', () => {
  assert.equal(retryDelayMs(res(), 'Please try again in 3m30s'), null, 'minutes are not worth a lesson');
  assert.equal(retryDelayMs(res({ 'retry-after': '600' }), ''), null);
});

t('waits out the longest refusal seen from the live key', () => {
  // Copied verbatim from a real 429 during a test run. A ceiling below this
  // threw the answer away for the sake of six seconds.
  assert.equal(
    retryDelayMs(
      res(),
      'Rate limit reached for model `openai/gpt-oss-120b` ... Limit 8000, Used 7662, Requested 1110. Please try again in 5.79s. Need more tokens?',
    ),
    5790,
  );
});

t('still retries once when the provider gives no hint at all', () => {
  assert.equal(retryDelayMs(res(), 'rate limited'), 500);
});

console.log(`\n${pass} passing (including drawings, geometry, context and rate limits)`);
