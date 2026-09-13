/**
 * Tests for the global error mapper (see src/errors.ts).
 *
 * The gap this locks down: a malformed request used to come back as 500 with
 * `ZodError.message` — the raw issue dump — in the body. Wrong status, and it
 * leaked internals to the caller.
 *
 * Run with: node --import tsx scripts/errors.test.ts
 */

import assert from 'node:assert/strict';
import { z } from 'zod';
import { toErrorResponse } from './../src/errors.ts';

let pass = 0;
const t = (name: string, fn: () => void): void => {
  try { fn(); pass += 1; console.log(`  ok  ${name}`); }
  catch (e) { console.log(`  FAIL ${name}: ${(e as Error).message}`); process.exitCode = 1; }
};

const DEV = { isProduction: false };
const PROD = { isProduction: true };

/** The real thing a route throws, rather than a hand-built lookalike. */
function zodErrorFrom(schema: z.ZodTypeAny, value: unknown): unknown {
  try { schema.parse(value); } catch (e) { return e; }
  throw new Error('schema unexpectedly accepted the value');
}

t('a missing query param is a 400, not a 500', () => {
  const err = zodErrorFrom(z.object({ participantId: z.string() }), {});
  const r = toErrorResponse(err, DEV);
  assert.equal(r.status, 400);
  assert.equal(r.serverFault, false);
});

t('the 400 names the offending field', () => {
  const err = zodErrorFrom(z.object({ participantId: z.string() }), {});
  const r = toErrorResponse(err, DEV);
  assert.deepEqual(r.body.fields, ['participantId']);
  assert.match(r.body.error, /participantId/);
});

t('several bad fields are all reported', () => {
  const err = zodErrorFrom(
    z.object({ slotId: z.string(), studentId: z.string(), topic: z.string() }),
    { slotId: 'a' },
  );
  const r = toErrorResponse(err, DEV);
  assert.deepEqual(r.body.fields?.sort(), ['studentId', 'topic']);
});

t('a nested path is reported dotted', () => {
  const err = zodErrorFrom(
    z.object({ quiz: z.object({ options: z.array(z.string()) }) }),
    { quiz: { options: [1] } },
  );
  const r = toErrorResponse(err, DEV);
  assert.deepEqual(r.body.fields, ['quiz.options.0']);
});

t('the raw Zod issue dump never reaches the caller', () => {
  const err = zodErrorFrom(z.object({ participantId: z.string() }), {});
  const r = toErrorResponse(err, DEV);
  const serialised = JSON.stringify(r.body);
  assert.ok(!serialised.includes('invalid_type'), 'leaked a Zod issue code');
  assert.ok(!serialised.includes('"received"'), 'leaked Zod issue internals');
});

t('a ZodError from a second zod copy is still a 400', () => {
  // No `instanceof` relationship — only the duck-typed shape.
  const lookalike = { name: 'ZodError', issues: [{ path: ['topic'], message: 'Required' }] };
  const r = toErrorResponse(lookalike, DEV);
  assert.equal(r.status, 400);
  assert.deepEqual(r.body.fields, ['topic']);
});

t('an error that already carries a 4xx keeps its status and message', () => {
  const r = toErrorResponse(
    Object.assign(new Error('Only the teacher can start a quiz'), { statusCode: 403 }),
    DEV,
  );
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'Only the teacher can start a quiz');
  assert.equal(r.serverFault, false);
});

t('an unexpected error is still a 500, not softened into a 400', () => {
  const r = toErrorResponse(new TypeError('cannot read properties of undefined'), DEV);
  assert.equal(r.status, 500);
  assert.equal(r.serverFault, true, 'a real bug must stay flagged as a server fault');
});

t('production hides the internal message; dev keeps it', () => {
  const boom = new TypeError('cannot read properties of undefined');
  assert.equal(toErrorResponse(boom, PROD).body.error, 'Something went wrong on the server.');
  assert.equal(toErrorResponse(boom, DEV).body.error, 'cannot read properties of undefined');
});

t('no stack trace is ever included, in either mode', () => {
  const boom = new Error('boom');
  for (const mode of [DEV, PROD]) {
    const serialised = JSON.stringify(toErrorResponse(boom, mode).body);
    assert.ok(!serialised.includes('at '), 'looks like a stack frame leaked');
    assert.ok(!serialised.includes('.ts:'), 'leaked an internal file path');
  }
});

console.log(`\n${pass} passing`);
