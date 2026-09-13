/**
 * Assigns every participant a stable, persistent color — one CSS custom
 * property per seat, from the `--eco-seat-*` set in globals.css.
 *
 * The idea is borrowed directly from a sibling Agora ConvoAI project (a
 * game show that gives each of its three contestants a "seat color" so a
 * fast-moving transcript never depends on reading a name). This project's
 * roster is unbounded rather than fixed at three, so the assignment here is a
 * deterministic hash rather than a literal seat index — the same
 * participantId always lands on the same color within one classroom, without
 * the server needing to hand out or track seat numbers.
 */

const SEAT_COUNT = 4;

/** `--eco-seat-1` through `--eco-seat-4` (teal / amber / rose / violet), defined in app/globals.css. */
export function seatColorVar(participantId: string): string {
  let hash = 0;
  for (let i = 0; i < participantId.length; i += 1) {
    hash = (hash * 31 + participantId.charCodeAt(i)) >>> 0;
  }
  const seat = (hash % SEAT_COUNT) + 1;
  return `var(--eco-seat-${seat})`;
}
