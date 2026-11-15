import { describe, expect, it } from "vitest";
import { createBattle } from "./engine";
import type { AttackEvent, Battle, BattleOptions } from "./engine";
import { buildEngineYard, buildingMaxHp } from "./yard";
import type { CombatBuildingDataMap, CombatTargetKind } from "./types";

/**
 * A Monster Bunker below half health sends no one out (player report, 15 Nov
 * 2026: damaged Map Room 2 camp bunkers still let monsters out).
 *
 * Flash has no health check on the release itself: `BUILDING22.TickAttack`
 * sends a monster only through a door that is fully up (`_animTick >= 15`,
 * `BUILDING22.as:344`), and the door moves only in `TickFast` (`:433-455`), an
 * ENTER_FRAME listener the building drops when it loads a new look
 * (`BFOUNDATION.as:1096-1098`) and takes back only for a look with an `anim`
 * strip. The damaged look, worn below half health (`isCriticallyDamaged`,
 * `BFOUNDATION.as:495-497`), has none on any yard (`YARD_PROPS.as:2460-2470`,
 * `OUTPOST_YARD_PROPS.as:1869-1878`, `INFERNOYARDPROPS.as:1929-1938`). So the
 * door is stuck where it was: shut for a bunker that starts below half, and as
 * it was for one that falls below half mid-fight.
 */

/** Every yard a Monster Bunker can stand on. */
const KINDS: readonly CombatTargetKind[] = ["main", "wild", "tribe", "outpost", "inferno"];

const BUNKER = 1;

/** A level 1 bunker at the origin and a harvester to the south-east, the bunker at `health`. */
const yardOf = (kind: CombatTargetKind, health: number | undefined, extra: CombatBuildingDataMap = {}) =>
  buildEngineYard({
    buildingdata: {
      "1": { id: BUNKER, t: 22, l: 1, X: 0, Y: 0 },
      "2": { id: 2, t: 1, l: 1, X: 290, Y: 290 },
      ...extra,
    },
    buildinghealthdata: health === undefined ? {} : { [String(BUNKER)]: health },
    resources: { r1: 100000, r2: 0, r3: 0, r4: 0 },
    kind,
  });

/** A Pokey at the harvester, in the bunker's range. */
const pokeys = (count: number): AttackEvent => ({
  kind: "fling",
  t: 0,
  x: 270,
  y: 270,
  r: 0,
  monsters: { C1: count },
});

interface Watch {
  /** Defenders sent, in all. */
  sent: number;
  /** Ticks of each `release` event. */
  releases: number[];
  /** Ticks of each `bunkerDoor` event. */
  doors: number[];
  /** The first tick the bunker stood below half, or Infinity. */
  crossed: number;
  /** The tick the bunker fell, or Infinity. */
  fallen: number;
}

/** Runs the battle `ticks` steps, watching the bunker. */
const watch = (battle: Battle, ticks: number, maxHp: number): Watch => {
  const out: Watch = { sent: 0, releases: [], doors: [], crossed: Infinity, fallen: Infinity };
  for (let step = 0; step < ticks && !battle.over(); step += 1) {
    battle.step();
    for (const event of battle.recentEvents(battle.tick - 1)) {
      if (event.kind === "release") out.releases.push(event.tick);
      if (event.kind === "bunkerDoor") out.doors.push(event.tick);
    }
    const hp = battle.state().health[String(BUNKER)] ?? maxHp;
    if (out.crossed === Infinity && hp > 0 && hp < maxHp * 0.5) out.crossed = battle.tick;
    if (out.fallen === Infinity && hp <= 0) out.fallen = battle.tick;
  }
  out.sent = battle.state().bunkers.find((report) => report.id === BUNKER)?.sent ?? 0;
  return out;
};

const fight = (kind: CombatTargetKind, health: number | undefined, options: Partial<BattleOptions> = {}) => {
  const maxHp = buildingMaxHp(22, 1, kind);
  const battle = createBattle(yardOf(kind, health), { seed: 3, bunkers: { [BUNKER]: { C1: 4 } }, ...options });
  battle.apply(pokeys(1));
  return watch(battle, 400, maxHp);
};

describe("a Monster Bunker that starts the battle below half health", () => {
  for (const kind of KINDS) {
    const maxHp = buildingMaxHp(22, 1, kind);

    it(`sends no one out and never opens its door (${kind} yard)`, () => {
      const result = fight(kind, maxHp * 0.5 - 1);
      expect(result.sent).toBe(0);
      expect(result.releases).toEqual([]);
      expect(result.doors).toEqual([]);
    });

    it(`at exactly half is not damaged and sends as before (${kind} yard)`, () => {
      const half = fight(kind, maxHp * 0.5);
      const full = fight(kind, undefined);
      expect(full.sent).toBeGreaterThan(0);
      expect(half.sent).toBe(full.sent);
      expect(half.releases).toEqual(full.releases);
    });

    it(`above half sends as at full health (${kind} yard)`, () => {
      const above = fight(kind, Math.ceil(maxHp * 0.75));
      const full = fight(kind, undefined);
      expect(above.sent).toBe(full.sent);
      expect(above.releases).toEqual(full.releases);
    });
  }

  it("keeps a Decoy's pull shut out too: nothing comes out to it", () => {
    const decoyAt: AttackEvent = { kind: "siege", t: 0, x: 100, y: 100, weapon: "decoy" };
    const maxHp = buildingMaxHp(22, 1, "main");
    const run = (health: number | undefined) => {
      const yard = buildEngineYard({
        buildingdata: {
          "1": { id: BUNKER, t: 22, l: 1, X: 0, Y: 0 },
          "2": { id: 2, t: 14, l: 1, X: 800, Y: 800 },
        },
        buildinghealthdata: health === undefined ? {} : { [String(BUNKER)]: health },
        resources: { r1: 100000, r2: 0, r3: 0, r4: 0 },
      });
      const battle = createBattle(yard, { seed: 11, bunkers: { [BUNKER]: { C6: 3 } }, siege: { decoy: 1 } });
      battle.apply({ kind: "fling", t: 0, x: 780, y: 780, r: 0, monsters: { C1: 1 } });
      battle.apply(decoyAt);
      return watch(battle, 600, maxHp);
    };
    expect(run(undefined).sent).toBeGreaterThan(0);
    const damaged = run(maxHp * 0.5 - 1);
    expect(damaged.sent).toBe(0);
    expect(damaged.doors).toEqual([]);
  });
});

describe("a Monster Bunker that falls below half mid-fight", () => {
  /**
   * The bunker starts at exactly half, so the first blow takes it below. While
   * it stands, its door never moves again (a fallen bunker's shuts, as before).
   */
  const crossing = (flingAt: number, count: number, held: number) => {
    const maxHp = buildingMaxHp(22, 1, "main");
    const yard = buildEngineYard({
      buildingdata: {
        "1": { id: BUNKER, t: 22, l: 1, X: 0, Y: 0 },
        "2": { id: 2, t: 1, l: 1, X: flingAt + 20, Y: flingAt + 20 },
      },
      buildinghealthdata: { [String(BUNKER)]: maxHp * 0.5 },
      resources: { r1: 100000, r2: 0, r3: 0, r4: 0 },
    });
    const battle = createBattle(yard, { seed: 5, bunkers: { [BUNKER]: { C1: held } } });
    battle.apply({ kind: "fling", t: 0, x: flingAt, y: flingAt, r: 0, monsters: { C1: count } });
    return watch(battle, 3000, maxHp);
  };

  it("hit before its door is fully up: the door stays shut and no one comes out", () => {
    const result = crossing(40, 12, 8);
    expect(result.crossed).toBeLessThan(20);
    expect(result.doors.filter((tick) => tick < result.fallen)).toEqual(
      result.doors.filter((tick) => tick <= result.crossed),
    );
    expect(result.sent).toBe(0);
  });

  it("hit with its door fully up: the door stays up and it goes on sending", () => {
    const result = crossing(200, 30, 30);
    // Its first defender came out before the crossing, through a door fully up.
    expect(result.releases[0]).toBeLessThan(result.crossed);
    expect(result.crossed).toBeLessThan(result.fallen);
    for (const tick of result.doors) {
      expect(tick <= result.crossed || tick >= result.fallen).toBe(true);
    }
    expect(result.releases.some((tick) => tick > result.crossed)).toBe(true);
  });
});

describe("the Inferno's Housing Bunker (type 128)", () => {
  it("is not a Monster Bunker: it sends at any health above zero, as Flash does", () => {
    // `HOUSINGBUNKER.TickAttack` (`HOUSINGBUNKER.as:237-300`) has no door and no health check.
    const yard = buildEngineYard({
      buildingdata: {
        "1": { id: 1, t: 128, l: 1, X: 0, Y: 0 },
        "2": { id: 2, t: 1, l: 1, X: 900, Y: 900 },
      },
      buildinghealthdata: { "1": Math.floor(buildingMaxHp(128, 1, "inferno") * 0.1) },
      resources: { r1: 100000, r2: 0, r3: 0, r4: 0 },
      kind: "inferno",
    });
    const battle = createBattle(yard, { seed: 5, bunkers: { 1: { IC1: 3 } } });
    battle.apply({ kind: "fling", t: 0, x: 160, y: 160, r: 0, monsters: { C1: 1 } });
    for (let step = 0; step < 30; step += 1) battle.step();
    expect(battle.creeps().filter((creep) => creep.friendly)).toHaveLength(3);
  });
});
