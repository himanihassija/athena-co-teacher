/**
 * Self-echo filtering — protects against Athena's own TTS being picked back up
 * by an open mic and misread as a human turn.
 *
 * This matters for exactly the setup the plan assumes is common: a teacher and
 * students in the same physical room on laptop speakers rather than headphones.
 * Athena's voice comes out of a speaker, a nearby mic picks it up, Deepgram
 * transcribes it, and without this it arrives at `ingestTranscript` looking
 * exactly like a student said it — which can misfire the gap detector, or worse,
 * coincidentally contain her own name and cause her to answer herself.
 *
 * Ported from the pattern in a sibling Agora ConvoAI project (a game-show host
 * whose TTS leaks into three open contestant mics for the same physical reason),
 * adapted to this project's session-scoped, in-memory state rather than a
 * global keyed store — this project already threads `ClassroomSession` through
 * every call, so there is no need to key by an external room code.
 *
 * The core lesson carried over from that project's own bug history: a boolean
 * "is this an echo" is not enough. A mixed turn — the echo captured mid-sentence
 * while a student answers over it — contains both, and discarding the whole
 * turn throws the real answer away with the echo. So this returns the
 * *remainder* after subtracting whatever matches recent agent speech, not a
 * yes/no.
 */

import type { ClassroomSession } from '../state/sessionRegistry.js';

/** How long a spoken line is considered "recent enough to echo". */
const ECHO_WINDOW_MS = 10_000;

/** Below this, a string is too short to match reliably — treat it as real speech. */
const MIN_MATCH_LENGTH = 6;

/**
 * Below this, discarding an ENTIRE turn as echo is not safe.
 *
 * `MIN_MATCH_LENGTH` governs whether a string is worth comparing at all. This
 * governs the much stronger claim that a turn is *entirely* Athena's voice and
 * should be thrown away. Six characters of overlap is "yes", "four",
 * "option b", "a common denominator" — the exact shape of a student answering a
 * question, and every one of those is a literal substring of something she said
 * moments earlier. Six of nine realistic student answers were being destroyed
 * this way, and because the drop happens before the wake-phrase check, she did
 * not hear them either.
 *
 * A partial cut is still allowed below this length; only the all-or-nothing
 * drop is gated.
 */
const MIN_WHOLE_TURN_DROP_LENGTH = 25;

/** Trigram similarity above this counts as the same utterance, ASR noise and all. */
const FUZZY_MATCH_THRESHOLD = 0.6;

interface RecentUtterance {
  text: string;
  at: number;
}

const recentAgentSpeech = new WeakMap<ClassroomSession, RecentUtterance[]>();

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function trigrams(text: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < text.length - 2; i += 1) out.add(text.slice(i, i + 3));
  return out;
}

function trigramSimilarity(a: string, b: string): number {
  const setA = trigrams(a);
  const setB = trigrams(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  for (const g of setA) if (setB.has(g)) shared += 1;
  // Union, not min. Dividing by the SMALLER set makes this a containment ratio
  // rather than a similarity: every trigram of a four-word student answer can
  // appear somewhere in a long agent sentence and score a clean 1.0, which is
  // how "the answer is four" was classified as Athena's own voice. Jaccard
  // requires the two utterances to be comparable in SIZE as well as
  // overlapping, which is what "this is the same sentence" actually means. A
  // genuine echo still scores near 1.0, so FUZZY_MATCH_THRESHOLD is unchanged.
  return shared / (setA.size + setB.size - shared);
}

/**
 * Records something Athena just said, so a later human turn can be checked
 * against it. `now` is injectable so tests can prove the window expiry
 * without a real 10-second sleep — production callers never pass it.
 */
export function rememberAgentUtterance(
  session: ClassroomSession,
  text: string,
  now: number = Date.now(),
): void {
  if (!text.trim()) return;
  const list = (recentAgentSpeech.get(session) ?? []).filter(
    (u) => u.at > now - ECHO_WINDOW_MS,
  );
  list.push({ text, at: now });
  recentAgentSpeech.set(session, list);
}

function recent(session: ClassroomSession, now: number): RecentUtterance[] {
  return (recentAgentSpeech.get(session) ?? []).filter(
    (u) => u.at > now - ECHO_WINDOW_MS,
  );
}

/**
 * Cuts the span matching `needle` out of `haystack`, working token-by-token so
 * punctuation and whitespace differences between the two don't break the match.
 * Returns the original string unchanged if no matching span is found.
 */
function cutSpan(haystack: string, needle: string): string {
  const tokens = haystack.split(/\s+/).filter(Boolean);
  const words = tokens
    .map((t, i) => ({ i, n: normalise(t) }))
    .filter((w) => w.n.length > 0);
  const target = normalise(needle);
  if (!target) return haystack;

  for (let from = 0; from < words.length; from += 1) {
    let joined = '';
    for (let to = from; to < words.length; to += 1) {
      const word = words[to];
      if (!word) break;
      joined = joined ? `${joined} ${word.n}` : word.n;
      if (joined === target) {
        const cutFrom = words[from]?.i ?? from;
        const cutTo = word.i;
        const rest = [...tokens.slice(0, cutFrom), ...tokens.slice(cutTo + 1)];
        return rest.join(' ');
      }
      if (joined.length > target.length) break;
    }
  }
  return haystack;
}

/**
 * Removes whatever part of `transcript` matches something Athena recently said,
 * and returns what's left.
 *
 * Returns the empty string when the whole turn was echo. A caller should treat
 * that exactly like "drop this turn" — but unlike a plain boolean check, a
 * *partial* match here still returns the real remainder, so a student's answer
 * spoken over the tail end of Athena's sentence is not thrown away with it.
 */
export function stripSelfEcho(
  session: ClassroomSession,
  transcript: string,
  now: number = Date.now(),
  /**
   * Whether the agent's audio was actually playing into the room when this turn
   * arrived.
   *
   * When it was, a short turn matching her words is far more likely to be her
   * own voice through an open mic than a student speaking — most sharply while
   * she reads four quiz options aloud, where "Option B five" is literally her
   * sentence. So the whole-turn drop stays aggressive there.
   *
   * When it was not, that same short turn is the ordinary shape of a student
   * answering a question, and dropping it is the bug
   * MIN_WHOLE_TURN_DROP_LENGTH exists to stop.
   */
  agentSpeaking = false,
): string {
  const raw = transcript.trim();
  if (!raw) return '';

  const normalised = normalise(raw);
  if (normalised.length < MIN_MATCH_LENGTH) return raw;

  let kept = raw;

  for (const utterance of recent(session, now)) {
    const a = normalise(utterance.text);
    if (a.length < MIN_MATCH_LENGTH) continue;

    const normKept = normalise(kept);
    if (normKept.length === 0) return '';

    // Only a substantial turn may be discarded outright as echo; see
    // MIN_WHOLE_TURN_DROP_LENGTH. A short one is far more likely to be a
    // student answering in her vocabulary than her own voice coming back.
    const dropWholeTurnAllowed =
      agentSpeaking || normKept.length >= MIN_WHOLE_TURN_DROP_LENGTH;

    // Whole-turn match: nothing left but echo, or the echo swallows the turn.
    if (a.includes(normKept)) {
      if (dropWholeTurnAllowed) return '';
      continue;
    }
    if (normKept.includes(a)) {
      kept = cutSpan(kept, a);
      continue;
    }
    // Fuzzy whole-turn match: ASR mangled the echo enough that no exact span
    // exists, so there is nothing left to salvage either.
    if (
      dropWholeTurnAllowed &&
      trigramSimilarity(a, normKept) > FUZZY_MATCH_THRESHOLD
    ) {
      return '';
    }
  }

  // Punctuation debris left behind where a matched span used to be.
  const cleaned = kept.replace(/\s{2,}/g, ' ').replace(/^[\s,.!?-]+|[\s,]+$/g, '');

  // A cleaned remainder with no letters in it is just punctuation noise, not a
  // real (if short) answer — drop it rather than log an empty-looking turn.
  return /\p{L}/u.test(cleaned) ? cleaned : '';
}

/** Drops a finished session's echo-tracking state. */
export function clearEchoTracking(session: ClassroomSession): void {
  recentAgentSpeech.delete(session);
}
