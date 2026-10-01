import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ATTACK_COUNTDOWN_SECONDS,
  RETREAT_GRACE_SECONDS,
  buildEngineYard,
  createBattle,
  ticks,
  type FlingEvent,
  type FlingLog,
} from "../../../game-rules/combat/index.js";
import type { AttackSession } from "../attackSession.js";
import { siloCapacity } from "../../../game-data/buildingCosts.js";
import { BASE_STORAGE, OUTPOST_STORAGE } from "../economy/resourceBudget.js";
import {
  attackLootOf,
  attackerLootCap,
  bankAttackLoot,
  fightableLog,
  krallenBuffOf,
  wholeAmounts,
  type LootAttacker,
  type LootDefender,
} from "./attackLoot.js";

/**
 * Attack loot is capped by the server's own replay (issue #163). The golden
 * replay fixtures stand in for real attacks: an "honest client" below fights
 * each one the way `AttackSession` does — the shared engine, every event
 * applied at its own tick, stopped wherever the player stopped — and whatever
 * it reports must be credited in full, while anything more must not.
 */

const FIXTURE_DIR = fileURLToPath(new URL("../../../../../web/test/fixtures/combat/", import.meta.url));
const SANDBOX = fileURLToPath(new URL("../../../../../web/test/fixtures/baseload-sandbox-yard.json", import.meta.url));
const sandbox = JSON.parse(readFileSync(SANDBOX, "utf8"));

const REPLAY_TIMEOUT_MS = 60_000;

interface Fixture {
  name: string;
  yard: "sandbox" | Record<string, Record<string, number>>;
  kind: "main" | "outpost" | "wild";
  /** `buildinghealthdata`, when the yard opens damaged. */
  health?: Record<string, number>;
  /** The map cell's height, which stretches an outpost's tower range. */
  height?: number;
  resources?: Record<string, number>;
  levels: Record<string, number>;
  log: FlingLog;
}

const fixtures: Fixture[] = readdirSync(FIXTURE_DIR)
  .filter((file) => file.endsWith(".json"))
  .sort()
  .map((file) => JSON.parse(readFileSync(`${FIXTURE_DIR}${file}`, "utf8")));

const fixture = (name: string) => fixtures.find((one) => one.name === name)!;

const TYPE_OF = { main: "main", outpost: "outpost", wild: "tribe" } as const;

const defenderOf = (one: Fixture): LootDefender =>
  one.yard === "sandbox"
    ? {
        type: TYPE_OF[one.kind],
        buildingdata: sandbox.buildingdata,
        buildinghealthdata: sandbox.buildinghealthdata,
        resources: sandbox.resources,
      }
    : {
        type: TYPE_OF[one.kind],
        buildingdata: one.yard as never,
        buildinghealthdata: one.health ?? {},
        resources: one.resources ?? {},
        ...(one.height !== undefined && { height: one.height }),
      };

/**
 * The attacker who fought the fixture: its academy, a Krallen and a Gorgo at
 * the power levels the fixtures fling them at (issue #202), a level 5 catapult.
 */
const attackerOf = (one: Fixture): LootAttacker => ({
  academy: Object.fromEntries(Object.entries(one.levels).map(([id, level]) => [id, { level }])),
  // Korath and Fomor at the power level the champion-ability fixtures fling them at (issue #222).
  champion: [
    { t: 5, l: 5, pl: 2 },
    { t: 1, l: 4, pl: 3 },
    { t: 4, l: 6, pl: 3 },
    { t: 3, l: 6, pl: 3 },
  ],
  catapult: 5,
  buildingdata: {},
});

/** Exactly what the log flings, as the attacker's one yard housed it at entry. */
const entryOf = (log: FlingLog): Record<string, Record<string, number>> => {
  const housed: Record<string, number> = {};
  for (const event of log.events) {
    if (event.kind !== "fling") continue;
    for (const [id, count] of Object.entries(event.monsters)) housed[id] = (housed[id] ?? 0) + count;
  }
  return { "2000241207": housed };
};

const sessionOf = (log: FlingLog, extra: Partial<AttackSession> = {}): AttackSession => ({
  attackerid: 2505,
  attackid: 1,
  startedat: 0,
  entryHoused: entryOf(log),
  ...extra,
});

const negative = (amounts: Record<string, number>) =>
  Object.fromEntries(Object.entries(amounts).map(([key, value]) => [key, value > 0 ? -value : 0]));

/**
 * `AttackSession`: the engine, each event at its tick, stopped at `end`, at
 * the level the attack load served; the loot it would report.
 */
const honestClient = (one: Fixture, end: number, playerLevel?: number, height = defenderOf(one).height) => {
  const defender = defenderOf(one);
  const battle = createBattle(
    buildEngineYard({
      buildingdata: defender.buildingdata ?? {},
      buildinghealthdata: defender.buildinghealthdata ?? null,
      resources: defender.resources as never,
      kind: one.kind,
      // What `AttackSession.load` reads off the load's `cellheight`.
      height: height ?? null,
    }),
    { seed: one.log.seed, levels: one.levels, declareWar: false, ...(playerLevel !== undefined && { playerLevel }) }
  );
  for (const event of one.log.events) {
    if (event.t > end) break;
    battle.runTo(event.t);
    battle.apply(event);
  }
  battle.runTo(end);
  const state = battle.state();
  return { attackloot: wholeAmounts(state.loot), defenderLoss: wholeAmounts(state.defenderLoss) };
};

const lootFor = (
  one: Fixture,
  sent: unknown,
  overrides: { log?: unknown; session?: AttackSession | null; reported?: unknown } = {}
) =>
  attackLootOf({
    sent,
    reported: overrides.reported,
    flinglog: overrides.log ?? one.log,
    session: overrides.session === undefined ? sessionOf(one.log) : overrides.session,
    defender: defenderOf(one),
    attacker: attackerOf(one),
    mapRoom3: false,
  });

const FULL = ticks(ATTACK_COUNTDOWN_SECONDS + RETREAT_GRACE_SECONDS);

describe("an honest attack is credited in full", () => {
  for (const one of fixtures) {
    test(
      `${one.name}: whenever the client stops, what it reports is credited`,
      () => {
        const first = one.log.events[0]!.t;
        for (const end of [first + 1600, first + 8000, FULL]) {
          const client = honestClient(one, end);
          const loot = lootFor(one, client.attackloot, { reported: negative(client.defenderLoss) });
          expect(loot.basis).toBe("replay");
          expect(loot.credit).toEqual(client.attackloot);
          expect(loot.defenderDelta).toEqual(negative(client.defenderLoss) as never);
        }
      },
      REPLAY_TIMEOUT_MS
    );
  }

});

/**
 * A player's outpost (issue #179): the core, the outpost ladders, the
 * harvesters' attack buffer and the cell's height all reach the replay as
 * they reach the client, so an honest attack is credited in full, and a
 * client that ignored the height fights a battle the server does not.
 */
describe("an attack on an outpost", () => {
  const one = fixture("outpost-core");

  test(
    "is credited in full, the core's fall and the harvesters' buffers included",
    () => {
      const client = honestClient(one, FULL);
      const loot = lootFor(one, client.attackloot, { reported: negative(client.defenderLoss) });
      expect(loot.basis).toBe("replay");
      // The core fell: a twentieth of 30M twigs is 1.5M, far beyond what the hits drew.
      expect(client.attackloot.r1).toBeGreaterThan(1_500_000);
      expect(loot.credit).toEqual(client.attackloot);
      expect(loot.defenderDelta).toEqual(negative(client.defenderLoss) as never);
    },
    REPLAY_TIMEOUT_MS
  );

  test(
    "is replayed on the cell's height: a battle fought on flat ground is not the one credited",
    () => {
      expect(one.height).toBe(250);
      const flat = honestClient(one, FULL, undefined, 0);
      const real = honestClient(one, FULL);
      expect(flat.attackloot).not.toEqual(real.attackloot);
      const loot = lootFor(one, flat.attackloot, { reported: negative(flat.defenderLoss) });
      const keys = ["r1", "r2", "r3", "r4"] as const;
      for (const key of keys) {
        expect(loot.credit[key]).toBe(Math.min(flat.attackloot[key], real.attackloot[key]));
      }
      // The towers reach further at height 250, so the flat battle claimed more than was there.
      expect(keys.some((key) => loot.credit[key] < flat.attackloot[key])).toBe(true);
    },
    REPLAY_TIMEOUT_MS
  );
});

describe("a low-level attacker (issue #167)", () => {
  for (const one of fixtures) {
    test(
      `${one.name}: a level 1 client, at the level its session kept, is credited in full`,
      () => {
        const first = one.log.events[0]!.t;
        for (const end of [first + 1600, first + 8000, FULL]) {
          const client = honestClient(one, end, 1);
          const loot = lootFor(one, client.attackloot, {
            reported: negative(client.defenderLoss),
            session: sessionOf(one.log, { attackerlevel: 1 }),
          });
          expect(loot.credit).toEqual(client.attackloot);
          expect(loot.defenderDelta).toEqual(negative(client.defenderLoss) as never);
        }
      },
      REPLAY_TIMEOUT_MS
    );
  }

  test(
    "the bonus is the session's level, never the client's: without one, a level 1 claim is cut",
    () => {
      const one = fixture("pokey-rush");
      const client = honestClient(one, FULL, 1);
      const atTwenty = honestClient(one, FULL, 20);
      const loot = lootFor(one, client.attackloot, { reported: negative(client.defenderLoss) });
      expect(client.attackloot.r1).toBeGreaterThan(atTwenty.attackloot.r1);
      for (const key of ["r1", "r2", "r3", "r4"] as const) {
        expect(loot.credit[key]).toBeLessThan(client.attackloot[key]);
      }
    },
    REPLAY_TIMEOUT_MS
  );

  test(
    "the defender pays for the loot, not for the bonus on it",
    () => {
      const one = fixture("pokey-rush");
      const client = honestClient(one, FULL, 1);
      const loot = lootFor(one, client.attackloot, {
        reported: {},
        session: sessionOf(one.log, { attackerlevel: 1 }),
      });
      for (const key of ["r1", "r2", "r3", "r4"] as const) {
        expect(-loot.defenderDelta[key]).toBe(Math.floor(client.attackloot[key] / 1.57));
        expect(-loot.defenderDelta[key]).toBeLessThanOrEqual(client.defenderLoss[key]);
      }
    },
    REPLAY_TIMEOUT_MS
  );
});

describe("the defender's loss", () => {
  test(
    "is at least what the attacker banked, so a pool cannot be looted and left whole",
    () => {
      const one = fixture("pokey-rush");
      const client = honestClient(one, FULL);
      const loot = lootFor(one, client.attackloot, { reported: { r1: 0, r2: 5, r3: -1 } });
      expect(loot.defenderDelta).toEqual(negative(client.attackloot) as never);
    },
    REPLAY_TIMEOUT_MS
  );

  test(
    "is at most what the battle could take, so a pool cannot be drained by a claim",
    () => {
      const one = fixture("pokey-rush");
      const loot = lootFor(one, {}, { reported: { r1: -1e9, r2: -1e9, r3: -1e9, r4: -1e9 } });
      // The sandbox holds 11 billion of each; a battle takes the falls' shares
      // (a Town Hall's at most 10 million, a silo's 4 million) and its hits.
      for (const key of ["r1", "r2", "r3", "r4"] as const) {
        expect(loot.defenderDelta[key]).toBeLessThan(0);
        expect(loot.defenderDelta[key]).toBeGreaterThan(-1e8);
      }
    },
    REPLAY_TIMEOUT_MS
  );
});

describe("a crafted save is not", () => {
  test(
    "a claim above the battle's loot is cut to it",
    () => {
      const one = fixture("pokey-rush");
      const loot = lootFor(one, { r1: 1e12, r2: 1e12, r3: 1e12, r4: 1e12 });
      expect(loot.credit).toEqual(loot.cap);
      expect(loot.cap.r1).toBeGreaterThan(0);
      expect(loot.cap.r1).toBeLessThan(1e8);
    },
    REPLAY_TIMEOUT_MS
  );

  test("negatives, fractions, text, storage caps and other keys credit nothing but whole gains", () => {
    const one = fixture("empty-yard");
    const loot = lootFor(one, { r1: 2.9, r2: -500, r3: "9999", r4: null, r1max: 1e12, __proto__: 5, x: 1 });
    expect(Object.keys(loot.credit).sort()).toEqual(["r1", "r2", "r3", "r4"]);
    expect(loot.credit.r1).toBe(2);
    expect(loot.credit.r2).toBe(0);
    expect(loot.credit.r4).toBe(0);
  }, REPLAY_TIMEOUT_MS);

  test(
    "flinging more monsters than the attacker housed at entry loots no more",
    () => {
      const one = fixture("pokey-rush");
      const honest = lootFor(one, { r1: 1e12, r2: 1e12, r3: 1e12, r4: 1e12 });
      const tenfold: FlingLog = {
        ...one.log,
        events: one.log.events.map((event) =>
          event.kind === "fling" ? { ...event, monsters: { C1: 3000 } } : event
        ),
      };
      const crafted = lootFor(one, { r1: 1e12, r2: 1e12, r3: 1e12, r4: 1e12 }, { log: tenfold });
      expect(crafted.cap).toEqual(honest.cap);
    },
    REPLAY_TIMEOUT_MS
  );

  test("a Map Room 2 save with no usable fling log is credited nothing and costs the defender nothing", () => {
    const one = fixture("pokey-rush");
    for (const log of [undefined, "not a log", { v: 2, seed: 1, events: [] }, { v: 1, seed: 1, events: [{ kind: "x" }] }]) {
      const loot = attackLootOf({
        sent: { r1: 5000 },
        reported: { r1: -5000 },
        flinglog: log,
        session: sessionOf(one.log),
        defender: defenderOf(one),
        attacker: attackerOf(one),
        mapRoom3: false,
      });
      expect(loot.basis).toBe("no-log");
      expect(loot.credit).toEqual({ r1: 0, r2: 0, r3: 0, r4: 0 });
      expect(loot.defenderDelta).toEqual({ r1: 0, r2: 0, r3: 0, r4: 0 });
    }
  }, REPLAY_TIMEOUT_MS);

  test("an empty log loots nothing", () => {
    const one = fixture("empty-yard");
    const loot = lootFor(one, { r1: 5000 }, { log: { v: 1, seed: 1, events: [] } });
    expect(loot.basis).toBe("replay");
    expect(loot.credit).toEqual({ r1: 0, r2: 0, r3: 0, r4: 0 });
  }, REPLAY_TIMEOUT_MS);
});

describe("the pool the replay draws on", () => {
  test(
    "is the one the attack load served, not one changed since",
    () => {
      const one = fixture("pokey-rush");
      const served = { r1: 400_000, r2: 400_000, r3: 400_000, r4: 400_000 };
      const drained = { ...defenderOf(one), resources: { r1: 0, r2: 0, r3: 0, r4: 0 } };
      const sent = { r1: 1e12, r2: 1e12, r3: 1e12, r4: 1e12 };

      const fromSession = attackLootOf({
        sent,
        reported: undefined,
        flinglog: one.log,
        session: sessionOf(one.log, { defenderResources: served }),
        defender: drained,
        attacker: attackerOf(one),
        mapRoom3: false,
      });
      const fromServed = attackLootOf({
        sent,
        reported: undefined,
        flinglog: one.log,
        session: sessionOf(one.log),
        defender: { ...drained, resources: served },
        attacker: attackerOf(one),
        mapRoom3: false,
      });
      expect(fromSession.cap).toEqual(fromServed.cap);
    },
    REPLAY_TIMEOUT_MS
  );

  const mapRoom3Attack = (mapRoom3: boolean) =>
    attackLootOf({
      sent: { r1: 1e9, r2: 10, r3: 1e9, r4: 1e9 },
      reported: { r1: -3000, r2: 0 },
      flinglog: undefined,
      session: { attackerid: 2505, attackid: 1, startedat: 0 },
      defender: {
        type: "main",
        buildingdata: { "1": { t: 1, st: 500 }, "2": { t: 6 } } as never,
        buildinghealthdata: {},
        resources: { r1: 1000, r2: 1000, r3: 0, r4: 0 },
      },
      attacker: attackerOf(fixture("pokey-rush")),
      mapRoom3,
    });

  test("a Map Room 3 attacker (no recorded roster): the defender's holdings times the bonus allowance", () => {
    const loot = mapRoom3Attack(true);
    expect(loot.basis).toBe("pool");
    expect(loot.credit).toEqual({ r1: 2400, r2: 10, r3: 0, r4: 0 });
    // Without a replay there is no ceiling but the pool itself (`defenderLootHandler` floors it).
    expect(loot.defenderDelta).toEqual({ r1: -3000, r2: -10, r3: 0, r4: 0 });
  }, REPLAY_TIMEOUT_MS);

  test("an attack load that named Map Room 3 for anyone else is credited nothing", () => {
    const loot = mapRoom3Attack(false);
    expect(loot.basis).toBe("no-roster");
    expect(loot.credit).toEqual({ r1: 0, r2: 0, r3: 0, r4: 0 });
    expect(loot.defenderDelta).toEqual({ r1: 0, r2: 0, r3: 0, r4: 0 });
  }, REPLAY_TIMEOUT_MS);
});

describe("fightableLog", () => {
  const attacker: LootAttacker = {
    academy: {},
    champion: [{ t: 5, l: 3 }, { t: 1, l: 6 }],
    catapult: 2,
    buildingdata: {},
  };
  const fling = (t: number, monsters: Record<string, number>, champion?: { t: number; l: number }): FlingEvent => ({
    kind: "fling",
    t,
    x: 0,
    y: 0,
    r: 100,
    monsters,
    ...(champion && { champion }),
  });

  test("an honest log comes back as it was", () => {
    const log: FlingLog = {
      v: 1,
      seed: 7,
      events: [
        fling(10, { C1: 5 }, { t: 5, l: 3 }),
        { kind: "bomb", t: 20, x: 0, y: 0, id: "pb1" },
        fling(30, { C1: 5, C2: 1 }),
        { kind: "retreat", t: 40 },
      ],
    };
    expect(fightableLog(log, attacker, { a: { C1: 8 }, b: { C1: 2, C2: 1 } })).toEqual(log);
  }, REPLAY_TIMEOUT_MS);

  test("monsters beyond what the yards housed at entry are not flung, and an emptied fling goes", () => {
    const log: FlingLog = { v: 1, seed: 7, events: [fling(10, { C1: 6, C9: 3 }), fling(20, { C1: 6 })] };
    expect(fightableLog(log, attacker, { a: { C1: 8 } }).events).toEqual([
      fling(10, { C1: 6 }),
      fling(20, { C1: 2 }),
    ]);
  }, REPLAY_TIMEOUT_MS);

  test("a champion the attacker does not own, a second time, or above its level is not fielded", () => {
    const log: FlingLog = {
      v: 1,
      seed: 7,
      events: [fling(10, {}, { t: 5, l: 9 }), fling(20, {}, { t: 5, l: 3 }), fling(30, { C1: 1 }, { t: 3, l: 1 })],
    };
    expect(fightableLog(log, attacker, { a: { C1: 1 } }).events).toEqual([
      fling(10, {}, { t: 5, l: 3 }),
      fling(30, { C1: 1 }),
    ]);
  }, REPLAY_TIMEOUT_MS);

  test("a champion fights at no more than its stored power level; a log without one, at its level alone (#202)", () => {
    const powered: LootAttacker = { ...attacker, champion: [{ t: 1, l: 6, pl: 2 }] };
    const withPower = (pl?: number): FlingEvent =>
      ({ ...fling(10, {}), champion: { t: 1, l: 6, ...(pl !== undefined && { pl }) } }) as FlingEvent;
    const fought = (pl?: number) =>
      fightableLog({ v: 1, seed: 7, events: [withPower(pl)] }, powered, {}).events[0] as FlingEvent;

    expect(fought(2)).toEqual(withPower(2));
    expect(fought(3)).toEqual(withPower(2));
    expect(fought(-1)).toEqual(withPower(0));
    // An old log, written before `pl` existed, keeps none: the engine reads that as 0.
    expect(fought(undefined)).toEqual(withPower(undefined));
    // A stored champion with no `pl` has none to give.
    expect(
      fightableLog({ v: 1, seed: 7, events: [withPower(3)] }, attacker, {}).events[0] as FlingEvent
    ).toEqual(withPower(0));
  }, REPLAY_TIMEOUT_MS);

  test("a champion keeps the Mode it was flung in; a log without one keeps none (#220)", () => {
    const withMode = (s?: string): FlingEvent =>
      ({ ...fling(10, {}), champion: { t: 5, l: 3, ...(s !== undefined && { s }) } }) as FlingEvent;
    const fought = (s?: string) =>
      fightableLog({ v: 1, seed: 7, events: [withMode(s)] }, attacker, {}).events[0] as FlingEvent;

    expect(fought("defensive")).toEqual(withMode("defensive"));
    expect(fought("offensive")).toMatchObject({ champion: { s: "offensive" } });
    expect((fought(undefined) as { champion: { s?: string } }).champion.s).toBeUndefined();
  }, REPLAY_TIMEOUT_MS);

  test("a bomb the catapult does not unlock, an unknown one or a second of the same resource does not go off", () => {
    const log: FlingLog = {
      v: 1,
      seed: 7,
      events: [
        { kind: "bomb", t: 1, x: 0, y: 0, id: "pu0" },
        { kind: "bomb", t: 2, x: 0, y: 0, id: "nope" },
        { kind: "bomb", t: 3, x: 0, y: 0, id: "pb0" },
        { kind: "bomb", t: 4, x: 0, y: 0, id: "pb1" },
      ],
    };
    expect(fightableLog(log, attacker, {}).events.map((event) => (event as { id: string }).id)).toEqual(["pb0"]);
  }, REPLAY_TIMEOUT_MS);
});

describe("the attacker's storage (issue #166)", () => {
  const log = (champion?: { t: number; l: number }): FlingLog => ({
    v: 1,
    seed: 7,
    events: [
      { kind: "fling", t: 10, x: 0, y: 0, r: 100, monsters: { C1: 1 } },
      { kind: "fling", t: 20, x: 0, y: 0, r: 100, monsters: {}, ...(champion && { champion }) },
    ],
  });

  test("Krallen raises the cap by her buffs at the level she was flung, capped at the one owned", () => {
    // `buffs: [0.2, 0.22, 0.24, 0.27, 0.3]` (`CHAMPIONCAGE.as:249`).
    expect(krallenBuffOf(log({ t: 5, l: 5 }), [{ t: 5, l: 5 }])).toBeCloseTo(0.3);
    expect(krallenBuffOf(log({ t: 5, l: 2 }), [{ t: 5, l: 5 }])).toBeCloseTo(0.22);
    expect(krallenBuffOf(log({ t: 5, l: 5 }), [{ t: 5, l: 1 }])).toBeCloseTo(0.2);
  }, REPLAY_TIMEOUT_MS);

  test("no Krallen flung, one not owned, or another champion raises nothing", () => {
    expect(krallenBuffOf(log(), [{ t: 5, l: 5 }])).toBe(0);
    expect(krallenBuffOf(log({ t: 5, l: 5 }), [])).toBe(0);
    expect(krallenBuffOf(log({ t: 3, l: 6 }), [{ t: 3, l: 6 }])).toBe(0);
    expect(krallenBuffOf(null, [{ t: 5, l: 5 }])).toBe(0);
  }, REPLAY_TIMEOUT_MS);

  test("the cap is the yard's silos and outposts, raised by Krallen", () => {
    const save = {
      buildingdata: { "1": { id: 1, t: 6, X: 0, Y: 0, l: 3 } } as never,
      outposts: [[1, 2, "3"]],
      resources: {},
    };
    const cap = BASE_STORAGE + siloCapacity(3) + OUTPOST_STORAGE;
    expect(attackerLootCap(save, 0)).toBe(cap);
    expect(attackerLootCap(save, 0.3)).toBe(Math.floor(cap * 1.3));
  }, REPLAY_TIMEOUT_MS);

  test("an attacker at or over the cap banks nothing and keeps what they hold", () => {
    const save = { buildingdata: {}, resources: { r1: BASE_STORAGE, r2: BASE_STORAGE + 500 } };
    const banked = bankAttackLoot(save, { r1: 4000, r2: 4000, r3: 0, r4: 0 }, 0);
    expect(banked.credited).toEqual({ r1: 0, r2: 0, r3: 0, r4: 0 });
    expect(banked.overflow).toEqual({ r1: 4000, r2: 4000, r3: 0, r4: 0 });
    expect(save.resources).toEqual({ r1: BASE_STORAGE, r2: BASE_STORAGE + 500 });
  }, REPLAY_TIMEOUT_MS);

  test("an attacker near the cap banks the room left, and Krallen's raise adds to it", () => {
    const near = () => ({ buildingdata: {}, resources: { r1: BASE_STORAGE - 300, r2: 0, r3: 0, r4: 0 } });
    const credit = { r1: 4000, r2: 4000, r3: 0, r4: 0 };

    const plain = near();
    expect(bankAttackLoot(plain, credit, 0).credited).toEqual({ r1: 300, r2: 4000, r3: 0, r4: 0 });
    expect(plain.resources).toEqual({ r1: BASE_STORAGE, r2: 4000, r3: 0, r4: 0 });

    const withKrallen = near();
    expect(bankAttackLoot(withKrallen, credit, 0.2).credited.r1).toBe(300 + BASE_STORAGE * 0.2);
  }, REPLAY_TIMEOUT_MS);

  test("attackLootOf says how far the battle's Krallen raises the cap", () => {
    // The fixture flings a level 5 Krallen, and the attacker owns one.
    expect(lootFor(fixture("mixed-waves"), {}).krallenBuff).toBeCloseTo(0.3);
    expect(lootFor(fixture("mixed-waves"), {}, { log: "not a log" }).krallenBuff).toBe(0);
  }, REPLAY_TIMEOUT_MS);
});
