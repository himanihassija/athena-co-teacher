/**
 * Measures the quality of the "what should this picture show" step.
 *
 * This is the step that decides whether a diagram is any good — Excalidraw does
 * the layout and cannot improve the content it is handed — and it is the only
 * part of the feature with no naturally observable success rate. A lesson shows
 * you one diagram at a time, so "it works about half the time" was the best
 * anyone could say about it, and that is not a number you can improve against.
 *
 * So this runs the real spec step over a fixed set of topics and scores three
 * things that a live lesson cannot separate:
 *
 *  - **parsed** — did a usable picture come back at all? A no is either the
 *    model failing or, much more often on a free-tier key, a rate limit.
 *  - **kind** — did it choose boxes for a process and a real picture for a
 *    fraction? Choosing wrong is the failure that had Athena describing a
 *    shaded circle while the board showed a flowchart.
 *  - **echo** — did it just restate the topic phrase back as a label? This is
 *    what "flow of synthesis" produced, and it is the specific symptom that
 *    having no lesson context caused.
 *
 * Deliberately does NOT call Excalidraw: the point is to measure the model
 * step in isolation, cheaply enough to run before and after a prompt change.
 *
 * Run with: node --env-file=.env --import tsx scripts/illustrate.bench.ts
 * Set RUNS to change the repeats per topic (default 2).
 */

import {
  describeContext,
  parseIllustrationPlan,
  type IllustrationContext,
} from '../src/board/boardAgent.ts';
import { config } from '../src/config.ts';
import { tryComplete } from '../src/llm/complete.ts';

/*
 * `illustrate()` holds the system prompt privately, which is right — nothing
 * else should be able to reach in and change what Athena draws. Re-declaring
 * the two lines the bench needs would let the two drift apart silently, so the
 * request is rebuilt from the exported helpers instead and only the system
 * prompt is read back out of the module's source.
 */
const source = await import('node:fs').then((fs) =>
  fs.readFileSync(new URL('../src/board/boardAgent.ts', import.meta.url), 'utf8'),
);
const specSystem = /const SPEC_SYSTEM = `([\s\S]*?)`;/.exec(source)?.[1];
if (!specSystem) {
  console.error('could not read SPEC_SYSTEM out of boardAgent.ts — has it been renamed?');
  process.exit(1);
}

interface Case {
  topic: string;
  /** What a teacher would obviously expect, or undefined when either is fine. */
  expect?: 'diagram' | 'drawing';
  context?: IllustrationContext;
}

const CHEMISTRY: IllustrationContext = {
  lessonTitle: 'Organic Chemistry — Class 12',
  language: 'en',
  transcript: [
    'Mrs Rao: today we are looking at how aspirin is prepared in the lab',
    'Mrs Rao: start from salicylic acid and add acetic anhydride',
  ],
  material: ['Aspirin is prepared from salicylic acid and acetic anhydride with an acid catalyst.'],
};

const FRACTIONS: IllustrationContext = {
  lessonTitle: 'Fractions — Class 5',
  language: 'en',
  transcript: [
    'Mrs Rao: so three quarters means three parts out of four equal parts',
    'Arjun: can you show us what that looks like',
  ],
  material: [],
};

const CASES: Case[] = [
  // The reported failure. Without context this is unanswerable, and the model
  // restated the phrase; with it, it is a specific reaction.
  { topic: 'flow of synthesis', expect: 'diagram', context: CHEMISTRY },
  { topic: 'the water cycle', expect: 'diagram' },
  { topic: 'photosynthesis', expect: 'diagram' },
  { topic: 'how a bill becomes law', expect: 'diagram' },
  { topic: 'types of triangles', expect: 'diagram' },
  // The pictures a flowchart cannot express.
  { topic: '3/4 shaded circle', expect: 'drawing', context: FRACTIONS },
  { topic: 'how a fraction is split into equal parts', expect: 'drawing', context: FRACTIONS },
  { topic: 'which is bigger, 2/3 or 3/5', expect: 'drawing', context: FRACTIONS },
  // Degenerate phrases: whatever comes back must at least not be the phrase.
  { topic: 'the process', context: CHEMISTRY },
  { topic: 'this concept', context: FRACTIONS },
];

const RUNS = Number(process.env.RUNS ?? 2);
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Whether a label is really just the topic handed back.
 *
 * Matches the whole phrase and any multi-word fragment of it, because "flow of
 * synthesis" came back split across boxes reading "flow" and "synthesis" as
 * well as whole.
 */
function echoesTopic(topic: string, labels: string[]): boolean {
  const t = norm(topic);
  return labels.some((label) => {
    const l = norm(label);
    return l.length > 0 && (l === t || (l.split(' ').length >= 2 && t.includes(l)));
  });
}

let parsed = 0;
let attempts = 0;
let rightKind = 0;
let kindChecked = 0;
let echoed = 0;

console.log(`model: ${config.boardLlmModel.trim() || '(deployment default)'}`);
console.log(`${CASES.length} topics x ${RUNS} runs\n`);

for (const testCase of CASES) {
  for (let i = 0; i < RUNS; i += 1) {
    attempts += 1;
    const plan = parseIllustrationPlan(
      await tryComplete(
        [
          { role: 'system', content: specSystem },
          { role: 'user', content: describeContext(testCase.topic, testCase.context) },
        ],
        {
          temperature: 0.3,
          maxTokens: 900,
          model: config.boardLlmModel.trim() || undefined,
        },
      ),
    );

    if (!plan) {
      console.log(`  MISS  "${testCase.topic}" — nothing usable came back`);
      continue;
    }
    parsed += 1;

    const labels =
      plan.kind === 'diagram'
        ? plan.nodes.map((n) => n.label)
        : plan.shapes.map((s) => ('caption' in s ? s.caption ?? '' : 'text' in s ? s.text : ''));

    // Only diagrams can echo. A drawing captioned "3/4" for the topic "3/4
    // shaded circle" is not restating the question, it is labelling the
    // picture correctly — scoring that as a failure measured the wrong thing.
    const echo = plan.kind === 'diagram' && echoesTopic(testCase.topic, labels);
    if (echo) echoed += 1;

    let kindNote = '';
    if (testCase.expect) {
      kindChecked += 1;
      if (plan.kind === testCase.expect) rightKind += 1;
      else kindNote = `  <- wanted a ${testCase.expect}`;
    }

    const flag = echo ? 'ECHO ' : kindNote ? 'KIND ' : 'ok   ';
    console.log(
      `  ${flag} "${testCase.topic}" [${plan.kind}] ${labels.filter(Boolean).join(' | ')}${kindNote}`,
    );
  }
}

const usable = parsed - echoed;
console.log('\n---');
console.log(`attempts        ${attempts}`);
console.log(`came back       ${parsed}  (${pct(parsed, attempts)})`);
console.log(`right kind      ${rightKind}/${kindChecked}  (${pct(rightKind, kindChecked)})`);
console.log(`restated topic  ${echoed}`);
console.log(`USABLE          ${usable}/${attempts}  (${pct(usable, attempts)})`);

function pct(n: number, of: number): string {
  return of === 0 ? 'n/a' : `${Math.round((n / of) * 100)}%`;
}
