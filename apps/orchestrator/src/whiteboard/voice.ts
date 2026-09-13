import type { WhiteboardAction } from '@echosphere/shared-types';

export interface ParsedBoardSpeech {
  action: WhiteboardAction;
  text?: string;
}

/**
 * Maps a finished human utterance onto a board command.
 *
 * Conservative: only fires when the speaker clearly mentioned the board, or
 * used an explicit "write/put/show … on the board" pattern. Ordinary lesson
 * talk must not flood the board.
 */
/**
 * Words a speaker uses to mean "put this on the board".
 *
 * "right" is here because speech recognition returns it for "write" — that is
 * what happened in the session this was rewritten for. It is only ever treated
 * as a command when immediately followed by a board phrase, so "Right, so the
 * denominator stays the same" is untouched.
 */
const WRITE_VERB = String.raw`(?:write|right|put|show|display|pin|note|jot)`;
const BOARD = String.raw`(?:the\s+)?(?:white\s*)?board`;

/** Bare pointers are not content — "write this on the board" said nothing. */
const DEMONSTRATIVE = /^(?:this|that|it|these|those|them)\b[\s.,!?]*$/i;

export function parseVoiceBoardCommand(text: string): ParsedBoardSpeech | null {
  const raw = text.trim();
  if (raw.length === 0) return null;
  const lower = raw.toLowerCase();

  if (
    /\b(clear|erase|wipe|reset)\b.{0,24}\b(board|whiteboard)\b/.test(lower) ||
    /\b(board|whiteboard)\b.{0,16}\b(clear|erase|wipe)\b/.test(lower)
  ) {
    return { action: 'clear' };
  }

  if (/\b(hide|close|put away)\b.{0,16}\b(board|whiteboard)\b/.test(lower)) {
    return { action: 'hide' };
  }

  // Content BEFORE the board phrase: "write X on the board".
  const before = raw.match(
    new RegExp(String.raw`${WRITE_VERB}\s+(.+?)\s+on\s+${BOARD}\b`, 'i'),
  );
  if (before?.[1]) return writeOrNull(before[1]);

  // Content AFTER it, either trailing the same sentence or opening the next —
  // "write on the whiteboard two plus two", "Write on the board. Two plus two".
  // This is how people actually dictate, and the original pattern missed it.
  const after = raw.match(
    new RegExp(String.raw`${WRITE_VERB}\s+(?:it\s+)?on\s+${BOARD}\b[\s.,:;-]*(.*)`, 'i'),
  );
  if (after) return writeOrNull(after[1] ?? '');

  // "on the board, write X"
  const leading = raw.match(
    new RegExp(String.raw`on\s+${BOARD}\b[,:]?\s*${WRITE_VERB}\s+(.+)`, 'i'),
  );
  if (leading?.[1]) return writeOrNull(leading[1]);

  // Only a bare "show the board" with no content is a show.
  if (
    /\b(show|open|bring up|display)\b.{0,20}\b(the )?(white)?board\b/.test(lower) &&
    !/\bon (the )?(white)?board\b/.test(lower)
  ) {
    return { action: 'show' };
  }

  return null;
}

/** A write is only a write if something was actually dictated. */
function writeOrNull(candidate: string): ParsedBoardSpeech | null {
  const text = cleanBoardText(candidate);
  if (text.length === 0 || DEMONSTRATIVE.test(text)) return null;
  return { action: 'write', text };
}


function cleanBoardText(text: string): string {
  return text
    .replace(/\b(please|athena|adena|athina)\b/gi, ' ')
    .replace(/[.?!,;:]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
