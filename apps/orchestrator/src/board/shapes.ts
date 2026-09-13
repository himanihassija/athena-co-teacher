/**
 * The shaped-drawing half of Athena's board: pictures that are not flowcharts.
 *
 * **Why this exists.** `create_diagram` draws boxes joined by arrows and
 * nothing else. That is the right tool for a process or a hierarchy, and the
 * wrong one for "a circle split into four equal parts with three shaded" —
 * which is not expressible as nodes and edges at all. Asked for one anyway, the
 * model does the only thing the schema allows and produces a flowchart *about*
 * the picture: `Whole circle -> Divide into 4 parts -> Shade 3 parts`. Measured
 * in a real lesson, Athena said "here is a circle split into four equal parts"
 * while the board showed exactly that chain of boxes, so her words and the
 * board disagreed.
 *
 * **Why the geometry is computed here and not by the model.** The obvious
 * alternative is to let the model emit Excalidraw elements directly. It is also
 * the unreliable one: "four equal parts" is an arithmetic claim, and a model
 * writing coordinates by hand produces wedges of visibly different sizes, bars
 * that do not sum to the whole, and ticks that drift off the line. A picture
 * whose whole pedagogical point is that the parts are equal cannot be drawn by
 * something that only approximately divides by four.
 *
 * So the model chooses from a small vocabulary and supplies the numbers — how
 * many parts, how many shaded — and the exact placement is done here, where a
 * unit test can check that four parts really are a quarter-turn each.
 *
 * **Why skeletons rather than finished elements.** These are Excalidraw
 * "element skeletons": the partial form `edit_scene_content` accepts, where the
 * server assigns ids and fills in the fields a real element needs. Handing
 * Excalidraw a skeleton and reading back what it persisted is the same round
 * trip the diagram path already makes, so both kinds of picture reach the board
 * through one proven route rather than two.
 */

/** One picture in the vocabulary the model may ask for. */
export type DrawingShape =
  | {
      type: 'partitioned-circle';
      /** Total equal parts the whole is cut into. */
      parts: number;
      /** How many of them are filled in. */
      shaded: number;
      caption?: string;
    }
  | {
      type: 'partitioned-bar';
      parts: number;
      shaded: number;
      caption?: string;
    }
  | {
      type: 'bar-chart';
      bars: Array<{ label: string; value: number }>;
      caption?: string;
    }
  | {
      type: 'number-line';
      from: number;
      to: number;
      /** Distance between ticks. Must divide the span into a sane number of them. */
      step: number;
      /** Values to highlight with a dot. */
      marks?: number[];
      caption?: string;
    }
  | { type: 'note'; text: string };

/** An Excalidraw element skeleton, as `edit_scene_content.add` accepts them. */
export type Skeleton = Record<string, unknown>;

/*
 * Layout constants. The board is read from across a classroom, so these are
 * deliberately larger than Excalidraw's own defaults, and the gaps are wide
 * enough that two pictures never read as one.
 */
const COLUMN = 300;
const GAP = 90;
const RADIUS = 110;
const BAR_WIDTH = 280;
const BAR_HEIGHT = 96;
const CHART_HEIGHT = 220;
const CAPTION_SIZE = 20;

/* Palette taken from the values `read_freeform_format` names as preferred. */
const INK = '#1e1e1e';
const FILL = '#a5d8ff';
const FILL_STROKE = '#1971c2';

/** Rounds to a tenth of a pixel, so assertions are not fighting float noise. */
const round = (n: number): number => Math.round(n * 10) / 10;

/**
 * Turns the model's chosen shapes into Excalidraw skeletons.
 *
 * Shapes are laid out left to right in one row, each in its own column, which
 * matches how the classroom board is shaped — wide, beside a participant strip
 * — and means a two-part comparison reads side by side without scrolling.
 */
export function renderDrawing(shapes: DrawingShape[]): Skeleton[] {
  const out: Skeleton[] = [];
  let x = 0;

  for (const shape of shapes) {
    out.push(...renderOne(shape, x));
    x += COLUMN + GAP;
  }

  return out;
}

function renderOne(shape: DrawingShape, x: number): Skeleton[] {
  switch (shape.type) {
    case 'partitioned-circle':
      return partitionedCircle(shape, x);
    case 'partitioned-bar':
      return partitionedBar(shape, x);
    case 'bar-chart':
      return barChart(shape, x);
    case 'number-line':
      return numberLine(shape, x);
    case 'note':
      return [caption(shape.text, x + COLUMN / 2, 0)];
  }
}

/* ------------------------------------------------------------------ pieces */

/**
 * Roughly how wide `text` will render at `size`.
 *
 * Only used for the `width` field, which the format guide requires on every
 * skeleton but which Excalidraw then overrides with its own measurement of the
 * real font. 0.55em per character is a fair approximation for Excalifont; it
 * does not affect where the caption ends up.
 */
function estimateTextWidth(text: string, size: number): number {
  return text.length * size * 0.55;
}

/**
 * A standalone line of text, centred on `centerX`.
 *
 * `x` really is the centre and not the left edge, which is not obvious and is
 * worth stating because getting it wrong is silent. Read back off the live
 * service, a text skeleton sent with `textAlign: 'center'` comes back with
 * `x` rewritten to `sent_x - measured_width / 2` — Excalidraw treats the
 * supplied coordinate as the centre and re-anchors around its own measurement.
 * An earlier version of this function pre-subtracted half an *estimated* width
 * as well, and so every caption landed half its own width to the left of the
 * shape it names.
 *
 * Deferring to Excalidraw's measurement is also more accurate than estimating,
 * since the estimate never has to be right for the caption to sit centred.
 *
 * The guide is explicit that standalone text clips when its bounds are tight,
 * and gives the rule used here for height: at least fontSize * lines * 1.35.
 */
function caption(text: string, centerX: number, y: number): Skeleton {
  return {
    type: 'text',
    x: round(centerX),
    y: round(y),
    width: round(estimateTextWidth(text, CAPTION_SIZE)),
    height: round(CAPTION_SIZE * 1.35),
    text,
    fontSize: CAPTION_SIZE,
    fontFamily: 5,
    strokeColor: INK,
    textAlign: 'center',
  };
}

/**
 * A closed, filled polygon approximating one wedge of a circle.
 *
 * Excalidraw has no wedge primitive, and the format guide's own advice for pie
 * charts is "arcs or wedge-like shapes ... if supported" — so a wedge is a
 * closed `line` from the centre, out along the arc, and back. `ARC_STEPS`
 * controls how many segments the arc is drawn with; at 12 per wedge the curve
 * is smooth at classroom scale without bloating the payload.
 */
const ARC_STEPS = 12;

function wedge(cx: number, cy: number, from: number, to: number): Skeleton {
  const points: Array<[number, number]> = [[0, 0]];
  for (let i = 0; i <= ARC_STEPS; i += 1) {
    const angle = from + ((to - from) * i) / ARC_STEPS;
    points.push([round(RADIUS * Math.cos(angle)), round(RADIUS * Math.sin(angle))]);
  }
  points.push([0, 0]);

  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);

  return {
    type: 'line',
    x: round(cx),
    y: round(cy),
    width: round(Math.max(...xs) - Math.min(...xs)),
    height: round(Math.max(...ys) - Math.min(...ys)),
    points,
    backgroundColor: FILL,
    fillStyle: 'solid',
    strokeColor: FILL_STROKE,
    strokeWidth: 2,
    roughness: 1,
  };
}

/* ------------------------------------------------------------- primitives */

/**
 * A circle cut into `parts` equal wedges with `shaded` of them filled.
 *
 * The fraction case, and the one that sent this module into existence. Angles
 * start at twelve o'clock and run clockwise, which is how a fraction is drawn
 * in every school textbook.
 */
function partitionedCircle(
  shape: Extract<DrawingShape, { type: 'partitioned-circle' }>,
  x: number,
): Skeleton[] {
  const parts = clampInt(shape.parts, 2, 12);
  const shaded = clampInt(shape.shaded, 0, parts);
  const cx = x + COLUMN / 2;
  const cy = RADIUS;
  const sweep = (Math.PI * 2) / parts;
  const start = -Math.PI / 2;

  const out: Skeleton[] = [];

  // Filled wedges first so the outline and dividers draw on top of them.
  for (let i = 0; i < shaded; i += 1) {
    out.push(wedge(cx, cy, start + i * sweep, start + (i + 1) * sweep));
  }

  out.push({
    type: 'ellipse',
    x: round(cx - RADIUS),
    y: round(cy - RADIUS),
    width: RADIUS * 2,
    height: RADIUS * 2,
    backgroundColor: 'transparent',
    strokeColor: INK,
    strokeWidth: 2,
    roughness: 1,
  });

  // Every boundary gets a divider, including the ones between two unshaded
  // parts — without them an unshaded remainder reads as one undivided region
  // and the "equal parts" claim is invisible.
  for (let i = 0; i < parts; i += 1) {
    const angle = start + i * sweep;
    out.push({
      type: 'line',
      x: round(cx),
      y: round(cy),
      width: round(Math.abs(RADIUS * Math.cos(angle))),
      height: round(Math.abs(RADIUS * Math.sin(angle))),
      points: [
        [0, 0],
        [round(RADIUS * Math.cos(angle)), round(RADIUS * Math.sin(angle))],
      ],
      strokeColor: INK,
      strokeWidth: 2,
      roughness: 1,
    });
  }

  out.push(caption(shape.caption ?? `${shaded}/${parts}`, x + COLUMN / 2, cy + RADIUS + 24));
  return out;
}

/**
 * A bar cut into `parts` equal cells with `shaded` of them filled.
 *
 * The other way a fraction is taught, and the better one for comparing two
 * fractions, because equal-width cells line up across two stacked bars in a way
 * that two circles never do.
 */
function partitionedBar(
  shape: Extract<DrawingShape, { type: 'partitioned-bar' }>,
  x: number,
): Skeleton[] {
  const parts = clampInt(shape.parts, 2, 16);
  const shaded = clampInt(shape.shaded, 0, parts);
  const left = x + (COLUMN - BAR_WIDTH) / 2;
  const cell = BAR_WIDTH / parts;

  const out: Skeleton[] = [];

  for (let i = 0; i < parts; i += 1) {
    out.push({
      type: 'rectangle',
      x: round(left + i * cell),
      y: 0,
      width: round(cell),
      height: BAR_HEIGHT,
      backgroundColor: i < shaded ? FILL : 'transparent',
      fillStyle: 'solid',
      strokeColor: INK,
      strokeWidth: 2,
      roughness: 1,
    });
  }

  out.push(caption(shape.caption ?? `${shaded}/${parts}`, x + COLUMN / 2, BAR_HEIGHT + 24));
  return out;
}

/**
 * A plain bar chart, for the "compare these quantities" ask.
 *
 * Bars are scaled against the largest value rather than a fixed axis, so the
 * tallest always fills the frame and the differences stay legible whatever the
 * numbers are. Values are printed above the bars because the guide asks for
 * exact values to be shown when they are known.
 */
function barChart(
  shape: Extract<DrawingShape, { type: 'bar-chart' }>,
  x: number,
): Skeleton[] {
  const bars = shape.bars.slice(0, 7).filter((b) => Number.isFinite(b.value));
  if (bars.length === 0) return [];

  const peak = Math.max(...bars.map((b) => Math.abs(b.value)), 1);
  const slot = BAR_WIDTH / bars.length;
  const width = slot * 0.6;
  const left = x + (COLUMN - BAR_WIDTH) / 2;
  const out: Skeleton[] = [];

  bars.forEach((bar, i) => {
    const height = Math.max((Math.abs(bar.value) / peak) * CHART_HEIGHT, 4);
    const bx = left + i * slot + (slot - width) / 2;
    out.push({
      type: 'rectangle',
      x: round(bx),
      y: round(CHART_HEIGHT - height),
      width: round(width),
      height: round(height),
      backgroundColor: FILL,
      fillStyle: 'solid',
      strokeColor: FILL_STROKE,
      strokeWidth: 2,
      roughness: 1,
    });
    out.push(caption(String(bar.value), bx + width / 2, round(CHART_HEIGHT - height - 28)));
    out.push(caption(bar.label, bx + width / 2, CHART_HEIGHT + 12));
  });

  // Baseline, so the bars are read against something rather than floating.
  out.push({
    type: 'line',
    x: round(left - 12),
    y: CHART_HEIGHT,
    width: round(BAR_WIDTH + 24),
    height: 0,
    points: [
      [0, 0],
      [round(BAR_WIDTH + 24), 0],
    ],
    strokeColor: INK,
    strokeWidth: 2,
    roughness: 1,
  });

  if (shape.caption) out.push(caption(shape.caption, x + COLUMN / 2, CHART_HEIGHT + 52));
  return out;
}

/**
 * A number line with evenly spaced ticks and optional highlighted values.
 *
 * `step` is clamped so a careless span like 0 to 1000 by 1 cannot emit a
 * thousand elements onto a shared board.
 */
function numberLine(
  shape: Extract<DrawingShape, { type: 'number-line' }>,
  x: number,
): Skeleton[] {
  const from = Number.isFinite(shape.from) ? shape.from : 0;
  const to = Number.isFinite(shape.to) ? shape.to : from + 1;
  if (to <= from) return [];

  const span = to - from;
  const rawStep = Number.isFinite(shape.step) && shape.step > 0 ? shape.step : span / 5;
  // At most 20 ticks; below that the labels collide and the line is unreadable.
  const step = Math.max(rawStep, span / 20);
  const left = x + (COLUMN - BAR_WIDTH) / 2;
  const y = 60;
  const at = (value: number): number => left + ((value - from) / span) * BAR_WIDTH;

  const out: Skeleton[] = [
    {
      type: 'arrow',
      x: round(left - 20),
      y,
      width: round(BAR_WIDTH + 40),
      height: 0,
      points: [
        [0, 0],
        [round(BAR_WIDTH + 40), 0],
      ],
      strokeColor: INK,
      strokeWidth: 2,
      roughness: 1,
      startArrowhead: 'arrow',
      endArrowhead: 'arrow',
    },
  ];

  for (let value = from; value <= to + 1e-9; value += step) {
    const tx = at(value);
    out.push({
      type: 'line',
      x: round(tx),
      y: y - 10,
      width: 0,
      height: 20,
      points: [
        [0, 0],
        [0, 20],
      ],
      strokeColor: INK,
      strokeWidth: 2,
      roughness: 1,
    });
    out.push(caption(trimNumber(value), tx, y + 18));
  }

  for (const mark of shape.marks ?? []) {
    if (!Number.isFinite(mark) || mark < from || mark > to) continue;
    out.push({
      type: 'ellipse',
      x: round(at(mark) - 10),
      y: y - 10,
      width: 20,
      height: 20,
      backgroundColor: FILL_STROKE,
      fillStyle: 'solid',
      strokeColor: FILL_STROKE,
      strokeWidth: 2,
      roughness: 0,
    });
  }

  if (shape.caption) out.push(caption(shape.caption, x + COLUMN / 2, y + 56));
  return out;
}

/* ------------------------------------------------------------------ utils */

function clampInt(value: unknown, min: number, max: number): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return min;
  return Math.min(Math.max(n, min), max);
}

/** `0.5` rather than `0.5000000001`, and `3` rather than `3.0`. */
function trimNumber(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

/**
 * Validates and narrows whatever the model put in `shapes`.
 *
 * Anything unrecognised is dropped rather than repaired: a half-understood
 * picture on a classroom board is worse than falling back to the flowchart,
 * and the caller treats an empty result as exactly that signal.
 */
export function parseDrawingShapes(value: unknown): DrawingShape[] {
  if (!Array.isArray(value)) return [];
  const out: DrawingShape[] = [];

  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    const caption = typeof raw.caption === 'string' && raw.caption.trim()
      ? raw.caption.trim().slice(0, 80)
      : undefined;

    switch (raw.type) {
      case 'partitioned-circle':
      case 'partitioned-bar': {
        const parts = Math.round(Number(raw.parts));
        const shaded = Math.round(Number(raw.shaded));
        if (!Number.isFinite(parts) || parts < 2) continue;
        if (!Number.isFinite(shaded) || shaded < 0 || shaded > parts) continue;
        out.push({ type: raw.type, parts, shaded, caption });
        break;
      }
      case 'bar-chart': {
        if (!Array.isArray(raw.bars)) continue;
        const bars = raw.bars
          .filter((b): b is Record<string, unknown> => Boolean(b) && typeof b === 'object')
          .map((b) => ({ label: String(b.label ?? '').slice(0, 24), value: Number(b.value) }))
          .filter((b) => b.label.length > 0 && Number.isFinite(b.value));
        if (bars.length < 2) continue;
        out.push({ type: 'bar-chart', bars, caption });
        break;
      }
      case 'number-line': {
        const from = Number(raw.from);
        const to = Number(raw.to);
        if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) continue;
        const marks = Array.isArray(raw.marks)
          ? raw.marks.map(Number).filter((n) => Number.isFinite(n))
          : undefined;
        out.push({
          type: 'number-line',
          from,
          to,
          step: Number.isFinite(Number(raw.step)) ? Number(raw.step) : (to - from) / 5,
          marks,
          caption,
        });
        break;
      }
      case 'note': {
        const text = typeof raw.text === 'string' ? raw.text.trim().slice(0, 120) : '';
        if (!text) continue;
        out.push({ type: 'note', text });
        break;
      }
      default:
        continue;
    }
  }

  // A drawing is at most four pictures. Beyond that the columns run off the
  // side of the board and nothing is readable.
  return out.slice(0, 4);
}
