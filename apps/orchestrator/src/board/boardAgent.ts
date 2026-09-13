/**
 * Athena's "draw me a diagram" path.
 *
 * Topic in, Excalidraw elements out. Deliberately pure in that sense: this
 * module never touches the SSE bus, the session's scene, or the floor. The
 * caller (`classroomController.applyControl`) owns the merge and the broadcast,
 * which is what makes generation independently testable without standing up a
 * classroom.
 *
 * Two stages, and they use different things. Deciding *what* to draw is a
 * language problem, so it goes through `tryComplete` on whatever provider the
 * deployment has configured. Deciding *where the boxes and arrows go* is a
 * layout problem, and that is what Excalidraw+ is for — `create_diagram`
 * measures labels, routes elbow arrows and reserves room for edge labels far
 * better than geometry we would hand-roll here.
 *
 * **Why a scratch scene.** `create_diagram` writes into a scene on Excalidraw's
 * side; we read it back and copy the elements onto the classroom board. The
 * scratch scene is a workbench, not the thing students look at.
 *
 * **Why the diff.** A scratch scene is reused, so the second read returns the
 * first diagram's elements too. Copying that wholesale would re-paste every
 * earlier diagram on every request, so ids already taken from a scene are
 * remembered and only genuinely new elements are returned.
 *
 * **Why the per-session lock.** That diff is a read-modify-write against
 * remembered state; two requests in flight at once would each read the same
 * "seen" set and both claim the other's elements. Requests are serialised per
 * session instead.
 */

import type { BoardElement } from '@echosphere/shared-types';
import { config } from '../config.js';
import { tryComplete } from '../llm/complete.js';
import { excalidrawConfigured, withExcalidraw, type ToolCaller } from './excalidrawMcp.js';
import { parseDrawingShapes, renderDrawing, type DrawingShape } from './shapes.js';

/**
 * What the lesson was about when the diagram was asked for.
 *
 * Every field is optional and the whole object may be omitted: a diagram must
 * still be drawable from a bare topic, because the live script and the tests
 * call it that way.
 *
 * This exists because the spec step used to be sent the topic and nothing else
 * — `Topic: flow of synthesis` — and that is genuinely not enough information
 * to draw from. It does not say whether the synthesis is photosynthesis,
 * protein synthesis or an organic prep, and a model with no way to tell picks
 * the safest output available to it, which is to restate the phrase it was
 * given. That is the failure this is here to remove.
 */
export interface IllustrationContext {
  /** The lesson's title, the coarsest signal of what subject this is. */
  lessonTitle?: string;
  /** Classroom language, so labels are not silently drawn in English. */
  language?: string;
  /** Recent classroom speech, oldest first — what "this" and "it" refer to. */
  transcript?: string[];
  /** Excerpts from the teacher's own uploaded material, if any matched. */
  material?: string[];
}

/** Whether both halves of this feature — a model and Excalidraw+ — are present. */
export function illustrationConfigured(): boolean {
  return excalidrawConfigured();
}

interface IllustrationState {
  /** The scratch scene this session draws into, once one exists. */
  sceneId: string | null;
  /** Element ids already copied onto the classroom board from that scene. */
  seen: Set<string>;
  /** Tail of the serialisation chain, so requests queue rather than race. */
  queue: Promise<unknown>;
}

const states = new Map<string, IllustrationState>();

function stateFor(sessionId: string): IllustrationState {
  let state = states.get(sessionId);
  if (!state) {
    state = {
      sceneId: config.excalidrawScratchSceneId.trim() || null,
      seen: new Set(),
      queue: Promise.resolve(),
    };
    states.set(sessionId, state);
  }
  return state;
}

/** Drops remembered scratch-scene state. Called when a session ends. */
export function forgetIllustrations(sessionId: string): void {
  states.delete(sessionId);
}

/** One node in the diagram the model proposes. */
export interface DiagramSpec {
  title: string;
  nodes: Array<{ id: string; label: string }>;
  edges: Array<{ from: string; to: string; label?: string }>;
}

const SPEC_SYSTEM = `You turn a lesson topic into a picture for a classroom whiteboard.

First decide WHICH KIND of picture the topic needs, then reply with ONLY a JSON object — no prose, no code fence.

KIND 1 — "diagram". Boxes joined by arrows. Use for anything with structure: a process with steps, a hierarchy, a cycle, a comparison, parts making up a whole.
{"kind":"diagram","title":"...","nodes":[{"id":"n1","label":"..."}],"edges":[{"from":"n1","to":"n2","label":"..."}]}
- Between three and eight nodes. A student reads this off a shared board while a lesson continues around them, so a few clearly-labelled boxes beat a complete map of the subject.
- Labels are real words from the topic, at most four words each. Never placeholders.
- Every edge's "from" and "to" must be ids that exist in "nodes".
- "label" on an edge is optional and should be one or two words when present.
- Prefer the shape the topic actually has: a sequence for a process, a tree for a hierarchy, a cycle for something that repeats.

KIND 2 — "drawing". An actual picture, not boxes. Use when the topic IS a visual object and a flowchart would be absurd: a fraction, a proportion, a share of a whole, a quantity comparison, a position on a scale.
{"kind":"drawing","title":"...","shapes":[ ... ]}
Every shape must be one of exactly these, with exactly these fields:
- {"type":"partitioned-circle","parts":4,"shaded":3,"caption":"3/4"} — a circle cut into equal wedges, some filled. The way to draw a fraction.
- {"type":"partitioned-bar","parts":4,"shaded":3,"caption":"3/4"} — the same idea as a bar. Better when comparing two fractions: use two of these.
- {"type":"bar-chart","bars":[{"label":"Cats","value":12},{"label":"Dogs","value":7}],"caption":"..."} — comparing quantities.
- {"type":"number-line","from":0,"to":1,"step":0.25,"marks":[0.75],"caption":"..."} — a value's position on a scale.
- {"type":"note","text":"..."} — a short standalone caption beside the others.
At most four shapes. "shaded" must be between 0 and "parts".

Choosing between them:
- "how photosynthesis works", "stages of mitosis", "how a bill becomes law" -> diagram.
- "three quarters", "3/4 of a circle shaded", "which is bigger, 2/3 or 3/5", "where 0.75 sits between 0 and 1" -> drawing.
- If the topic names a thing a student would DRAW rather than a process they would follow, it is a drawing.

Whichever kind you choose: the labels and numbers must come from the topic and the lesson context you are given. Never emit the topic phrase itself as a node label — a box reading "flow of synthesis" teaches nobody anything. If the context does not tell you what the topic means, draw the most standard textbook version of it and use real domain words.`;

/**
 * Renders the lesson context as the user half of the spec request.
 *
 * Deliberately labelled section by section rather than pasted in as one blob:
 * the model has to be able to tell the teacher's own material apart from
 * whatever was last said out loud, because the two disagree often enough — a
 * class discussing an aside is not a class changing subject.
 */
export function describeContext(
  topic: string,
  context: IllustrationContext | undefined,
): string {
  const parts = [`Topic: ${topic}`];
  if (!context) return parts.join('\n');

  if (context.lessonTitle?.trim()) parts.push(`Lesson: ${context.lessonTitle.trim()}`);
  if (context.language?.trim() && context.language.trim() !== 'en') {
    parts.push(`Write every label in this language: ${context.language.trim()}`);
  }
  if (context.material?.length) {
    parts.push(`\nFrom the teacher's lesson material:\n${context.material.join('\n')}`);
  }
  if (context.transcript?.length) {
    parts.push(`\nWhat the class has just been saying:\n${context.transcript.join('\n')}`);
  }
  return parts.join('\n');
}

/**
 * Asks the model for a diagram specification.
 *
 * Exported so the parsing and validation can be tested without a model call.
 */
export function parseDiagramSpec(raw: string | null): DiagramSpec | null {
  if (!raw) return null;

  // Models fence JSON even when told not to, and some prepend a sentence.
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return null;

  let value: unknown;
  try {
    value = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;

  const nodes: DiagramSpec['nodes'] = [];
  if (!Array.isArray(record.nodes)) return null;
  // Maps the model's raw id to the sanitised one, so edges can follow it.
  const renamed = new Map<string, string>();
  for (const item of record.nodes) {
    if (!item || typeof item !== 'object') continue;
    const node = item as Record<string, unknown>;
    if (typeof node.id !== 'string' || typeof node.label !== 'string') continue;
    const raw = node.id.trim();
    const label = node.label.trim();
    if (!raw || !label) continue;
    const id = safeNodeId(raw, renamed.size);
    if (renamed.has(raw)) continue;
    renamed.set(raw, id);
    // create_diagram caps labels at 300 characters and rejects longer ones.
    nodes.push({ id, label: label.slice(0, 300) });
  }
  if (nodes.length < 2) return null;

  const ids = new Set(nodes.map((n) => n.id));
  const edges: DiagramSpec['edges'] = [];
  if (Array.isArray(record.edges)) {
    for (const item of record.edges) {
      if (!item || typeof item !== 'object') continue;
      const edge = item as Record<string, unknown>;
      if (typeof edge.from !== 'string' || typeof edge.to !== 'string') continue;
      const from = renamed.get(edge.from.trim()) ?? edge.from.trim();
      const to = renamed.get(edge.to.trim()) ?? edge.to.trim();
      // An edge to a node the model never defined would be a dangling arrow.
      if (!ids.has(from) || !ids.has(to)) continue;
      const label =
        typeof edge.label === 'string' && edge.label.trim()
          ? edge.label.trim().slice(0, 120)
          : undefined;
      edges.push({ from, to, label });
    }
  }

  const title = typeof record.title === 'string' && record.title.trim() ? record.title.trim() : 'Diagram';
  return { title, nodes, edges };
}

/**
 * What the model decided to draw: boxes and arrows, or an actual picture.
 */
export type IllustrationPlan =
  | ({ kind: 'diagram' } & DiagramSpec)
  | { kind: 'drawing'; title: string; shapes: DrawingShape[] };

/**
 * Reads whichever of the two picture kinds the model replied with.
 *
 * The drawing branch is tried first and the diagram branch is the fallback,
 * which is the safety property that matters here: a reply claiming to be a
 * drawing but carrying shapes this build does not understand is not drawn as a
 * broken picture and is not thrown away either — if it also carries usable
 * nodes it becomes a flowchart, exactly as it would have before this branch
 * existed. Nothing that worked before can start failing because of a shape name
 * that did not validate.
 */
export function parseIllustrationPlan(raw: string | null): IllustrationPlan | null {
  if (!raw) return null;

  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      const value = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
      if (value && typeof value === 'object' && value.kind === 'drawing') {
        const shapes = parseDrawingShapes(value.shapes);
        if (shapes.length > 0) {
          const title =
            typeof value.title === 'string' && value.title.trim()
              ? value.title.trim()
              : 'Drawing';
          return { kind: 'drawing', title, shapes };
        }
      }
    } catch {
      // Fall through to the diagram parser, which has its own tolerance for
      // fenced and prose-prefixed replies.
    }
  }

  const spec = parseDiagramSpec(raw);
  return spec ? { kind: 'diagram', ...spec } : null;
}

/**
 * Forces a node id into the shape `create_diagram` accepts.
 *
 * Its schema pins ids to `^[A-Za-z0-9_.:-]+$`, and a model told to invent ids
 * happily returns "water vapour" — which the tool rejects outright, losing the
 * whole diagram rather than one node. Sanitising is safe because the ids are
 * internal: only the edges reference them, and they are rewritten to match.
 */
function safeNodeId(raw: string, index: number): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_.:-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned.slice(0, 120) || `n${index + 1}`;
}

/**
 * Which step an illustrate request got to.
 *
 * This exists because the previous return type could not tell four different
 * outcomes apart. "No diagram appeared" was `[]` whether the model had never
 * answered, Excalidraw had rejected the write, or the scene read had come back
 * with nothing new — and since the only record was a `console.error`, a teacher
 * watching a board stay empty had no way to know which, or even that anything
 * had been attempted. Athena, meanwhile, had already said out loud that she was
 * drawing.
 */
export type IllustrationStage = 'spec' | 'excalidraw' | 'empty';

export type IllustrationResult =
  | { ok: true; elements: BoardElement[]; kind: 'diagram' | 'drawing'; ms: number }
  | { ok: false; stage: IllustrationStage; detail: string; ms: number };

/**
 * Generates a picture for `topic` and returns the elements to add to the board.
 *
 * Never throws and never blocks a lesson: every failure comes back as an
 * `ok: false` result naming the step that failed, and the caller decides
 * whether that is worth telling anyone about. A lesson continues without the
 * picture; it must never stop because of one.
 */
export async function generateIllustration(
  sessionId: string,
  topic: string,
  context?: IllustrationContext,
): Promise<IllustrationResult> {
  const started = Date.now();
  const clean = topic.trim();
  if (!illustrationConfigured()) {
    return { ok: false, stage: 'spec', detail: 'Excalidraw is not configured', ms: 0 };
  }
  if (!clean) {
    return { ok: false, stage: 'spec', detail: 'empty topic', ms: 0 };
  }

  const state = stateFor(sessionId);
  const run = state.queue.then(() => illustrate(state, clean, context, started));
  // The chain must survive a rejection, or one failure wedges the session.
  state.queue = run.catch(() => undefined);
  return run;
}

async function illustrate(
  state: IllustrationState,
  topic: string,
  context: IllustrationContext | undefined,
  started: number,
): Promise<IllustrationResult> {
  const since = (): number => Date.now() - started;

  const plan = parseIllustrationPlan(
    await tryComplete(
      [
        { role: 'system', content: SPEC_SYSTEM },
        { role: 'user', content: describeContext(topic, context) },
      ],
      {
        temperature: 0.3,
        maxTokens: 900,
        // Blank unless BOARD_LLM_MODEL is set, in which case this is the only
        // completion in the orchestrator that moves. See config.boardLlmModel.
        model: config.boardLlmModel.trim() || undefined,
      },
    ),
  );
  if (!plan) {
    return { ok: false, stage: 'spec', detail: 'the model did not return a usable picture', ms: since() };
  }

  const elements = await withExcalidraw(async (call) => {
    const sceneId = state.sceneId ?? (await createScratchScene(call));
    if (!sceneId) throw new Error('no scratch scene available');
    state.sceneId = sceneId;

    if (plan.kind === 'drawing') {
      // Excalidraw asks for the guide matching the task before the first write,
      // and for a freeform composition that is the freeform one rather than the
      // diagram one.
      await call('read_freeform_format', {}).catch(() => undefined);

      // `add` is a JSON array *string*, not an array — the tool's own schema
      // says so, and passing a real array is rejected.
      await call('edit_scene_content', {
        sceneId,
        add: JSON.stringify(renderDrawing(plan.shapes)),
      });
    } else {
      // Excalidraw's docs ask for the matching format guide before the first
      // scene write. It is cheap and it is what makes create_diagram's own
      // schema authoritative rather than guessed at.
      await call('read_diagram_format', {}).catch(() => undefined);

      await call('create_diagram', {
        sceneId,
        title: plan.title,
        // The classroom board is wider than it is tall, and it sits beside a
        // participant strip, so a left-to-right diagram fits without scrolling.
        direction: 'RIGHT',
        nodes: plan.nodes.map((n) => ({ id: n.id, label: n.label })),
        edges: plan.edges.map((e) => ({ from: e.from, to: e.to, label: e.label })),
      });
    }

    return findElements(await call('get_scene_content', { sceneId }));
  });

  if (!elements) {
    return {
      ok: false,
      stage: 'excalidraw',
      detail: 'Excalidraw refused the request or timed out',
      ms: since(),
    };
  }

  const fresh = elements.filter((el) => !state.seen.has(el.id));
  for (const el of fresh) state.seen.add(el.id);
  if (fresh.length === 0) {
    return {
      ok: false,
      stage: 'empty',
      detail: 'the scene came back with nothing new on it',
      ms: since(),
    };
  }
  return { ok: true, elements: fresh, kind: plan.kind, ms: since() };
}

/**
 * Creates the scratch scene this session lays diagrams out in.
 *
 * `create_scene` requires `name`, `pinned` and `collectionId` — all three, none
 * defaulted — and `collectionId` is where the two kinds of Excalidraw+ key
 * diverge. The schema says a personal key may pass the literal `'private'` for
 * the owner's virtual collection; a workspace key cannot reach private
 * collections at all and answers `{"error":"Collection not found"}` to exactly
 * that value. Since nothing in the key itself says which kind it is, the
 * collection is looked up rather than assumed: the workspace's default
 * collection is the right home for a scratch scene either way.
 * `EXCALIDRAW_COLLECTION_ID` overrides it.
 */
async function createScratchScene(call: ToolCaller): Promise<string | null> {
  const collectionId = await resolveCollection(call);
  if (!collectionId) throw new Error('no Excalidraw collection available to create a scene in');

  const created = await call('create_scene', {
    name: 'Athena classroom board',
    pinned: false,
    collectionId,
  });
  return findSceneId(created);
}

/** Cached for the process: the workspace's collections do not move mid-lesson. */
let cachedCollectionId: string | null = null;

async function resolveCollection(call: ToolCaller): Promise<string | null> {
  const configured = config.excalidrawCollectionId.trim();
  if (configured) return configured;
  if (cachedCollectionId) return cachedCollectionId;

  const listed = await call('list_collections', {});
  const rows = collectionRows(listed);
  // The default collection first, then simply the first one that exists.
  const chosen = rows.find((row) => row.isDefault === true) ?? rows[0];
  cachedCollectionId = typeof chosen?.id === 'string' ? chosen.id : null;
  return cachedCollectionId;
}

function collectionRows(value: unknown): Array<Record<string, unknown>> {
  if (!value || typeof value !== 'object') return [];
  const data = (value as Record<string, unknown>).data;
  if (!Array.isArray(data)) return [];
  return data.filter(
    (row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object',
  );
}

/** Depth-first hunt for a scene id, since the wrapper shape is beta. */
function findSceneId(value: unknown, depth = 0): string | null {
  if (depth > 6 || !value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  for (const key of ['id', 'sceneId', 'scene_id']) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  }
  for (const nested of Object.values(record)) {
    const found = findSceneId(nested, depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * Depth-first hunt for the element array, for the same reason.
 *
 * An Excalidraw element is recognised by carrying both an `id` and a `type`,
 * which is specific enough not to match the wrapper objects around it.
 */
export function findElements(value: unknown, depth = 0): BoardElement[] {
  if (depth > 6 || !value || typeof value !== 'object') return [];

  if (Array.isArray(value)) {
    const elements = value.filter(isElementLike);
    if (elements.length > 0) return elements.map(normalise);
    for (const item of value) {
      const found = findElements(item, depth + 1);
      if (found.length > 0) return found;
    }
    return [];
  }

  const record = value as Record<string, unknown>;
  // Prefer the conventionally-named field before searching blindly.
  for (const key of ['elements', 'sceneElements']) {
    const found = findElements(record[key], depth + 1);
    if (found.length > 0) return found;
  }
  for (const nested of Object.values(record)) {
    const found = findElements(nested, depth + 1);
    if (found.length > 0) return found;
  }
  return [];
}

function isElementLike(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string' && typeof record.type === 'string';
}

/**
 * Makes an incoming element safe for the scene merge.
 *
 * `mergeSceneElements` keys on `id` and compares `version`, so both must be
 * present and the right type — an element arriving without a numeric version
 * would compare as `undefined >= undefined`, which is false, and silently
 * refuse to update. The `athena` flag matches what `athenaTextElement` already
 * sets, so her drawings and her written lines are marked the same way.
 */
function normalise(element: Record<string, unknown>): BoardElement {
  return {
    ...element,
    id: String(element.id),
    version: typeof element.version === 'number' ? element.version : 1,
    isDeleted: element.isDeleted === true,
    athena: true,
  } as BoardElement;
}

/**
 * Shifts a diagram clear of what is already on the board.
 *
 * Excalidraw+ lays every diagram out from its own origin, so two diagrams would
 * land on top of each other and on top of anything the teacher had drawn.
 * Exported separately from generation so the placement rule can be tested
 * without an Excalidraw call.
 */
export function placeBeside(
  existing: BoardElement[],
  incoming: BoardElement[],
): BoardElement[] {
  if (incoming.length === 0) return [];

  const right = existing.reduce((max, el) => {
    if (el.isDeleted === true) return max;
    const x = numberAt(el, 'x');
    return Math.max(max, x + numberAt(el, 'width'));
  }, Number.NEGATIVE_INFINITY);

  // Nothing on the board yet: leave Excalidraw's own layout alone.
  if (!Number.isFinite(right)) return incoming;

  const left = incoming.reduce((min, el) => Math.min(min, numberAt(el, 'x')), Number.POSITIVE_INFINITY);
  const shift = right + 80 - left;
  if (shift <= 0) return incoming;

  return incoming.map((el) => ({ ...el, x: numberAt(el, 'x') + shift }));
}

function numberAt(element: BoardElement, key: string): number {
  const value = (element as Record<string, unknown>)[key];
  return typeof value === 'number' ? value : 0;
}
