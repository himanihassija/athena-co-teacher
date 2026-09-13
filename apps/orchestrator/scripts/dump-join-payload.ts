/**
 * Prints the join payload the orchestrator actually sends to Agora.
 *
 * Configuration in this repo is assembled by `startAgent()` and then rewritten
 * by the SDK before it goes out: `Agent.buildStartRequest` passes some fields
 * through verbatim, drops others, and fills in defaults of its own. That gap is
 * not theoretical — a `sal` block was sent for months alongside an
 * `advanced_features` object that never carried `enable_sal`, so the feature was
 * configured and disabled at the same time and no local config object showed it.
 *
 * So "the value is right in agentLifecycle.ts" is not evidence. This runs the
 * real `startAgent()` against a stubbed `fetch`, captures the request body on
 * the wire, and asserts against that. No agent is started and nothing is billed.
 *
 * Run: pnpm --filter @echosphere/orchestrator dump:join
 */

const captured: { url: string; body: unknown }[] = [];

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init: any) => {
  const url = typeof input === 'string' ? input : (input?.url ?? String(input));
  if (String(url).includes('/join')) {
    captured.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) });
    return new Response(
      JSON.stringify({ agent_id: 'stub-agent', create_ts: Date.now(), status: 'RUNNING' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }
  return realFetch(input, init);
}) as typeof fetch;

const { createSession } = await import('../src/state/sessionRegistry.js');
const { startAgent } = await import('../src/agent/agentLifecycle.js');

const session = createSession('Payload probe');
await startAgent(session);

const join = captured[0];
if (!join) {
  console.error('No /join request was captured — the SDK call path changed.');
  process.exit(1);
}

const props = (join.body as any).properties ?? {};
console.log('\n── Outbound POST', join.url, '\n');
console.log(JSON.stringify(props, null, 2));

const sos = props.turn_detection?.config?.start_of_speech?.vad_config ?? {};
const checks: [string, unknown, unknown][] = [
  ['turn_detection…start_of_speech.vad_config.interrupt_duration_ms', sos.interrupt_duration_ms, 200],
  ['turn_detection…start_of_speech.vad_config.prefix_padding_ms', sos.prefix_padding_ms, 800],
  ['parameters.audio_scenario', props.parameters?.audio_scenario, 'aiserver'],
  ['sal (must be absent)', props.sal, undefined],
  ['advanced_features.enable_sal (must be absent)', props.advanced_features?.enable_sal, undefined],
];

console.log('\n── Assertions against the wire payload\n');
let failures = 0;
for (const [label, actual, expected] of checks) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(
    `  ${ok ? 'ok  ' : 'FAIL'} ${label} = ${JSON.stringify(actual)}` +
      (ok ? '' : ` (expected ${JSON.stringify(expected)})`),
  );
}

// Reported, not asserted: these are the audit's open questions, and seeing the
// value on the wire is the point rather than pinning it to an expectation.
console.log('\n── Reported for the record\n');
console.log('  speaking_interrupt_duration_ms (barge-in, left at Agora default 160):',
  JSON.stringify(sos.speaking_interrupt_duration_ms ?? '(absent — engine default 160)'));
console.log('  end_of_speech.mode:', JSON.stringify(props.turn_detection?.config?.end_of_speech?.mode));
console.log('  interruption:', JSON.stringify(props.interruption));
console.log('  remote_rtc_uids:', JSON.stringify(props.remote_rtc_uids));
console.log('  turn_detection.language:', JSON.stringify(props.turn_detection?.language));
console.log('  llm.params:', JSON.stringify(props.llm?.params));
console.log('  asr:', JSON.stringify(props.asr));

console.log(failures === 0 ? '\nPayload matches intent.\n' : `\n${failures} failed.\n`);
process.exit(failures === 0 ? 0 : 1);
