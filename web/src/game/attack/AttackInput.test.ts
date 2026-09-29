// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse } from "@/api/types";
import {
  BOMBS,
  bombBlast,
  bombReaches,
  bucketCost,
  buildEngineYard,
  cellOf,
  createBattle,
  dropRadius,
  puttyReach,
  scatterRadius,
  screenPointOf,
  TICKS_PER_SECOND,
} from "@/game/combat/rules";
import { Camera } from "@/game/Camera";
import { readYard, type Yard } from "@/game/yard/yardModel";
import { toIso } from "@/game/yard/YardGrid";
import {
  ATTACK_TAP_CLAIMS,
  AttackInput,
  clampDropPoint,
  DECOY_CLEARANCE,
  dropZoneOf,
  judgeDrop,
  obstaclesOf,
  overlappingBuildings,
  parseSiegeStock,
  siegeWeapon,
  unusedToolCount,
  type ToolInventory,
} from "./AttackInput";
import { AttackSession } from "./AttackSession";
import type { AttackTarget } from "./attackTarget";
import { Bucket } from "./bucket";

/**
 * The drop rules (§F3, §F4) on a fixture yard: one Cannon Tower at the
 * origin and a Town Hall off to the side, enough to see a centre refused for
 * touching a footprint and accepted on open ground, in the shape the
 * fling-log contract fixes (`docs/design/server-combat.md` §3.10).
 */

/** A Cannon Tower (20) at the origin and a Town Hall (1) at (300, 300). */
const fixtureLoad = (): BaseLoadResponse =>
  ({
    error: 0,
    id: 1,
    baseid: "3502",
    basesaveid: 1,
    worldsize: [800, 800],
    currenttime: 1_700_000_000,
    buildingdata: {
      "1": { id: 1, t: 20, l: 1, X: 0, Y: 0 },
      "2": { id: 2, t: 1, l: 1, X: 300, Y: 300 },
    },
    buildinghealthdata: {},
    resources: { r1: 1000, r2: 0, r3: 0, r4: 0 },
    attackid: 77,
  }) as unknown as BaseLoadResponse;

const targetOf = (overrides: Partial<AttackTarget> = {}): AttackTarget => ({
  baseid: "3502",
  kind: "wild",
  cell: { col: 241, row: 208 },
  name: "Kozu",
  roster: {
    monsters: { C1: 10 },
    levels: {},
    champions: [],
    flingerLevel: 4,
    catapultLevel: 2,
    sources: [],
    siege: null,
    resources: null,
  },
  ...overrides,
});

interface Rig {
  session: AttackSession;
  bucket: Bucket;
  yard: Yard;
  input: AttackInput;
  canvas: HTMLCanvasElement;
  camera: Camera;
  previews: unknown[];
  refusals: string[];
  toolsUsed: string[];
}

const rig = (overrides: Partial<AttackTarget> = {}): Rig => {
  const load = fixtureLoad();
  const session = new AttackSession({ target: targetOf({ ...overrides, load }), seed: 1 });
  session.start();
  const yard = readYard(load);
  const bucket = new Bucket(session, { storage: null });
  const canvas = document.createElement("canvas");
  document.body.append(canvas);
  const camera = new Camera({ zoom: 1 });
  camera.resize(800, 600);
  const previews: unknown[] = [];
  const refusals: string[] = [];
  const toolsUsed: string[] = [];
  const input = new AttackInput({
    canvas,
    camera,
    renderer: { worldToYard: (x, y) => ({ x, y }) },
    yard,
    session,
    bucket,
    onPreview: (preview) => previews.push(preview),
    onRefuse: (reason) => refusals.push(reason),
    onToolUsed: (tool) => toolsUsed.push(tool.kind),
  });
  input.attach();
  return { session, bucket, yard, input, canvas, camera, previews, refusals, toolsUsed };
};

/** A spot well away from both buildings. */
const OPEN = { x: -400, y: 200 };

describe("overlap rule", () => {
  it("refuses a fling centre on a footprint and accepts open ground, per DROPZONE.as:64", () => {
    const yard = readYard(fixtureLoad());
    const obstacles = obstaclesOf(yard);
    const zone = dropZoneOf({ kind: "fling" }, 100);
    expect(zone).toMatchObject({ size: 200, target: "ground" });

    expect(overlappingBuildings({ x: 0, y: 0 }, zone.size, obstacles).map((o) => o.id)).toEqual([1]);
    expect(overlappingBuildings(OPEN, zone.size, obstacles)).toEqual([]);

    expect(judgeDrop(zone, { x: 0, y: 0 }, obstacles, []).legal).toBe(false);
    expect(judgeDrop(zone, OPEN, obstacles, []).legal).toBe(true);
  });

  it("tests in isometric pixels with the 0.8 squash, so the edge is where Flash put it", () => {
    // Along the isometric x axis the zone's semi-axis is size/2 and the
    // tower's is size/4 (props size 64): overlap ends at 100 + 16 = 116 px.
    const yard = readYard(fixtureLoad());
    const obstacles = obstaclesOf(yard);
    const towerMiddle = obstacles[0]!.middle;
    const along = (isoX: number): boolean => {
      // A yard point whose isometric projection is (isoX, towerMiddle).
      const x = isoX / 2 + towerMiddle;
      const y = towerMiddle - isoX / 2;
      const iso = toIso(x, y);
      expect(Math.abs(iso.x - isoX)).toBeLessThanOrEqual(1);
      return overlappingBuildings({ x, y }, 200, obstacles).length > 0;
    };
    expect(along(110)).toBe(true);
    expect(along(122)).toBe(false);
  });

  it("stops counting a building once the battle has flattened it, and never counts a trap or decoration", () => {
    const yard = readYard(fixtureLoad());
    expect(overlappingBuildings({ x: 0, y: 0 }, 200, obstaclesOf(yard, [1]))).toEqual([]);
    const withTrap = {
      buildings: [
        ...yard.buildings,
        { ...yard.buildings[0]!, id: 9, type: 24, footprint: [30, 30] as const },
      ],
    };
    expect(
      overlappingBuildings({ x: 0, y: 0 }, 200, obstaclesOf(withTrap, [1])).map((o) => o.id),
    ).toEqual([]);
  });

  it("wants a building under a damage bomb and a tower under Jars, and the Decoy clear within 30", () => {
    const yard = readYard(fixtureLoad());
    const obstacles = obstaclesOf(yard);
    const twig = BOMBS.find((bomb) => bomb.id === "tw0")!;
    const bombZone = dropZoneOf({ kind: "bomb", bomb: twig }, 100);
    expect(bombZone).toMatchObject({ size: 200, target: "buildings" });
    expect(judgeDrop(bombZone, { x: 0, y: 0 }, obstacles, []).legal).toBe(true);
    expect(judgeDrop(bombZone, OPEN, obstacles, []).legal).toBe(false);

    const jars = siegeWeapon("jars")!;
    const jarsZone = dropZoneOf({ kind: "siege", weapon: jars, level: 1 }, 100);
    expect(jarsZone).toMatchObject({ size: 200, target: "tower" });
    expect(judgeDrop(jarsZone, { x: 0, y: 0 }, obstacles, []).legal).toBe(true);
    // Over the Town Hall, which is not a tower.
    expect(judgeDrop(jarsZone, { x: 300, y: 300 }, obstacles, []).legal).toBe(false);

    const decoy = siegeWeapon("decoy")!;
    const decoyZone = dropZoneOf({ kind: "siege", weapon: decoy, level: 1 }, 100);
    expect(decoyZone).toMatchObject({ size: 250, target: "clear-special" });
    // Clear within 30 px even though the 250 ring would touch the tower.
    const near = { x: 120, y: 120 };
    expect(overlappingBuildings(near, 250, obstacles).length).toBeGreaterThan(0);
    expect(overlappingBuildings(near, DECOY_CLEARANCE, obstacles)).toEqual([]);
    expect(judgeDrop(decoyZone, near, obstacles, []).legal).toBe(true);
  });

  it("draws a damage bomb's ring as the blast the engine applies (#75)", () => {
    for (const bomb of BOMBS.filter((one) => one.damage > 0)) {
      const ring = dropZoneOf({ kind: "bomb", bomb }, 100).ring;
      // The same object the engine's hit test reads, in the same pixels.
      expect(ring).toEqual(bombBlast(bomb));
      expect(ring).toEqual({ rx: bomb.radius / 2, ry: (bomb.radius * 0.8) / 2 });
      // A sizeless building on the ring's edge is just outside; inside is hit.
      expect(bombReaches(bomb, ring.rx - 0.5, 0, 0)).toBe(true);
      expect(bombReaches(bomb, ring.rx + 0.5, 0, 0)).toBe(false);
      expect(bombReaches(bomb, 0, ring.ry - 0.5, 0)).toBe(true);
      expect(bombReaches(bomb, 0, -(ring.ry + 0.5), 0)).toBe(false);
    }
  });

  it("keeps the Flash drop clip for a fling and a siege weapon", () => {
    expect(dropZoneOf({ kind: "fling" }, 100).ring).toEqual({ rx: 120, ry: 60 });
    const jars = siegeWeapon("jars")!;
    expect(dropZoneOf({ kind: "siege", weapon: jars, level: 1 }, 100).ring).toEqual({
      rx: 120,
      ry: 60,
    });
  });

  it("draws a fling's ring round every creep the engine lands (#91)", () => {
    const yard = buildEngineYard({ buildingdata: {}, buildinghealthdata: {}, resources: {} });
    // The floor, a middling payload and a full flinger (321 Pokeys, 2,247).
    for (const pokeys of [1, 100, 321]) {
      const monsters = { C1: pokeys };
      const radius = dropRadius(bucketCost(monsters, {}));
      const { rx, ry } = dropZoneOf({ kind: "fling" }, radius).ring;
      // The scatter is a screen circle, so the ring's short half-axis bounds it.
      expect(scatterRadius(bucketCost(monsters, {}))).toBeLessThan(ry);
      const battle = createBattle(yard, { seed: pokeys });
      battle.apply({ kind: "fling", t: 0, x: 100, y: -50, r: radius, monsters });
      const centre = screenPointOf(100, -50);
      for (const creep of battle.creeps()) {
        const at = screenPointOf(creep.ix, creep.iy);
        expect(((at.x - centre.x) / rx) ** 2 + ((at.y - centre.y) / ry) ** 2).toBeLessThan(1);
      }
    }
  });

  it("draws a putty bomb's ground circle as its screen ellipse", () => {
    const putty = BOMBS.find((bomb) => bomb.id === "pu3")!;
    const ring = dropZoneOf({ kind: "bomb", bomb: putty }, 100).ring;
    // 250 yard units on the ground: 250 * sqrt 2 across, half that tall.
    expect(ring.rx).toBeCloseTo(250 * Math.SQRT2, 9);
    expect(ring.ry).toBeCloseTo((250 * Math.SQRT2) / 2, 9);
    // A yard point 250 units along X lands on the ellipse's edge.
    const edge = toIso(250, 0);
    expect((edge.x / ring.rx) ** 2 + (edge.y / ring.ry) ** 2).toBeCloseTo(1, 6);
  });

  it("lets a putty bomb go only onto a live monster within its reach (#147)", () => {
    const putty = BOMBS.find((bomb) => bomb.id === "pu0")!;
    const zone = dropZoneOf({ kind: "bomb", bomb: putty }, 100);
    const reach = puttyReach(putty);
    expect(zone.target).toBe("monsters");
    // Nothing on the field.
    const empty = judgeDrop(zone, OPEN, [], []);
    expect(empty.legal).toBe(false);
    expect(empty.reason).toMatch(/none are on the field/);
    // A monster at the ring's edge counts; one just past it does not.
    const edge = { x: OPEN.x + reach, y: OPEN.y };
    expect(judgeDrop(zone, OPEN, [], [edge]).legal).toBe(true);
    const far = { x: OPEN.x + reach + 1, y: OPEN.y };
    const miss = judgeDrop(zone, OPEN, [], [far]);
    expect(miss.legal).toBe(false);
    expect(miss.reason).toMatch(/Aim at them/);
    // Any one inside is enough.
    expect(judgeDrop(zone, OPEN, [], [far, { x: OPEN.x, y: OPEN.y - reach / 2 }]).legal).toBe(true);
  });
});

describe("AttackInput taps", () => {
  it("flings the composition at the tapped yard point, then tells the bucket", () => {
    const { session, bucket, input } = rig();
    bucket.setCount("C1", 4);
    const appendFling = vi.spyOn(session, "appendFling");
    const afterDrop = vi.spyOn(bucket, "afterDrop");

    expect(input.tapAt(OPEN, null)).toBe(true);

    expect(appendFling).toHaveBeenCalledTimes(1);
    expect(appendFling.mock.calls[0]![0]).toEqual({ monsters: { C1: 4 }, x: OPEN.x, y: OPEN.y });
    expect(afterDrop).toHaveBeenCalledTimes(1);
    expect(appendFling.mock.invocationCallOrder[0]!).toBeLessThan(
      afterDrop.mock.invocationCallOrder[0]!,
    );
    const log = session.flingLog();
    expect(log.events).toHaveLength(1);
    expect(log.events[0]).toMatchObject({ kind: "fling", x: OPEN.x, y: OPEN.y, monsters: { C1: 4 } });
    expect(session.state().creepsFlung).toBe(4);
    // The composition is not cleared (§F3).
    expect(bucket.count("C1")).toBe(4);
  });

  it("refuses a centre on a footprint and says why, without spending anything", () => {
    const { session, bucket, input, refusals } = rig();
    bucket.setCount("C1", 4);
    expect(input.tapAt({ x: 0, y: 0 }, null)).toBe(true);
    expect(refusals).toEqual(["Too close to a building. Drop on open ground."]);
    expect(session.state().creepsFlung).toBe(0);
  });

  it("leaves a tap on a building, or with an empty bucket, to the scene", () => {
    const { session, bucket, input, yard } = rig();
    expect(input.tapAt(OPEN, null)).toBe(false);
    bucket.setCount("C1", 4);
    expect(input.tapAt({ x: 300, y: 300 }, yard.buildings[1]!)).toBe(false);
    expect(session.state().creepsFlung).toBe(0);
  });

  it("drops a pending bomb where the tap lands, logs it and clears the tool", () => {
    const { session, bucket, input, toolsUsed: used } = rig();
    bucket.setCount("C1", 4);
    const twig = BOMBS.find((bomb) => bomb.id === "tw0")!;

    input.setTool({ kind: "bomb", bomb: twig });
    expect(input.tapAt({ x: 0, y: 0 }, null)).toBe(true);

    const log = session.flingLog();
    expect(log.events).toHaveLength(1);
    expect(log.events[0]).toEqual({ kind: "bomb", t: 0, x: 0, y: 0, id: "tw0" });
    expect(input.pendingTool()).toBeNull();
    expect(used).toEqual(["bomb"]);
    // The bucket is untouched by a bomb (§F4).
    expect(bucket.count("C1")).toBe(4);
    expect(session.state().creepsFlung).toBe(0);
  });

  it("takes a putty bomb only where it lands on a live monster (#147)", () => {
    const { session, bucket, input, refusals } = rig();
    bucket.setCount("C1", 2);
    expect(input.tapAt(OPEN, null)).toBe(true);
    session.battle()!.runTo(session.battle()!.tick + 1);
    const putty = BOMBS.find((bomb) => bomb.id === "pu0")!;
    input.setTool({ kind: "bomb", bomb: putty });
    // Far from the flung monsters: refused, and the bomb stays armed.
    expect(input.tapAt({ x: OPEN.x + 600, y: OPEN.y - 600 }, null)).toBe(true);
    expect(refusals.at(-1)).toMatch(/Aim at them/);
    expect(input.pendingTool()).not.toBeNull();
    expect(session.flingLog().events.filter((event) => event.kind === "bomb")).toHaveLength(0);
    // On them: taken.
    const creep = session.battle()!.creeps().find((one) => !one.friendly)!;
    expect(input.tapAt({ x: creep.ix, y: creep.iy }, null)).toBe(true);
    expect(session.flingLog().events.filter((event) => event.kind === "bomb")).toHaveLength(1);
    expect(input.pendingTool()).toBeNull();
  });

  it("logs a siege drop with the weapon's id and keeps the roster whole", () => {
    const { session, bucket, input } = rig();
    bucket.setCount("C1", 4);
    input.setTool({ kind: "siege", weapon: siegeWeapon("decoy")!, level: 1 });
    expect(input.tapAt(OPEN, null)).toBe(true);
    expect(session.flingLog().events[0]).toEqual({
      kind: "siege",
      t: 0,
      x: OPEN.x,
      y: OPEN.y,
      weapon: "decoy",
    });
    expect(input.pendingTool()).toBeNull();
    expect(session.remaining()).toEqual({ C1: 10 });
  });

  it("is asked before the scene through ATTACK_TAP_CLAIMS, and steps out on detach", () => {
    const before = ATTACK_TAP_CLAIMS.length;
    const { session, input, bucket, canvas } = rig();
    // Attaching puts this input's claim first in line.
    expect(ATTACK_TAP_CLAIMS).toHaveLength(before + 1);
    const claim = ATTACK_TAP_CLAIMS[0]!;
    bucket.setCount("C1", 2);
    // The last hover is where the scene's tap lands: over the tower it is
    // refused but still claimed, and nothing is sent.
    canvas.dispatchEvent(pointerEvent("pointermove", { clientX: 0, clientY: 0, pointerType: "mouse" }));
    expect(claim(null)).toBe(true);
    expect(session.state().creepsFlung).toBe(0);
    input.detach();
    expect(ATTACK_TAP_CLAIMS).toHaveLength(before);
    expect(ATTACK_TAP_CLAIMS).not.toContain(claim);
  });

  it("does nothing once the attack has ended", () => {
    const { session, bucket, input } = rig();
    bucket.setCount("C1", 4);
    session.retreat();
    expect(input.tapAt(OPEN, null)).toBe(false);
    expect(session.flingLog().events.map((event) => event.kind)).toEqual(["retreat"]);
  });
});

describe("the grid's edge", () => {
  it("leaves a point the engine can path from alone", () => {
    expect(clampDropPoint(OPEN)).toBe(OPEN);
    expect(clampDropPoint({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    // The far corner of the wild plot is still on the grid.
    const corner = { x: -920, y: -750 };
    expect(cellOf(corner.x, corner.y)).toBeGreaterThanOrEqual(0);
    expect(clampDropPoint(corner)).toBe(corner);
  });

  it("pulls a point past the grid onto it, one cell in from the edge", () => {
    // Yard x 2000 is well past the 260 x 10 grid, which spans -1300..1300.
    const far = { x: 2000, y: 500 };
    expect(cellOf(far.x, far.y)).toBe(-1);
    const moved = clampDropPoint(far);
    expect(cellOf(moved.x, moved.y)).toBeGreaterThanOrEqual(0);
    expect(moved.x).toBe(1290);
    // Only the axis that was out moves.
    expect(moved.y).toBe(500);

    for (const point of [
      { x: -3000, y: 100 },
      { x: 100, y: -3000 },
      { x: 5000, y: -5000 },
      { x: -1500, y: 1400 },
    ]) {
      const on = clampDropPoint(point);
      expect(cellOf(on.x, on.y)).toBeGreaterThanOrEqual(0);
    }
  });

  it("keeps the drop ring's scatter on the grid too", () => {
    const radius = 281; // dropRadius of a full 2,250-unit bucket
    const moved = clampDropPoint({ x: 2000, y: 2000 }, radius);
    // The reach is 1290 - 281 = 1009 on both axes.
    expect(moved).toEqual({ x: 1009, y: 1009 });
    // Every point of the ring is inside the grid.
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 8) {
      const edgeX = moved.x + Math.cos(angle) * radius;
      const edgeY = moved.y + Math.sin(angle) * radius;
      expect(Math.abs(edgeX)).toBeLessThan(1300);
      expect(Math.abs(edgeY)).toBeLessThan(1300);
    }
  });

  it("flings a tap on the far outskirts from the grid's edge, so the creeps spawn and walk", () => {
    const { session, bucket, input } = rig();
    bucket.setCount("C1", 4);
    const aimed = { x: -2600, y: 900 };
    expect(cellOf(aimed.x, aimed.y)).toBe(-1);

    expect(input.tapAt(aimed, null)).toBe(true);

    const log = session.flingLog();
    expect(log.events).toHaveLength(1);
    const drop = log.events[0]!;
    if (drop.kind !== "fling") throw new Error(`expected a fling, got ${drop.kind}`);
    expect(cellOf(drop.x, drop.y)).toBeGreaterThanOrEqual(0);
    expect({ x: drop.x, y: drop.y }).not.toEqual(aimed);
    expect(session.state().creepsFlung).toBe(4);
    const creeps = session.battle()!.creeps();
    expect(creeps).toHaveLength(4);
    for (const creep of creeps) {
      expect(cellOf(Math.trunc(creep.ix), Math.trunc(creep.iy))).toBeGreaterThanOrEqual(0);
    }
    // They have somewhere to go: after a few seconds every one has moved.
    const before = creeps.map((creep) => [creep.ix, creep.iy] as const);
    session.advance(3);
    const after = session.battle()!.creeps();
    expect(after.length).toBeGreaterThan(0);
    for (const [index, creep] of after.entries()) {
      const [ix, iy] = before[index]!;
      expect(Math.hypot(creep.ix - ix, creep.iy - iy)).toBeGreaterThan(0);
    }
  });
});

describe("AttackInput preview", () => {
  it("previews on mouse hover, and on touch only between press and release", () => {
    const { input, bucket, canvas, previews } = rig();
    bucket.setCount("C1", 2);
    previews.length = 0;

    canvas.dispatchEvent(pointerEvent("pointermove", { clientX: 10, clientY: 10, pointerType: "mouse" }));
    expect(previews.at(-1)).toMatchObject({ legal: expect.any(Boolean), zone: { target: "ground" } });

    previews.length = 0;
    canvas.dispatchEvent(pointerEvent("pointermove", { clientX: 20, clientY: 20, pointerType: "touch" }));
    expect(previews).toEqual([]);

    canvas.dispatchEvent(pointerEvent("pointerdown", { clientX: 20, clientY: 20, pointerType: "touch" }));
    expect(previews.at(-1)).not.toBeNull();
    canvas.dispatchEvent(pointerEvent("pointermove", { clientX: 30, clientY: 30, pointerType: "touch" }));
    expect(previews.at(-1)).not.toBeNull();
    canvas.dispatchEvent(pointerEvent("pointerup", { clientX: 30, clientY: 30, pointerType: "touch" }));
    expect(previews.at(-1)).toBeNull();
    input.detach();
  });

  it("hides the ring while there is nothing to drop and shows the armed tool's zone", () => {
    const { input, bucket, canvas, previews } = rig();
    canvas.dispatchEvent(pointerEvent("pointermove", { clientX: 10, clientY: 10, pointerType: "mouse" }));
    expect(previews.at(-1)).toBeNull();
    const twig = BOMBS.find((bomb) => bomb.id === "tw1")!;
    input.setTool({ kind: "bomb", bomb: twig });
    expect(previews.at(-1)).toMatchObject({ zone: { size: 200, target: "buildings" } });
    input.cancel();
    expect(previews.at(-1)).toBeNull();
    bucket.setCount("C1", 1);
    expect(previews.at(-1)).toMatchObject({ zone: { target: "ground" } });
    input.detach();
  });

  it("lights exactly the buildings an armed bomb would hit, and nothing once disarmed (#88)", () => {
    const { input, session, camera, canvas, previews } = rig();
    const pebble = BOMBS.find((bomb) => bomb.id === "pb0")!;
    input.setTool({ kind: "bomb", bomb: pebble });
    type Shown = { x: number; y: number; legal: boolean; highlight: readonly number[] } | null;
    const hover = (x: number, y: number): Shown => {
      const at = camera.worldToScreen({ x, y });
      canvas.dispatchEvent(
        pointerEvent("pointermove", { clientX: at.x, clientY: at.y, pointerType: "mouse" }),
      );
      return previews.at(-1) as Shown;
    };

    // On the Cannon Tower: it and only it, and the engine agrees.
    const over = hover(10, 5)!;
    expect(over.legal).toBe(true);
    expect(over.highlight).toEqual([1]);
    const before = session.battle()!.state().health["1"];
    expect(before).toBeUndefined();
    // Open ground: a bomb cannot land, so nothing is lit.
    const open = hover(OPEN.x, OPEN.y)!;
    expect(open.legal).toBe(false);
    expect(open.highlight).toEqual([]);

    // The highlight is what the bomb then does.
    hover(10, 5);
    expect(input.tap(null)).toBe(true);
    const health = session.battle()!.state().health;
    expect(Object.keys(health)).toEqual(["1"]);
    // Fired, the bomb is disarmed and the bucket is empty: no ring, nothing lit.
    expect(previews.at(-1)).toBeNull();
    input.detach();
  });

  it("lights the buildings that block a fling, as the Flash drop zone did", () => {
    const { input, bucket, camera, canvas, previews } = rig();
    bucket.setCount("C1", 2);
    const at = camera.worldToScreen({ x: 0, y: 0 });
    canvas.dispatchEvent(pointerEvent("pointermove", { clientX: at.x, clientY: at.y, pointerType: "mouse" }));
    expect(previews.at(-1)).toMatchObject({ legal: false, highlight: [1] });
    const open = camera.worldToScreen(OPEN);
    canvas.dispatchEvent(pointerEvent("pointermove", { clientX: open.x, clientY: open.y, pointerType: "mouse" }));
    expect(previews.at(-1)).toMatchObject({ legal: true, highlight: [] });
    input.detach();
  });

  it("cancels a pending tool on Escape and on right-click", () => {
    const { input, canvas } = rig();
    const twig = BOMBS.find((bomb) => bomb.id === "tw0")!;
    input.setTool({ kind: "bomb", bomb: twig });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(input.pendingTool()).toBeNull();
    input.setTool({ kind: "bomb", bomb: twig });
    const menu = new MouseEvent("contextmenu", { cancelable: true, bubbles: true });
    canvas.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
    expect(input.pendingTool()).toBeNull();
    input.detach();
  });
});

describe("tool accounting", () => {
  const base: ToolInventory = {
    catapultLevel: 3,
    pool: { r1: 1_000_000, r2: 1_000_000, r3: 1_000_000 },
    bombsUsed: new Set(),
    creepsAlive: 0,
    siege: [],
    siegeUsed: {},
  };

  it("counts one bomb per resource still fireable, putty only with a field, plus siege left", () => {
    expect(unusedToolCount(base)).toBe(2);
    expect(unusedToolCount({ ...base, creepsAlive: 1 })).toBe(3);
    expect(unusedToolCount({ ...base, bombsUsed: new Set([1]) })).toBe(1);
    expect(unusedToolCount({ ...base, pool: { r1: 5000, r2: 0, r3: 0 } })).toBe(0);
    expect(unusedToolCount({ ...base, pool: null })).toBe(0);
    expect(unusedToolCount({ ...base, catapultLevel: 0 })).toBe(0);
    expect(
      unusedToolCount({
        ...base,
        catapultLevel: 0,
        siege: [
          { id: "decoy", level: 1, quantity: 2 },
          { id: "jars", level: 3, quantity: 1 },
        ],
        siegeUsed: { decoy: 1 },
      }),
    ).toBe(2);
  });

  it("reads the own save's siege blob and shrugs at anything else", () => {
    expect(parseSiegeStock(null)).toEqual([]);
    expect(parseSiegeStock({ decoy: { level: 2, quantity: 3 }, vacuum: { level: 0, quantity: 5 } })).toEqual([
      { id: "decoy", level: 2, quantity: 3 },
    ]);
    expect(parseSiegeStock({ jars: { level: "x" } })).toEqual([]);
  });

  it("keeps the session's exhausted rule honest: tools left, field empty, nothing housed", () => {
    const { session, bucket, input } = rig({
      roster: { monsters: { C1: 1 }, levels: {}, champions: [], flingerLevel: 4, catapultLevel: 1, sources: [], siege: null, resources: null },
    });
    session.setUnusedTools(1);
    bucket.setCount("C1", 1);
    expect(input.tapAt(OPEN, null)).toBe(true);
    // One Pokey against a Cannon Tower dies well inside a minute.
    for (let frame = 0; frame < 60 * TICKS_PER_SECOND; frame += 1) session.advance(1 / 60);
    expect(session.state().creepsAlive).toBe(0);
    expect(session.state().phase).toBe("running");
    session.setUnusedTools(0);
    expect(session.state().phase).toBe("ended");
    expect(session.state().endReason).toBe("exhausted");
    input.detach();
  });
});

/** A pointer event jsdom can build, with `pointerType` where it lacks PointerEvent. */
const pointerEvent = (
  type: string,
  init: { clientX: number; clientY: number; pointerType: string; button?: number },
): Event => {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.clientX,
    clientY: init.clientY,
    button: init.button ?? 0,
  });
  Object.defineProperty(event, "pointerType", { value: init.pointerType });
  Object.defineProperty(event, "pointerId", { value: 1 });
  return event;
};
