import { GroupOp } from "@/game/yard/planner/groupTools";

/**
 * Small looping pictures of what each planner tool does.
 *
 * A sentence like "flip the selection left to right about its own centre" is
 * exact and still tells a new player nothing: they have to build the picture
 * in their head before the words mean anything. These draw the picture — a few
 * rectangles on a grid, a dashed outline where they started, and the motion
 * that takes one to the other — so the tooltip shows the move instead of
 * describing it.
 *
 * ## Why inline SVG and CSS keyframes
 *
 * No GIFs, no video, no sprite sheets and no library. Every demo is elements
 * the page already knows how to draw, so there is nothing to download, nothing
 * to decode and nothing to keep in sync with the palette: the shapes take
 * their colours from the same tokens as the rest of the chrome, so they follow
 * the theme and stay legible in both. A 2.4 s loop is long enough to read and
 * short enough that a player who glanced away sees it again.
 *
 * The animation itself lives in `planner.css`, not here. Every moving element
 * carries {@link DEMO_ANIM_CLASS} plus one class naming *how* it moves, and
 * the distances it moves by are set as CSS custom properties. That is what
 * lets one `@keyframes` rule drive nine different demos, and it is what lets
 * `prefers-reduced-motion: reduce` turn the loop off and pin every element at
 * its **end** state instead: a still picture of the "after" is still a useful
 * answer to "what does this button do", where a frozen "before" is not.
 *
 * Nothing here reads the DOM or the plan. A demo is a picture of the *idea* —
 * the four blocks are not the player's buildings — so these are pure builders
 * that a caller mounts and drops.
 */

const SVG_NS = "http://www.w3.org/2000/svg" as const;

/**
 * The class every animated element carries.
 *
 * One hook for the stylesheet's reduced-motion override and one thing for a
 * test to assert, so "this demo actually animates" is checkable without
 * parsing keyframes.
 */
export const DEMO_ANIM_CLASS = "planner-demo__anim";

/** Every demo, by the name the UI asks for it under. */
export type DemoName =
  | "select"
  | "boxSelect"
  | "drag"
  | "carry"
  | "mirrorH"
  | "mirrorV"
  | "alignLeft"
  | "alignRight"
  | "alignTop"
  | "alignBottom"
  | "alignCentreX"
  | "alignCentreY"
  | "distributeH"
  | "distributeV"
  | "find"
  | "store";

/** `[x, y, width, height]` in the demo's own 120 × 72 grid. */
type Rect = readonly [x: number, y: number, width: number, height: number];

const el = <K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] => {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
};

/** The faint graph paper everything is drawn on. */
const grid = (): SVGGElement => {
  const group = el("g", { class: "planner-demo__grid" });
  for (let x = 12; x < 120; x += 12) {
    group.append(el("line", { x1: x, y1: 0, x2: x, y2: 72 }));
  }
  for (let y = 12; y < 72; y += 12) {
    group.append(el("line", { x1: 0, y1: y, x2: 120, y2: y }));
  }
  return group;
};

/** An empty demo canvas, gridded and named. */
const frame = (name: DemoName): SVGSVGElement => {
  const svg = el("svg", {
    viewBox: "0 0 120 72",
    class: `planner-demo planner-demo--${name}`,
    "data-demo": name,
    // The line of text beside every demo says the same thing in words, so the
    // picture is decoration as far as a screen reader is concerned.
    "aria-hidden": "true",
    focusable: "false",
  });
  svg.append(grid());
  return svg;
};

/** A building. `lead` marks the ones the operation is acting on. */
const block = (rect: Rect, lead = false): SVGRectElement => {
  const [x, y, width, height] = rect;
  return el("rect", {
    x,
    y,
    width,
    height,
    rx: 2,
    class: lead ? "planner-demo__block planner-demo__block--lead" : "planner-demo__block",
  });
};

/** A dashed outline of where something started. */
const ghost = (rect: Rect): SVGRectElement => {
  const [x, y, width, height] = rect;
  return el("rect", { x, y, width, height, rx: 2, class: "planner-demo__ghost" });
};

/** The selection outline, drawn just outside a block. */
const ring = (rect: Rect): SVGRectElement => {
  const [x, y, width, height] = rect;
  const node = el("rect", {
    x: x - 3,
    y: y - 3,
    width: width + 6,
    height: height + 6,
    rx: 3,
    class: "planner-demo__ring",
  });
  node.classList.add(DEMO_ANIM_CLASS, "planner-demo__appear");
  return node;
};

/** The guide an align lands on, or the axis a mirror reflects about. */
const axis = (from: [number, number], to: [number, number]): SVGLineElement =>
  el("line", {
    x1: from[0],
    y1: from[1],
    x2: to[0],
    y2: to[1],
    class: "planner-demo__axis",
  });

/**
 * A pointer, at rest.
 *
 * Wrapped by `mover` when it has to travel: an SVG `transform` *attribute* and
 * a CSS `transform` do not compose — the property wins outright — so the
 * static placement and the animated one have to sit on different elements.
 */
const cursor = (x: number, y: number): SVGGElement => {
  const group = el("g", { transform: `translate(${x} ${y})` });
  group.append(
    el("path", {
      d: "M0 0 L0 14 L3.6 10.4 L6.2 15.6 L8.8 14.4 L6.2 9.2 L11 9.2 Z",
      class: "planner-demo__cursor",
    }),
  );
  return group;
};

/** A click, as a ring that expands and fades. `late` puts it in the second half. */
const ping = (x: number, y: number, late = false): SVGCircleElement => {
  const node = el("circle", { cx: x, cy: y, r: 6 });
  node.classList.add(DEMO_ANIM_CLASS, "planner-demo__ping");
  if (late) node.classList.add("planner-demo__ping--late");
  return node;
};

/** Everything inside travels by `dx, dy` and comes back. */
const mover = (dx: number, dy: number, ...children: SVGElement[]): SVGGElement => {
  const group = el("g");
  group.classList.add(DEMO_ANIM_CLASS, "planner-demo__move");
  group.style.setProperty("--dx", `${dx}px`);
  group.style.setProperty("--dy", `${dy}px`);
  group.append(...children);
  return group;
};

/** A marquee that sweeps out from its own top-left corner. */
const marquee = (rect: Rect): SVGRectElement => {
  const [x, y, width, height] = rect;
  const node = el("rect", { x, y, width, height, class: "planner-demo__marquee" });
  node.classList.add(DEMO_ANIM_CLASS, "planner-demo__grow");
  return node;
};

/** Everything inside reflects about the vertical line at `centre`. */
const flipX = (centre: number, ...children: SVGElement[]): SVGGElement => {
  const group = el("g");
  group.classList.add(DEMO_ANIM_CLASS, "planner-demo__flip-x");
  group.style.transformOrigin = `${centre}px 36px`;
  group.append(...children);
  return group;
};

/** Everything inside reflects about the horizontal line at `centre`. */
const flipY = (centre: number, ...children: SVGElement[]): SVGGElement => {
  const group = el("g");
  group.classList.add(DEMO_ANIM_CLASS, "planner-demo__flip-y");
  group.style.transformOrigin = `60px ${centre}px`;
  group.append(...children);
  return group;
};

/* ── The demos ──────────────────────────────────────────────────────────── */

/** Click a building and it is selected. */
export const select = (): SVGSVGElement => {
  const svg = frame("select");
  const target: Rect = [20, 18, 26, 18];
  svg.append(
    block([66, 36, 26, 18]),
    block(target, true),
    ring(target),
    ping(33, 27),
    mover(-62, 12, cursor(95, 15)),
  );
  return svg;
};

/** Drag a box and everything inside it is selected. */
export const boxSelect = (): SVGSVGElement => {
  const svg = frame("boxSelect");
  const first: Rect = [22, 16, 24, 16];
  const second: Rect = [56, 34, 24, 16];
  svg.append(
    block([94, 18, 18, 14]),
    block(first, true),
    block(second, true),
    marquee([16, 10, 66, 48]),
    ring(first),
    ring(second),
    mover(66, 48, cursor(16, 10)),
  );
  return svg;
};

/** Drag a selection and it moves. */
export const drag = (): SVGSVGElement => {
  const svg = frame("drag");
  const first: Rect = [16, 14, 26, 16];
  const second: Rect = [16, 38, 26, 16];
  svg.append(
    ghost(first),
    ghost(second),
    mover(34, 12, block(first, true), block(second, true), cursor(30, 26)),
  );
  return svg;
};

/** Click once to pick the selection up, click again to put it down. */
export const carry = (): SVGSVGElement => {
  const svg = frame("carry");
  const first: Rect = [18, 16, 26, 18];
  const second: Rect = [18, 40, 26, 18];
  svg.append(
    ghost(first),
    ghost(second),
    mover(40, 8, block(first, true), block(second, true), cursor(32, 30)),
    ping(31, 25),
    ping(72, 33, true),
  );
  return svg;
};

/** The selection flips left to right about its own centre. */
export const mirrorH = (): SVGSVGElement => {
  const svg = frame("mirrorH");
  const rects: Rect[] = [
    [18, 12, 18, 12],
    [46, 30, 26, 12],
    [18, 48, 14, 12],
  ];
  svg.append(
    ...rects.map(ghost),
    axis([45, 4], [45, 68]),
    flipX(45, ...rects.map((rect) => block(rect, true))),
  );
  return svg;
};

/** The selection flips top to bottom about its own centre. */
export const mirrorV = (): SVGSVGElement => {
  const svg = frame("mirrorV");
  const rects: Rect[] = [
    [14, 12, 20, 10],
    [42, 24, 28, 10],
    [80, 46, 22, 10],
  ];
  svg.append(
    ...rects.map(ghost),
    axis([6, 34], [114, 34]),
    flipY(34, ...rects.map((rect) => block(rect, true))),
  );
  return svg;
};

/**
 * The three blocks every align demo starts from, and their extent.
 *
 * One layout for all six so the six pictures read as one family: the shapes
 * never move between them, only the guide and where they end up.
 */
const ALIGN_RECTS: readonly Rect[] = [
  [22, 10, 26, 12],
  [48, 30, 22, 12],
  [34, 50, 30, 12],
];

/** Builds one align demo from the offset each block ends up moving by. */
const alignDemo = (
  name: DemoName,
  guide: [[number, number], [number, number]],
  offsets: readonly (readonly [number, number])[],
): SVGSVGElement => {
  const svg = frame(name);
  svg.append(...ALIGN_RECTS.map(ghost), axis(guide[0], guide[1]));
  ALIGN_RECTS.forEach((rect, index) => {
    const [dx, dy] = offsets[index] ?? [0, 0];
    svg.append(mover(dx, dy, block(rect, true)));
  });
  return svg;
};

/** Every left edge onto the leftmost one. */
export const alignLeft = (): SVGSVGElement =>
  alignDemo("alignLeft", [
    [22, 4],
    [22, 68],
  ], [
    [0, 0],
    [-26, 0],
    [-12, 0],
  ]);

/** Every right edge onto the rightmost one. */
export const alignRight = (): SVGSVGElement =>
  alignDemo("alignRight", [
    [70, 4],
    [70, 68],
  ], [
    [22, 0],
    [0, 0],
    [6, 0],
  ]);

/** Every top edge onto the topmost one. */
export const alignTop = (): SVGSVGElement =>
  alignDemo("alignTop", [
    [6, 10],
    [114, 10],
  ], [
    [0, 0],
    [0, -20],
    [0, -40],
  ]);

/** Every bottom edge onto the bottommost one. */
export const alignBottom = (): SVGSVGElement =>
  alignDemo("alignBottom", [
    [6, 62],
    [114, 62],
  ], [
    [0, 40],
    [0, 20],
    [0, 0],
  ]);

/** Every centre onto one vertical line. */
export const alignCentreX = (): SVGSVGElement =>
  alignDemo("alignCentreX", [
    [46, 4],
    [46, 68],
  ], [
    [11, 0],
    [-13, 0],
    [-3, 0],
  ]);

/** Every centre onto one horizontal line. */
export const alignCentreY = (): SVGSVGElement =>
  alignDemo("alignCentreY", [
    [6, 36],
    [114, 36],
  ], [
    [0, 20],
    [0, 0],
    [0, -20],
  ]);

/** Equal gaps left to right, the outer two left where they are. */
export const distributeH = (): SVGSVGElement => {
  const svg = frame("distributeH");
  const fixed: Rect[] = [
    [8, 28, 18, 16],
    [94, 28, 18, 16],
  ];
  const moved: [Rect, number][] = [
    [[34, 28, 14, 16], 7],
    [[56, 28, 10, 16], 13],
  ];
  svg.append(...fixed.map((rect) => block(rect)), ...moved.map(([rect]) => ghost(rect)));
  for (const [rect, dx] of moved) svg.append(mover(dx, 0, block(rect, true)));
  return svg;
};

/** Equal gaps top to bottom, the outer two left where they are. */
export const distributeV = (): SVGSVGElement => {
  const svg = frame("distributeV");
  const fixed: Rect[] = [
    [50, 4, 20, 12],
    [50, 58, 20, 12],
  ];
  const moved: [Rect, number][] = [
    [[50, 20, 20, 10], 4],
    [[50, 34, 20, 8], 8],
  ];
  svg.append(...fixed.map((rect) => block(rect)), ...moved.map(([rect]) => ghost(rect)));
  for (const [rect, dy] of moved) svg.append(mover(0, dy, block(rect, true)));
  return svg;
};

/**
 * The selection leaves the yard and goes into the drawer.
 *
 * Drawn as the two selected blocks fading out over their own dashed outlines
 * while a tray fills at the edge: "gone from here, kept over there" is the one
 * thing a player has to believe before they will press a button called Store.
 */
export const store = (): SVGSVGElement => {
  const svg = frame("store");
  const first: Rect = [16, 16, 24, 16];
  const second: Rect = [16, 40, 24, 16];

  const tray = el("g", { class: "planner-demo__tray" });
  tray.append(
    el("rect", { x: 78, y: 14, width: 32, height: 44, rx: 3 }),
    el("line", { x1: 78, y1: 28, x2: 110, y2: 28 }),
    el("line", { x1: 78, y1: 42, x2: 110, y2: 42 }),
  );

  const leaving = el("g");
  leaving.classList.add(DEMO_ANIM_CLASS, "planner-demo__vanish");
  leaving.append(block(first, true), block(second, true));

  svg.append(block([48, 28, 20, 14]), ghost(first), ghost(second), tray, leaving);
  return svg;
};

/** Search finds a building and puts the camera on it. */
export const find = (): SVGSVGElement => {
  const svg = frame("find");
  const target: Rect = [46, 34, 22, 14];
  const lens = el("g", { transform: "translate(97 29)" });
  lens.append(
    el("circle", { cx: 0, cy: 0, r: 7, class: "planner-demo__lens" }),
    el("line", { x1: 5, y1: 5, x2: 11, y2: 11, class: "planner-demo__lens" }),
  );
  svg.append(
    block([14, 14, 20, 12]),
    block([82, 16, 18, 12]),
    block([20, 46, 16, 12]),
    block(target, true),
    ring(target),
    ping(57, 41),
    mover(-40, 12, lens),
  );
  return svg;
};

/** Every demo, by name. */
export const DEMOS: Readonly<Record<DemoName, () => SVGSVGElement>> = {
  select,
  boxSelect,
  drag,
  carry,
  mirrorH,
  mirrorV,
  alignLeft,
  alignRight,
  alignTop,
  alignBottom,
  alignCentreX,
  alignCentreY,
  distributeH,
  distributeV,
  find,
  store,
};

/** Draws one by name. */
export const demo = (name: DemoName): SVGSVGElement => DEMOS[name]();

/**
 * Which demo stands for which group operation.
 *
 * Every align and every distribute has its own picture rather than one
 * standing in for the rest: "top edges" illustrated by a left-align is worse
 * than no picture, because it is confidently wrong about the one thing the
 * player is trying to work out.
 */
export const GROUP_OP_DEMOS: Readonly<Record<GroupOp, DemoName>> = {
  [GroupOp.MIRROR_X]: "mirrorH",
  [GroupOp.MIRROR_Y]: "mirrorV",
  [GroupOp.ALIGN_LEFT]: "alignLeft",
  [GroupOp.ALIGN_RIGHT]: "alignRight",
  [GroupOp.ALIGN_TOP]: "alignTop",
  [GroupOp.ALIGN_BOTTOM]: "alignBottom",
  [GroupOp.ALIGN_CENTRE_X]: "alignCentreX",
  [GroupOp.ALIGN_CENTRE_Y]: "alignCentreY",
  [GroupOp.DISTRIBUTE_X]: "distributeH",
  [GroupOp.DISTRIBUTE_Y]: "distributeV",
};
