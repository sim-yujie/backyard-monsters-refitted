import { describe, expect, it } from "vitest";
import { towerRange, towerStats } from "@/game/combat/rules";
import { rangeRadii } from "./planner/RangeLayer";
import { YardRenderer, YardView } from "./YardRenderer";
import {
  expoEaseOut,
  hoverRange,
  pointerHovers,
  RANGE_HOVER_DELAY,
  RANGE_HOVER_GROW,
  rangeHoverFrame,
  type RangeHoverYard,
} from "./towerRangeHover";
import { BuildingCondition, type Yard, type YardBuilding, type YardCountdown } from "./yardModel";

/**
 * The range oval on hover (owner, beta 6 grill, 2 Nov 2026): Flash's
 * `BTOWER.RangeIndicator`, on the player's own yards only, sized by the range
 * the combat engine fires at.
 */

const CANNON = 21;
const BUNKER = 22;
const BOOBY_TRAP = 24;
const INFERNO_BUNKER = 128;
const SILO = 6;

const OWN: RangeHoverYard = { foreign: false, kind: "main", cellHeight: 0 };
const VISIT: RangeHoverYard = { foreign: true, kind: "main", cellHeight: 0 };

const building = (type: number, extra: Partial<YardBuilding> = {}): YardBuilding =>
  ({
    id: 1,
    type,
    level: 3,
    countdown: null,
    condition: BuildingCondition.HEALTHY,
    hp: null,
    centreX: 400,
    centreY: 300,
    ...extra,
  }) as unknown as YardBuilding;

const countdown = (kind: YardCountdown["kind"]): YardCountdown => ({
  kind,
  endsAt: 0,
  seconds: 60,
  paused: false,
});

describe("hoverRange: which buildings show an oval", () => {
  it("a standing defence on the player's own yard shows its combat range", () => {
    expect(hoverRange(building(CANNON), OWN)).toBe(towerRange(CANNON, 3));
    expect(hoverRange(building(CANNON), OWN)).toBeGreaterThan(0);
  });

  it("never on somebody else's yard: a visit, an attack or a replay", () => {
    expect(hoverRange(building(CANNON), VISIT)).toBeNull();
    expect(hoverRange(building(BUNKER), VISIT)).toBeNull();
  });

  it("Monster Bunkers show one; traps and other buildings do not", () => {
    expect(hoverRange(building(BUNKER), OWN)).toBe(towerStats(BUNKER, 3)?.range);
    expect(hoverRange(building(BOOBY_TRAP), OWN)).toBeNull();
    expect(hoverRange(building(SILO), OWN)).toBeNull();
  });

  it("not while it is being built, upgraded or fortified, nor waiting to be rebuilt", () => {
    for (const kind of ["build", "upgrade", "fortify", "rebuild"] as const) {
      expect(hoverRange(building(CANNON, { countdown: countdown(kind) }), OWN)).toBeNull();
    }
    expect(hoverRange(building(CANNON, { level: 0 }), OWN)).toBeNull();
  });

  it("not once destroyed; a damaged one still shows it, as in Flash (`health > 0`)", () => {
    expect(hoverRange(building(CANNON, { condition: BuildingCondition.DESTROYED }), OWN)).toBeNull();
    expect(hoverRange(building(CANNON, { hp: 0 }), OWN)).toBeNull();
    expect(hoverRange(building(CANNON, { condition: BuildingCondition.DAMAGED, hp: 10 }), OWN)).toBe(
      towerRange(CANNON, 3),
    );
  });

  it("a Map Room 2 outpost stretches a tower by its cell height, the engine's own figure", () => {
    const flat: RangeHoverYard = { foreign: false, kind: "outpost", cellHeight: 0 };
    const hill: RangeHoverYard = { foreign: false, kind: "outpost", cellHeight: 250 };
    const low: RangeHoverYard = { foreign: false, kind: "outpost", cellHeight: 99 };
    const base = towerRange(CANNON, 3, "outpost") ?? 0;
    expect(hoverRange(building(CANNON), flat)).toBe(base);
    expect(hoverRange(building(CANNON), low)).toBe(base);
    expect(hoverRange(building(CANNON), hill)).toBe(Math.trunc((250 * base) / 125));
    expect(hoverRange(building(CANNON), hill)).toBe(towerRange(CANNON, 3, "outpost", 250));
  });

  it("a bunker keeps its table range on a hill, as the engine dispatches from it", () => {
    const hill: RangeHoverYard = { foreign: false, kind: "outpost", cellHeight: 250 };
    expect(hoverRange(building(BUNKER), hill)).toBe(towerStats(BUNKER, 3, "outpost")?.range);
  });

  it("the Inferno yard reads the Inferno tables, Inferno bunker included", () => {
    const inferno: RangeHoverYard = { foreign: false, kind: "inferno", cellHeight: 0 };
    expect(hoverRange(building(CANNON), inferno)).toBe(towerRange(CANNON, 3, "inferno"));
    expect(hoverRange(building(INFERNO_BUNKER, { level: 1 }), inferno)).toBe(
      towerStats(INFERNO_BUNKER, 1, "inferno")?.range,
    );
  });
});

describe("rangeHoverFrame: Flash's 0.25 s wait and 0.25 s grow-in", () => {
  it("shows nothing for the first quarter second", () => {
    expect(rangeHoverFrame(0)).toBeNull();
    expect(rangeHoverFrame(RANGE_HOVER_DELAY - 0.01)).toBeNull();
  });

  it("starts flat, half see-through and a quarter wide", () => {
    expect(rangeHoverFrame(RANGE_HOVER_DELAY)).toEqual({ alpha: 0.5, scaleX: 0.25, scaleY: 0 });
  });

  it("lands on full size and full opacity, and stays there", () => {
    const end = { alpha: 1, scaleX: 1, scaleY: 1 };
    expect(rangeHoverFrame(RANGE_HOVER_DELAY + RANGE_HOVER_GROW)).toEqual(end);
    expect(rangeHoverFrame(10)).toEqual(end);
  });

  it("eases out: most of the growing is in the first moments", () => {
    const early = rangeHoverFrame(RANGE_HOVER_DELAY + RANGE_HOVER_GROW * 0.2);
    expect(early?.scaleY).toBeCloseTo(expoEaseOut(0.2));
    expect(early?.scaleY ?? 0).toBeGreaterThan(0.7);
  });
});

describe("pointerHovers: desktop only", () => {
  it("a mouse hovers; a finger or a pen does not", () => {
    expect(pointerHovers("mouse")).toBe(true);
    expect(pointerHovers("touch")).toBe(false);
    expect(pointerHovers("pen")).toBe(false);
  });
});

describe("YardRenderer.setRangeHover", () => {
  type Inside = {
    yard: Yard | null;
    rangeOval: { visible: boolean; alpha: number; position: { x: number; y: number }; scale: { x: number; y: number }; bounds: { width: number } };
    growRangeOval: (dt: number) => void;
  };
  const make = (yard: RangeHoverYard): { renderer: YardRenderer; inside: Inside } => {
    const renderer = new YardRenderer();
    const inside = renderer as unknown as Inside;
    inside.yard = yard as Yard;
    return { renderer, inside };
  };

  it("grows an oval the engine's range wide around the tower's middle, then hides it", () => {
    const { renderer, inside } = make(OWN);
    const cannon = building(CANNON);
    renderer.setRangeHover(cannon);
    expect(renderer.rangeHoverId).toBe(1);
    expect(inside.rangeOval.position).toMatchObject({ x: 400, y: 300 });

    inside.growRangeOval(0.1);
    expect(inside.rangeOval.visible).toBe(false);
    inside.growRangeOval(1);
    expect(inside.rangeOval.visible).toBe(true);
    expect(inside.rangeOval.alpha).toBe(1);
    expect(inside.rangeOval.scale).toMatchObject({ x: 1, y: 1 });
    // The width is the iso ellipse of the combat range, plus the hairline edge.
    const { rx } = rangeRadii(towerRange(CANNON, 3) ?? 0, YardView.ISO);
    expect(inside.rangeOval.bounds.width).toBeGreaterThanOrEqual(rx * 2);
    expect(inside.rangeOval.bounds.width).toBeLessThan(rx * 2 + 4);

    renderer.setRangeHover(null);
    expect(renderer.rangeHoverId).toBeNull();
    expect(inside.rangeOval.visible).toBe(false);
  });

  it("shows nothing for a trap, or anything on a foreign yard", () => {
    const own = make(OWN);
    own.renderer.setRangeHover(building(BOOBY_TRAP));
    expect(own.renderer.rangeHoverId).toBeNull();

    const visit = make(VISIT);
    visit.renderer.setRangeHover(building(CANNON));
    expect(visit.renderer.rangeHoverId).toBeNull();
  });

  it("not while the planner is open, which draws its own rings", () => {
    const { renderer } = make(OWN);
    renderer.setRangeHover(building(CANNON));
    (renderer as unknown as { plannerVisuals: unknown }).plannerVisuals = {};
    renderer.setRangeHover(building(CANNON, { id: 2 }));
    expect(renderer.rangeHoverId).toBeNull();
  });

  it("starts the wait again when the mouse moves to another tower", () => {
    const { renderer, inside } = make(OWN);
    renderer.setRangeHover(building(CANNON));
    inside.growRangeOval(1);
    renderer.setRangeHover(building(CANNON, { id: 2 }));
    expect(inside.rangeOval.visible).toBe(false);
    inside.growRangeOval(0.1);
    expect(inside.rangeOval.visible).toBe(false);
  });

  it("the same tower again keeps the oval where it is", () => {
    const { renderer, inside } = make(OWN);
    renderer.setRangeHover(building(CANNON));
    inside.growRangeOval(1);
    renderer.setRangeHover(building(CANNON));
    expect(inside.rangeOval.visible).toBe(true);
  });
});
