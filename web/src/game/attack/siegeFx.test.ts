import { describe, expect, it } from "vitest";
import { Container, Texture, type Sprite } from "pixi.js";
import type { SiegeSnapshot } from "@/game/combat/rules/engine";
import { JAR_FALL_TICKS } from "@/game/combat/rules/jars";
import { TICKS_PER_SECOND } from "@/game/combat/rules/stats";
import { VACUUM_HOSE_RISE, VACUUM_LOWER_TICKS, VACUUM_SPOUT_LIFT, VACUUM_SPOUT_Y } from "@/game/combat/rules/vacuum";
import {
  DECOY_FUSE_LEAD,
  SIEGE_DROP_HEIGHT,
  SIEGE_STRIPS,
  SiegeFx,
  decoyCells,
  dropOffset,
  expoEaseIn,
  explosionCell,
  type SiegeArt,
  type SiegeSheet,
} from "./siegeFx";

/** The Decoy, the Vacuum's hose and the Jars on the field (Inferno WP 6.8). */

/** Every cell is ready at once; the asks are remembered. */
const artOf = (): SiegeArt & { asked: { sheet: SiegeSheet; frame: number }[] } => {
  const asked: { sheet: SiegeSheet; frame: number }[] = [];
  return {
    asked,
    cell: (sheet, frame) => {
      asked.push({ sheet, frame });
      return Texture.WHITE;
    },
    destroy() {},
  };
};

const none: SiegeSnapshot = { active: null, decoy: null, vacuum: null, jars: [] };

const decoy = {
  x: 100,
  y: 50,
  droppedAt: 0,
  landsAt: Math.round(0.6 * TICKS_PER_SECOND),
  explodesAt: 10 * TICKS_PER_SECOND,
  range: 250,
};

const tower = { worldX: 400, worldY: 300, footprint: [70, 70] as const };
const hall = { worldX: 600, worldY: 200, footprint: [130, 130] as const };

const setup = (reducedMotion = false) => {
  const air = new Container();
  const art = artOf();
  const fx = new SiegeFx(
    {
      air: () => air,
      world: (x, y) => ({ x: x - y, y: (x + y) / 2 }),
      building: (id) => (id === 1 ? hall : id === 2 ? tower : null),
    },
    { art, reducedMotion },
  );
  return { air, art, fx };
};

describe("the siege timings", () => {
  it("falls 300 px with Expo.easeIn and rests on landing", () => {
    expect(dropOffset(0, 0, 48)).toBeCloseTo(-SIEGE_DROP_HEIGHT * (1 - expoEaseIn(0)));
    expect(dropOffset(24, 0, 48)).toBeLessThan(-250);
    expect(dropOffset(48, 0, 48)).toBe(0);
  });

  it("shows the Decoy's first wave cell until it lands, then loops; the fuse burns half a second before the blast", () => {
    expect(decoyCells(decoy, 10)).toEqual({ wave: 0, fuse: 0 });
    expect(decoyCells(decoy, decoy.landsAt + 2 * 3)).toEqual({ wave: 3, fuse: 0 });
    expect(decoyCells(decoy, decoy.landsAt + 2 * 45).wave).toBe(0);
    const lit = decoy.explodesAt - DECOY_FUSE_LEAD;
    expect(decoyCells(decoy, lit + 2 * 5).fuse).toBe(5);
    expect(decoyCells(decoy, lit + 1000).fuse).toBe(SIEGE_STRIPS.fuse.frames - 1);
  });

  it("plays the explosion's 33 cells once", () => {
    expect(explosionCell(0)).toBe(0);
    expect(explosionCell(2 * 32)).toBe(32);
    expect(explosionCell(2 * 33)).toBeNull();
  });
});

describe("SiegeFx", () => {
  it("drops the Decoy on its point, then blows it up and clears it", () => {
    const { air, art, fx } = setup();
    fx.update({ ...none, active: "decoy", decoy }, 0);
    expect(fx.shown.decoy).toBe("decoy");
    // The blast's sheet is fetched on the drop, so it is in by the blast.
    expect(art.asked).toContainEqual({ sheet: "explosion", frame: 0 });
    const root = air.children[0] as Container;
    expect(root.x).toBe(50);
    expect(root.y).toBeLessThan(75 - 250);
    fx.update({ ...none, active: "decoy", decoy }, decoy.landsAt);
    expect(root.y).toBe(75);
    // Gone from the battle: the blast plays where it stood.
    fx.update(none, decoy.explodesAt);
    expect(fx.shown.decoy).toBe("blast");
    expect(art.asked.at(-1)).toEqual({ sheet: "explosion", frame: 0 });
    expect((root.children[1] as Sprite).visible).toBe(false);
    // Centred on the drop like the wave was, not hung off the wave's corner.
    const body = root.children[0] as Sprite;
    expect(body.x).toBe(-SIEGE_STRIPS.explosion.width / 2);
    expect(body.y).toBe(-SIEGE_STRIPS.explosion.height / 2);
    fx.update(none, decoy.explodesAt + 2 * 33);
    expect(fx.shown.decoy).toBeNull();
    expect(air.children).toHaveLength(0);
  });

  it("lowers the hose over the Town Hall, fading in, and lifts it away when it lets go", () => {
    const { air, art, fx } = setup();
    const vacuum = { buildingId: 1, droppedAt: 100, endsAt: 100 + 30 * TICKS_PER_SECOND, health: 6000, durability: 6000 };
    fx.update({ ...none, active: "vacuum", vacuum }, 100);
    const root = air.children[0] as Container;
    expect(root.x).toBe(hall.worldX);
    expect(root.y).toBeCloseTo(hall.worldY - VACUUM_HOSE_RISE);
    expect(root.alpha).toBe(0);
    fx.update({ ...none, active: "vacuum", vacuum }, 100 + VACUUM_LOWER_TICKS);
    expect(root.y).toBeCloseTo(hall.worldY + VACUUM_SPOUT_Y - VACUUM_SPOUT_LIFT);
    expect(root.alpha).toBe(1);
    expect(art.asked.some((ask) => ask.sheet === "pipe")).toBe(true);
    // The nozzle sits on the hose's point with pipe above it.
    const [end, pipe] = root.children as Sprite[];
    expect(end!.y).toBe(-SIEGE_STRIPS.end.height);
    expect(pipe!.y).toBe(-SIEGE_STRIPS.end.height - SIEGE_STRIPS.pipe.height);

    const at = 100 + 5 * TICKS_PER_SECOND;
    fx.update(none, at);
    expect(fx.shown.hose).toBe(true);
    fx.update(none, at + VACUUM_LOWER_TICKS / 2);
    expect(root.alpha).toBeLessThan(0.1);
    expect(root.y).toBeLessThan(hall.worldY - 300);
    fx.update(none, at + VACUUM_LOWER_TICKS);
    expect(fx.shown.hose).toBe(false);
  });

  it("drops a jar on each tower, shows the engine's cell, and clears it once gone", () => {
    const { air, art, fx } = setup();
    const jar = { buildingId: 2, landsAt: 200, frame: 0, breaking: false, health: null, durability: 2000 };
    fx.update({ ...none, active: "jars", jars: [jar, { ...jar, buildingId: 99 }] }, 200 - JAR_FALL_TICKS);
    expect(fx.shown.jars).toBe(1);
    const sprite = air.children[0] as Sprite;
    const restX = tower.worldX - SIEGE_STRIPS.jar.width / 2 + 35 / 2;
    const restY = tower.worldY - SIEGE_STRIPS.jar.height / 2;
    expect(sprite.x).toBe(restX);
    expect(sprite.y).toBeCloseTo(restY - SIEGE_DROP_HEIGHT * (1 - expoEaseIn(0)));
    fx.update({ ...none, active: "jars", jars: [{ ...jar, health: 500, frame: 2 }] }, 300);
    expect(sprite.y).toBe(restY);
    expect(art.asked.at(-1)).toEqual({ sheet: "jar", frame: 2 });
    fx.update(none, 400);
    expect(fx.shown.jars).toBe(0);
    expect(air.children).toHaveLength(0);
  });

  it("with reduced motion, nothing falls and the blast is skipped", () => {
    const { air, fx } = setup(true);
    fx.update({ ...none, active: "decoy", decoy }, 0);
    expect((air.children[0] as Container).y).toBe(75);
    fx.update(none, decoy.explodesAt);
    expect(fx.shown.decoy).toBeNull();
  });
});
