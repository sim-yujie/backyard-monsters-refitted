// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { BaseLoadResponse, BuildingData } from "@/api/types";
import type { Camera } from "@/game/Camera";
import type { Point, Rect } from "../YardGrid";
import { readYard, type Yard, type YardBuilding } from "../yardModel";
import { YardView, type YardRenderer } from "../YardRenderer";
import {
  BLUEPRINT_WORLD,
  blueprintToWorld,
  blueprintToYard,
  centredRect,
  rectContains,
  rectCorners,
  tileRect,
} from "./blueprint";
import type { Corners } from "./marquee";
import { PlannerSession, type PlannerState } from "./PlannerSession";

/**
 * The planner's pointer behaviour, driven through real DOM events.
 *
 * `PlannerSession` is the thing that decides what a press means, so testing it
 * by calling its methods would test everything except the decision. These
 * dispatch `pointerdown`, `pointermove`, `pointerup` and `keydown` on a canvas
 * and let `PlannerInput` claim them exactly as it does in the browser, which is
 * the only way the click-to-carry rules — a click picks up, a refused drop stays
 * in hand, the secondary button puts it back — can be checked at all.
 *
 * Everything runs in the blueprint view, where a world pixel is a yard unit and
 * a drag is a plain translation. The isometric view's projection has its own
 * tests (`placement.test.ts`); repeating it here would only make every
 * coordinate in the file harder to read for no extra coverage.
 */

/* ── The yard under test ──────────────────────────────────────────────────── */

/**
 * Three buildings at expansion 0, whose plot is 1000 x 800 yard units.
 *
 * Two cannon towers (type 20, a 70-unit footprint) far enough apart to have
 * room between them, and one wall off in a corner. Small enough that every
 * coordinate below can be worked out by hand.
 */
const BUILDINGS: readonly BuildingData[] = [
  { id: 1, t: 20, X: 0, Y: 0 },
  { id: 2, t: 20, X: 200, Y: 0 },
  { id: 3, t: 17, X: -300, Y: -300 },
];

const testYard = (): Yard =>
  readYard({
    error: 0,
    id: 1,
    baseid: "1",
    basesaveid: 1,
    worldsize: [800, 800],
    currenttime: 1_700_000_000,
    savetime: 1_700_000_000,
    storedata: { ENL: { q: 0 } },
    buildingdata: Object.fromEntries(BUILDINGS.map((entry) => [String(entry.id), entry])),
    mushrooms: { l: [] },
  } as unknown as BaseLoadResponse);

/** The middle of a tile, which is where a press on that building lands. */
const tileCentre = (type: number, x: number, y: number): Point => {
  const rect = tileRect(type, x, y);
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
};

/** Press points: the two towers where they start, and bare ground. */
const ONE = tileCentre(20, 0, 0);
const TWO = tileCentre(20, 200, 0);
const GROUND = blueprintToWorld(400, 300);

/** A point `(dx, dy)` yard units away from another. */
const by = (from: Point, dx: number, dy: number): Point => ({ x: from.x + dx, y: from.y + dy });

/* ── Harness ──────────────────────────────────────────────────────────────── */

interface Harness {
  readonly session: PlannerSession;
  readonly canvas: HTMLCanvasElement;
  /** Every state the session pushed at its owner, newest last. */
  readonly states: PlannerState[];
  /** Where the renderer has each building drawn, in yard units. */
  readonly placements: ReadonlyMap<number, Point>;
  readonly view: () => YardView;
  readonly setView: (view: YardView) => void;
  readonly press: (at: Point, init?: PointerEventInit) => void;
  readonly release: (at: Point, init?: PointerEventInit) => void;
  readonly click: (at: Point, init?: PointerEventInit) => void;
  readonly drag: (at: Point) => void;
  readonly key: (key: string, init?: KeyboardEventInit) => void;
  /** Fires a context menu and reports whether the planner swallowed it. */
  readonly contextMenu: () => boolean;
  readonly close: () => void;
}

const open: Harness[] = [];

afterEach(() => {
  while (open.length > 0) open.pop()?.close();
  document.body.replaceChildren();
});

/**
 * A session over the three-building yard, wired to a renderer that only
 * remembers where things are.
 *
 * The fake answers every geometric question in blueprint units whichever view
 * it reports, because the one test that switches views is about the gesture
 * being dropped rather than about where anything lands.
 */
const planner = (): Harness => {
  const yard = testYard();
  const canvas = document.createElement("canvas");
  document.body.append(canvas);

  // An identity camera: a client pixel is a world pixel, and jsdom reports the
  // canvas at the origin, so every coordinate in a test is a blueprint pixel.
  const camera = {
    screenToWorld: (screen: Point): Point => ({ x: screen.x, y: screen.y }),
  } as unknown as Camera;

  const byId = new Map(yard.buildings.map((building) => [building.id, building]));
  const placements = new Map<number, Point>(
    yard.buildings.map((building) => [building.id, { x: building.x, y: building.y }]),
  );

  let view: YardView = YardView.BLUEPRINT;

  const rectOf = (id: number): Rect | null => {
    const building = byId.get(id);
    const at = placements.get(id);
    return building && at ? tileRect(building.type, at.x, at.y) : null;
  };

  const renderer = {
    get view(): YardView {
      return view;
    },
    placeBuilding: (id: number, x: number, y: number): void => {
      placements.set(id, { x, y });
    },
    resortByDepth: (): void => {},
    resetPlacements: (): void => {
      for (const building of yard.buildings) {
        placements.set(building.id, { x: building.x, y: building.y });
      }
    },
    pick: (worldX: number, worldY: number): YardBuilding | null => {
      for (const building of yard.buildings) {
        const rect = rectOf(building.id);
        if (rect && rectContains(rect, worldX, worldY)) return building;
      }
      return null;
    },
    cornersOf: (id: number): Corners | null => {
      const rect = rectOf(id);
      return rect ? rectCorners(rect) : null;
    },
    centreOf: (id: number): Point | null => {
      const rect = rectOf(id);
      return rect ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : null;
    },
    plotCorners: (): Corners => rectCorners(centredRect(500, 400)),
    setPlannerVisuals: (): void => {},
    worldSize: (): { width: number; height: number } => ({
      width: BLUEPRINT_WORLD.width,
      height: BLUEPRINT_WORLD.height,
    }),
    fitRect: (): Rect => centredRect(540, 440),
    yardToWorld: (x: number, y: number): Point => blueprintToWorld(x, y),
    worldToYard: (worldX: number, worldY: number): Point => blueprintToYard(worldX, worldY),
    setZoom: (): void => {},
  } as unknown as YardRenderer;

  const states: PlannerState[] = [];

  const setView = (next: YardView): void => {
    if (view === next) return;
    view = next;
    session.viewChanged();
  };

  const session = new PlannerSession({
    yard,
    renderer,
    camera,
    canvas,
    onChange: () => states.push(session.state()),
    onViewToggle: () =>
      setView(view === YardView.ISO ? YardView.BLUEPRINT : YardView.ISO),
  });
  session.attach();

  const pointer = (type: string, at: Point, init: PointerEventInit = {}): void => {
    canvas.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: "mouse",
        button: 0,
        buttons: 1,
        clientX: at.x,
        clientY: at.y,
        ...init,
      }),
    );
  };

  const harness: Harness = {
    session,
    canvas,
    states,
    placements,
    view: () => view,
    setView,
    press: (at, init) => pointer("pointerdown", at, init),
    release: (at, init) => pointer("pointerup", at, { buttons: 0, ...init }),
    click: (at, init) => {
      pointer("pointerdown", at, init);
      pointer("pointerup", at, { buttons: 0, ...init });
    },
    drag: (at) => pointer("pointermove", at),
    key: (key, init) => {
      canvas.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }),
      );
    },
    contextMenu: () =>
      !canvas.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
    close: () => {
      session.detach();
      canvas.remove();
    },
  };

  open.push(harness);
  return harness;
};

/**
 * Whether the plan still holds `id`'s cells.
 *
 * A lifted building is erased from the occupancy grid, so the only way to see
 * one left behind is to try to move something else onto it: that succeeds while
 * the cells are open and fails once they are closed again.
 *
 * `beginMove` puts down whatever was in hand first, so this is a question to
 * ask after a gesture has finished, never during one.
 */
const stillOccupies = (harness: Harness, id: number, mover: number): boolean => {
  const plan = harness.session.plan;
  const target = plan.get(id);
  const moving = plan.get(mover);
  if (!target || !moving) throw new Error("no such building");
  plan.beginMove([mover]);
  const blocked = !plan.testMove(target.x - moving.x, target.y - moving.y).valid;
  plan.cancelMove();
  return blocked;
};

/** Where the plan says a building is. */
const at = (harness: Harness, id: number): Point => {
  const node = harness.session.plan.get(id);
  if (!node) throw new Error("no such building");
  return { x: node.x, y: node.y };
};

/* ── Picking up and dropping ──────────────────────────────────────────────── */

describe("click to carry", () => {
  it("picks a building up on a click that does not travel", () => {
    const harness = planner();
    harness.click(ONE);

    expect(harness.session.state().carrying).toBe(true);
    expect(harness.session.selectedIds()).toEqual([1]);

    // Still lifted: the sprite follows the pointer with no button held, and
    // the plan answers drop questions about what is in hand.
    harness.drag(by(ONE, 100, 0));
    expect(harness.placements.get(1)).toEqual({ x: 100, y: 0 });
    expect(harness.session.plan.testMove(100, 0).valid).toBe(true);
    expect(harness.session.plan.testMove(200, 0).valid).toBe(false);
  });

  it("measures the carry from the pick-up point, not from the last move", () => {
    const harness = planner();
    harness.click(ONE);

    harness.drag(by(ONE, 100, 0));
    harness.drag(by(ONE, 50, 0));
    expect(harness.placements.get(1)).toEqual({ x: 50, y: 0 });

    harness.click(by(ONE, 50, 0));
    expect(at(harness, 1)).toEqual({ x: 50, y: 0 });
  });

  it("commits a drop onto free ground and records one undo entry", () => {
    const harness = planner();
    harness.click(ONE);
    harness.drag(by(ONE, 100, 0));
    harness.click(by(ONE, 100, 0));

    const state = harness.session.state();
    expect(state.carrying).toBe(false);
    expect(state.movedCount).toBe(1);
    expect(state.canUndo).toBe(true);
    expect(state.undoLabel).toBe("Move building");
    expect(at(harness, 1)).toEqual({ x: 100, y: 0 });
    expect(stillOccupies(harness, 1, 3)).toBe(true);
  });

  it("keeps a refused drop in hand until a legal one comes along", () => {
    const harness = planner();
    harness.click(ONE);

    // Straight on top of the second tower.
    harness.drag(TWO);
    harness.click(TWO);

    expect(harness.session.state().carrying).toBe(true);
    expect(harness.session.state().canUndo).toBe(false);
    expect(at(harness, 1)).toEqual({ x: 0, y: 0 });

    harness.drag(by(ONE, 100, 0));
    harness.click(by(ONE, 100, 0));

    expect(harness.session.state().carrying).toBe(false);
    expect(harness.session.state().movedCount).toBe(1);
    expect(at(harness, 1)).toEqual({ x: 100, y: 0 });
  });

  it("refuses a drop outside the plot and keeps it in hand", () => {
    const harness = planner();
    harness.click(ONE);
    harness.drag(by(ONE, 600, 0));
    harness.click(by(ONE, 600, 0));

    expect(harness.session.state().carrying).toBe(true);
    expect(at(harness, 1)).toEqual({ x: 0, y: 0 });
  });

  it("ends the carry with no undo entry when it is put back where it came from", () => {
    const harness = planner();
    harness.click(ONE);
    harness.drag(by(ONE, 100, 0));
    harness.drag(ONE);
    harness.click(ONE);

    const state = harness.session.state();
    expect(state.carrying).toBe(false);
    expect(state.canUndo).toBe(false);
    expect(state.movedCount).toBe(0);
    expect(at(harness, 1)).toEqual({ x: 0, y: 0 });
    expect(stillOccupies(harness, 1, 2)).toBe(true);
  });
});

/* ── Putting it back ──────────────────────────────────────────────────────── */

describe("cancelling a carry", () => {
  it("puts it back on the secondary button and swallows the context menu", () => {
    const harness = planner();
    harness.click(ONE);
    harness.drag(by(ONE, 100, 0));

    harness.press(by(ONE, 100, 0), { button: 2, buttons: 2 });
    const swallowed = harness.contextMenu();
    harness.release(by(ONE, 100, 0), { button: 2 });

    expect(swallowed).toBe(true);
    expect(harness.session.state().carrying).toBe(false);
    expect(harness.session.state().movedCount).toBe(0);
    expect(at(harness, 1)).toEqual({ x: 0, y: 0 });
    expect(harness.placements.get(1)).toEqual({ x: 0, y: 0 });
    expect(stillOccupies(harness, 1, 2)).toBe(true);
  });

  it("leaves an ordinary context menu alone", () => {
    const harness = planner();
    expect(harness.contextMenu()).toBe(false);
  });

  it("puts it back on Escape", () => {
    const harness = planner();
    harness.click(ONE);
    harness.drag(by(ONE, 100, 0));
    harness.key("Escape");

    expect(harness.session.state().carrying).toBe(false);
    expect(harness.session.selectedIds()).toEqual([1]);
    expect(at(harness, 1)).toEqual({ x: 0, y: 0 });
    expect(stillOccupies(harness, 1, 2)).toBe(true);
  });

  it("cancels the carry before it undoes", () => {
    const harness = planner();
    harness.click(ONE);
    harness.drag(by(ONE, 100, 0));
    harness.click(by(ONE, 100, 0));
    expect(at(harness, 1)).toEqual({ x: 100, y: 0 });

    harness.click(tileCentre(20, 100, 0));
    expect(harness.session.state().carrying).toBe(true);

    harness.key("z", { ctrlKey: true });

    const state = harness.session.state();
    expect(state.carrying).toBe(false);
    expect(state.canUndo).toBe(false);
    expect(state.movedCount).toBe(0);
    expect(at(harness, 1)).toEqual({ x: 0, y: 0 });
    expect(stillOccupies(harness, 1, 2)).toBe(true);
  });

  it("leaves nothing lifted and no grab cursor when the planner is left", () => {
    const harness = planner();
    harness.click(ONE);
    harness.drag(by(ONE, 100, 0));
    expect(harness.canvas.style.cursor).toBe("grabbing");

    harness.session.detach();

    expect(harness.canvas.style.cursor).toBe("");
    expect(at(harness, 1)).toEqual({ x: 0, y: 0 });
    expect(stillOccupies(harness, 1, 2)).toBe(true);
    expect(harness.placements.get(1)).toEqual({ x: 0, y: 0 });
  });
});

/* ── Selection ────────────────────────────────────────────────────────────── */

describe("selection", () => {
  it("never carries on a shift-click that deselects", () => {
    const harness = planner();
    harness.session.selectOnly([1, 2]);

    harness.click(ONE, { shiftKey: true });

    expect(harness.session.state().carrying).toBe(false);
    expect(harness.session.selectedIds()).toEqual([2]);
    expect(stillOccupies(harness, 1, 3)).toBe(true);
  });

  it("clears the selection on a click on bare ground", () => {
    const harness = planner();
    harness.session.selectOnly([1]);
    harness.click(GROUND);
    expect(harness.session.selectedIds()).toEqual([]);
  });
});

/* ── Views ────────────────────────────────────────────────────────────────── */

describe("switching views", () => {
  it("drops a carry rather than carrying it into the other view's pixels", () => {
    const harness = planner();
    harness.click(ONE);
    harness.drag(by(ONE, 100, 0));

    harness.setView(YardView.ISO);

    expect(harness.session.state().carrying).toBe(false);
    expect(harness.session.selectedIds()).toEqual([1]);
    expect(at(harness, 1)).toEqual({ x: 0, y: 0 });
    expect(stillOccupies(harness, 1, 2)).toBe(true);
  });

  it("keeps the selection when there was nothing in hand", () => {
    const harness = planner();
    harness.session.selectOnly([1, 2]);

    harness.setView(YardView.ISO);
    harness.setView(YardView.BLUEPRINT);

    expect(harness.session.selectedIds()).toEqual([1, 2]);
  });

  it("switches on Tab, which the session asks its owner to do", () => {
    const harness = planner();
    harness.key("Tab");
    expect(harness.view()).toBe(YardView.ISO);
    expect(harness.session.state().view).toBe(YardView.ISO);
  });
});

/* ── What the bar is told ─────────────────────────────────────────────────── */

describe("the state pushed to the bar", () => {
  it("says in hand on the pick-up and no longer on the drop", () => {
    const harness = planner();

    harness.click(ONE);
    expect(harness.states[harness.states.length - 1]?.carrying).toBe(true);

    harness.drag(by(ONE, 100, 0));
    harness.click(by(ONE, 100, 0));
    expect(harness.states[harness.states.length - 1]?.carrying).toBe(false);
  });

  it("says in hand again after a refused drop", () => {
    const harness = planner();
    harness.click(ONE);
    harness.drag(TWO);
    harness.click(TWO);
    expect(harness.states[harness.states.length - 1]?.carrying).toBe(true);
  });

  it("stops saying in hand the moment a carry is cancelled", () => {
    const harness = planner();
    harness.click(ONE);
    harness.key("Escape");
    expect(harness.states[harness.states.length - 1]?.carrying).toBe(false);
  });
});

/* ── Unsaved changes ──────────────────────────────────────────────────────── */

describe("the unsaved-changes flag", () => {
  it("starts clean and follows the undo stack in both directions", () => {
    const harness = planner();
    expect(harness.session.state().dirty).toBe(false);

    harness.click(ONE);
    harness.drag(by(ONE, 100, 0));
    harness.click(by(ONE, 100, 0));
    expect(harness.session.state().dirty).toBe(true);

    harness.session.undo();
    expect(harness.session.state().dirty).toBe(false);

    harness.session.redo();
    expect(harness.session.state().dirty).toBe(true);
  });

  it("treats a save as the new clean position", () => {
    const harness = planner();
    harness.click(ONE);
    harness.drag(by(ONE, 100, 0));
    harness.click(by(ONE, 100, 0));

    harness.session.markSaved(0, "Turtle");
    expect(harness.session.state().dirty).toBe(false);

    harness.session.undo();
    expect(harness.session.state().dirty).toBe(true);

    harness.session.redo();
    expect(harness.session.state().dirty).toBe(false);
  });

  it("stays clean through a carry that changes nothing", () => {
    const harness = planner();
    harness.click(ONE);
    harness.drag(by(ONE, 100, 0));
    harness.key("Escape");
    expect(harness.session.state().dirty).toBe(false);
  });
});
