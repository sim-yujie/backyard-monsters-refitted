// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LAYOUT_VERSION,
  type BaseLoadResponse,
  type BuildingData,
  type Layout,
} from "@/api/types";
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
import { GroupOp } from "./groupTools";
import {
  GroupRefusal,
  PlannerSession,
  PlannerTool,
  type GroupOutcome,
  type PlannerState,
} from "./PlannerSession";

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

const yardOf = (buildings: readonly BuildingData[]): Yard =>
  readYard({
    error: 0,
    id: 1,
    baseid: "1",
    basesaveid: 1,
    worldsize: [800, 800],
    currenttime: 1_700_000_000,
    savetime: 1_700_000_000,
    storedata: { ENL: { q: 0 } },
    // Enough of everything that a planned upgrade is never held back for
    // resources: what these tests are about is workers, undo and the stack.
    resources: { r1: 1e9, r2: 1e9, r3: 1e9, r4: 1e9 },
    buildingdata: Object.fromEntries(buildings.map((entry) => [String(entry.id), entry])),
    mushrooms: { l: [] },
  } as unknown as BaseLoadResponse);

const testYard = (): Yard => yardOf(BUILDINGS);

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
  /** Every group operation the session reported, newest last. */
  readonly groups: GroupOutcome[];
  /** The ids the session last asked for a red outline on. */
  readonly faulted: () => ReadonlySet<number>;
  /** How many times the session asked its owner to open the search box. */
  readonly finds: () => number;
  /** Where the renderer has each building drawn, in yard units. */
  readonly placements: ReadonlyMap<number, Point>;
  /**
   * The buildings the renderer has been told to stop drawing.
   *
   * Mutable, because one test has to forget them: rebuilding the sprites for a
   * rebase is exactly what clears them in the real renderer.
   */
  readonly hidden: Set<number>;
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
const planner = (
  options: { readOnly?: boolean; buildings?: readonly BuildingData[] } = {},
): Harness => {
  const yard = yardOf(options.buildings ?? BUILDINGS);
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
  const hidden = new Set<number>();

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
    setBuildingStored: (id: number, stored: boolean): void => {
      if (stored) hidden.add(id);
      else hidden.delete(id);
    },
    resortByDepth: (): void => {},
    resetPlacements: (): void => {
      for (const building of yard.buildings) {
        placements.set(building.id, { x: building.x, y: building.y });
      }
      hidden.clear();
    },
    pick: (worldX: number, worldY: number): YardBuilding | null => {
      for (const building of yard.buildings) {
        if (hidden.has(building.id)) continue;
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
    setPlannerVisuals: (visuals: { invalid: ReadonlySet<number> } | null): void => {
      faulted = visuals ? visuals.invalid : new Set<number>();
    },
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
  const groups: GroupOutcome[] = [];
  let finds = 0;
  let faulted: ReadonlySet<number> = new Set<number>();

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
    onFind: () => {
      finds++;
    },
    onGroup: (outcome) => groups.push(outcome),
    ...(options.readOnly === undefined ? {} : { readOnly: options.readOnly }),
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
    groups,
    faulted: () => faulted,
    finds: () => finds,
    placements,
    hidden,
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

/* ── Search ───────────────────────────────────────────────────────────────── */

describe("the find key", () => {
  it("asks the owner to open the search box without changing the tool", () => {
    const harness = planner();
    harness.key("b");
    expect(harness.session.state().tool).toBe(PlannerTool.BOX);

    harness.key("f");

    expect(harness.finds()).toBe(1);
    expect(harness.session.state().tool).toBe(PlannerTool.BOX);
  });

  it("leaves the selection and the plan alone", () => {
    const harness = planner();
    harness.session.selectOnly([1, 2]);
    harness.key("f");

    expect(harness.session.selectedIds()).toEqual([1, 2]);
    expect(at(harness, 1)).toEqual({ x: 0, y: 0 });
  });
});

/* ── A yard the server changed underneath ─────────────────────────────────── */

describe("rebase", () => {
  it("keeps the plan's positions and the undo stack after a move", () => {
    const harness = planner();
    harness.click(ONE);
    harness.drag(by(ONE, 100, 0));
    harness.click(by(ONE, 100, 0));

    harness.session.rebase(testYard());

    // The yard still has the tower at the origin; the plan's move survives.
    expect(at(harness, 1)).toEqual({ x: 100, y: 0 });
    expect(harness.placements.get(1)).toEqual({ x: 100, y: 0 });

    const state = harness.session.state();
    expect(state.canUndo).toBe(true);
    expect(state.undoLabel).toBe("Move building");
    expect(state.movedCount).toBe(1);
  });

  it("takes the new level from the yard", () => {
    const harness = planner();
    expect(harness.session.plan.get(3)?.level).toBe(1);

    const result = harness.session.rebase(
      yardOf([BUILDINGS[0]!, BUILDINGS[1]!, { id: 3, t: 17, X: -300, Y: -300, l: 5 }]),
    );

    expect(result.changed).toEqual([3]);
    expect(harness.session.plan.get(3)?.level).toBe(5);
  });

  it("adds a trap the yard has gained, where the yard has it", () => {
    const harness = planner();
    const result = harness.session.rebase(
      yardOf([...BUILDINGS, { id: 4, t: 24, X: 50, Y: 200 }]),
    );

    expect(result.added).toEqual([4]);
    expect(at(harness, 4)).toEqual({ x: 50, y: 200 });
    expect(harness.placements.get(4)).toEqual({ x: 50, y: 200 });
    // Its yard position is its origin, so a fresh trap does not read as moved.
    expect(harness.session.state().movedCount).toBe(0);
    expect(harness.session.plan.hasMoved(4)).toBe(false);
  });

  it("removes a building the yard no longer has and frees its cells", () => {
    const harness = planner();
    harness.session.selectOnly([1, 2]);

    const result = harness.session.rebase(yardOf([BUILDINGS[0]!, BUILDINGS[2]!]));

    expect(result.removed).toEqual([2]);
    expect(harness.session.plan.get(2)).toBeUndefined();
    expect(harness.session.selectedIds()).toEqual([1]);

    // Where the second tower stood is open ground now.
    const plan = harness.session.plan;
    plan.beginMove([1]);
    expect(plan.testMove(200, 0).valid).toBe(true);
    plan.cancelMove();
  });

  it("puts a carried selection down before it re-reads", () => {
    const harness = planner();
    harness.click(ONE);
    harness.drag(by(ONE, 100, 0));
    expect(harness.session.state().carrying).toBe(true);

    harness.session.rebase(testYard());

    expect(harness.session.state().carrying).toBe(false);
    expect(at(harness, 1)).toEqual({ x: 0, y: 0 });
    expect(stillOccupies(harness, 1, 2)).toBe(true);
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

/* ── Read-only ────────────────────────────────────────────────────────────── */

/**
 * A read-only session (design §8, Q5).
 *
 * The rule is that the planner still *opens* — the views, the selection, the
 * search and the cost cells all answer questions about the yard — and that no
 * path through the pointer or the keyboard can move anything. These press the
 * canvas exactly as the editing tests do and check the plan afterwards, which
 * is the only way to know the refusal is in the session rather than in a
 * button the tests never touch.
 */
describe("read-only", () => {
  it("reports itself in the state, as read-only and as previewing", () => {
    const state = planner({ readOnly: true }).session.state();
    expect(state.readOnly).toBe(true);
    // One flag for "looking, not editing", whatever the cause, so Apply and
    // the slot label need no second condition.
    expect(state.previewing).toBe(true);
  });

  it("still selects on a click, because the cost cells read the selection", () => {
    const harness = planner({ readOnly: true });
    harness.click(ONE);
    expect(harness.session.selectedIds()).toEqual([1]);
    // Selected, but never picked up.
    expect(harness.session.state().carrying).toBe(false);
  });

  it("refuses a drag: the building is still where the save had it", () => {
    const harness = planner({ readOnly: true });

    harness.press(ONE);
    harness.drag(by(ONE, 100, 0));
    harness.release(by(ONE, 100, 0));

    expect(at(harness, 1)).toEqual({ x: 0, y: 0 });
    expect(harness.placements.get(1)).toEqual({ x: 0, y: 0 });
    expect(harness.session.state().dirty).toBe(false);
    expect(harness.session.state().canUndo).toBe(false);
  });

  it("refuses a carry: a click never puts anything in hand", () => {
    const harness = planner({ readOnly: true });

    harness.click(ONE);
    expect(harness.session.state().carrying).toBe(false);

    // A pointer move after the click would be the carry following it.
    harness.drag(by(ONE, 100, 0));
    expect(at(harness, 1)).toEqual({ x: 0, y: 0 });
    expect(harness.placements.get(1)).toEqual({ x: 0, y: 0 });
  });

  it("refuses a nudge from the arrow keys", () => {
    const harness = planner({ readOnly: true });
    harness.click(ONE);

    harness.key("ArrowRight");
    harness.session.nudge(10, 0);

    expect(at(harness, 1)).toEqual({ x: 0, y: 0 });
    expect(harness.session.state().dirty).toBe(false);
  });

  it("box-selects, which changes nothing but what the cost cells add up", () => {
    const harness = planner({ readOnly: true });
    harness.session.setTool(PlannerTool.BOX);

    harness.press(blueprintToWorld(-50, -50));
    harness.drag(blueprintToWorld(300, 100));
    harness.release(blueprintToWorld(300, 100));

    expect(harness.session.selectedIds().sort()).toEqual([1, 2]);
    expect(at(harness, 1)).toEqual({ x: 0, y: 0 });
    expect(at(harness, 2)).toEqual({ x: 200, y: 0 });
  });

  it("opens a layout as a preview, never as an edit", () => {
    const harness = planner({ readOnly: true });

    // Asked for as a real load; a read-only session downgrades it.
    harness.session.load(
      {
        slot: 0,
        name: "Turtle",
        version: LAYOUT_VERSION,
        expansion: 0,
        updatedAt: 1_700_000_000,
        nodes: [{ id: 1, t: 20, x: 400, y: 200 }],
      },
      { preview: false },
    );

    expect(harness.session.state().previewing).toBe(true);
    expect(harness.session.state().dirty).toBe(false);
    expect(harness.session.state().slot).toBeNull();

    harness.session.dismissPreview();
    expect(at(harness, 1)).toEqual({ x: 0, y: 0 });
  });

  it("leaves an editable session alone", () => {
    const harness = planner();
    expect(harness.session.state().readOnly).toBe(false);
    expect(harness.session.state().previewing).toBe(false);

    harness.press(ONE);
    harness.drag(by(ONE, 100, 0));
    harness.release(by(ONE, 100, 0));

    expect(at(harness, 1)).toEqual({ x: 100, y: 0 });
  });
});

/* ── F1: planned upgrades ────────────────────────────────────────────────── */

/** The three-building yard plus a level 10 Town Hall, so gates are clear. */
const WITH_HALL: readonly BuildingData[] = [...BUILDINGS, { id: 4, t: 14, X: 300, Y: 200, l: 10 }];

/** A layout naming one tower, with a plan on it. */
const plannedLayout = (over: Partial<Layout> = {}): Layout => ({
  slot: 1,
  name: "Towers",
  version: LAYOUT_VERSION,
  expansion: 0,
  updatedAt: 1_700_000_000,
  nodes: [{ id: 1, t: 20, x: 400, y: 200, plan: { level: 4, order: 0 } }],
  ...over,
});

describe("planning an upgrade", () => {
  it("is one undo entry, and dirties the plan like any other edit", () => {
    const harness = planner();

    expect(harness.session.setPlanLevel([1], 3)).toBe(1);

    const state = harness.session.state();
    expect(state.plannedCount).toBe(1);
    expect(state.dirty).toBe(true);
    expect(state.canUndo).toBe(true);
    expect(state.undoLabel).toBe("Plan Cannon Tower to L3");

    harness.session.undo();
    expect(harness.session.state().plannedCount).toBe(0);
    expect(harness.session.plan.get(1)!.plan).toBeNull();
  });

  it("plans a whole selection in one command", () => {
    const harness = planner();

    expect(harness.session.setPlanLevel([1, 2], 2)).toBe(2);
    expect(harness.session.state().undoLabel).toBe("Plan 2 buildings to L2");

    harness.session.undo();
    expect(harness.session.state().plannedCount).toBe(0);
  });

  it("counts only what actually changed", () => {
    const harness = planner();
    harness.session.setPlanLevel([1], 2);

    // The wall is a Block at level 1, which can be planned; the same level
    // again on the tower is not a change.
    expect(harness.session.setPlanLevel([1, 3], 2)).toBe(1);
    expect(harness.session.state().plannedCount).toBe(2);
  });

  it("clears a plan, and says so on the undo button", () => {
    const harness = planner();
    harness.session.setPlanLevel([1], 5);

    expect(harness.session.setPlanLevel([1], null)).toBe(1);
    expect(harness.session.state().undoLabel).toBe("Clear plan on Cannon Tower");
    expect(harness.session.state().plannedCount).toBe(0);

    harness.session.undo();
    expect(harness.session.plan.get(1)!.plan).toEqual({ level: 5, order: 0 });
  });

  it("pushes nothing when every building refuses", () => {
    const harness = planner();
    // Level 1 is the level they are at.
    expect(harness.session.setPlanLevel([1, 2], 1)).toBe(0);
    expect(harness.session.state().canUndo).toBe(false);
    expect(harness.session.state().dirty).toBe(false);
  });

  it("lists the planned buildings in walk order and by id", () => {
    const harness = planner();
    harness.session.setPlanLevel([2], 2);
    harness.session.setPlanLevel([1], 3);

    expect(harness.session.plannedNodes().map((node) => node.id)).toEqual([2, 1]);
    expect(harness.session.plannedLevels()).toEqual(
      new Map([
        [1, 3],
        [2, 2],
      ]),
    );
  });

  it("is refused outright in a read-only session", () => {
    const harness = planner({ readOnly: true });

    expect(harness.session.setPlanLevel([1], 3)).toBe(0);
    expect(harness.session.state().plannedCount).toBe(0);
    expect(harness.session.state().canUndo).toBe(false);
  });
});

describe("the Apply preview through the session", () => {
  it("starts one job per free worker and holds the rest back", () => {
    // One worker: `storedata` has no `BEW`, so the second tower waits.
    const harness = planner({ buildings: WITH_HALL });
    harness.session.setPlanLevel([1], 2);
    harness.session.setPlanLevel([2], 2);

    const preview = harness.session.applyPreview();
    expect(preview.workers.total).toBe(1);
    expect(preview.started.map((row) => row.id)).toEqual([1]);
    expect(preview.waiting.map((row) => row.id)).toEqual([2]);
  });

  it("adds warning rows to the checklist that do not block Apply", () => {
    const harness = planner({ buildings: WITH_HALL });
    harness.session.setPlanLevel([1], 2);
    harness.session.setPlanLevel([2], 2);

    const checklist = harness.session.checklist();
    const workers = checklist.rows.find((row) => row.key === "upgradeWorkers")!;

    expect(workers.warning).toBe(true);
    expect(workers.ok).toBe(false);
    expect(workers.items.map((item) => item.id)).toEqual([2]);
    // A warning never stops Apply, and never outlines anything in red.
    expect(checklist.ok).toBe(true);
    expect(harness.faulted().has(2)).toBe(false);
  });

  it("leaves the upgrade rows out entirely when nothing is planned", () => {
    const harness = planner({ buildings: WITH_HALL });
    const keys = harness.session.checklist().rows.map((row) => row.key);

    expect(keys).toEqual(["placed", "overlap", "bounds"]);
  });
});

describe("loading a layout with plans", () => {
  it("moves and plans in one undo entry", () => {
    const harness = planner();
    const result = harness.session.load(plannedLayout());

    expect(result.plans).toHaveLength(1);
    expect(harness.session.plan.get(1)!.plan).toEqual({ level: 4, order: 0 });
    expect(at(harness, 1)).toEqual({ x: 400, y: 200 });
    expect(harness.session.state().undoLabel).toBe("Load “Towers”");

    harness.session.undo();
    expect(harness.session.plan.get(1)!.plan).toBeNull();
    expect(at(harness, 1)).toEqual({ x: 0, y: 0 });
    // One entry, not two.
    expect(harness.session.state().canUndo).toBe(false);
  });

  it("reports the plans it had to drop", () => {
    const harness = planner();
    const result = harness.session.load(
      plannedLayout({ nodes: [{ id: 1, t: 20, x: 400, y: 200, plan: { level: 99, order: 0 } }] }),
    );

    expect(result.plans).toEqual([]);
    expect(result.plansDropped).toBe(1);
    expect(harness.session.state().plannedCount).toBe(0);
  });

  it("puts plans back when a preview is dismissed", () => {
    const harness = planner();
    harness.session.setPlanLevel([2], 6);

    harness.session.load(plannedLayout(), { preview: true });
    expect(harness.session.plan.get(1)!.plan).toEqual({ level: 4, order: 0 });

    harness.session.dismissPreview();
    expect(harness.session.plan.get(1)!.plan).toBeNull();
    // The plan made before the preview is still there afterwards.
    expect(harness.session.plan.get(2)!.plan).toEqual({ level: 6, order: 0 });
    expect(harness.session.state().dirty).toBe(true);
  });
});

describe("rebase against a plan", () => {
  it("drops a plan the yard has caught up with and reports it", () => {
    const harness = planner();
    harness.session.setPlanLevel([1], 2);

    const result = harness.session.rebase(
      yardOf(BUILDINGS.map((one) => (one.id === 1 ? { ...one, l: 2 } : one))),
    );

    expect(result.plansDropped).toEqual([1]);
    expect(harness.session.state().plannedCount).toBe(0);
  });

  it("measures the preview against the yard it was handed", () => {
    const harness = planner({ buildings: WITH_HALL });
    harness.session.setPlanLevel([1], 2);

    // The tower is now mid-upgrade, so Apply would skip it as busy.
    harness.session.rebase(
      yardOf(WITH_HALL.map((one) => (one.id === 1 ? { ...one, cU: 600 } : one))),
    );

    expect(harness.session.applyPreview().skipped).toEqual([
      { id: 1, t: 20, reason: "busy", from: 1, to: 2 },
    ]);
  });
});

/* ── F7: mirror, align and distribute ────────────────────────────────────── */

/** A ragged row of three walls, close enough to be worth straightening. */
const RAGGED: readonly BuildingData[] = [
  { id: 1, t: 17, X: 0, Y: 0 },
  { id: 2, t: 17, X: 40, Y: 25 },
  { id: 3, t: 17, X: 80, Y: 60 },
];

describe("mirror, align and distribute", () => {
  it("commits a mirror as a single undo entry", () => {
    const harness = planner();
    harness.session.selectOnly([1, 2]);

    // The two towers span 0 to 270, so the reflection swaps them.
    const outcome = harness.session.groupTool(GroupOp.MIRROR_X);

    expect(outcome).toEqual({
      op: GroupOp.MIRROR_X,
      ok: true,
      moved: 2,
      blocked: 0,
      reason: null,
    });
    expect(at(harness, 1)).toEqual({ x: 200, y: 0 });
    expect(at(harness, 2)).toEqual({ x: 0, y: 0 });
    expect(harness.placements.get(1)).toEqual({ x: 200, y: 0 });
    expect(harness.session.state().undoLabel).toBe("Mirror left to right · 2 buildings");

    harness.session.undo();
    expect(at(harness, 1)).toEqual({ x: 0, y: 0 });
    expect(at(harness, 2)).toEqual({ x: 200, y: 0 });
    // One entry for the whole operation: a second undo has nothing to reverse.
    expect(harness.session.state().canUndo).toBe(false);
    expect(harness.session.state().movedCount).toBe(0);
  });

  it("straightens a ragged row in one command", () => {
    const harness = planner({ buildings: RAGGED });
    harness.session.selectOnly([1, 2, 3]);

    // The lowest bottom edge is 60 + 20, so every 20-unit wall starts at 60.
    const outcome = harness.session.groupTool(GroupOp.ALIGN_BOTTOM);

    expect(outcome.ok).toBe(true);
    expect(outcome.moved).toBe(2);
    expect(at(harness, 1)).toEqual({ x: 0, y: 60 });
    expect(at(harness, 2)).toEqual({ x: 40, y: 60 });
    expect(at(harness, 3)).toEqual({ x: 80, y: 60 });
    expect(harness.session.state().undoLabel).toBe("Align bottom · 2 buildings");
    expect(harness.session.state().movedCount).toBe(2);
  });

  it("counts the buildings it moved, not the ones selected", () => {
    const harness = planner({ buildings: RAGGED });
    harness.session.selectOnly([1, 2]);

    // Only the second wall is off the top line, so only it moves.
    expect(harness.session.groupTool(GroupOp.ALIGN_TOP).moved).toBe(1);
    expect(harness.session.state().undoLabel).toBe("Align top · 1 building");
  });

  it("spaces a row evenly and leaves the outermost two where they are", () => {
    const harness = planner({
      buildings: [
        { id: 1, t: 17, X: 0, Y: 0 },
        { id: 2, t: 17, X: 30, Y: 0 },
        { id: 3, t: 17, X: 200, Y: 0 },
      ],
    });
    harness.session.selectOnly([1, 2, 3]);

    // Span 220 less three 20-unit walls is 160 of space over two gaps.
    expect(harness.session.groupTool(GroupOp.DISTRIBUTE_X).moved).toBe(1);
    expect(at(harness, 1)).toEqual({ x: 0, y: 0 });
    expect(at(harness, 2)).toEqual({ x: 100, y: 0 });
    expect(at(harness, 3)).toEqual({ x: 200, y: 0 });
  });

  it("answers M and Shift+M from the canvas", () => {
    const harness = planner();
    harness.session.selectOnly([1, 2]);

    harness.key("m");
    expect(at(harness, 1)).toEqual({ x: 200, y: 0 });

    // Both towers sit at y 0 and are the same height, so the other axis is the
    // identity and the session says so rather than pushing an empty command.
    harness.key("M", { shiftKey: true });
    expect(harness.groups.at(-1)?.reason).toBe(GroupRefusal.NO_CHANGE);
    expect(harness.session.state().canUndo).toBe(true);
    harness.session.undo();
    expect(harness.session.state().canUndo).toBe(false);
  });

  it("says a selection is too small rather than doing half of it", () => {
    const harness = planner({ buildings: RAGGED });

    harness.session.selectOnly([1]);
    expect(harness.session.groupTool(GroupOp.MIRROR_X).reason).toBe(GroupRefusal.TOO_FEW);

    harness.session.selectOnly([1, 3]);
    expect(harness.session.groupTool(GroupOp.DISTRIBUTE_X).reason).toBe(GroupRefusal.TOO_FEW);
    expect(harness.session.state().canUndo).toBe(false);
  });
});

describe("a group operation that cannot be done", () => {
  it("moves nothing when two of the selection would land on each other", () => {
    const harness = planner();
    harness.session.selectOnly([1, 2]);

    // Both towers sit at y 0, so putting their left edges on one line stacks
    // the second on the first.
    const outcome = harness.session.groupTool(GroupOp.ALIGN_LEFT);

    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe(GroupRefusal.BLOCKED);
    expect(at(harness, 1)).toEqual({ x: 0, y: 0 });
    expect(at(harness, 2)).toEqual({ x: 200, y: 0 });
    expect(harness.session.state().canUndo).toBe(false);
    expect(harness.session.state().dirty).toBe(false);
    expect([...harness.faulted()].sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it("names a building that was never selected", () => {
    // A tower at the top, a wall below it, and an unselected wall in the gap
    // that the tower's mirrored footprint reaches over.
    const harness = planner({
      buildings: [
        { id: 1, t: 20, X: 0, Y: 0 },
        { id: 2, t: 17, X: 0, Y: 100 },
        { id: 4, t: 17, X: 0, Y: 80 },
      ],
    });
    harness.session.selectOnly([1, 2]);

    const outcome = harness.session.groupTool(GroupOp.MIRROR_Y);

    expect(outcome.ok).toBe(false);
    expect(outcome.blocked).toBeGreaterThan(0);
    expect(harness.faulted().has(4)).toBe(true);
    expect(at(harness, 1)).toEqual({ x: 0, y: 0 });
    expect(at(harness, 2)).toEqual({ x: 0, y: 100 });
    expect(harness.placements.get(1)).toEqual({ x: 0, y: 0 });
  });

  it("leaves the grid intact, so the next drag still sees every building", () => {
    const harness = planner();
    harness.session.selectOnly([1, 2]);
    harness.session.groupTool(GroupOp.ALIGN_LEFT);

    // The refused operation put both towers' cells back: tower 2 still cannot
    // be dragged onto tower 1, and can still be dragged somewhere free.
    expect(stillOccupies(harness, 1, 2)).toBe(true);
    harness.session.nudge(0, 100);
    expect(at(harness, 1)).toEqual({ x: 0, y: 100 });
    expect(at(harness, 2)).toEqual({ x: 200, y: 100 });
  });

  it("is refused outright in a read-only session", () => {
    const harness = planner({ readOnly: true });
    harness.session.selectOnly([1, 2]);

    expect(harness.session.groupTool(GroupOp.MIRROR_X).reason).toBe(GroupRefusal.READ_ONLY);
    expect(at(harness, 1)).toEqual({ x: 0, y: 0 });
    expect(harness.session.state().canUndo).toBe(false);
  });
});

/* ── Touch and mobile gestures (F14) ──────────────────────────────────────── */

/** A press or release from a particular finger. */
const finger = (id: number): PointerEventInit => ({ pointerType: "touch", pointerId: id });

/**
 * Every `pointerdown` that got past the planner to the canvas.
 *
 * The planner listens on `window` in the capture phase and stops the presses it
 * claims, so a press that arrives here is one the camera will see — which is
 * the whole question for a pinch: the camera needs both pointers to have
 * pressed on it, and it never gets a second one if the planner ate the first.
 */
const reachedCanvas = (harness: Harness): number[] => {
  const seen: number[] = [];
  harness.canvas.addEventListener("pointerdown", (event) => {
    seen.push((event as PointerEvent).pointerId);
  });
  return seen;
};

describe("touch gestures", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("picks a building up when a finger is held still on it", () => {
    const harness = planner();
    harness.press(ONE, finger(1));

    // Not yet. Anything shorter than this is a tap, and until it fires the
    // finger is the camera's.
    vi.advanceTimersByTime(399);
    expect(harness.session.state().carrying).toBe(false);

    vi.advanceTimersByTime(1);
    expect(harness.session.state().carrying).toBe(true);
    expect(harness.session.selectedIds()).toEqual([1]);

    // From here it is the state a click gives a mouse: the finger drags it,
    // lifting leaves it in hand, and the next tap drops it.
    harness.drag(by(ONE, 100, 0));
    expect(harness.placements.get(1)).toEqual({ x: 100, y: 0 });

    harness.release(by(ONE, 100, 0), finger(1));
    expect(harness.session.state().carrying).toBe(true);

    harness.press(by(ONE, 100, 0), finger(1));
    expect(harness.session.state().carrying).toBe(false);
    expect(at(harness, 1)).toEqual({ x: 100, y: 0 });
  });

  it("drops where the tap lands, with no move between lifting and tapping", () => {
    const harness = planner();
    harness.press(ONE, finger(1));
    vi.advanceTimersByTime(400);
    harness.release(ONE, finger(1));

    // Touch sends no `pointermove` before a press, so the drop has to read its
    // own position rather than the last drag's.
    harness.press(by(ONE, 100, 0), finger(1));
    expect(harness.session.state().carrying).toBe(false);
    expect(at(harness, 1)).toEqual({ x: 100, y: 0 });
  });

  it("gives up the hold as soon as the finger travels", () => {
    const harness = planner();
    harness.press(ONE, finger(1));
    harness.drag(by(ONE, 40, 0));
    vi.advanceTimersByTime(600);
    harness.release(by(ONE, 40, 0), finger(1));

    // A pan across a building, which is what this is, moves the view and
    // leaves the yard alone.
    expect(harness.session.state().carrying).toBe(false);
    expect(harness.session.selectedIds()).toEqual([]);
    expect(harness.placements.get(1)).toEqual({ x: 0, y: 0 });
  });

  it("selects on a tap and picks nothing up", () => {
    const harness = planner();
    harness.press(ONE, finger(1));
    vi.advanceTimersByTime(100);
    harness.release(ONE, finger(1));

    const state = harness.session.state();
    expect(harness.session.selectedIds()).toEqual([1]);
    expect(state.carrying).toBe(false);
    expect(state.movedCount).toBe(0);

    // And a tap on bare ground clears it again, as a click does.
    harness.press(GROUND, finger(1));
    harness.release(GROUND, finger(1));
    expect(harness.session.selectedIds()).toEqual([]);
  });

  it("adds to the selection when a tap comes with Shift", () => {
    const harness = planner();
    harness.press(ONE, finger(1));
    harness.release(ONE, finger(1));
    harness.press(TWO, { ...finger(1), shiftKey: true });
    harness.release(TWO, { ...finger(1), shiftKey: true });

    expect(harness.session.selectedIds()).toEqual([1, 2]);
  });

  it("leaves both fingers to the camera, so a pinch still zooms", () => {
    const harness = planner();
    const seen = reachedCanvas(harness);

    harness.press(ONE, finger(1));
    harness.press(by(ONE, 200, 200), finger(2));
    vi.advanceTimersByTime(600);

    expect(seen).toEqual([1, 2]);
    expect(harness.session.state().carrying).toBe(false);
    expect(harness.session.selectedIds()).toEqual([]);
  });

  it("draws a box from one finger and hands it back when a second lands", () => {
    const harness = planner();
    harness.session.setTool(PlannerTool.BOX);
    const seen = reachedCanvas(harness);

    // The box tool is the one press touch still claims on the way down: it has
    // nothing to do with what is under the finger.
    harness.press(GROUND, finger(1));
    harness.drag(by(GROUND, 20, 20));
    expect(seen).toEqual([]);

    harness.press(by(GROUND, 120, 120), finger(2));
    expect(seen).toEqual([2]);

    // The box is over rather than still growing: dragging the first finger
    // across a tower no longer sweeps it up.
    harness.drag(ONE);
    expect(harness.session.selectedIds()).toEqual([]);
  });

  it("puts a drag back when a second pointer joins it", () => {
    const harness = planner();
    harness.press(ONE);
    harness.drag(by(ONE, 100, 0));
    expect(harness.placements.get(1)).toEqual({ x: 100, y: 0 });

    harness.press(by(ONE, 300, 200), finger(2));

    // Restored, and the gesture is finished: both pointers are the camera's
    // now, so a pinch does not drag the building along with the zoom.
    expect(harness.placements.get(1)).toEqual({ x: 0, y: 0 });
    expect(at(harness, 1)).toEqual({ x: 0, y: 0 });
    expect(harness.session.state().movedCount).toBe(0);

    harness.drag(by(ONE, 200, 0));
    expect(harness.placements.get(1)).toEqual({ x: 0, y: 0 });
  });

  it("puts a carried selection back on the chip's behalf", () => {
    const harness = planner();
    harness.press(ONE, finger(1));
    vi.advanceTimersByTime(400);
    harness.drag(by(ONE, 100, 0));
    expect(harness.placements.get(1)).toEqual({ x: 100, y: 0 });

    harness.session.putBack();

    const state = harness.session.state();
    expect(state.carrying).toBe(false);
    expect(state.movedCount).toBe(0);
    expect(at(harness, 1)).toEqual({ x: 0, y: 0 });
    expect(harness.placements.get(1)).toEqual({ x: 0, y: 0 });
    // The selection survives: putting a move back is not a deselect.
    expect(harness.session.selectedIds()).toEqual([1]);
  });

  it("leaves the selection alone when nothing is in hand", () => {
    const harness = planner();
    harness.session.selectOnly([1, 2]);
    harness.session.putBack();
    expect(harness.session.selectedIds()).toEqual([1, 2]);
  });
});

/* ── Storing and placing (issue #50) ──────────────────────────────────────── */

describe("storing", () => {
  it("takes the selection off the yard on Delete", () => {
    const harness = planner();
    harness.click(ONE);
    harness.key("Delete");

    const state = harness.session.state();
    expect(state.storedCount).toBe(1);
    expect(harness.session.plan.get(1)?.stored).toBe(true);
    // Drawn nowhere, and out of the selection: it cannot be dragged now.
    expect(harness.hidden.has(1)).toBe(true);
    expect(harness.session.selectedIds()).toEqual([]);
  });

  it("takes Backspace too, and frees the cells it left", () => {
    const harness = planner();
    harness.click(ONE);
    harness.key("Backspace");

    expect(harness.session.state().storedCount).toBe(1);
    // Tower two can now be dragged onto tower one's old spot.
    harness.press(TWO);
    harness.drag(by(TWO, -200, 0));
    harness.release(by(TWO, -200, 0));
    expect(at(harness, 2)).toEqual({ x: 0, y: 0 });
  });

  it("is one undo entry however many it took", () => {
    const harness = planner();
    harness.session.selectOnly([1, 2]);

    expect(harness.session.store()).toBe(2);
    expect(harness.session.state().undoLabel).toBe("Store · 2 buildings");

    harness.session.undo();

    expect(harness.session.state().storedCount).toBe(0);
    expect(at(harness, 1)).toEqual({ x: 0, y: 0 });
    expect(at(harness, 2)).toEqual({ x: 200, y: 0 });
    // Drawn again, and back where they stood.
    expect(harness.hidden.size).toBe(0);
    expect(harness.placements.get(1)).toEqual({ x: 0, y: 0 });
  });

  it("names the one building it stored", () => {
    const harness = planner();
    harness.session.selectOnly([1]);
    harness.session.store();
    expect(harness.session.state().undoLabel).toContain("Store ");
  });

  it("does nothing with an empty selection", () => {
    const harness = planner();
    expect(harness.session.store()).toBe(0);
    expect(harness.session.state().canUndo).toBe(false);
  });

  it("clears the whole yard as one entry", () => {
    const harness = planner();
    const total = harness.session.plan.buildings().length;

    expect(harness.session.clearYard()).toBe(total);

    expect(harness.session.state().storedCount).toBe(total);
    expect(harness.session.plan.buildings()).toEqual([]);
    expect(harness.session.state().undoLabel).toBe(`Store · ${total} buildings`);

    harness.session.undo();
    expect(harness.session.state().storedCount).toBe(0);
    expect(harness.session.plan.buildings()).toHaveLength(total);
  });

  it("blocks Apply while anything is in the drawer, and names it", () => {
    const harness = planner();
    expect(harness.session.checklist().ok).toBe(true);

    harness.session.selectOnly([1]);
    harness.session.store();

    const checklist = harness.session.checklist();
    expect(checklist.ok).toBe(false);
    const row = checklist.rows.find((entry) => entry.key === "placed");
    expect(row?.ok).toBe(false);
    expect(row?.items.map((item) => item.id)).toEqual([1]);
    expect(row?.items[0]?.label).toContain("drawer");
  });

  it("refuses every part of it in a read-only session", () => {
    const harness = planner({ readOnly: true });
    harness.session.selectOnly([1]);

    expect(harness.session.store()).toBe(0);
    expect(harness.session.clearYard()).toBe(0);
    harness.key("Delete");

    expect(harness.session.state().storedCount).toBe(0);
    expect(harness.session.state().canUndo).toBe(false);
  });
});

describe("placing from the drawer", () => {
  /** Stores tower one and picks it back up. */
  const inHand = (): Harness => {
    const harness = planner();
    harness.session.selectOnly([1]);
    harness.session.store();
    expect(harness.session.startPlacing(1)).toBe(true);
    return harness;
  };

  it("follows the pointer by its own centre, then drops on a click", () => {
    const harness = inHand();
    expect(harness.session.state().placing).toBe(true);
    expect(harness.session.state().carrying).toBe(true);

    // A 70-unit tower centred on (400, 300) has its origin at (365, 265),
    // snapped onto the five-unit grid.
    const target = blueprintToWorld(400, 300);
    harness.drag(target);
    expect(harness.placements.get(1)).toEqual({ x: 365, y: 265 });

    harness.press(target);

    const state = harness.session.state();
    expect(state.placing).toBe(false);
    expect(state.storedCount).toBe(0);
    expect(at(harness, 1)).toEqual({ x: 365, y: 265 });
    expect(harness.hidden.has(1)).toBe(false);
    expect(state.undoLabel).toContain("Place ");
  });

  it("undoes back into the drawer", () => {
    const harness = inHand();
    const target = blueprintToWorld(400, 300);
    harness.drag(target);
    harness.press(target);

    harness.session.undo();

    expect(harness.session.state().storedCount).toBe(1);
    expect(harness.session.plan.get(1)?.stored).toBe(true);
    expect(harness.hidden.has(1)).toBe(true);
  });

  it("keeps it in hand when the spot is taken", () => {
    const harness = inHand();

    // Straight over tower two, which has not moved.
    harness.drag(TWO);
    expect(harness.session.state().dragInvalid).toBe(true);
    harness.press(TWO);

    const state = harness.session.state();
    expect(state.placing).toBe(true);
    expect(state.storedCount).toBe(1);
    expect(state.canUndo).toBe(true); // the store, not a placement
    expect(state.undoLabel).toContain("Store");
  });

  it("goes back to the drawer on Escape", () => {
    const harness = inHand();
    harness.drag(blueprintToWorld(400, 300));

    harness.key("Escape");

    const state = harness.session.state();
    expect(state.placing).toBe(false);
    expect(state.carrying).toBe(false);
    expect(state.storedCount).toBe(1);
    expect(harness.hidden.has(1)).toBe(true);
    // Nothing was committed, so the only entry is the store itself.
    expect(state.undoLabel).toContain("Store");
  });

  it("goes back to the drawer on the Put back chip", () => {
    const harness = inHand();
    harness.drag(blueprintToWorld(400, 300));

    harness.session.putBack();

    expect(harness.session.state().placing).toBe(false);
    expect(harness.session.state().storedCount).toBe(1);
  });

  it("refuses a building that is not in the drawer, and a read-only session", () => {
    const harness = planner();
    expect(harness.session.startPlacing(1)).toBe(false);

    const readOnly = planner({ readOnly: true });
    expect(readOnly.session.startPlacing(1)).toBe(false);
  });

  it("hides the drawer's buildings again after a rebase rebuilds the sprites", () => {
    const harness = planner();
    harness.session.selectOnly([1]);
    harness.session.store();
    expect(harness.hidden.has(1)).toBe(true);

    // A batch action rebuilds the renderer's sprites from the new save, and
    // fresh sprites are all visible.
    harness.hidden.clear();
    harness.session.rebase(testYard());

    expect(harness.session.state().storedCount).toBe(1);
    expect(harness.hidden.has(1)).toBe(true);
  });

  it("drops a stored building the yard no longer has", () => {
    const harness = planner();
    harness.session.selectOnly([3]);
    harness.session.store();

    harness.session.rebase(yardOf([BUILDINGS[0]!, BUILDINGS[1]!]));

    expect(harness.session.state().storedCount).toBe(0);
    expect(harness.session.plan.get(3)).toBeUndefined();
  });
});
