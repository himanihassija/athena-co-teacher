import { randomUUID } from 'node:crypto';
import type {
  WhiteboardCard,
  WhiteboardCommand,
  WhiteboardJoin,
  WhiteboardPublicState,
} from '@echosphere/shared-types';
import { publish } from '../state/eventBus.js';
import type { BoardElement, BoardFile } from '@echosphere/shared-types';
import type { ClassroomSession } from '../state/sessionRegistry.js';

export function publicWhiteboard(session: ClassroomSession): WhiteboardPublicState {
  const board = session.whiteboard;
  return {
    open: board.open,
    presenting: board.presenting,
    scene: board.scene,
    files: board.files,
    cards: board.cards,
  };
}

export function broadcastWhiteboard(session: ClassroomSession): void {
  publish(session.sessionId, {
    kind: 'echosphere:whiteboard',
    board: publicWhiteboard(session),
  });
}

/**
 * Opens the local Excalidraw board for the room. No separate Agora
 * Interactive Whiteboard room or credential is needed.
 */
export async function openWhiteboard(session: ClassroomSession): Promise<void> {
  session.whiteboard.open = true;
  broadcastWhiteboard(session);
}

export function applyBoardCommand(
  session: ClassroomSession,
  command: Omit<WhiteboardCommand, 'at'> & { at?: number },
): void {
  const at = command.at ?? Date.now();
  const full: WhiteboardCommand = { ...command, at };

  if (full.action === 'show') {
    session.whiteboard.open = true;
  } else if (full.action === 'hide') {
    session.whiteboard.open = false;
  } else if (full.action === 'clear') {
    session.whiteboard.cards = [];
    session.whiteboard.scene = [];
    session.whiteboard.files = [];
    session.whiteboard.open = true;
    publish(session.sessionId, {
      kind: 'echosphere:whiteboard-scene',
      elements: [],
      by: full.source,
    });
  } else if (full.action === 'write') {
    const text = full.text?.trim();
    if (!text) return;
    session.whiteboard.open = true;
    const card: WhiteboardCard = {
      id: randomUUID(),
      text,
      at,
      source: full.source,
    };
    session.whiteboard.cards = [...session.whiteboard.cards, card].slice(-12);

    // Also written onto the shared canvas, so her line is a real object the
    // teacher can move or annotate rather than a separate overlay.
    const element = athenaTextElement(session, text);
    mergeSceneElements(session, [element]);
    publish(session.sessionId, {
      kind: 'echosphere:whiteboard-scene',
      elements: [element],
      by: full.source,
    });
  }

  publish(session.sessionId, { kind: 'echosphere:whiteboard-command', command: full });
  broadcastWhiteboard(session);
}

export async function joinPayload(
  session: ClassroomSession,
  uid: string,
  writable: boolean,
): Promise<WhiteboardJoin> {
  const publicState = publicWhiteboard(session);
  return {
    ...publicState,
    uid,
    writable,
  };
}

/**
 * Folds incoming drawing changes into the authoritative scene.
 *
 * Per element, keyed on `id`, keeping whichever carries the higher `version` —
 * the counter Excalidraw itself bumps on every edit. Replacing the whole scene
 * instead would mean a client that posted a stale copy silently erased edits it
 * had not seen yet; merging by version cannot do that.
 *
 * Deletions arrive as elements flagged `isDeleted`, so they merge like any
 * other change rather than needing a separate path.
 */
export function mergeSceneElements(
  session: ClassroomSession,
  incoming: BoardElement[],
): void {
  const byId = new Map<string, BoardElement>(
    session.whiteboard.scene.map((el) => [el.id, el]),
  );
  for (const el of incoming) {
    const existing = byId.get(el.id);
    if (!existing || el.version >= existing.version) byId.set(el.id, el);
  }
  session.whiteboard.scene = [...byId.values()];
}

/**
 * A single image, in bytes. Big enough for a photo off a phone, small enough
 * that one paste cannot exhaust the orchestrator's memory.
 */
const MAX_FILE_BYTES = 6 * 1024 * 1024;

/** Ceiling on everything the board is holding, across all its images. */
const MAX_TOTAL_FILE_BYTES = 30 * 1024 * 1024;

/**
 * Folds newly referenced image bytes into the board.
 *
 * Files are immutable once created — Excalidraw mints a fresh `fileId` for a
 * fresh insert — so unlike elements there is no version to reconcile: the first
 * copy of an id wins and later ones are ignored. Returns only the files that
 * were actually new, since those are the ones worth putting on the bus; the
 * rest every client already has.
 */
export function mergeSceneFiles(
  session: ClassroomSession,
  incoming: BoardFile[],
): BoardFile[] {
  const known = new Set(session.whiteboard.files.map((f) => f.id));
  let total = session.whiteboard.files.reduce((n, f) => n + f.dataURL.length, 0);
  const added: BoardFile[] = [];

  for (const file of incoming) {
    if (known.has(file.id)) continue;
    if (file.dataURL.length > MAX_FILE_BYTES) continue;
    if (total + file.dataURL.length > MAX_TOTAL_FILE_BYTES) break;
    known.add(file.id);
    total += file.dataURL.length;
    added.push(file);
  }

  if (added.length > 0) {
    session.whiteboard.files = [...session.whiteboard.files, ...added];
  }
  return added;
}

/**
 * Turns one of Athena's board lines into an Excalidraw text element.
 *
 * Written straight into the shared scene rather than kept as a separate card
 * layer, so her writing and the teacher's drawing are the same object graph —
 * the teacher can move, erase or annotate around what she wrote.
 *
 * Lines stack down the left margin. Excalidraw needs the geometry up front, so
 * width is estimated from the character count; it only affects the selection
 * box, since the text itself lays out from `fontSize`.
 */
export function athenaTextElement(
  session: ClassroomSession,
  text: string,
): BoardElement {
  const written = session.whiteboard.scene.filter(
    (el) => (el as { athena?: boolean }).athena,
  ).length;
  const fontSize = 20;

  return {
    id: `athena-${randomUUID().slice(0, 8)}`,
    version: 1,
    type: 'text',
    x: 40,
    y: 40 + written * (fontSize * 2),
    width: Math.max(120, text.length * fontSize * 0.55),
    height: fontSize * 1.25,
    text,
    originalText: text,
    fontSize,
    fontFamily: 1,
    textAlign: 'left',
    verticalAlign: 'top',
    strokeColor: '#1e1e1e',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 1,
    strokeStyle: 'solid',
    roughness: 0,
    opacity: 100,
    angle: 0,
    seed: Math.floor(Math.random() * 2 ** 31),
    versionNonce: Math.floor(Math.random() * 2 ** 31),
    isDeleted: false,
    groupIds: [],
    frameId: null,
    roundness: null,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
    containerId: null,
    lineHeight: 1.25,
    /** Marks it as hers, so stacking only counts her own lines. */
    athena: true,
  };
}
