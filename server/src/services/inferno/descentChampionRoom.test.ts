import { describe, expect, test } from "bun:test";

import {
  bucketCost,
  championByType,
  championStat,
  defenderForcesOf,
  type FlingEvent,
  type FlingLog,
} from "../../game-rules/combat/index.js";
import { replayAbandonedAttack, type AbandonedInput } from "../base/combat/abandonedAttack.js";
import { battleMismatches } from "../base/combat/battle.js";
import { DESCENT_FLINGER_CAPACITY, descentFightableLog, descentYardOf } from "./descent.js";

/**
 * Why a Descent attack with a champion did not tally (Max, 12 Nov 2026;
 * Bluetenit, 10 Nov 2026): the screen fought one army and the server another.
 *
 * Up to v2.0.0-beta.6.15 (live `main`) the attack panel filled the whole
 * Flinger with monsters and put the picked champion on top. The server cuts
 * every Descent fling to the Flinger with the champion going in first
 * (`descentFightableLog`, as Flash's `ATTACK.BucketAdd`), so the fling that
 * carried the champion lost a champion's worth of monsters (Gorgo: 240 bucket
 * units) on the server only. Its battle then differed from the screen's, the
 * save was refused as a replay mismatch (`COMBAT_SAVE_VALIDATION=reject`, the
 * default), the player's screen said nothing was saved, and the finaliser
 * later landed the attack from its last checkpoint with the smaller army.
 *
 * The web client on `revamp` reserves the champion's room in the bucket
 * (`web/src/game/attack/bucket.ts` `reserved`, commit bbca2fcf7), so its fling
 * is never cut: the second half of this file shows such a fling is fought the
 * same on both sides.
 *
 * The yard is Descent yard 2 (base 202), one of the yards Max named; the cut
 * does not depend on the yard, only on a champion riding a full fling.
 */

const YARD_INDEX = 1;
/** The Flinger at level 4, the payload a Descent attack gets there. */
const CAPACITY = DESCENT_FLINGER_CAPACITY[3]!;
const GORGO = { t: 1, l: 3 };
const GORGO_ROOM = championStat(championByType(GORGO.t)!, "bucket", GORGO.l);
/** Long enough for the fight to run out on its own. */
const END_TICK = 20_000;
const SEED = 4242;

/** A full fling of 2,500 units, as the panel's Fill gives it. */
const FULL = { C2: 70, C3: 40, C5: 20 } as const;

const fling = (t: number, x: number, y: number, monsters: Record<string, number>, champion?: typeof GORGO): FlingEvent =>
  ({ kind: "fling", t, x, y, r: 60, monsters: { ...monsters }, ...(champion && { champion: { ...champion } }) }) as FlingEvent;

const replay = (log: FlingLog) => {
  const yard = descentYardOf(YARD_INDEX);
  const defence = defenderForcesOf({
    buildingdata: yard.buildingdata,
    academy: yard.academy,
    champion: yard.champion,
    monsters: yard.monsters,
    buildinghealthdata: {},
  });
  const input: AbandonedInput = {
    defender: {
      type: "iwm",
      kind: "inferno",
      buildingdata: yard.buildingdata as AbandonedInput["defender"]["buildingdata"],
      buildinghealthdata: {},
      resources: yard.resources as AbandonedInput["defender"]["resources"],
    },
    attacker: { academy: null, champion: [{ ...GORGO }] as never, siege: null },
    log,
    tick: END_TICK,
    declareWar: false,
    left: false,
    defence,
    descentYard: YARD_INDEX + 1,
  };
  return replayAbandonedAttack(input);
};

/** The save's numbers as the client's own battle gives them (`attackSave.ts` `buildAttackSave`). */
const saveOf = (outcome: ReturnType<typeof replay>) => ({
  damage: outcome.damage,
  destroyed: undefined,
  buildinghealthdata: outcome.buildinghealthdata,
  buildingdata: descentYardOf(YARD_INDEX).buildingdata,
  attackloot: outcome.attackloot,
  attackerchampion: outcome.attackerchampion,
});

const TIMEOUT_MS = 60_000;

describe("a Descent fling with a champion on a full Flinger (Max, Descent 2/4/6)", () => {
  test("the full army costs exactly the Flinger's payload", () => {
    expect(bucketCost({ ...FULL }, undefined)).toBe(CAPACITY);
    expect(GORGO_ROOM).toBe(240);
  });

  test(
    "as live main's panel sent it: the server cuts the champion's room and fights a smaller army, so the save is refused",
    () => {
      // One full fling with Gorgo on top (the old panel: 2,500 + 240).
      const sent: FlingLog = { v: 1, seed: SEED, events: [fling(10, -300, 250, FULL, GORGO)] };
      const cut = descentFightableLog(sent, CAPACITY, undefined);
      const first = cut.events[0] as Extract<FlingEvent, { kind: "fling" }>;
      // The champion's 240 units come out of the monsters on the server only.
      expect(bucketCost(first.monsters, undefined)).toBeLessThanOrEqual(CAPACITY - GORGO_ROOM);
      expect(bucketCost(first.monsters, undefined)).toBeLessThan(bucketCost({ ...FULL }, undefined));

      // Yard 2 falls to both armies, but not in the same way: the buildings'
      // health, the loot and Gorgo's health differ, and any one of those
      // refuses the save under `COMBAT_SAVE_VALIDATION=reject`.
      const screen = replay(sent);
      const server = replay(cut);
      const fields = battleMismatches(saveOf(screen), server, descentYardOf(YARD_INDEX).buildingdata as never);
      expect(fields).toEqual(expect.arrayContaining(["buildinghealthdata", "attackloot", "attackerchampion"]));
    },
    TIMEOUT_MS
  );

  test(
    "as revamp's panel sends it: the champion's room is left free, nothing is cut, both sides fight the same battle",
    () => {
      // The panel reserves Gorgo's 240 units first: 2,500 - 240 = 2,260 of monsters.
      const trimmed = { C2: 70, C3: 40, C5: 16 };
      expect(bucketCost(trimmed, undefined) + GORGO_ROOM).toBeLessThanOrEqual(CAPACITY);
      const sent: FlingLog = {
        v: 1,
        seed: SEED,
        events: [fling(10, -300, 250, trimmed, GORGO), fling(10, 300, 250, FULL)],
      };
      const cut = descentFightableLog(sent, CAPACITY, undefined);
      expect(cut).toEqual(sent);

      const screen = replay(sent);
      const server = replay(cut);
      expect(battleMismatches(saveOf(screen), server, descentYardOf(YARD_INDEX).buildingdata as never)).toEqual([]);
    },
    TIMEOUT_MS
  );
});
