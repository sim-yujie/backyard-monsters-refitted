import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { footprintOf } from "../../game-data/buildingFootprints.js";
import {
  bucketCost,
  buildEngineYard,
  defenderForcesOf,
  dropRadius,
  flingCost,
  flingerPayload,
  GRID_CELL,
  GRID_WIDTH,
  mulberry32,
  TICKS_PER_SECOND,
  type CombatBuildingDataMap,
  type FlingEvent,
} from "../../game-rules/combat/index.js";
import { parseFlingLog } from "../base/attackCheckpoint.js";
import { fightableLog } from "../base/combat/attackLoot.js";
import { replayAbandonedAttack } from "../base/combat/abandonedAttack.js";
import { yardSize } from "../yardplanner/layoutGeometry.js";
import { PERSONAS, targetInBand } from "./progression.js";
import {
  DROP_GAP_SECONDS,
  DROP_POINTS,
  FIRST_DROP_SECONDS,
  planRevenge,
  revengeArmyOf,
  splitArmy,
  zoneTouches,
  type RevengeArmy,
} from "./revengePlan.js";
import { generateBotYard, type BotYard } from "./yardGenerator.js";

/** The bot revenge drop planner (issue #243, `docs/design/bot-neighbours.md` §4.7). */

const NOW = 1_800_000_000;
const PAYLOAD = flingerPayload();

/** Every replay here runs the whole combat engine, which a loaded machine slows. */
const REPLAY_TIMEOUT_MS = 120_000;

const SANDBOX = fileURLToPath(new URL("../../../../web/test/fixtures/baseload-sandbox-yard.json", import.meta.url));
const sandbox = JSON.parse(readFileSync(SANDBOX, "utf8"));

/**
 * A generated yard as `buildingdata`. The bot layout (WP5, #238) gives every
 * building its `X`/`Y`; until it is merged the generator leaves them out, and
 * this places them itself: in id order, each on the free 10-unit cell nearest
 * the middle (a little jitter, a 10-unit gap round every footprint) of the
 * biggest plot. Crude, but a yard of the right buildings and levels, packed
 * as a young player packs one.
 */
const buildingDataOf = (yard: BotYard, seed: number): Record<string, Record<string, unknown>> => {
  const placed = yard.buildings as unknown as ReadonlyArray<{ X?: unknown; Y?: unknown }>;
  const positions = placed.every((building) => typeof building.X === "number" && typeof building.Y === "number")
    ? placed.map((building) => ({ X: building.X as number, Y: building.Y as number }))
    : packed(yard, seed);
  return Object.fromEntries(
    yard.buildings.map((building, index) => [
      String(building.id),
      { ...building, ...positions[index]! } as Record<string, unknown>,
    ])
  );
};

const packed = (yard: BotYard, seed: number): { X: number; Y: number }[] => {
  const cell = 10;
  const [width, height] = yardSize(6);
  const columns = width / cell;
  const rows = height / cell;
  const taken = new Uint8Array(columns * rows);
  const rng = mulberry32(seed);
  const spots = Array.from({ length: columns * rows }, (_, index) => {
    const x = (index % columns) * cell - width / 2;
    const y = Math.floor(index / columns) * cell - height / 2;
    return { index, x, y, d: Math.hypot(x, y) + rng.float() * 60 };
  }).sort((a, b) => a.d - b.d);

  return yard.buildings.map((building) => {
    const { w, h } = footprintOf(building.t);
    const wide = Math.ceil(w / cell) + 2;
    const high = Math.ceil(h / cell) + 2;
    for (const spot of spots) {
      const column = (spot.index % columns) - 1;
      const row = Math.floor(spot.index / columns) - 1;
      if (column < 0 || row < 0 || column + wide > columns || row + high > rows) continue;
      let free = true;
      for (let dy = 0; dy < high && free; dy++) {
        for (let dx = 0; dx < wide && free; dx++) free = taken[(row + dy) * columns + column + dx] === 0;
      }
      if (!free) continue;
      for (let dy = 1; dy < high - 1; dy++) {
        for (let dx = 1; dx < wide - 1; dx++) taken[(row + dy) * columns + column + dx] = 1;
      }
      return { X: spot.x, Y: spot.y };
    }
    throw new Error("plot full");
  });
};

/** A bot of `level` and what it would field. */
const botAt = (level: number, seed: number) => {
  const yard = generateBotYard({
    seed,
    persona: PERSONAS[seed % PERSONAS.length]!,
    targetPoints: targetInBand(level, 0.5),
    now: NOW,
  });
  return { yard, army: revengeArmyOf(yard) };
};

/** A player's yard of `level`: another generated yard, with its defence. */
const playerAt = (level: number, seed: number) => {
  const yard = generateBotYard({
    seed,
    persona: PERSONAS[(seed + 1) % PERSONAS.length]!,
    targetPoints: targetInBand(level, 0.3),
    now: NOW,
  });
  const buildingdata = buildingDataOf(yard, seed);
  return {
    buildingdata: buildingdata as unknown as CombatBuildingDataMap,
    resources: yard.resources,
    defence: defenderForcesOf({ buildingdata, academy: yard.academy, champion: yard.champion }),
  };
};

const flings = (events: readonly FlingEvent[]) =>
  events.filter((event): event is Extract<FlingEvent, { kind: "fling" }> => event.kind === "fling");

const sum = (rosters: readonly Readonly<Record<string, number>>[]): Record<string, number> => {
  const total: Record<string, number> = {};
  for (const roster of rosters) for (const [id, count] of Object.entries(roster)) total[id] = (total[id] ?? 0) + count;
  return total;
};

/** Every rule a plan keeps, whatever the yard (§4.7 step 3). */
const expectValid = (army: RevengeArmy, buildingdata: CombatBuildingDataMap, seed: number) => {
  const plan = planRevenge(army, { buildingdata }, seed);
  expect(plan).not.toBeNull();
  const events = plan!.events;

  // Flings only: no bombs, siege weapons or retreat.
  expect(flings(events).length).toBe(events.length);
  const drops = flings(events);

  // Every monster flung, exactly once; within the payload each drop.
  expect(sum(drops.map((drop) => drop.monsters))).toEqual({ ...army.monsters });
  for (const drop of drops) {
    expect(bucketCost(drop.monsters, army.levels)).toBeLessThanOrEqual(PAYLOAD);
    expect(drop.r).toBe(dropRadius(flingCost(drop, army.levels)));
  }

  // The champion with the first drop, and only there.
  expect(drops[0]!.champion).toEqual(army.champion ?? undefined);
  for (const drop of drops.slice(1)) expect(drop.champion).toBeUndefined();

  // 1-3 points, each clear of every footprint for its zone and on the grid.
  const points = new Set(drops.map((drop) => `${drop.x},${drop.y}`));
  expect(points.size).toBeGreaterThanOrEqual(DROP_POINTS.min);
  expect(points.size).toBeLessThanOrEqual(DROP_POINTS.max);
  const blockers = buildEngineYard({ buildingdata, kind: "main" }).buildings.filter(
    (building) => building.kind !== "trap" && building.kind !== "decoration"
  );
  const reach = (GRID_WIDTH / 2 - 1) * GRID_CELL;
  for (const drop of drops) {
    expect(zoneTouches(drop, 2 * drop.r, blockers)).toBe(false);
    expect(Math.abs(drop.x)).toBeLessThanOrEqual(reach - drop.r);
    expect(Math.abs(drop.y)).toBeLessThanOrEqual(reach - drop.r);
    // And outside every footprint, measured plainly in yard units.
    for (const building of blockers) {
      const inside =
        drop.x >= building.x && drop.x < building.x + building.w && drop.y >= building.y && drop.y < building.y + building.h;
      expect(inside).toBe(false);
    }
  }

  // The first drop 1-3 s in, then 2-8 s apart.
  const ticks = drops.map((drop) => drop.t);
  expect(ticks[0]!).toBeGreaterThanOrEqual(FIRST_DROP_SECONDS.min * TICKS_PER_SECOND - 1);
  expect(ticks[0]!).toBeLessThanOrEqual(FIRST_DROP_SECONDS.max * TICKS_PER_SECOND + 1);
  for (let i = 1; i < ticks.length; i++) {
    expect(ticks[i]! - ticks[i - 1]!).toBeGreaterThanOrEqual(DROP_GAP_SECONDS.min * TICKS_PER_SECOND - 1);
    expect(ticks[i]! - ticks[i - 1]!).toBeLessThanOrEqual(DROP_GAP_SECONDS.max * TICKS_PER_SECOND + 1);
  }

  // A log the checkpoint reads, and one the landing fights unchanged.
  const log = { v: 1 as const, seed: 77, events };
  expect(parseFlingLog(log)).not.toBeNull();
  const champions = army.champion ? [army.champion] : [];
  expect(fightableLog(log, { champion: champions }, { bot: army.monsters }).events).toEqual(events);
  return plan!;
};

describe("revengeArmyOf", () => {
  test("is everything housed and the champion at home with health", () => {
    const army = revengeArmyOf({
      monsters: { housed: { C1: 12, C3: 4.7, C5: 0, C9: -2 } },
      champion: [{ t: 2, l: 3, hp: 30000, pl: 1, status: 0 }],
      academy: { C1: { level: 2 }, C3: { level: 1 } },
    });
    expect(army).toEqual({ monsters: { C1: 12, C3: 4 }, champion: { t: 2, l: 3, pl: 1 }, levels: { C1: 2, C3: 1 } });
  });

  test("leaves a dead or frozen champion home, and copes with an empty save", () => {
    expect(revengeArmyOf({ monsters: {}, champion: [{ t: 2, l: 3, hp: 0, status: 0 }], academy: {} }).champion).toBeNull();
    expect(revengeArmyOf({ monsters: {}, champion: [{ t: 2, l: 3, hp: 9, status: 1 }], academy: {} }).champion).toBeNull();
    expect(revengeArmyOf({ monsters: null, champion: null, academy: null })).toEqual({
      monsters: {},
      champion: null,
      levels: {},
    });
  });

  test("is what the generator gives a bot of that level: its Housing and its champion", () => {
    for (const level of [5, 25, 40]) {
      const { yard, army } = botAt(level, 11);
      expect(army.monsters).toEqual(yard.monsters.housed);
      expect(army.champion?.t).toBe(yard.champion[0]?.t);
    }
  });
});

describe("splitArmy", () => {
  test("spreads each monster evenly and keeps every drop within the payload", () => {
    const drops = splitArmy({ C1: 10, C3: 7 }, {}, 3, PAYLOAD);
    expect(drops.length).toBe(3);
    expect(sum(drops.map((drop) => drop.monsters))).toEqual({ C1: 10, C3: 7 });
    for (const drop of drops) {
      expect(drop.monsters.C1! >= 3 && drop.monsters.C1! <= 4).toBe(true);
      expect(drop.monsters.C3! >= 2 && drop.monsters.C3! <= 3).toBe(true);
    }
  });

  test("adds drops when the army outgrows the payload", () => {
    const unit = bucketCost({ C1: 1 }, {});
    const many = Math.ceil((PAYLOAD * 2.5) / unit);
    const drops = splitArmy({ C1: many }, {}, 1, PAYLOAD);
    expect(drops.length).toBe(3);
    for (const drop of drops) expect(bucketCost(drop.monsters, {})).toBeLessThanOrEqual(PAYLOAD);
    expect(sum(drops.map((drop) => drop.monsters))).toEqual({ C1: many });
  });

  test("never makes more drops than monsters, nor an empty one", () => {
    const drops = splitArmy({ C1: 2 }, {}, 5, PAYLOAD);
    expect(drops).toEqual([{ monsters: { C1: 1 } }, { monsters: { C1: 1 } }]);
    expect(splitArmy({}, {}, 3, PAYLOAD)).toEqual([]);
  });
});

describe("planRevenge", () => {
  test("is the same plan for the same seed, and another for another", () => {
    const { army } = botAt(20, 3);
    const { buildingdata } = playerAt(20, 4);
    const one = planRevenge(army, { buildingdata }, 99);
    expect(planRevenge(army, { buildingdata }, 99)).toEqual(one);
    expect(planRevenge(army, { buildingdata }, 100)).not.toEqual(one);
  });

  test("keeps every rule against yards of every level", () => {
    let planned = 0;
    for (let level = 1; level <= 40; level++) {
      for (const seed of [1, 2, 3]) {
        const { army } = botAt(level, level * 7 + seed);
        const { buildingdata } = playerAt(Math.min(40, level + seed - 2 || 1), level * 13 + seed);
        // A young bot with no Housing yet has nothing to field, as a player
        // without one: no plan, so no revenge.
        if (Object.keys(army.monsters).length === 0 && !army.champion) {
          expect(planRevenge(army, { buildingdata }, seed)).toBeNull();
          continue;
        }
        planned += 1;
        expectValid(army, buildingdata, level * 31 + seed);
      }
    }
    // Only the first levels can lack Housing.
    expect(planned).toBeGreaterThanOrEqual(110);
  });

  test("keeps every rule against a full player yard", () => {
    const { army } = botAt(40, 5);
    for (const seed of [1, 2, 3, 4, 5]) expectValid(army, sandbox.buildingdata, seed);
  });

  test("lands a champion alone when there is nothing else", () => {
    const army: RevengeArmy = { monsters: {}, champion: { t: 1, l: 2, pl: 0 }, levels: {} };
    const plan = planRevenge(army, { buildingdata: playerAt(30, 1).buildingdata }, 5)!;
    expect(plan.events).toEqual([expect.objectContaining({ kind: "fling", monsters: {}, champion: army.champion })]);
  });

  test("is no plan with nothing to fling or nothing to attack", () => {
    const { army } = botAt(20, 1);
    expect(planRevenge({ monsters: {}, champion: null, levels: {} }, { buildingdata: sandbox.buildingdata }, 1)).toBeNull();
    expect(planRevenge(army, { buildingdata: {} }, 1)).toBeNull();
    const flat = Object.fromEntries(Object.keys(sandbox.buildingdata).map((id) => [id, 0]));
    expect(planRevenge(army, { buildingdata: sandbox.buildingdata, buildinghealthdata: flat }, 1)).toBeNull();
  });
});

describe("a revenge plan in the shared engine", () => {
  /** The bot's plan fought as the landing fights it (`replayAbandonedAttack`, as the finaliser does). */
  const fight = (level: number, seed: number) => {
    const { yard, army } = botAt(level, seed);
    const player = playerAt(Math.max(1, level - 2), seed + 1000);
    const plan = planRevenge(army, { buildingdata: player.buildingdata }, seed)!;
    return replayAbandonedAttack({
      defender: { type: "main", buildingdata: player.buildingdata, buildinghealthdata: null, resources: player.resources },
      attacker: { academy: yard.academy as never, champion: yard.champion, siege: null },
      log: { v: 1, seed: seed * 7919, events: plan.events },
      tick: plan.tick,
      declareWar: false,
      left: false,
      defence: player.defence,
    });
  };

  for (const level of [3, 8, 14, 20, 26, 32, 38, 40]) {
    test(
      `a level ${level} bot damages a level ${Math.max(1, level - 2)} yard and the battle ends`,
      () => {
        const outcome = fight(level, level);
        expect(outcome.damage).toBeGreaterThan(0);
        expect(outcome.tick).toBeLessThanOrEqual(planRevengeTick());
      },
      REPLAY_TIMEOUT_MS
    );
  }

  test(
    "a level 40 bot damages the full player yard",
    () => {
      const { yard, army } = botAt(40, 9);
      const plan = planRevenge(army, { buildingdata: sandbox.buildingdata }, 9)!;
      const outcome = replayAbandonedAttack({
        defender: {
          type: "main",
          buildingdata: sandbox.buildingdata,
          buildinghealthdata: sandbox.buildinghealthdata,
          resources: sandbox.resources,
        },
        attacker: { academy: yard.academy as never, champion: yard.champion, siege: null },
        log: { v: 1, seed: 4242, events: plan.events },
        tick: plan.tick,
        declareWar: false,
        left: false,
        defence: defenderForcesOf(sandbox),
      });
      expect(outcome.damage).toBeGreaterThan(0);
    },
    REPLAY_TIMEOUT_MS
  );
});

/** The tick every plan is fought to. */
const planRevengeTick = () => planRevenge(botAt(10, 1).army, { buildingdata: sandbox.buildingdata }, 1)!.tick;
