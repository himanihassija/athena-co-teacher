/**
 * One Excalidraw scene element. Deliberately opaque: Excalidraw owns this
 * shape, it changes between versions, and the orchestrator only ever stores
 * and rebroadcasts it. `id` and `version` are the two fields we rely on —
 * `version` is how Excalidraw itself orders edits to the same element.
 */
export interface BoardElement {
  id: string;
  version: number;
  [key: string]: unknown;
}

/**
 * One binary an Excalidraw scene refers to — in practice an inserted image.
 *
 * Excalidraw deliberately splits a scene in two: `elements` carry geometry, and
 * an `image` element holds only a `fileId` pointing into a separate map of
 * bytes. Sync that carries elements alone therefore delivers a picture frame
 * with no picture in it, which is exactly what a student used to see. Shaped to
 * match Excalidraw's own `BinaryFileData` so it can be handed straight to
 * `addFiles` on the far side.
 */
export interface BoardFile {
  id: string;
  /** The image itself, base64 in a `data:` URL, as Excalidraw stores it. */
  dataURL: string;
  mimeType: string;
  created: number;
}

/** Who, if anyone, is currently presenting the board to the room. */
export interface ActiveWhiteboard {
  participantId: string;
  displayName: string;
}

/** A spoken note pinned on the classroom board (teacher or Athena). */
export interface WhiteboardCard {
  id: string;
  text: string;
  at: number;
  source: 'teacher' | 'athena';
}

export type WhiteboardAction = 'show' | 'hide' | 'write' | 'clear';

export interface WhiteboardCommand {
  action: WhiteboardAction;
  text?: string;
  source: WhiteboardCard['source'];
  at: number;
}

/** Public state for the shared local board. */
export interface WhiteboardPublicState {
  open: boolean;
  /** Set while the board is being presented to the room, like a screen share. */
  presenting: ActiveWhiteboard | null;
  /** The shared drawing. Authoritative copy lives in the orchestrator. */
  scene: BoardElement[];
  /** Bytes for the `image` elements in `scene`, keyed by their `fileId`. */
  files: BoardFile[];
  cards: WhiteboardCard[];
}

/** Per-participant state for the local board. */
export interface WhiteboardJoin {
  open: boolean;
  uid: string;
  writable: boolean;
  cards: WhiteboardCard[];
}
