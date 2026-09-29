import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ATTACK_COUNTDOWN_SECONDS,
  RETREAT_GRACE_SECONDS,
  attackReport,
  buildEngineYard,
  createBattle,
  damagePercent,
  derivedDestroyed,
  ticks,
  toCombatYard,
  type FlingLog,
} from "../../../game-rules/combat/index.js";
import { MR1_TRIBES_MAP } from "../../../game-data/tribes/v1/index.js";
import { MAX_CHECKPOINT_TICK } from "../attackCheckpoint.js";
import type { AttackSession } from "../attackSession.js";
import { replayAbandonedAttack } from "./abandonedAttack.js";
import { wholeAmounts } from "./attackLoot.js";
import { battleMismatches, battleReplayInput, battleTick, type BattleDefender } from "./battle.js";

/**
 * The attack save's battle is the server's (issue #23, C3), and an honest save
 * writes exactly what its client showed. The golden replay fixtures stand in
 * for real attacks: an "honest client" fights each one the way the web
 * client's `AttackSession` does (the shared engine, every event at its own
 * tick, stopped where the player stopped) and reports what its save carries.
 * The server's replay of the same log to the same tick must write the same.
 */

const FIXTURE_DIR = fileURLToPath(new URL("../../../../../web/test/fixtures/combat/", import.meta.url));
const SANDBOX = fileURLToPath(new URL("../../../../../web/test/fixtures/baseload-sandbox-yard.json", import.meta.url));
const sandbox = JSON.parse(readFileSync(SANDBOX, "utf8"));

const REPLAY_TIMEOUT_MS = 60_000;

interface Fixture {
  name: string;
  yard: "sandbox" | Record<string, Record<string, number>>;
  /** `tribe`: a Map Room 1 tribe, a `tribe` row the engine fights as `"tribe"`. */
  kind: "main" | "outpost" | "wild" | "tribe";
  health?: Record<string, number>;
  height?: number;
  resources?: Record<string, number>;
  levels: Record<string, number>;
  log: FlingLog;
}

const fixtures: Fixture[] = readdirSync(FIXTURE_DIR)
  .filter((file) => file.endsWith(".json"))
  .sort()
  .map((file) => JSON.parse(readFileSync(`${FIXTURE_DIR}${file}`, "utf8")));

const TYPE_OF = { main: "main", outpost: "outpost", wild: "tribe", tribe: "tribe" } as const;

const defenderOf = (one: Fixture): BattleDefender =>
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
        ...(one.kind === "tribe" && { kind: "tribe" as const }),
      };

const attackerOf = (one: Fixture) => ({
  academy: Object.fromEntries(Object.entries(one.levels).map(([id, level]) => [id, { level }])),
  champion: [{ t: 5, l: 5, hp: 62000 }],
  catapult: 5,
  buildingdata: {},
  siege: null,
});

const sessionOf = (log: FlingLog): AttackSession => {
  const housed: Record<string, number> = {};
  for (const event of log.events) {
    if (event.kind !== "fling") continue;
    for (const [id, count] of Object.entries(event.monsters)) housed[id] = (housed[id] ?? 0) + count;
  }
  return { attackerid: 2505, attackid: 1, startedat: 0, entryHoused: { "2000241207": housed } };
};

/** The log as the client held it at `end`: nothing it had not done yet. */
const logAt = (log: FlingLog, end: number): FlingLog => ({ ...log, events: log.events.filter((event) => event.t <= end) });

/** `AttackSession` to `end`, and the figures its save carries (`attackSave.ts`). */
const honestClient = (one: Fixture, end: number) => {
  const defender = defenderOf(one);
  const buildingdata = (defender.buildingdata ?? {}) as never;
  const battle = createBattle(
    buildEngineYard({
      buildingdata,
      buildinghealthdata: (defender.buildinghealthdata ?? null) as never,
      resources: defender.resources as never,
      kind: one.kind,
      height: defender.height ?? null,
    }),
    { seed: one.log.seed, levels: one.levels, declareWar: false }
  );
  for (const event of logAt(one.log, end).events) {
    battle.runTo(event.t);
    battle.apply(event);
  }
  battle.runTo(end);
  const state = battle.state();
  const yard = toCombatYard({ kind: one.kind, buildingdata, buildinghealthdata: (defender.buildinghealthdata ?? null) as never });
  const percent = damagePercent(yard, state.health, new Set(state.firedTraps));
  const damage = Math.round(percent * 100) / 100;
  return {
    // `attackReportOf` with the end plugin's names (`monsterName`), for a
    // battle the player ended in the attack screen.
    report: attackReport(logAt(one.log, end).events, {
      tick: state.tick,
      left: false,
      damagePercent: percent,
      buildingsDestroyed: state.destroyedIds.length,
      loot: state.loot,
    }),
    tick: state.tick,
    health: { ...state.health },
    damage,
    // The web save names a Map Room 1 tribe `wild` for this (`session.target.kind`).
    destroyed: derivedDestroyed(damage, one.kind === "tribe" ? "wild" : one.kind),
    firedTraps: [...state.firedTraps],
    attackloot: wholeAmounts(state.loot),
    defenderLoss: wholeAmounts(state.defenderLoss),
  };
};

/** The server's battle for the same save (`baseSave.ts`). */
const serverBattle = (one: Fixture, log: FlingLog, tick: unknown) =>
  replayAbandonedAttack(
    battleReplayInput({
      flinglog: log,
      session: sessionOf(one.log),
      defender: defenderOf(one),
      attacker: attackerOf(one),
      tick: battleTick(tick),
      declareWar: false,
      left: false,
    })!
  );

const FULL = ticks(ATTACK_COUNTDOWN_SECONDS + RETREAT_GRACE_SECONDS);

describe("an honest save writes what its client showed (#23, C3)", () => {
  for (const one of fixtures) {
    test(
      `${one.name}: health, damage, destroyed, traps and loot, wherever the client stops`,
      () => {
        const first = one.log.events[0]?.t ?? 0;
        for (const end of [first + 1600, first + 8000, FULL]) {
          const client = honestClient(one, end);
          const log = logAt(one.log, end);
          const server = serverBattle(one, log, client.tick);

          expect(server.buildinghealthdata).toEqual(client.health);
          expect(server.damage).toBe(client.damage);
          expect(server.destroyed).toBe(client.destroyed);
          expect([...server.firedTraps].sort()).toEqual([...client.firedTraps].sort());
          expect(server.attackloot).toEqual(client.attackloot);
          // The report too, word for word (#23, C6).
          expect(server.attackreport).toBe(client.report);
          expect(wholeAmounts(Object.fromEntries(Object.entries(server.defenderDelta).map(([k, v]) => [k, -v])))).toEqual(
            client.defenderLoss
          );

          // Nothing for the save to be flagged over, either.
          const stored = defenderOf(one).buildingdata ?? {};
          const sentBuildings = Object.fromEntries(
            Object.entries(stored).filter(([key, building]) => {
              const id = Math.floor(Number((building as { id?: unknown }).id ?? key));
              return !client.firedTraps.includes(id);
            })
          );
          expect(
            battleMismatches(
              {
                damage: client.damage,
                destroyed: client.destroyed,
                buildinghealthdata: client.health,
                buildingdata: sentBuildings,
                attackloot: client.attackloot,
              },
              server,
              stored
            )
          ).toEqual([]);
        }
      },
      REPLAY_TIMEOUT_MS
    );
  }
});

/**
 * The same fights on a Map Room 1 tribe (issue #23, C4): each fixture's log
 * flung at the Legionnaire camp's top tier, the engine's `"tribe"` kind on
 * both sides, and `destroyed` by the camp threshold the tribe path applies.
 */
describe("an honest Map Room 1 tribe save writes what its client showed (#23, C4)", () => {
  const template = MR1_TRIBES_MAP.get("6")!;
  for (const one of fixtures) {
    const tribe: Fixture = {
      ...one,
      name: `${one.name} on a tribe`,
      yard: template.buildingdata as never,
      kind: "tribe",
      resources: template.resources as Record<string, number>,
    };
    delete tribe.health;
    delete tribe.height;
    test(
      `${tribe.name}: health, damage, destroyed, traps and loot`,
      () => {
        const first = one.log.events[0]?.t ?? 0;
        for (const end of [first + 1600, FULL]) {
          const client = honestClient(tribe, end);
          const server = serverBattle(tribe, logAt(one.log, end), client.tick);

          expect(server.buildinghealthdata).toEqual(client.health);
          expect(server.damage).toBe(client.damage);
          expect(derivedDestroyed(server.damage, "wild")).toBe(client.destroyed);
          expect([...server.firedTraps].sort()).toEqual([...client.firedTraps].sort());
          expect(server.attackloot).toEqual(client.attackloot);
        }
      },
      REPLAY_TIMEOUT_MS
    );
  }
});

describe("battleTick", () => {
  test("is the client's clock, whole and never past the longest end", () => {
    expect(battleTick(2400.7)).toBe(2400);
    expect(battleTick(MAX_CHECKPOINT_TICK + 5000)).toBe(MAX_CHECKPOINT_TICK);
  });

  test("without a usable clock, the longest end", () => {
    expect(battleTick(undefined)).toBe(MAX_CHECKPOINT_TICK);
    expect(battleTick(-3)).toBe(MAX_CHECKPOINT_TICK);
    expect(battleTick("soon")).toBe(MAX_CHECKPOINT_TICK);
  });
});

describe("battleMismatches", () => {
  const one = fixtures.find((fixture) => fixture.name === "pokey-rush")!;
  const end = (one.log.events[0]?.t ?? 0) + 8000;
  const client = honestClient(one, end);
  const server = serverBattle(one, logAt(one.log, end), client.tick);
  const stored = defenderOf(one).buildingdata ?? {};
  const honest = {
    damage: client.damage,
    destroyed: client.destroyed,
    buildinghealthdata: client.health,
    buildingdata: stored,
    attackloot: client.attackloot,
  };

  test(
    "names every field a crafted save changed",
    () => {
      const crafted = {
        ...honest,
        damage: 100,
        destroyed: 1,
        buildinghealthdata: Object.fromEntries(Object.keys(stored).map((key) => [key, 0])),
        buildingdata: {},
        attackloot: { r1: 1e9, r2: 0, r3: 0, r4: 0 },
      };
      const fields = battleMismatches(crafted, server, stored);
      expect(fields).toContain("damage");
      expect(fields).toContain("buildinghealthdata");
      expect(fields).toContain("attackloot");
    },
    REPLAY_TIMEOUT_MS
  );
});

describe("the fightable log drops a bomb the attacker could not afford (#23, C3)", () => {
  const log: FlingLog = {
    v: 1,
    seed: 5,
    events: [
      { kind: "fling", t: 40, x: 0, y: 0, r: 100, monsters: { C1: 3 } },
      { kind: "bomb", t: 80, x: 0, y: 0, id: "tw0" },
    ],
  };
  const one = fixtures.find((fixture) => fixture.name === "pokey-rush")!;
  const input = (attackerResources?: Record<string, number>) =>
    battleReplayInput({
      flinglog: log,
      session: {
        ...sessionOf(log),
        ...(attackerResources && { attackerResources: { r1: 0, r2: 0, r3: 0, r4: 0, ...attackerResources } }),
      },
      defender: defenderOf(one),
      attacker: attackerOf(one),
      tick: 400,
      declareWar: false,
    })!;

  test("priced against the pool the attack began with", () => {
    // tw0 costs 10,000 twigs.
    expect(input({ r1: 9_999 }).log.events.some((event) => event.kind === "bomb")).toBe(false);
    expect(input({ r1: 10_000 }).log.events.some((event) => event.kind === "bomb")).toBe(true);
  });

  test("and not checked when the session has no such pool", () => {
    expect(input().log.events.some((event) => event.kind === "bomb")).toBe(true);
  });
});
