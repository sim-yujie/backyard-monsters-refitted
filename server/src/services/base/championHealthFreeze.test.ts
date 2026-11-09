import { describe, expect, test } from "bun:test";
import { buildEngineYard, createBattle, type FlingLog } from "../../game-rules/combat/index.js";
import { championStatWithFood } from "../../game-rules/combat/stats.js";
import type { ChampionData } from "../../schemas/ChampionSchema.js";
import { checkpointSession, newCheckpoint, parseFlingLog, parseStoredCheckpoint, serialiseCheckpoint } from "./attackCheckpoint.js";
import { healthOf, newAttackSession, parseAttackSession, serialiseAttackSession } from "./attackSession.js";
import { fightableLog, withFrozenChampions } from "./combat/attackLoot.js";
import { replayAbandonedAttack } from "./combat/abandonedAttack.js";
import { championsAfterAttack, championsAfterBattle } from "./combat/attackerRow.js";
import { battleReplayInput } from "./combat/battle.js";

/**
 * A champion keeps the health it has between attacks: Flash sent it out at
 * its stored `hp` (`ATTACK.as:532`, `CREEPS.SpawnGuardian(..., hp, fb, pl)`),
 * so one hurt in one attack is still hurt in the next. The attack load
 * freezes each champion's health into the session, every replay sends the
 * log's champions out at that and never at what the log says, and the engine
 * spawns a champion at the health it is handed.
 */

const HOME = "1000239208";
const FULL = championStatWithFood("G1", "health", 4, 0);

const champion = (t: number, extra: Partial<ChampionData> = {}): ChampionData => ({
  t,
  hp: FULL,
  l: 4,
  ft: 0,
  fd: 0,
  fb: 0,
  pl: 0,
  status: 0,
  ...extra,
});

const log = (hp?: unknown): FlingLog =>
  ({
    v: 1,
    seed: 7,
    events: [
      { kind: "fling", t: 100, x: 0, y: 0, r: 300, monsters: { C1: 5 }, champion: { t: 1, l: 4, ...(hp !== undefined && { hp }) } },
    ],
  }) as FlingLog;

const session = (championHealth?: Record<string, number>) =>
  newAttackSession(2, 4242, { [HOME]: { C1: 5 } }, undefined, 30, undefined, undefined, undefined, undefined, undefined, undefined, championHealth);

describe("healthOf", () => {
  test("freezes each champion's whole health, never below 0, by type", () => {
    expect(
      healthOf([
        champion(1, { hp: 1234.7 }),
        champion(3, { hp: 0 }),
        champion(5, { hp: -50 }),
        { t: 2, hp: "junk" },
        { t: 9, hp: 100 },
        null,
      ])
    ).toEqual({ "1": 1234, "2": 0, "3": 0, "5": 0 });
    expect(healthOf([])).toBeUndefined();
    expect(healthOf(null)).toBeUndefined();
  });
});

describe("the frozen health rides the session and the checkpoint", () => {
  test("a session keeps it through Redis, made safe", () => {
    expect(parseAttackSession(serialiseAttackSession(session({ "1": 500 })))?.championHealth).toEqual({ "1": 500 });
    const raw = JSON.parse(serialiseAttackSession(session({ "1": 500 })));
    raw.championHealth = { "1": 99.9, "2": "lots", "3": -4, "x": 1 };
    expect(parseAttackSession(JSON.stringify(raw))?.championHealth).toEqual({ "1": 99, "2": 0, "3": 0 });
  });

  test("a session minted before it has none", () => {
    expect(parseAttackSession(serialiseAttackSession(newAttackSession(2, 4242)))?.championHealth).toBeUndefined();
  });

  test("a checkpoint keeps its own copy for the finaliser", () => {
    const checkpoint = newCheckpoint(session({ "1": 500 }), 9, { tick: 200, flinglog: log(), sources: [HOME] }, 1);
    const stored = parseStoredCheckpoint(serialiseCheckpoint(checkpoint))!;
    expect(checkpointSession(stored).championHealth).toEqual({ "1": 500 });
  });
});

describe("the log a client sends", () => {
  test("may carry a champion's health, which parses", () => {
    expect(parseFlingLog(log(500))).not.toBeNull();
    expect(parseFlingLog(log("full"))).toBeNull();
  });

  const housed = { [HOME]: { C1: 5 } };
  const fought = (health: Record<string, number> | undefined, sent?: number) => {
    const event = fightableLog(log(sent), { champion: [champion(1, { hp: 500 })], health }, housed).events[0]!;
    return event.kind === "fling" ? event.champion : undefined;
  };

  test("is sent out at the frozen health, never at the log's", () => {
    expect(fought({ "1": 500 }, FULL)).toEqual({ t: 1, l: 4, hp: 500 });
    expect(fought({ "1": 500 })).toEqual({ t: 1, l: 4, hp: 500 });
  });

  test("a champion with no health left at launch stays home", () => {
    expect(fought({ "1": 0 }, FULL)).toBeUndefined();
    expect(fought({ "2": 500 }, FULL)).toBeUndefined();
  });

  test("a session minted before it sends the champion out at full health, as its client did", () => {
    expect(fought(undefined, 500)).toEqual({ t: 1, l: 4 });
  });

  test("a replay that does not cut the log down is stamped all the same", () => {
    expect(withFrozenChampions(log(FULL), undefined, { "1": 500 }).events[0]).toMatchObject({ champion: { hp: 500 } });
    expect(withFrozenChampions(log(FULL), undefined, undefined).events[0]).not.toHaveProperty("champion.hp");
    const input = battleReplayInput({
      flinglog: log(FULL),
      session: { ...session({ "1": 500 }) },
      defender: { type: "tribe", buildingdata: {}, buildinghealthdata: {}, resources: {} },
      attacker: { champion: [champion(1, { hp: 500 })] },
      tick: 200,
      declareWar: false,
    })!;
    expect(input.log.events[0]).toMatchObject({ champion: { hp: 500 } });
  });
});

describe("the engine sends a champion out at the health it is handed", () => {
  const battleWith = (hp?: number) => {
    const yard = buildEngineYard({
      buildingdata: { "1": { id: 1, t: 14, l: 1, X: 820, Y: 820 } },
      buildinghealthdata: {},
      resources: { r1: 0, r2: 0, r3: 0, r4: 0 },
    });
    const battle = createBattle(yard, { seed: 5 });
    battle.apply({
      kind: "fling",
      t: 0,
      x: 0,
      y: 0,
      r: 0,
      monsters: {},
      champion: { t: 1, l: 4, ...(hp !== undefined && { hp }) },
    });
    return battle.state().championsHp["G1"];
  };

  test("hurt, at its health; none or more than full, at full", () => {
    expect(battleWith(500)).toBe(500);
    expect(battleWith()).toBe(FULL);
    expect(battleWith(FULL * 3)).toBe(FULL);
  });

  test("so a hurt champion comes home no healthier than it went out", () => {
    // Attack one left it at 500; attack two sends it out at 500, and the save
    // after can only keep or lower that.
    const after = battleWith(500)!;
    expect(after).toBeLessThanOrEqual(500);
    expect(championsAfterAttack([champion(1, { hp: 500 })], [{ ...champion(1), hp: after }], log())).toEqual([
      champion(1, { hp: after }),
    ]);
  });
});

/**
 * Vorgs heal a champion in battle, and it comes home at that health, as Flash
 * kept it (`ChampionBase.as:1200/1310` export `hp` every tick, `BASE.as:3270`
 * sends it, `ATTACK.as:532` spawns from it). Where the server replayed the
 * battle, its figure is the one stored, whichever path lands the attack: the
 * save that ends it, or the finaliser from its checkpoint
 * (`finaliseAttack.ts`, which writes `attackerchampion` as is).
 */
describe("a champion comes home at the server's battle's health (Vorg and Zafreeti heals)", () => {
  const FOMOR_FULL = championStatWithFood("G3", "health", 4, 0);
  const LOW = Math.floor(FOMOR_FULL * 0.05);
  const fomor = (hp: number, extra: Partial<ChampionData> = {}): ChampionData => champion(3, { hp, ...extra });
  /** A camp with a Sniper Tower that reaches the fling point. */
  const CAMP = { "0": { id: 0, t: 14, l: 1, X: 0, Y: 0 }, "1": { id: 1, t: 21, l: 3, X: 300, Y: 300 } };
  const vorgLog = (monsters: Record<string, number>) =>
    ({
      v: 1,
      seed: 5,
      events: [{ kind: "fling", t: 80, x: 400, y: 400, r: 200, monsters, champion: { t: 3, l: 4 } }],
    }) as FlingLog;

  /** The server's replay, as both the save and the finaliser run it. */
  const fight = (
    monsters: Record<string, number>,
    housed: Record<string, number>,
    hp: number,
    championHealth: Record<string, number> | undefined = { "3": hp }
  ) => {
    const input = battleReplayInput({
      flinglog: vorgLog(monsters),
      session: { ...newAttackSession(2, 4242, { [HOME]: housed }), ...(championHealth && { championHealth }) },
      defender: { type: "tribe", buildingdata: CAMP, buildinghealthdata: {}, resources: { r1: 5000, r2: 0, r3: 0, r4: 0 } },
      attacker: { academy: {}, champion: [fomor(hp)] },
      tick: 24_000,
      declareWar: false,
    })!;
    return replayAbandonedAttack(input);
  };
  const replayHp = (outcome: ReturnType<typeof fight>) => outcome.attackerchampion![0]!.hp;

  test("a hurt Fomor with housed Vorgs comes home healed, at the replay's figure", () => {
    const outcome = fight({ C16: 6 }, { C16: 6 }, LOW);
    const healed = replayHp(outcome);
    expect(healed).toBeGreaterThan(LOW);
    expect(healed).toBeLessThanOrEqual(FOMOR_FULL);

    // The save that ends the attack: the client reports what it saw, the
    // only-downwards rule keeps the stored health, then the replay's lands.
    const reported = [fomor(healed)];
    const afterSave = championsAfterBattle(
      championsAfterAttack([fomor(LOW)], reported, vorgLog({ C16: 6 })),
      outcome,
      { "3": LOW }
    );
    expect(afterSave).toEqual([fomor(healed)]);

    // The finaliser from the checkpoint writes the same battle's figure.
    expect(outcome.attackerchampion).toEqual([fomor(healed)]);
  });

  // Every healer the game has: the two monsters with negative damage, C15
  // Zafreeti and C16 Vorg (`Zafreeti.as`, `Vorg.as`, both through
  // `FIREBALL.as:150-159`, a tenth on a champion). Flash's `Vorgv2` and
  // `Zafreetiv2` (and its powered-up heal on death) sit behind
  // `k_USE_REBALANCED_MONSTERS = false` (`CREATURELOCKER.as:30`) and never ran.
  test.each([
    ["Zafreeti", { C15: 2 }],
    ["Vorg", { C16: 6 }],
    ["both", { C15: 2, C16: 6 }],
  ])("%s: the healed health comes home, whichever path lands it", (_name, healers) => {
    const outcome = fight(healers, healers, LOW);
    const healed = replayHp(outcome);
    expect(healed).toBeGreaterThan(LOW);
    expect(healed).toBeLessThanOrEqual(FOMOR_FULL);
    expect(championsAfterBattle([fomor(LOW)], outcome, { "3": LOW })).toEqual(outcome.attackerchampion!);
  });

  test("a forged save reporting full health stores the replay's figure", () => {
    const outcome = fight({ C16: 6 }, { C16: 6 }, LOW);
    const after = championsAfterBattle(
      championsAfterAttack([fomor(LOW)], [fomor(FOMOR_FULL)], vorgLog({ C16: 6 })),
      outcome,
      { "3": LOW }
    );
    expect(after[0]!.hp).toBe(replayHp(outcome));
    expect(after[0]!.hp).toBeLessThan(FOMOR_FULL);
  });

  test("a forged log with Vorgs the attacker never housed is cut: no heal", () => {
    const outcome = fight({ C16: 6 }, { C4: 12 }, LOW);
    const after = championsAfterBattle([fomor(LOW)], outcome, { "3": LOW });
    expect(after[0]!.hp).toBeLessThanOrEqual(LOW);
    expect(after[0]!.hp).toBe(replayHp(outcome));
  });

  test("a champion with no Vorg that takes damage keeps it", () => {
    const outcome = fight({}, {}, FOMOR_FULL);
    const hurt = replayHp(outcome);
    expect(hurt).toBeLessThan(FOMOR_FULL);
    // Even when the save claims it came home untouched.
    const after = championsAfterBattle(
      championsAfterAttack([fomor(FOMOR_FULL)], [fomor(FOMOR_FULL)], vorgLog({})),
      outcome,
      { "3": FOMOR_FULL }
    );
    expect(after).toEqual([fomor(hurt)]);
  });

  test("with no replay (Map Room 3) the save's figure lands only downwards, as before", () => {
    const log = vorgLog({ C16: 6 });
    expect(championsAfterAttack([fomor(LOW)], [fomor(FOMOR_FULL)], log)).toEqual([fomor(LOW)]);
    expect(championsAfterAttack([fomor(LOW)], [fomor(100)], log)).toEqual([fomor(100)]);
  });

  test("never above full health for its stored level and food bonus, never below 0", () => {
    const battle = (hp: number) => ({ attackerchampion: [fomor(hp)], championsFlung: [3] });
    expect(championsAfterBattle([fomor(LOW)], battle(FOMOR_FULL * 5), { "3": LOW })).toEqual([fomor(FOMOR_FULL)]);
    expect(championsAfterBattle([fomor(LOW)], battle(-40), { "3": LOW })).toEqual([fomor(0)]);
    expect(championsAfterBattle([fomor(LOW)], battle(1234.9), { "3": LOW })).toEqual([fomor(1234)]);
  });

  test("a champion the battle never flung, one not out of the cage, or one with no frozen health keeps its own", () => {
    const outcome = { attackerchampion: [fomor(9_000)], championsFlung: [3] };
    expect(championsAfterBattle([fomor(LOW)], { ...outcome, championsFlung: [] }, { "3": LOW })).toEqual([fomor(LOW)]);
    expect(championsAfterBattle([fomor(LOW, { status: 1 })], outcome, { "3": LOW })).toEqual([fomor(LOW, { status: 1 })]);
    // A session minted before the freeze fought it at full health: the figure says nothing.
    expect(championsAfterBattle([fomor(LOW)], outcome, undefined)).toEqual([fomor(LOW)]);
    expect(championsAfterBattle([fomor(LOW)], outcome, { "1": LOW })).toEqual([fomor(LOW)]);
    // Other champions are untouched; no champion is added.
    expect(championsAfterBattle([champion(1, { hp: 500 }), fomor(LOW)], outcome, { "1": 500, "3": LOW })).toEqual([
      champion(1, { hp: 500 }),
      fomor(9_000),
    ]);
    expect(championsAfterBattle([], outcome, { "3": LOW })).toEqual([]);
  });
});
