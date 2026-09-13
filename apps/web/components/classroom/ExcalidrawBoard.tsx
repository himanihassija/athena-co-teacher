/**
 * The shared drawing surface.
 *
 * Excalidraw's open-source package is a *local* canvas — its docs are explicit
 * that multiplayer is not included and the host owns the transport. So sync
 * runs over the same SSE bus everything else uses: local edits are throttled
 * and POSTed, the orchestrator merges them into the authoritative scene and
 * rebroadcasts, and remote edits arrive back through `updateScene`.
 *
 * Two things that are easy to get wrong and are handled deliberately:
 *
 *  - `onChange` fires on every pointer move. Posting each one would saturate
 *    the bus, so edits are throttled and only genuinely changed elements are
 *    sent, compared by Excalidraw's own `version` counter.
 *  - Applying a remote scene re-triggers `onChange`. Without a guard that would
 *    echo straight back to the server as a fresh local edit, so writes are
 *    suppressed while a remote update is being applied.
 *  - A scene is not just elements. Excalidraw keeps the bytes of an inserted
 *    image in a separate `files` map and leaves the element holding only a
 *    `fileId`, so elements-only sync hands the far side a picture frame with no
 *    picture in it. Files travel alongside, on their own schedule — see the
 *    flush loop.
 */

'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { BoardElement, BoardFile } from '@echosphere/shared-types';

// Excalidraw ships its stylesheet separately and renders unstyled without it —
// icons at natural SVG size, toolbar labels as loose text, no layout. Imported
// here rather than in globals.css so it loads with the lazy chunk instead of on
// every page.
import '@excalidraw/excalidraw/index.css';

/** Roughly ten posts a second: smooth to watch, ~40x less traffic than raw. */
const SYNC_INTERVAL_MS = 100;

export interface ExcalidrawBoardProps {
  /** The scene as the orchestrator currently holds it. */
  scene: BoardElement[];
  /** Bytes for the `image` elements in `scene`, keyed by their `fileId`. */
  files: BoardFile[];
  /** False for students, who watch rather than draw. */
  canDraw: boolean;
  onSceneChange: (elements: BoardElement[], files: BoardFile[]) => void;
}

/**
 * What a watching canvas is allowed to be shown.
 *
 * Excalidraw decides once, on first sight of an element id, whether an
 * `embeddable`'s link is one it will render, and caches that answer for the
 * life of the canvas — the guard is `has(element.id)`, so it never looks at the
 * link again, and there is no public API to clear it. The only thing that
 * overwrites a cached "no" is the link editor popup, which runs solely in the
 * browser where a human typed the URL.
 *
 * That is a problem here because the Web Embed tool creates the element the
 * moment the box is dragged out, before any URL exists, and this board puts
 * every intermediate state on the wire within 100ms. A student met the element
 * as `link: null`, recorded "not embeddable" against its id, and went on
 * drawing an empty outlined box for the rest of the lesson — while the teacher,
 * whose link editor set the flag directly, watched the video.
 *
 * Withholding a half-built embed until it carries a link makes the viewer's
 * first sight of it the finished element, which is the one thing Excalidraw
 * will act on. Viewers only: the teacher is the one authoring that box and has
 * to see it while it is still empty.
 */
function viewable(scene: BoardElement[], canDraw: boolean): BoardElement[] {
  if (canDraw) return scene;
  return scene.filter((el) => el.type !== 'embeddable' || Boolean(el.link));
}

/** Excalidraw wants its files as a map keyed by id; the wire carries a list. */
function filesRecord(files: BoardFile[]): Record<string, BoardFile> {
  return Object.fromEntries(files.map((f) => [f.id, f]));
}

/**
 * The bytes behind image elements now on the canvas that have not been sent.
 *
 * Driven off the live scene rather than the outgoing element batch, because the
 * two are not in step: Excalidraw creates an `image` element immediately and
 * fills in its file once the read finishes, so at the moment the element is
 * posted the bytes may not exist yet, and nothing guarantees the element
 * changes again once they do.
 */
function unsentFiles(
  elements: readonly BoardElement[],
  files: Record<string, BoardFile>,
  sent: Set<string>,
): BoardFile[] {
  const out: BoardFile[] = [];
  const seen = new Set<string>();
  for (const el of elements) {
    const fileId = (el as { fileId?: string }).fileId;
    if (!fileId || sent.has(fileId) || seen.has(fileId)) continue;
    seen.add(fileId);
    const file = files[fileId];
    if (!file?.dataURL) continue;
    out.push({
      id: file.id,
      dataURL: file.dataURL,
      mimeType: file.mimeType,
      created: file.created,
    });
  }
  return out;
}

export function ExcalidrawBoard({ scene, files, canDraw, onSceneChange }: ExcalidrawBoardProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Excalidraw's API type is not exported in a usable form.
  const apiRef = useRef<any>(null);

  /**
   * The canvas API itself, held as state rather than only in the ref.
   *
   * The effect that paints a remote scene has to run again whenever the canvas
   * changes, and there are two ways it can. Excalidraw is loaded lazily and
   * hands its API over after mount, so a board that already had content when
   * this first rendered ran that effect against a null API and bailed. And the
   * component can mount more than once — StrictMode does it in development,
   * and the lazy chunk resolving does it in any build — each time producing a
   * brand new, empty canvas.
   *
   * Tracking a boolean "ready" flag covered only the first case: on a remount
   * the flag was already true, so nothing re-ran and the fresh canvas was
   * never given the scene. Anyone joining a lesson in progress sat looking at
   * a blank board while the teacher, holding the elements locally, saw the
   * drawing. Keying on the API object means a new canvas is a new value, and
   * the scene is painted onto it.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see apiRef.
  const [api, setApi] = useState<any>(null);

  /**
   * Whatever the board already held when this mounted, captured once. Read
   * through a state initialiser rather than a ref, because reading a ref
   * during render is impure.
   */
  const [initialElements] = useState(() => viewable(scene, canDraw));
  const [initialFiles] = useState(() => filesRecord(files));
  const applyingRemote = useRef(false);
  /**
   * True between pointer-down and pointer-up. Applying a remote scene mid-drag
   * replaces the element currently under the pointer with an older copy, which
   * truncates the stroke. Remote work is not lost: the scene prop is applied on
   * the next change once the pointer is up.
   */
  const drawing = useRef(false);
  const missedRemote = useRef(false);
  const lastSentVersions = useRef(new Map<string, number>());
  /**
   * Keyed by element id so a second change to the same element within one
   * window replaces it rather than the batch being overwritten wholesale.
   * Overwriting lost edits silently: the version was already recorded as sent,
   * so the dropped element was never retried.
   */
  const pending = useRef(new Map<string, BoardElement>());
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  /**
   * The local canvas as `onChange` last reported it, elements and files.
   *
   * The flush loop needs both, and it cannot work from the element batch alone:
   * an `image` element is created and posted while its bytes are still being
   * read off disk, so at the moment its version changes there is nothing to
   * send, and there is no promise the version will change again afterwards.
   * Checking the live scene each tick instead means the bytes go out on the
   * first tick after they exist, whatever the element did.
   */
  const localElements = useRef<readonly BoardElement[]>([]);
  const localFiles = useRef<Record<string, BoardFile>>({});
  /** File ids already on the wire. A file never changes, so once is enough. */
  const sentFileIds = useRef(new Set<string>());
  /** File ids already handed to this canvas, to keep `addFiles` off the hot path. */
  const appliedFileIds = useRef(new Set<string>());

  // Latest scene, readable from callbacks without making them depend on it.
  const sceneRef = useRef(viewable(scene, canDraw));
  useEffect(() => {
    sceneRef.current = viewable(scene, canDraw);
  }, [scene, canDraw]);

  const onSceneChangeRef = useRef(onSceneChange);
  useEffect(() => {
    onSceneChangeRef.current = onSceneChange;
  }, [onSceneChange]);

  // Flush on an interval rather than per change: a single stroke is hundreds of
  // change events, and only the latest state of each element matters.
  useEffect(() => {
    timer.current = setInterval(() => {
      const files = unsentFiles(
        localElements.current,
        localFiles.current,
        sentFileIds.current,
      );
      if (pending.current.size === 0 && files.length === 0) return;
      const batch = [...pending.current.values()];
      pending.current = new Map();
      // Recorded as sent only once it actually goes out.
      for (const el of batch) lastSentVersions.current.set(el.id, el.version);
      for (const file of files) sentFileIds.current.add(file.id);
      onSceneChangeRef.current(batch, files);
    }, SYNC_INTERVAL_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  const handlePointerDown = useCallback(() => {
    drawing.current = true;
  }, []);

  const handlePointerUp = useCallback(() => {
    drawing.current = false;
    // Apply whatever arrived while the pointer was down.
    if (missedRemote.current && apiRef.current) {
      missedRemote.current = false;
      applyingRemote.current = true;
      apiRef.current.updateScene({ elements: sceneRef.current });
      requestAnimationFrame(() => {
        applyingRemote.current = false;
      });
    }
  }, []);

  // Excalidraw's third argument is the scene's binary files. Reading only the
  // first is what left every shared photo as a grey placeholder.
  const handleChange = useCallback((
    elements: readonly unknown[],
    _appState: unknown,
    files: Record<string, BoardFile> | undefined,
  ) => {
    if (applyingRemote.current || !canDraw) return;
    localElements.current = elements as readonly BoardElement[];
    if (files) localFiles.current = files;
    const changed: BoardElement[] = [];
    for (const raw of elements) {
      const el = raw as BoardElement;
      const sent = lastSentVersions.current.get(el.id);
      const queued = pending.current.get(el.id)?.version;
      if (sent !== el.version && queued !== el.version) changed.push(el);
    }
    for (const el of changed) pending.current.set(el.id, el);
  }, [canDraw]);

  // Remote scene in. Guarded so the resulting onChange is not echoed back.
  // Re-runs when the API arrives, so a scene that predates the canvas is not
  // stranded.
  useEffect(() => {
    if (!api) return;
    if (drawing.current) {
      missedRemote.current = true;
      return;
    }
    const visible = viewable(scene, canDraw);
    applyingRemote.current = true;
    try {
      // Bytes first: an image element whose file is missing is drawn as a grey
      // placeholder, and `addFiles` is what clears that. It is idempotent and
      // skips ids the canvas already holds, but the set keeps a scene tick from
      // walking every file on the board.
      const incoming = files.filter((f) => !appliedFileIds.current.has(f.id));
      if (incoming.length > 0) {
        for (const f of incoming) appliedFileIds.current.add(f.id);
        api.addFiles(incoming);
      }
      api.updateScene({ elements: visible });
      for (const el of scene) lastSentVersions.current.set(el.id, el.version);

      // A scene that lands while Excalidraw is still initialising is applied
      // and then overwritten by the empty default it finishes loading. Content
      // present at mount is handed over as `initialData`; this covers the
      // remaining sliver where it arrives just after. Only for viewers, whose
      // canvas should always be exactly the shared scene — re-asserting it for
      // someone who can draw would undo their own deletions.
      if (!canDraw && visible.length > 0) {
        requestAnimationFrame(() => {
          const live = api.getSceneElements?.() ?? [];
          if (live.length >= visible.length) return;
          applyingRemote.current = true;
          api.updateScene({ elements: sceneRef.current });
          requestAnimationFrame(() => {
            applyingRemote.current = false;
          });
        });
      }
    } finally {
      // Cleared after paint, since updateScene's onChange is not synchronous.
      requestAnimationFrame(() => {
        applyingRemote.current = false;
      });
    }
  }, [scene, files, api, canDraw]);

  return (
    <div className="absolute inset-0">
      <ExcalidrawCanvas
        apiRef={apiRef}
        onReady={setApi}
        initialElements={initialElements}
        initialFiles={initialFiles}
        canDraw={canDraw}
        onChange={handleChange}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
      />
    </div>
  );
}

/**
 * Loaded lazily: Excalidraw touches `window` at module scope, so importing it
 * into a page would break server rendering — the same reason ClassroomAudio is
 * lazy.
 */
const Excalidraw = dynamic(
  () => import('@excalidraw/excalidraw').then((m) => m.Excalidraw),
  { ssr: false, loading: () => <BoardLoading /> },
);

function ExcalidrawCanvas({
  apiRef,
  onReady,
  initialElements,
  initialFiles,
  canDraw,
  onChange,
  onPointerDown,
  onPointerUp,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above.
  apiRef: React.MutableRefObject<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see apiRef.
  onReady: (api: any) => void;
  initialElements: BoardElement[];
  initialFiles: Record<string, BoardFile>;
  canDraw: boolean;
  onChange: (
    elements: readonly unknown[],
    appState: unknown,
    files: Record<string, BoardFile> | undefined,
  ) => void;
  onPointerDown: () => void;
  onPointerUp: () => void;
}) {
  return (
    <Excalidraw
      /**
       * The scene the board already had, handed over at construction.
       *
       * Excalidraw gives out its API before it has finished loading its own
       * initial scene, so a scene pushed in through `updateScene` during that
       * window was applied and then overwritten by the empty default it
       * finishes initialising with — the element was accepted, the canvas
       * ended up blank, and nothing re-ran because neither the scene nor the
       * API had changed. Anything arriving later still goes through
       * `updateScene`; this covers content that was already there.
       */
      initialData={{
        elements: initialElements as never,
        // Handed over with the elements, so a student joining a lesson that
        // already has a photo on the board sees the photo and not a placeholder.
        files: initialFiles as never,
        // A late joiner's viewport is wherever Excalidraw starts, which need
        // not be where the writing is.
        scrollToContent: true,
      }}
      excalidrawAPI={(api: unknown) => {
        apiRef.current = api;
        onReady(api);
      }}
      onChange={onChange}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      viewModeEnabled={!canDraw}
      UIOptions={{
        canvasActions: {
          // The room is the sharing mechanism; per-user export and live
          // collaboration would be a second, competing sync.
          saveToActiveFile: false,
          loadScene: false,
          export: false,
          saveAsImage: canDraw,
        },
      }}
    />
  );
}

function BoardLoading() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-[var(--eco-cream-faint)]">
      Loading the board…
    </div>
  );
}
