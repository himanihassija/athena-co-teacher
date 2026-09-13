/**
 * Reader for the agent's control channel.
 *
 * The agent appends one JSON object to each spoken turn. MiniMax
 * `skipPatterns: [5]` strips curly-brace content before speech synthesis, so
 * the object never reaches the room's ears, but the RTM transcript restores the
 * full text — which makes braces a side channel down the existing voice
 * pipeline. No second model, no classifier call, no extra API key.
 *
 * The brace-span scanner is ported from the sibling Athena project, where it is
 * covered by tests. Its central trick: walk back from the last `}` and let
 * `JSON.parse` decide which `{` opens the payload. Tracking quote state instead
 * does not work, because spoken prose in front of the object often contains an
 * unbalanced apostrophe, which flips the parity and hides the JSON.
 */

export interface QuizControl {
  topic: string;
  question: string;
  options: string[];
  /** Letter of the correct option, as the agent labelled it aloud. */
  answer: string;
  difficulty?: 'easy' | 'medium' | 'hard';
}

export interface GapControl {
  topic: string;
  /** Display names, as spelled in the roster block of the prompt. */
  students: string[];
}

/**
 * A request to draw a diagram of something on the shared board (§3.4).
 *
 * Separate from `board` rather than a fifth `BoardControl.action`, because the
 * two are not the same kind of thing. A board command is synchronous and local
 * — `applyBoardCommand` finishes before the turn is done. An illustration is a
 * round trip to Excalidraw+ that lands seconds later, so it cannot share a
 * return path, and folding it into `WhiteboardAction` would have put a value in
 * that union which `applyBoardCommand` must silently ignore.
 */
export interface IllustrateControl {
  /** What to draw, in a few words. */
  topic: string;
}

export interface BoardControl {
  action: 'show' | 'hide' | 'write' | 'clear';
  text?: string;
}

export interface LibraryControl {
  action: 'open' | 'find';
  bookId?: string;
  page?: number;
  query?: string;
}

export interface CoTeacherControl {
  /** Display name of the student being answered this turn (§3.5, §3.9). */
  to?: string;
  gap?: GapControl;
  quiz?: QuizControl;
  board?: BoardControl;
  illustrate?: IllustrateControl;
  library?: LibraryControl;
}

export interface ParsedTurn {
  /** The turn with the control object removed — safe to log and display. */
  spoken: string;
  control: CoTeacherControl | null;
}

function findControlSpan(
  text: string,
): { start: number; end: number; value: unknown } | null {
  const close = text.lastIndexOf('}');
  if (close === -1) return null;

  // Rightmost first, since the payload is the last thing in the turn.
  const opens: number[] = [];
  for (let i = close - 1; i >= 0; i -= 1) {
    if (text[i] === '{') opens.push(i);
    // One small object per turn, so don't scan the whole reply.
    if (opens.length >= 12) break;
  }

  for (const open of opens) {
    try {
      const value: unknown = JSON.parse(text.slice(open, close + 1));
      if (value && typeof value === 'object') {
        return { start: open, end: close + 1, value };
      }
    } catch {
      // Not JSON from here; try an earlier brace.
    }
  }

  return null;
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out = value.filter((v): v is string => typeof v === 'string');
  return out.length === value.length ? out : null;
}

function readQuiz(value: unknown): QuizControl | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Record<string, unknown>;
  const options = asStringArray(v.options);
  if (
    typeof v.topic !== 'string' ||
    typeof v.question !== 'string' ||
    typeof v.answer !== 'string' ||
    !options ||
    options.length < 2
  ) {
    return undefined;
  }
  const difficulty =
    v.difficulty === 'easy' || v.difficulty === 'medium' || v.difficulty === 'hard'
      ? v.difficulty
      : undefined;
  return {
    topic: v.topic,
    question: v.question,
    options,
    answer: v.answer,
    difficulty,
  };
}

function readBoard(value: unknown): BoardControl | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Record<string, unknown>;
  if (
    v.action !== 'show' &&
    v.action !== 'hide' &&
    v.action !== 'write' &&
    v.action !== 'clear'
  ) {
    return undefined;
  }
  const text = typeof v.text === 'string' ? v.text.trim() : undefined;
  if (v.action === 'write' && !text) return undefined;
  return { action: v.action, text };
}

function readIllustrate(value: unknown): IllustrateControl | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Record<string, unknown>;
  const topic = typeof v.topic === 'string' ? v.topic.trim() : '';
  // A blank topic would send an empty prompt to the diagram model and come back
  // with something arbitrary on the board, which is worse than nothing.
  if (!topic) return undefined;
  return { topic };
}

function readGap(value: unknown): GapControl | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Record<string, unknown>;
  const students = asStringArray(v.students);
  if (typeof v.topic !== 'string' || !students) return undefined;
  return { topic: v.topic, students };
}

function readLibrary(value: unknown): LibraryControl | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Record<string, unknown>;
  if (v.action !== 'open' && v.action !== 'find') return undefined;
  const bookId = typeof v.bookId === 'string' ? v.bookId.trim() : undefined;
  const page = typeof v.page === 'number' && Number.isInteger(v.page) && v.page >= 0 ? v.page : undefined;
  const query = typeof v.query === 'string' ? v.query.trim() : undefined;
  return { action: v.action, bookId, page, query };
}

/**
 * Splits an agent turn into its spoken part and its control payload.
 *
 * A malformed or partial object is dropped rather than thrown on: the cost of a
 * bad payload is a quiz card arriving a turn late, and that must never take the
 * audio path down with it.
 */
export function parseAgentTurn(text: string): ParsedTurn {
  if (!text || !text.includes('{')) return { spoken: text ?? '', control: null };

  const span = findControlSpan(text);
  if (!span) return { spoken: text, control: null };

  const raw = span.value as Record<string, unknown>;
  const control: CoTeacherControl = {};
  if (typeof raw.to === 'string' && raw.to.trim().length > 0) {
    control.to = raw.to.trim();
  }
  const gap = readGap(raw.gap);
  if (gap) control.gap = gap;
  const quiz = readQuiz(raw.quiz);
  if (quiz) control.quiz = quiz;
  const board = readBoard(raw.board);
  if (board) control.board = board;
  const illustrate = readIllustrate(raw.illustrate);
  if (illustrate) control.illustrate = illustrate;
  const library = readLibrary(raw.library);
  if (library) control.library = library;

  const spoken = (text.slice(0, span.start) + text.slice(span.end))
    .replace(/\s{2,}/g, ' ')
    .trim();

  // An empty `{}` is a valid payload — the agent sends it when nothing applies —
  // and it still means "strip these braces from the transcript".
  return { spoken, control };
}

/**
 * Resolves a display name from the control channel to a participant id.
 * The model does not always echo names exactly, so matching is case-insensitive
 * and accepts a partial match in either direction.
 */
export function matchParticipantByName(
  names: Array<{ participantId: string; displayName: string }>,
  spoken: string,
): string | undefined {
  const target = spoken.trim().toLowerCase();
  if (target.length === 0) return undefined;

  const exact = names.find((n) => n.displayName.toLowerCase() === target);
  if (exact) return exact.participantId;

  const partial = names.find(
    (n) =>
      n.displayName.toLowerCase().includes(target) ||
      target.includes(n.displayName.toLowerCase()),
  );
  return partial?.participantId;
}
