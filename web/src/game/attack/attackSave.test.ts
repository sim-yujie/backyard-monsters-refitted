import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { BaseLoadResponse, ChampionSaveEntry } from "@/api/types";
import { TICKS_PER_SECOND } from "@/game/combat/rules";
import { AttackSession } from "./AttackSession";
import {
  attackReportOf,
  buildAttackSave,
  buildingDataAfter,
  clockOf,
  describeOutcome,
  attackerSiegeAfter,
  monsterUpdateOf,
  reportLine,
  summariseAttack,
} from "./attackSave";
import type { AttackTarget } from "./attackTarget";

/**
 * The save payload, key by key against `docs/design/attack-flow.md` §5.2's
 * table (WP6's unit-test focus), built from a real session: two flings
 * against the sandbox yard, a few seconds of battle, then a retreat.
 */

const SANDBOX = fileURLToPath(new URL("../../../test/fixtures/baseload-sandbox-yard.json", import.meta.url));

/** The 575-building sandbox yard, served as a wild camp under attack. */
const sandboxLoad = (): BaseLoadResponse => {
  const raw = JSON.parse(readFileSync(SANDBOX, "utf8")) as BaseLoadResponse;
  return { ...raw, baseid: "22913802241208", basesaveid: 9001, attackid: 4242, type: "tribe" };
};

/** A lone level 1 Cannon Tower at the origin, for the quick cases. */
const towerLoad = (): BaseLoadResponse =>
  ({
    error: 0,
    id: 1,
    baseid: "3502",
    basesaveid: 1,
    worldsize: [800, 800],
    currenttime: 1_700_000_000,
    buildingdata: {
      "1": { id: 1, t: 20, l: 1, X: 0, Y: 0 },
      "7": { id: 7, t: 24, l: 1, X: 300, Y: 300 },
    },
    buildinghealthdata: {},
    resources: { r1: 1000, r2: 0, r3: 0, r4: 0 },
    monsters: { housed: { C1: 4 }, space: 100 },
    champion: [{ t: 1, hp: 500, l: 1, ft: 0, fd: 0, fb: 0, pl: 0, status: 0 }],
    attackid: 77,
  }) as unknown as BaseLoadResponse;

const OWN_CHAMPION: ChampionSaveEntry = { t: 5, hp: 62_000, l: 5, ft: 0, fd: 0, fb: 0, pl: 2, status: 0 };

const targetOf = (overrides: Partial<AttackTarget> = {}): AttackTarget => ({
  baseid: "22913802241208",
  kind: "wild",
  cell: { col: 241, row: 208 },
  name: "Kozu",
  roster: {
    monsters: { C1: 40, C4: 10 },
    levels: { C1: 3 },
    champions: [OWN_CHAMPION],
    flingerLevel: 4,
    catapultLevel: 0,
    sources: SOURCES,
    siege: SIEGE,
  },
  ...overrides,
});

const play = (session: AttackSession, seconds: number): void => {
  const frames = Math.ceil(seconds * 60);
  for (let frame = 0; frame < frames; frame += 1) session.advance(1 / 60);
};

/** The scripted attack the tests read: two flings, a few seconds, a retreat. */
const scriptedSession = (load: BaseLoadResponse = sandboxLoad()): AttackSession => {
  const session = new AttackSession({ target: targetOf({ load }), seed: 7 });
  session.start();
  play(session, 1);
  session.appendFling({ x: -600, y: 120, monsters: { C1: 30, C4: 5 }, champion: { t: 5, l: 5 } });
  play(session, 2);
  session.appendFling({ x: 200, y: -400, monsters: { C1: 10 } });
  play(session, 3);
  session.retreat();
  return session;
};

const SOURCES = [
  { baseid: "3502", m: { housed: { C1: 25, C4: 10 }, space: 2160, hid: [1, 2] } },
  { baseid: "3503", m: { housed: { C1: 15, C2: 3 }, space: 500 } },
];

const SIEGE = { jars: { quantity: 2, a: 1 }, decoy: { quantity: 1 } };

describe("buildAttackSave", () => {
  it("carries every §5.2 key, shaped from the session, the battle and the log", () => {
    const session = scriptedSession();
    const load = session.attackLoad()!;
    const payload = buildAttackSave(session, { nameOf: (id) => (id === "C1" ? "Pokey" : id) });

    expect(payload.baseid).toBe("22913802241208");
    expect(payload.basesaveid).toBe(9001);
    expect(payload.attackid).toBe(4242);
    expect(payload.over).toBe(true);

    // The enemy yard goes back as loaded; only a fired trap would be absent.
    expect(Object.keys(payload.buildingdata!)).toHaveLength(Object.keys(load.buildingdata!).length);
    expect(payload.buildinghealthdata).toEqual(session.battle()!.state().health);
    for (const health of Object.values(payload.buildinghealthdata!)) {
      expect(Number.isInteger(health)).toBe(true);
    }

    expect(payload.damage).toBe(Math.round(session.state().damagePercent * 100) / 100);
    expect(payload.damage).toBeGreaterThanOrEqual(0);
    expect(payload.destroyed).toBe(0);

    // The defender's housing and champions, unchanged, and our champion's hp.
    expect(payload.monsters).toEqual(load.monsters);
    expect(payload.champion).toEqual(load.champion);
    expect(payload.attackerchampion).toHaveLength(1);
    expect(payload.attackerchampion![0]!.t).toBe(5);
    expect(payload.attackerchampion![0]!.hp).toBe(Math.floor(session.championHpAfter()!));
    expect(payload.attackerchampion![0]!.hp).toBeGreaterThan(0);

    // 40 Pokeys and 5 Finks spent, first cell first.
    expect(payload.monsterupdate).toEqual([
      { baseid: "3502", m: { housed: { C1: 0, C4: 5 }, space: 2160, hid: [1, 2] } },
      { baseid: "3503", m: { housed: { C1: 0, C2: 3 }, space: 500 } },
    ]);

    // Loot as whole units; the defender's delta negative, or zero.
    const battleState = session.battle()!.state();
    for (const key of ["r1", "r2", "r3", "r4"] as const) {
      expect(payload.attackloot![key]).toBe(Math.floor(battleState.loot[key]));
      expect(payload.resources![key]).toBe(-Math.floor(battleState.defenderLoss[key]));
      expect(payload.resources![key]).toBeLessThanOrEqual(0);
    }

    expect(payload.flinglog).toEqual(session.flingLog());
    expect(typeof payload.attackreport).toBe("string");
    // No siege weapon was used, so the inventory goes back as loaded.
    expect(payload.attackersiege).toEqual(SIEGE);
  });

  it("sends the log's three events as three report lines plus the result", () => {
    const session = scriptedSession();
    const payload = buildAttackSave(session, { nameOf: (id) => ({ C1: "Pokey", C4: "Fink" })[id] ?? id });
    const lines = payload.attackreport!.split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe("0:01 Flung 30 Pokey, 5 Fink, the champion (G5) at (-600, 120)");
    expect(lines[1]).toBe("0:03 Flung 10 Pokey at (200, -400)");
    expect(lines[2]).toBe("0:06 Retreated");
    expect(lines[3]).toMatch(/^Result: \d+% damage, \d+ buildings destroyed, looted \d+ twigs/);
  });

  it("round-trips the fling log through JSON as the §3.10 shape", () => {
    const session = scriptedSession();
    const payload = buildAttackSave(session);
    const wire = JSON.parse(JSON.stringify(payload.flinglog)) as { v: number; seed: number; events: unknown[] };
    expect(wire).toEqual(session.flingLog());
    expect(wire.v).toBe(1);
    expect(wire.seed).toBe(7);
    expect(wire.events).toHaveLength(3);
    expect(wire.events[0]).toMatchObject({
      kind: "fling",
      t: TICKS_PER_SECOND,
      x: -600,
      y: 120,
      monsters: { C1: 30, C4: 5 },
      champion: { t: 5, l: 5 },
    });
    expect(wire.events[2]).toEqual({ kind: "retreat", t: 6 * TICKS_PER_SECOND });
  });

  it("still builds a closing save when nothing was flung", () => {
    const session = new AttackSession({ target: targetOf({ load: towerLoad() }), seed: 1 });
    session.start();
    play(session, 0.5);
    session.retreat();
    const payload = buildAttackSave(session);
    expect(payload.over).toBe(true);
    expect(payload.attackid).toBe(77);
    expect(payload.damage).toBe(0);
    expect(payload.destroyed).toBe(0);
    expect(payload.buildinghealthdata).toEqual({});
    expect(payload.attackloot).toEqual({ r1: 0, r2: 0, r3: 0, r4: 0 });
    expect(payload.resources).toEqual({ r1: -0, r2: -0, r3: -0, r4: -0 });
    expect(payload.monsterupdate).toEqual([
      { baseid: "3502", m: SOURCES[0]!.m },
      { baseid: "3503", m: SOURCES[1]!.m },
    ]);
    expect(payload.attackerchampion).toEqual([OWN_CHAMPION]);
    expect(payload.attackreport).toBe(
      "0:00 Retreated\nResult: 0% damage, 0 buildings destroyed, looted 0 twigs, 0 pebbles, 0 putty, 0 goo.",
    );
  });

  it("omits destroyed for a main yard, and the champion, siege and source keys when there are none", () => {
    const session = new AttackSession({
      target: targetOf({
        kind: "main",
        load: { ...towerLoad(), champion: null, monsters: null },
        roster: { monsters: { C1: 3 }, levels: {}, champions: [], flingerLevel: 4, catapultLevel: 0 },
      }),
      seed: 1,
    });
    session.start();
    session.retreat();
    const payload = buildAttackSave(session);
    expect(payload.destroyed).toBeUndefined();
    expect(payload.champion).toBeUndefined();
    expect(payload.attackerchampion).toBeUndefined();
    expect(payload.attackersiege).toBeUndefined();
    expect(payload.monsters).toBeUndefined();
    expect(payload.monsterupdate).toEqual([]);
  });

  it("spends one siege weapon per siege event in attackersiege", () => {
    const session = new AttackSession({ target: targetOf({ load: towerLoad() }), seed: 1 });
    session.start();
    session.appendSiege({ x: 0, y: 0, weapon: "jars" });
    session.appendSiege({ x: 0, y: 0, weapon: "vacuum" });
    session.retreat();
    expect(buildAttackSave(session).attackersiege).toEqual({ jars: { quantity: 1, a: 1 }, decoy: { quantity: 1 } });
    expect(attackerSiegeAfter(null, [])).toBeUndefined();
    expect(
      attackerSiegeAfter({ jars: { quantity: 0 } }, [{ kind: "siege", t: 0, x: 0, y: 0, weapon: "jars" }]),
    ).toEqual({ jars: { quantity: 0 } });
  });

  it("keeps the champion's health when it walked home or was retreated, and zeroes it on a death", () => {
    // Sixty Pokeys and the champion flatten the lone tower; the champion then
    // walks home with the health it had, which the engine reports as 0.
    const walkedHome = new AttackSession({
      target: targetOf({
        load: towerLoad(),
        roster: { monsters: { C1: 60 }, levels: {}, champions: [OWN_CHAMPION], flingerLevel: 4, catapultLevel: 0 },
      }),
      seed: 1,
    });
    walkedHome.start();
    walkedHome.appendFling({ x: -100, y: -100, monsters: { C1: 60 }, champion: { t: 5, l: 5 } });
    play(walkedHome, 120);
    expect(walkedHome.state().phase).toBe("ended");
    expect(walkedHome.state().creepsAlive).toBe(0);
    const kept = buildAttackSave(walkedHome).attackerchampion![0]!.hp;
    expect(kept).toBeGreaterThan(0);
    expect(kept).toBeLessThanOrEqual(OWN_CHAMPION.hp);

    // A retreat mid-battle likewise keeps what the champion had.
    const retreated = scriptedSession();
    expect(retreated.championHpAfter()).toBeGreaterThan(0);

    // The champion alone against a ring of Sniper Towers dies, and the save says so.
    const ring: Record<string, unknown> = {};
    for (let i = 0; i < 24; i += 1) {
      const angle = (i / 24) * Math.PI * 2;
      ring[String(i + 1)] = { id: i + 1, t: 21, l: 5, X: Math.round(Math.cos(angle) * 400), Y: Math.round(Math.sin(angle) * 400) };
    }
    const died = new AttackSession({
      target: targetOf({
        load: { ...towerLoad(), buildingdata: ring } as BaseLoadResponse,
        roster: { monsters: {}, levels: {}, champions: [OWN_CHAMPION], flingerLevel: 4, catapultLevel: 0 },
      }),
      seed: 1,
    });
    died.start();
    died.appendFling({ x: 0, y: 0, monsters: {}, champion: { t: 5, l: 5 } });
    play(died, 100);
    expect(died.state().creepsKilled).toBe(1);
    expect(died.state().endReason).toBe("exhausted");
    expect(died.championHpAfter()).toBe(0);
    expect(buildAttackSave(died).attackerchampion![0]!.hp).toBe(0);
    expect(buildAttackSave(died).attackerchampion![1]).toBeUndefined();
  });

  it("refuses a session that was never loaded", () => {
    const session = new AttackSession({ target: targetOf(), seed: 1 });
    expect(() => buildAttackSave(session)).toThrow(/never loaded/);
  });
});

describe("the pieces", () => {
  it("drops fired traps from buildingdata and nothing else", () => {
    const data = towerLoad().buildingdata!;
    expect(Object.keys(buildingDataAfter(data, [7]))).toEqual(["1"]);
    expect(Object.keys(buildingDataAfter(data, []))).toEqual(["1", "7"]);
    expect(buildingDataAfter(null, [7])).toEqual({});
  });

  it("spends flung monsters across source cells in order and keeps the rest of the blob", () => {
    const update = monsterUpdateOf(SOURCES, { C1: 30 });
    expect(update).toEqual([
      { baseid: "3502", m: { housed: { C1: 0, C4: 10 }, space: 2160, hid: [1, 2] } },
      { baseid: "3503", m: { housed: { C1: 10, C2: 3 }, space: 500 } },
    ]);
    // The inputs are not touched.
    expect(SOURCES[0]!.m.housed).toEqual({ C1: 25, C4: 10 });
  });

  it("lists a source cell with no housed map untouched", () => {
    expect(monsterUpdateOf([{ baseid: "9", m: { space: 1 } }], { C1: 5 })).toEqual([
      { baseid: "9", m: { space: 1, housed: {} } },
    ]);
  });

  it("spells one line per event kind", () => {
    const names = (id: string) => (id === "C1" ? "Pokey" : id);
    expect(reportLine({ kind: "bomb", t: 2400, x: 180.4, y: -480, id: "pb1" }, names)).toBe(
      "0:30 Fired a pebble bomb (tier 2) at (180, -480)",
    );
    expect(reportLine({ kind: "siege", t: 3100, x: 180, y: -480, weapon: "jars" }, names)).toBe(
      "0:38 Deployed jars at (180, -480)",
    );
    expect(reportLine({ kind: "fling", t: 0, x: 0, y: 0, r: 100, monsters: { C1: 1, C2: 0 } }, names)).toBe(
      "0:00 Flung 1 Pokey at (0, 0)",
    );
    expect(clockOf(80 * 61)).toBe("1:01");
  });

  it("builds a report from an empty log as the result line alone", () => {
    const session = new AttackSession({ target: targetOf({ load: towerLoad() }), seed: 1 });
    expect(attackReportOf({ v: 1, seed: 1, events: [] }, session.state())).toMatch(/^Result: 0% damage/);
  });

  it("calls a camp won at the takeover threshold and a main yard by its damage", () => {
    expect(describeOutcome("wild", "Kozu", 90)).toEqual({ outcome: "Victory! Kozu's camp is destroyed.", tone: "win" });
    expect(describeOutcome("outpost", "Ann", 89.9).tone).toBe("lose");
    expect(describeOutcome("outpost", "Ann", 89.9).outcome).toMatch(/still stands at 89% damage/);
    expect(describeOutcome("main", "Bob", 50).tone).toBe("win");
    expect(describeOutcome("main", "Bob", 12.5)).toEqual({ outcome: "12% damage dealt to Bob's yard.", tone: "neutral" });
  });

  it("summarises the ended session for the panel", () => {
    const session = scriptedSession();
    const summary = summariseAttack(session);
    const state = session.state();
    expect(summary).toMatchObject({
      targetName: "Kozu",
      kind: "wild",
      endReason: "retreat",
      tone: "lose",
      damagePercent: state.damagePercent,
      buildingsDestroyed: state.buildingsDestroyed,
      buildingsTotal: 575,
      monstersSent: state.creepsFlung,
      monstersLost: state.creepsKilled,
      elapsedSeconds: 6,
    });
    expect(summary.loot).toEqual(state.loot);
    expect(summary.championHp).not.toBeNull();
  });
});
