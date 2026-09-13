/**
 * Tests for Agora token minting (see src/routes/tokens.ts).
 *
 * There is no live-credential check here — these decode the tokens `mintTokens`
 * produces and assert their *contents*, which is the part a wrong builder or a
 * uid-type mismatch silently corrupts. The failure mode being locked down: an
 * RTC token whose embedded uid does not match the uid the browser joins with,
 * which Agora rejects at join time as an opaque "invalid token" — easily
 * mistaken for a bad App Certificate.
 *
 * Run with: node --import tsx scripts/tokens.test.ts
 */

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// mintTokens -> config -> required(): both must be present before the import.
process.env.NEXT_PUBLIC_AGORA_APP_ID = '0123456789abcdef0123456789abcdef';
process.env.NEXT_AGORA_APP_CERTIFICATE = 'fedcba9876543210fedcba9876543210';

const requireCjs = createRequire(import.meta.url);
// agora-token ships no public decoder; AccessToken2 has `from_string`.
const { AccessToken2 } = requireCjs('agora-token/src/AccessToken2') as {
  AccessToken2: new () => {
    from_string(token: string): void;
    appId: unknown;
    services: Record<number, { __channel_name?: unknown; __uid?: unknown; __user_id?: unknown; __privileges: Record<string, number> }>;
  };
};

const RTC_SERVICE = 1;
const RTM_SERVICE = 2;
const buf = (v: unknown): string => Buffer.from(v as Buffer).toString('utf8');

function decode(token: string) {
  const t = new AccessToken2();
  t.from_string(token);
  return t;
}

const { mintTokens } = await import('../src/routes/tokens.ts');

let pass = 0;
const test = (name: string, fn: () => void) => {
  try { fn(); pass += 1; console.log(`  ok  ${name}`); }
  catch (e) { console.log(`  FAIL ${name}: ${(e as Error).message}`); process.exitCode = 1; }
};

const CHANNEL = 'echosphere-abcd1234';
const UID = '45231';

test('RTC token embeds the exact channel it was minted for', () => {
  const rtc = decode(mintTokens(CHANNEL, UID).rtcToken);
  assert.equal(buf(rtc.services[RTC_SERVICE].__channel_name), CHANNEL);
});

test('RTC token embeds the joining uid, stringified — the builder/join-type contract', () => {
  // The browser joins with Number(uid); Agora compares the join uid to the
  // token's uid field as a string. If these ever disagree, RTC join fails.
  const rtc = decode(mintTokens(CHANNEL, UID).rtcToken);
  assert.equal(buf(rtc.services[RTC_SERVICE].__uid), UID);
});

test('RTC token carries publisher privileges (join + publish audio/video/data)', () => {
  const rtc = decode(mintTokens(CHANNEL, UID).rtcToken);
  const privs = Object.keys(rtc.services[RTC_SERVICE].__privileges).sort();
  assert.deepEqual(privs, ['1', '2', '3', '4']);
});

test('RTM token is a distinct token bound to the same uid', () => {
  const { rtcToken, rtmToken } = mintTokens(CHANNEL, UID);
  assert.notEqual(rtcToken, rtmToken);
  const rtm = decode(rtmToken);
  assert.ok(rtm.services[RTM_SERVICE], 'RTM token has no RTM service');
  assert.equal(buf(rtm.services[RTM_SERVICE].__user_id), UID);
});

test('a numeric-string uid and its Number() form mint the same RTC uid field', () => {
  const a = decode(mintTokens(CHANNEL, '900123').rtcToken);
  const b = decode(mintTokens(CHANNEL, String(Number('900123'))).rtcToken);
  assert.equal(buf(a.services[RTC_SERVICE].__uid), buf(b.services[RTC_SERVICE].__uid));
});

console.log(`\n${pass} passing`);
