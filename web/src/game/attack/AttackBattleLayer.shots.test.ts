import { describe, expect, it } from "vitest";
import { Container, Texture, TextureSource } from "pixi.js";
import type { BaseLoadResponse } from "@/api/types";
import { TICKS_PER_SECOND, type BattleVisualEvent } from "@/game/combat/rules";
import { readYard } from "@/game/yard/yardModel";
import {
  AttackBattleLayer,
  MonsterSheetTextures,
  type BattleYardHost,
} from "./AttackBattleLayer";
import { AttackSession } from "./AttackSession";
import type { AttackTarget } from "./attackTarget";
import { PROJECTILE_TICKS } from "./creepFx";
import { FELLED_TICKS, type JuiceLevel } from "./juice";
import { MONSTER_SPRITES } from "./monsterSpriteData";
import { sheetUrl } from "./monsterSprites";

/**
 * A tower's bullet hurts when it lands, not when it is fired (issue #77): over
 * a real session, the creep's bar, its number and — for a killing shot — its
 * death all wait for the sniper's shell, which the engine flies and lands
 * itself (engine fidelity note 1), so the layer shows its wounds as they come.
 */

type BuildingRow = { id: number; t: number; l: number; X: number; Y: number };

const yardOf = (buildings: BuildingRow[]): BaseLoadResponse =>
  ({
    error: 0,
    id: 1,
    baseid: "3502",
    basesaveid: 1,
    worldsize: [800, 800],
    currenttime: 1_700_000_000,
    buildingdata: Object.fromEntries(buildings.map((row) => [String(row.id), row])),
    buildinghealthdata: {},
    resources: { r1: 1000, r2: 0, r3: 0, r4: 0 },
    attackid: 77,
    storedata: {},
  }) as unknown as BaseLoadResponse;

const targetOf = (monsters: Record<string, number> = { C1: 20 }): AttackTarget => ({
  baseid: "3502",
  kind: "wild",
  cell: { col: 241, row: 208 },
  name: "Kozu",
  roster: {
    monsters,
    levels: {},
    champions: [],
    flingerLevel: 4,
    catapultLevel: 0,
    sources: [],
    siege: null,
    resources: null,
  },
});

const blankSheet = (url: string): Promise<Texture> => {
  const sheet = Object.values(MONSTER_SPRITES).find((candidate) => url === sheetUrl(candidate));
  if (!sheet) throw new Error(`no sheet at ${url}`);
  return Promise.resolve(
    new Texture({ source: new TextureSource({ width: sheet.width, height: sheet.height }) }),
  );
};

interface Host extends BattleYardHost {
  readonly damage: Map<number, number>;
}

const hostOf = (): Host => {
  const depth = new Container();
  depth.sortableChildren = true;
  const damage = new Map<number, number>();
  return {
    damage,
    depthSortedLayer: () => depth,
    centreOf: () => ({ x: 400, y: 400 }),
    setBuildingDamage: (id, fraction) => damage.set(id, fraction),
    setConcealed: () => {},
    setAnimFrame: () => {},
  };
};

const setUp = (
  buildings: BuildingRow[],
  monsters?: Record<string, number>,
  juice: JuiceLevel = "off",
  classic = false,
) => {
  const session = new AttackSession({ target: targetOf(monsters), seed: 1 });
  const response = yardOf(buildings);
  session.load(response);
  const host = hostOf();
  const layer = new AttackBattleLayer({
    session,
    yard: readYard(response),
    host,
    overlay: new Container(),
    reducedMotion: false,
    textures: new MonsterSheetTextures(blankSheet),
    juice,
    classic,
    effectsQuality: "full",
    shotSheet: () =>
      Promise.resolve(new Texture({ source: new TextureSource({ width: 768, height: 1728 }) })),
  });
  return { session, layer, host };
};

/** One frame of `ticks` battle ticks; the events it produced. */
const frame = (
  session: AttackSession,
  layer: AttackBattleLayer,
  ticks = 1,
): readonly BattleVisualEvent[] => {
  const before = session.battle()?.tick ?? 0;
  session.advance(ticks / TICKS_PER_SECOND);
  layer.update();
  return session.battle()?.recentEvents(before) ?? [];
};

const engineFraction = (session: AttackSession, id: number): number | null => {
  const creep = session
    .battle()
    ?.creeps()
    .find((candidate) => candidate.id === id);
  return creep ? creep.hp / creep.maxHp : null;
};

describe("a sniper's bullet (#77)", () => {
  it("keeps the creep's bar full and shows no number until the bullet lands", () => {
    const { session, layer } = setUp([{ id: 1, t: 21, l: 1, X: 0, Y: 0 }]);
    session.appendFling({ x: -150, y: -150, monsters: { C1: 1 } });

    let target = -1;
    let shotTick = -1;
    for (let step = 0; step < 20 * TICKS_PER_SECOND && target < 0; step += 1) {
      const shot = frame(session, layer).find((event) => event.kind === "shot");
      if (shot?.kind === "shot") {
        target = shot.creepId;
        shotTick = shot.tick;
      }
    }
    expect(target).toBeGreaterThanOrEqual(0);

    // The shell is in the air: neither the engine nor the screen has hurt it,
    // and the layer holds nothing back.
    expect(engineFraction(session, target)).toBe(1);
    expect(layer.heldShots).toBe(0);
    expect(layer.shownHealthOf(target)).toBe(1);
    expect(layer.creepEffects.labelsFor(`creep:${target}`)).toHaveLength(0);

    let landedTick = -1;
    for (let step = 0; step < 2 * TICKS_PER_SECOND && landedTick < 0; step += 1) {
      frame(session, layer);
      if ((engineFraction(session, target) ?? 0) < 1) {
        landedTick = session.battle()?.tick ?? -1;
        break;
      }
      expect(layer.shownHealthOf(target)).toBe(1);
      expect(layer.creepEffects.labelsFor(`creep:${target}`)).toHaveLength(0);
    }
    // Half the sniper's speed of 10 a tick: a real flight, not the next tick.
    expect(landedTick - shotTick).toBeGreaterThanOrEqual(5);
    expect(layer.shownHealthOf(target)).toBeCloseTo(0.5);
    expect(
      layer.creepEffects.labelsFor(`creep:${target}`).map((label) => label.amount),
    ).toEqual([-100]);
    layer.destroy();
  });

  it("lets a creep the shell killed go only when it lands, a flight after the shot", () => {
    const { session, layer } = setUp([{ id: 1, t: 21, l: 1, X: 0, Y: 0 }]);
    // Dropped off to the side, so the killing shot finds the Pokey still some
    // way out and the bullet has a real flight to make.
    session.appendFling({ x: -200, y: -100, monsters: { C1: 1 } });

    let killed = -1;
    let lastShot = -1;
    let diedAt = -1;
    for (let step = 0; step < 30 * TICKS_PER_SECOND && killed < 0; step += 1) {
      for (const event of frame(session, layer)) {
        if (event.kind === "shot") lastShot = event.tick;
        if (event.kind === "death") {
          killed = event.creepId;
          diedAt = event.tick;
        }
      }
    }
    expect(killed).toBeGreaterThanOrEqual(0);
    // The killing shell's flight: half the sniper's speed of 10 a tick.
    expect(diedAt - lastShot).toBeGreaterThan(5);
    expect(engineFraction(session, killed)).toBeNull();
    expect(layer.shownHealthOf(killed)).toBeNull();
    expect(layer.creepCount).toBe(0);
    expect(layer.heldShots).toBe(0);
    layer.destroy();
  });

  it("lands the bullet on the same tick at 2x as at 1x", () => {
    const landing = (ticksPerFrame: number): number => {
      const { session, layer } = setUp([{ id: 1, t: 21, l: 1, X: 0, Y: 0 }]);
      session.appendFling({ x: -150, y: -150, monsters: { C1: 1 } });
      let target = -1;
      for (let step = 0; step < 20 * TICKS_PER_SECOND; step += 1) {
        const shot = frame(session, layer, ticksPerFrame).find(
          (event) => event.kind === "shot",
        );
        if (shot?.kind === "shot") target = shot.creepId;
        if (target >= 0 && (layer.shownHealthOf(target) ?? 0) < 1) break;
      }
      const tick = session.battle()?.tick ?? -1;
      const hp = layer.shownHealthOf(target);
      layer.destroy();
      expect(hp).toBeCloseTo(0.5);
      return tick;
    };
    const oneX = landing(1);
    const twoX = landing(2);
    // At 2x a frame covers two ticks, so the frame that sees it land ends on
    // its tick or the one after.
    expect(twoX - oneX).toBeGreaterThanOrEqual(0);
    expect(twoX - oneX).toBeLessThanOrEqual(1);
  });
});

describe("the new look's Sniper round striking a creep", () => {
  /** Runs frames until the Sniper's next round is drawn landing; that frame's events. */
  const untilLanded = (session: AttackSession, layer: AttackBattleLayer) => {
    let shot = false;
    for (let step = 0; step < 20 * TICKS_PER_SECOND; step += 1) {
      const events = frame(session, layer);
      if (events.some((event) => event.kind === "shot")) shot = true;
      if (shot && layer.towerEffects.flyingCount === 0) {
        return { events, tick: session.battle()?.tick ?? -1 };
      }
    }
    return null;
  };

  it("flashes the body it strikes for a few ticks, and the classic look never does", async () => {
    for (const juice of ["full", "off"] as const) {
      const { session, layer } = setUp([{ id: 1, t: 21, l: 1, X: 0, Y: 0 }], undefined, juice);
      // The shot sheet comes in on the next turn of the event loop.
      await new Promise((resolve) => setTimeout(resolve, 0));
      session.appendFling({ x: -150, y: -150, monsters: { C1: 1 } });
      const landed = untilLanded(session, layer);
      expect(landed).not.toBeNull();
      const creep = session.battle()?.creeps()[0];
      expect(creep).toBeDefined();
      const id = creep?.id ?? -1;
      const glint = layer.bodyOf(id)?.glint ?? 0;
      if (juice === "full") expect(glint).toBeGreaterThan(0.5);
      else expect(glint).toBe(0);
      // Gone again well before the next shot.
      for (let step = 0; step < 8; step += 1) frame(session, layer);
      expect(layer.bodyOf(id)?.glint).toBe(0);
      expect(layer.bodyOf(id)?.felled).toBe(false);
      layer.destroy();
    }
  });

  it("shoots Flash's shots in the Classic look, whatever the effects setting says", async () => {
    for (const classic of [false, true]) {
      const { session, layer } = setUp([{ id: 1, t: 21, l: 1, X: 0, Y: 0 }], undefined, "full", classic);
      await new Promise((resolve) => setTimeout(resolve, 0));
      session.appendFling({ x: -150, y: -150, monsters: { C1: 1 } });
      let sparks = 0;
      for (let step = 0; step < TICKS_PER_SECOND * 10 && !session.ended; step += 1) {
        frame(session, layer);
        sparks = Math.max(sparks, layer.towerEffects.sparkCount);
        if (classic) expect(layer.creepEffects.labelCount).toBe(0);
      }
      if (classic) expect(sparks).toBe(0);
      else expect(sparks).toBeGreaterThan(0);
      layer.destroy();
    }
  });

  it("keeps a creep it killed up for a moment, frozen and fading, then lets it go into its splat", async () => {
    const { session, layer } = setUp([{ id: 1, t: 21, l: 1, X: 0, Y: 0 }], undefined, "full");
    await new Promise((resolve) => setTimeout(resolve, 0));
    session.appendFling({ x: -200, y: -100, monsters: { C1: 1 } });
    let killed = -1;
    for (let step = 0; step < 30 * TICKS_PER_SECOND && killed < 0; step += 1) {
      const death = frame(session, layer).find((event) => event.kind === "death");
      if (death?.kind === "death") killed = death.creepId;
    }
    expect(killed).toBeGreaterThanOrEqual(0);
    // The killing round lands; the creep stays up over its splat.
    for (let step = 0; step < 2 * TICKS_PER_SECOND && layer.towerEffects.flyingCount > 0; step += 1) {
      frame(session, layer);
    }
    expect(layer.towerEffects.flyingCount).toBe(0);
    expect(layer.splatCount).toBeGreaterThan(0);
    const struck = layer.bodyOf(killed);
    expect(struck?.felled).toBe(true);
    expect(struck?.glint).toBeGreaterThan(0.5);
    expect(layer.shownHealthOf(killed)).toBeNull();
    const alphas: number[] = [];
    let frames = 0;
    while (layer.bodyOf(killed) !== null && frames < 40) {
      frame(session, layer);
      alphas.push(layer.bodyOf(killed)?.alpha ?? 0);
      frames += 1;
    }
    expect(layer.bodyOf(killed)).toBeNull();
    expect(frames).toBeGreaterThan(5);
    expect(frames).toBeLessThanOrEqual(FELLED_TICKS + 1);
    // It fades, never brightening back.
    for (let i = 1; i < alphas.length; i += 1) expect(alphas[i]).toBeLessThanOrEqual(alphas[i - 1] ?? 1);
    expect(layer.creepCount).toBe(0);
    layer.destroy();
  });
});

describe("a ranged creep's fireball (#77)", () => {
  it("darkens the building it hits when it lands, not when it is thrown", () => {
    const { session, layer, host } = setUp([{ id: 1, t: 14, l: 1, X: 0, Y: 0 }], { C14: 5 });
    session.appendFling({ x: -250, y: -250, monsters: { C14: 1 } });

    let hitTick = -1;
    for (let step = 0; step < 30 * TICKS_PER_SECOND && hitTick < 0; step += 1) {
      const hit = frame(session, layer).find(
        (event) =>
          event.kind === "hit" && event.ranged && event.buildingId === 1 && event.amount > 0,
      );
      if (hit) hitTick = hit.tick;
    }
    expect(hitTick).toBeGreaterThan(0);
    // The engine has the building hurt; the picture still shows it whole,
    // even when the session tells the layer to look again mid-flight (a
    // speed change notifies, as its quarter-second ticks do).
    expect(session.battle()?.state().health["1"]).toBeDefined();
    session.setSpeed(2);
    session.setSpeed(1);
    layer.update();
    expect(host.damage.get(1) ?? 1).toBe(1);

    for (let step = 0; step < PROJECTILE_TICKS - 1; step += 1) {
      frame(session, layer);
      session.setSpeed(2);
      session.setSpeed(1);
      layer.update();
      expect(host.damage.get(1) ?? 1).toBe(1);
    }
    frame(session, layer);
    expect(host.damage.get(1)).toBeLessThan(1);
    layer.destroy();
  });
});
