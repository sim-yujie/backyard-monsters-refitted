import { Container } from "pixi.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse, BuildingData } from "@/api/types";
import type { Camera } from "@/game/Camera";
import { BuildPlacement, type DropOutcome, type LineStage } from "./BuildPlacement";
import type * as BuildingArt from "./buildingArt";
import type { LinePlan } from "./wallLine";
import type { Point } from "./YardGrid";
import { readYard, type Yard } from "./yardModel";

vi.mock("./buildingArt", async (importOriginal) => ({
  ...(await importOriginal<typeof BuildingArt>()),
  resolveArt: () => null,
}));

/**
 * Line mode for wall Blocks (walls Option B, owner 8 Nov 2026; corners, owner
 * 8 Nov): corners put down by clicks or taps, the mouse's live stretch, undo,
 * a drag that pans, the preview's states, and ✓.
 */

const yardOf = (buildings: BuildingData[]): Yard =>
  readYard({
    error: 0,
    currenttime: 1,
    savetime: 1,
    buildingdata: Object.fromEntries(buildings.map((one) => [String(one.id), one])),
    storedata: {},
  } as unknown as BaseLoadResponse);

const BLOCK = 17; // 20 x 20
const HALL: BuildingData = { id: 1, t: 14, X: -65, Y: -65, l: 3 };
const TWIGS = { r1: 1000, r2: 0, r3: 0, r4: 0 };

const open: BuildPlacement[] = [];
beforeEach(() => {
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("HTMLInputElement", class {});
  vi.stubGlobal("HTMLTextAreaElement", class {});
});
afterEach(() => {
  while (open.length > 0) open.pop()?.destroy();
  vi.unstubAllGlobals();
});

const settle = async () => {
  for (let i = 0; i < 3; i++) await Promise.resolve();
};

const draw = (
  options: {
    budget?: { afford: number; room: number };
    onBuild?: (cells: readonly Point[]) => Promise<DropOutcome>;
    onDrop?: (x: number, y: number) => Promise<DropOutcome>;
    onCancel?: () => void;
    on?: boolean;
    yard?: Yard;
  } = {},
) => {
  const canvas = new EventTarget() as HTMLCanvasElement;
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0 }) as DOMRect;
  const plans: { plan: LinePlan | null; stage: LineStage }[] = [];
  const onDrop = vi.fn(options.onDrop ?? (() => Promise.resolve<DropOutcome>("placed")));
  const onBuild = vi.fn(options.onBuild ?? (() => Promise.resolve<DropOutcome>("placed")));
  const placement = new BuildPlacement({
    type: BLOCK,
    yard: options.yard ?? yardOf([HALL]),
    camera: { screenToWorld: (point: { x: number; y: number }) => point } as unknown as Camera,
    canvas,
    layer: new Container(),
    worldToYard: (x, y) => ({ x, y }),
    onDrop,
    onCancel: options.onCancel ?? (() => {}),
    repeat: true,
    line: {
      on: options.on ?? true,
      budget: () => options.budget ?? { afford: 100, room: 100 },
      unitCost: TWIGS,
      onPlan: (plan, stage) => plans.push({ plan, stage }),
      onBuild,
    },
  });
  open.push(placement);
  return { placement, canvas, plans, onDrop, onBuild, last: () => plans[plans.length - 1]! };
};

/** A pointer event with the fields the placement reads. */
const pointer = (type: string, pointerType: string, x: number, y: number, button = 0) =>
  Object.assign(new Event(type), { pointerType, clientX: x, clientY: y, button, pointerId: 1 }) as PointerEvent;

/** A mouse press on the canvas (the camera's own listener is not here: in the yard a drag pans). */
const press = (canvas: EventTarget, x: number, y: number, button = 0) =>
  canvas.dispatchEvent(pointer("pointerdown", "mouse", x, y, button));
const move = (canvas: EventTarget, x: number, y: number, pointerType = "mouse") =>
  canvas.dispatchEvent(pointer("pointermove", pointerType, x, y));
const release = (canvas: EventTarget, x: number, y: number, pointerType = "mouse") =>
  canvas.dispatchEvent(pointer("pointerup", pointerType, x, y));
const click = (canvas: EventTarget, x: number, y: number) => {
  press(canvas, x, y);
  release(canvas, x, y);
};
const tap = (canvas: EventTarget, x: number, y: number) => {
  canvas.dispatchEvent(pointer("pointerdown", "touch", x, y));
  canvas.dispatchEvent(pointer("pointerup", "touch", x, y));
};
const key = (name: string) => {
  const event = Object.assign(new Event("keydown", { cancelable: true }), { key: name });
  window.dispatchEvent(event);
  return event;
};
const cells = (plan: LinePlan | null | undefined) => plan?.build.map(({ x, y }) => `${x},${y}`);

describe("BuildPlacement line mode", () => {
  it("starts on when asked, with no line yet", () => {
    const { placement, last } = draw();
    expect(placement.lineMode).toBe(true);
    expect(placement.linePlan).toBeNull();
    expect(last().stage).toEqual({ empty: true, anchors: 0, busy: false });
  });

  it("mouse: clicks put corners down; three corners make a line with a bend (no build until ✓)", () => {
    const { canvas, placement, onBuild, onDrop, last } = draw();
    click(canvas, 210, 110); // spot centred on the pointer: (200, 100)
    expect(last().stage).toMatchObject({ empty: false, anchors: 1 });
    click(canvas, 270, 110);
    click(canvas, 270, 150);
    expect(placement.anchors).toEqual([
      { x: 200, y: 100 },
      { x: 260, y: 100 },
      { x: 260, y: 140 },
    ]);
    expect(cells(placement.linePlan)).toEqual(["200,100", "220,100", "240,100", "260,100", "260,120", "260,140"]);
    expect(onBuild).not.toHaveBeenCalled();
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("mouse: the next stretch follows the pointer from the last corner, an L when it does not line up", () => {
    const { canvas, placement } = draw();
    click(canvas, 210, 110);
    move(canvas, 270, 150);
    expect(cells(placement.linePlan)).toEqual(["200,100", "220,100", "240,100", "260,100", "260,120", "260,140"]);
    expect(placement.anchors).toHaveLength(1);
  });

  it("mouse: leaving the yard drops the live stretch, so the preview is what ✓ builds; ✓ never builds it", async () => {
    const { canvas, placement, onBuild } = draw();
    click(canvas, 210, 110);
    click(canvas, 250, 110);
    move(canvas, 250, 190);
    expect(placement.linePlan?.build).toHaveLength(7);
    canvas.dispatchEvent(new Event("pointerleave"));
    expect(placement.linePlan?.build).toHaveLength(3);
    move(canvas, 250, 190);
    await placement.confirmLine();
    expect(onBuild).toHaveBeenCalledWith([
      { x: 200, y: 100 },
      { x: 220, y: 100 },
      { x: 240, y: 100 },
    ]);
  });

  it("mouse: a press that travels is a pan, not a corner; a few pixels of wobble is still a click", () => {
    const { canvas, placement } = draw();
    click(canvas, 210, 110);
    press(canvas, 300, 300);
    move(canvas, 340, 300);
    release(canvas, 340, 300);
    expect(placement.anchors).toHaveLength(1);
    press(canvas, 270, 110);
    release(canvas, 274, 112);
    expect(placement.anchors).toHaveLength(2);
  });

  it("mouse: a double-click ends the line (no live stretch) until the next click", () => {
    const { canvas, placement } = draw();
    click(canvas, 210, 110);
    click(canvas, 270, 110);
    click(canvas, 270, 110); // the double-click's second click adds nothing
    canvas.dispatchEvent(new Event("dblclick"));
    expect(placement.anchors).toHaveLength(2);
    move(canvas, 270, 190);
    expect(placement.linePlan?.build).toHaveLength(4);
    click(canvas, 270, 190);
    expect(placement.anchors).toHaveLength(3);
    expect(placement.linePlan?.build).toHaveLength(8);
  });

  it("undo: Backspace, a right-click and ↶ each take the last corner away", () => {
    const { canvas, placement, last } = draw();
    click(canvas, 210, 110);
    click(canvas, 270, 110);
    click(canvas, 270, 150);
    click(canvas, 330, 150);
    expect(key("Backspace").defaultPrevented).toBe(true);
    expect(placement.anchors).toHaveLength(3);

    const menu = new Event("contextmenu", { cancelable: true });
    canvas.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
    expect(placement.anchors).toHaveLength(2);

    placement.undoAnchor();
    expect(placement.anchors).toHaveLength(1);
    expect(last().stage).toMatchObject({ anchors: 1 });
    placement.undoAnchor();
    expect(placement.linePlan).toBeNull();
    expect(last().stage).toEqual({ empty: true, anchors: 0, busy: false });
    // Nothing left: Backspace is the page's again.
    expect(key("Backspace").defaultPrevented).toBe(false);
  });

  it("a right-click press does not put a corner down", () => {
    const { canvas, placement } = draw();
    press(canvas, 210, 110, 2);
    release(canvas, 210, 110);
    expect(placement.anchors).toHaveLength(0);
  });

  it("touch: each tap is a corner, a finger drag pans and puts nothing down", () => {
    const { canvas, placement, last } = draw();
    tap(canvas, 210, 110);
    expect(placement.linePlan?.build).toEqual([{ x: 200, y: 100 }]);

    canvas.dispatchEvent(pointer("pointerdown", "touch", 300, 300));
    move(canvas, 100, 100, "touch");
    release(canvas, 100, 100, "touch");
    expect(placement.anchors).toHaveLength(1);

    tap(canvas, 210, 170);
    tap(canvas, 270, 170);
    expect(last().stage).toMatchObject({ anchors: 3 });
    expect(cells(placement.linePlan)).toEqual([
      "200,100", "200,120", "200,140", "200,160", "220,160", "240,160", "260,160",
    ]);
    // A finger has no hover: moving grows no live stretch.
    move(canvas, 500, 500, "touch");
    expect(placement.linePlan?.build).toHaveLength(7);
    placement.undoAnchor();
    expect(placement.linePlan?.build).toHaveLength(4);
  });

  it("the preview: red on a building (skipped), grey past the budget", () => {
    const wall: BuildingData = { id: 5, t: BLOCK, X: 240, Y: 100 };
    const { placement, last } = draw({ yard: yardOf([HALL, wall]), budget: { afford: 3, room: 100 } });
    placement.lineTap(200, 100);
    placement.lineTap(340, 100);
    const plan = last().plan!;
    expect(plan.cells.map((cell) => cell.state)).toEqual([
      "build", "build", "blocked", "build", "short", "short", "short", "short",
    ]);
    expect(plan.cells[2]).toMatchObject({ problem: "overlap", blockedBy: 5 });
    expect(plan.shortReason).toBe("resources");
    expect(plan.cost.r1).toBe(3000);
  });

  it("the summary counts the whole bent line, over the hall's limit too", () => {
    const { placement, last } = draw({ budget: { afford: 100, room: 5 } });
    placement.lineTap(200, 100);
    placement.lineTap(260, 100);
    placement.lineTap(260, 160);
    const plan = last().plan!;
    expect(plan.cells).toHaveLength(7);
    expect(plan.build).toHaveLength(5);
    expect(plan.short).toBe(2);
    expect(plan.shortReason).toBe("limit");
  });

  it("a line off the plot is red where it leaves", () => {
    const { placement } = draw();
    placement.lineTap(1500, 0);
    placement.lineTap(3000, 0);
    expect(placement.linePlan?.cells.some((cell) => cell.problem === "outOfBounds")).toBe(true);
  });

  it("✓ sends the green Blocks once, holds them while it waits, then clears the line", async () => {
    let answer: (outcome: DropOutcome) => void = () => {};
    const onBuild = vi.fn(() => new Promise<DropOutcome>((resolve) => (answer = resolve)));
    const { placement, last } = draw({ onBuild, budget: { afford: 2, room: 100 } });
    placement.lineTap(200, 100);
    placement.lineTap(260, 100);

    void placement.confirmLine();
    void placement.confirmLine(); // a second ✓ while waiting does nothing
    expect(onBuild).toHaveBeenCalledOnce();
    expect(onBuild).toHaveBeenCalledWith([
      { x: 200, y: 100 },
      { x: 220, y: 100 },
    ]);
    expect(last().stage).toMatchObject({ busy: true });
    // Held: the spots read as taken until the answer.
    expect(placement.grid.check(BLOCK, 200, 100).problem).toBe("overlap");
    placement.lineTap(500, 500); // no new corner while waiting
    placement.undoAnchor(); // nor undo
    expect(placement.anchors).toHaveLength(2);
    expect(placement.linePlan?.build[0]).toEqual({ x: 200, y: 100 });

    answer("placed");
    await settle();
    expect(placement.linePlan).toBeNull();
    expect(last().stage).toEqual({ empty: true, anchors: 0, busy: false });
    expect(placement.grid.check(BLOCK, 200, 100).problem).toBeNull();
  });

  it("a refused ✓ keeps the line to try again", async () => {
    const { placement } = draw({ onBuild: () => Promise.resolve("refused") });
    placement.lineTap(200, 100);
    placement.lineTap(240, 100);
    await placement.confirmLine();
    expect(placement.linePlan?.build).toHaveLength(3);
    expect(placement.anchors).toHaveLength(2);
  });

  it("✓ with nothing green sends nothing", async () => {
    const { placement, onBuild } = draw({ budget: { afford: 0, room: 100 } });
    placement.lineTap(200, 100);
    await placement.confirmLine();
    expect(onBuild).not.toHaveBeenCalled();
  });

  it("Escape lets the line go first, then cancels", () => {
    const onCancel = vi.fn();
    const { placement } = draw({ onCancel });
    placement.lineTap(200, 100);
    placement.lineTap(240, 100);
    key("Escape");
    expect(placement.linePlan).toBeNull();
    expect(placement.anchors).toHaveLength(0);
    expect(onCancel).not.toHaveBeenCalled();
    key("Escape");
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("off: a click builds one Block as before, and a right-click is left alone", () => {
    const { canvas, placement, onDrop, onBuild } = draw({ on: false });
    expect(placement.lineMode).toBe(false);
    click(canvas, 210, 110);
    expect(onDrop).toHaveBeenCalledWith(200, 100);
    expect(onBuild).not.toHaveBeenCalled();
    const menu = new Event("contextmenu", { cancelable: true });
    canvas.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(false);
  });

  it("toggling clears any line; in line mode a release never drops one Block", () => {
    const { canvas, placement, onDrop } = draw();
    placement.lineTap(200, 100);
    placement.setLineMode(false);
    expect(placement.linePlan).toBeNull();
    placement.setLineMode(true);
    click(canvas, 210, 110);
    placement.dropHere();
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("a new yard (resources changed) guesses the greens again", () => {
    let afford = 1;
    const canvas = new EventTarget() as HTMLCanvasElement;
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0 }) as DOMRect;
    const placement = new BuildPlacement({
      type: BLOCK,
      yard: yardOf([HALL]),
      camera: { screenToWorld: (point: { x: number; y: number }) => point } as unknown as Camera,
      canvas,
      layer: new Container(),
      worldToYard: (x, y) => ({ x, y }),
      onDrop: () => Promise.resolve("placed"),
      onCancel: () => {},
      repeat: true,
      line: {
        on: true,
        budget: () => ({ afford, room: 10 }),
        unitCost: TWIGS,
        onPlan: () => {},
        onBuild: () => Promise.resolve("placed"),
      },
    });
    open.push(placement);
    placement.lineTap(200, 100);
    placement.lineTap(240, 100);
    expect(placement.linePlan?.build).toHaveLength(1);
    afford = 5;
    placement.rebase(yardOf([HALL]));
    expect(placement.linePlan?.build).toHaveLength(3);
  });
});
