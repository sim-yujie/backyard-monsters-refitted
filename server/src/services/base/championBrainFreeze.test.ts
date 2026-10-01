import { describe, expect, test } from "bun:test";
import type { FlingLog } from "../../game-rules/combat/index.js";
import type { ChampionData } from "../../schemas/ChampionSchema.js";
import { YardChampionStanceSchema } from "../../schemas/YardSchemas.js";
import { planChampionEvolve, planChampionStance, type ChampionSave } from "../yard/champion.js";
import { checkpointSession, newCheckpoint, parseFlingLog, parseStoredCheckpoint, serialiseCheckpoint } from "./attackCheckpoint.js";
import { brainsOf, newAttackSession, parseAttackSession, serialiseAttackSession } from "./attackSession.js";
import { fightableLog, withFrozenBrains } from "./combat/attackLoot.js";
import { battleReplayInput } from "./combat/battle.js";

/**
 * A champion's brain is frozen into its attack at launch (issue #219): the
 * session keeps it, each checkpoint keeps a copy, and every replay fights the
 * log's champions with that copy and never with what the log or the live
 * save says. And no yard route takes a brain from the client.
 */

const BRAIN = { tower: 40, loot: -80, finish: 0, focus: 120, threat: 10 };
const ZERO = { tower: 0, loot: 0, finish: 0, focus: 0, threat: 0 };
const FORGED = { tower: 200, loot: 200, finish: 200, focus: 200, threat: 200 };
const HOME = "1000239208";

const champion = (t: number, extra: Partial<ChampionData> = {}): ChampionData => ({
  t,
  hp: 10_000,
  l: 4,
  ft: 0,
  fd: 0,
  fb: 0,
  pl: 0,
  status: 0,
  ...extra,
});

const log = (b?: unknown): FlingLog =>
  ({
    v: 1,
    seed: 7,
    events: [
      { kind: "fling", t: 100, x: 0, y: 0, r: 300, monsters: { C1: 5 }, champion: { t: 1, l: 4, ...(b !== undefined && { b }) } },
    ],
  }) as FlingLog;

describe("brainsOf", () => {
  test("freezes each champion's brain that has learned anything, made safe, by type", () => {
    expect(
      brainsOf([
        champion(1, { b: BRAIN }),
        champion(2, { b: ZERO }),
        champion(3),
        champion(5, { b: { tower: 1e9, loot: Number.NaN } as never }),
        { t: 9, b: BRAIN },
        null,
      ])
    ).toEqual({ "1": BRAIN, "5": { ...ZERO, tower: 200 } });
    expect(brainsOf([champion(1)])).toBeUndefined();
    expect(brainsOf(null)).toBeUndefined();
  });
});

describe("the frozen brains ride the session and the checkpoint", () => {
  const session = newAttackSession(2, 4242, { [HOME]: { C1: 5 } }, undefined, 30, undefined, undefined, { "1": BRAIN });

  test("a session keeps them through Redis", () => {
    expect(parseAttackSession(serialiseAttackSession(session))?.championBrains).toEqual({ "1": BRAIN });
    // A tampered key is made safe like any other brain.
    const raw = JSON.parse(serialiseAttackSession(session));
    raw.championBrains = { "1": FORGED, "2": "junk", "x": BRAIN };
    expect(parseAttackSession(JSON.stringify(raw))?.championBrains).toEqual({ "1": FORGED });
  });

  test("a session minted before brains has none", () => {
    expect(parseAttackSession(serialiseAttackSession(newAttackSession(2, 4242)))?.championBrains).toBeUndefined();
  });

  test("a checkpoint keeps its own copy for the finaliser", () => {
    const checkpoint = newCheckpoint(session, 9, { tick: 200, flinglog: log(), sources: [HOME] }, 1);
    const stored = parseStoredCheckpoint(serialiseCheckpoint(checkpoint))!;
    expect(checkpointSession(stored).championBrains).toEqual({ "1": BRAIN });
  });
});

describe("the log a client sends", () => {
  test("may carry a brain, which parses", () => {
    expect(parseFlingLog(log(BRAIN))).not.toBeNull();
    expect(parseFlingLog(log({ tower: "lots" }))).toBeNull();
    expect(parseFlingLog(log([1, 2]))).toBeNull();
  });

  test("never fights with its own: the session's frozen copy replaces it, or none", () => {
    const attacker = { champion: [champion(1, { b: { ...ZERO, loot: -200 } })] };
    const housed = { [HOME]: { C1: 5 } };
    const fought = (brains: Record<string, typeof BRAIN> | undefined, sent?: unknown) => {
      const event = fightableLog(log(sent), { ...attacker, brains }, housed).events[0]!;
      return event.kind === "fling" ? event.champion : undefined;
    };
    expect(fought({ "1": BRAIN }, FORGED)).toEqual({ t: 1, l: 4, b: BRAIN });
    expect(fought({ "1": BRAIN })).toEqual({ t: 1, l: 4, b: BRAIN });
    // No frozen brain: none at all, however the log or the live save reads.
    expect(fought(undefined, FORGED)).toEqual({ t: 1, l: 4 });
    expect(fought({ "2": BRAIN }, FORGED)).toEqual({ t: 1, l: 4 });
  });

  test("a replay that does not cut the log down is stamped all the same", () => {
    expect(withFrozenBrains(log(FORGED), { "1": BRAIN }).events[0]).toMatchObject({ champion: { b: BRAIN } });
    expect(withFrozenBrains(log(FORGED), undefined).events[0]).not.toHaveProperty("champion.b");
    const input = battleReplayInput({
      flinglog: log(FORGED),
      session: { attackerid: 2, attackid: 1, startedat: 0, championBrains: { "1": BRAIN } },
      defender: { type: "tribe", buildingdata: {}, buildinghealthdata: {}, resources: {} },
      attacker: { champion: [champion(1)] },
      tick: 200,
      declareWar: false,
    })!;
    expect(input.log.events[0]).toMatchObject({ champion: { b: BRAIN } });
  });
});

describe("the yard routes keep the brain and never take one", () => {
  const CAGE = { "3": { id: 3, t: 114, x: 0, y: 0, l: 1 } };
  const yard = (champions: ChampionData[]): ChampionSave => ({
    buildingdata: { ...CAGE },
    buildinghealthdata: {},
    monsters: { housed: {} },
    champion: champions,
    resources: { r1: 0, r2: 0, r3: 0, r4: 0 },
  });

  test("the Mode route's body has no brain in it, and keeps the stored one", () => {
    const body = YardChampionStanceSchema.parse({ type: 1, stance: "offensive", b: FORGED, bs: { n: 99 } });
    expect(body).toEqual({ type: 1, stance: "offensive" });
    const outcome = planChampionStance(yard([champion(1, { b: BRAIN, bs: { n: 3 } })]), body.type, body.stance);
    expect(outcome.slices.champion[0]).toMatchObject({ s: "offensive", b: BRAIN, bs: { n: 3 } });
  });

  test("the brain persists through a level-up", () => {
    const outcome = planChampionEvolve(yard([champion(1, { l: 2, hp: 60_000, b: BRAIN, bs: { n: 7, off: 0.4 } })]), 1_800_000_000);
    expect(outcome.slices.champion[0]).toMatchObject({ l: 3, b: BRAIN, bs: { n: 7, off: 0.4 } });
  });
});
