import { describe, expect, test } from "bun:test";

import { defenderForcesOf, type FlingEvent, type FlingLog } from "../../game-rules/combat/index.js";
import { replayAbandonedAttack } from "../base/combat/abandonedAttack.js";
import { battleMismatches, battleReplayInput } from "../base/combat/battle.js";
import { DESCENT_FLINGER_CAPACITY, descentFightableLog, descentYardOf } from "./descent.js";

/**
 * Krallen's Krallen Hunt loot aura in the Descent: the page and the replay
 * agree (descent-aura, 24 Nov 2026; diagnosis on `diag/descent`).
 *
 * The replay gives her the aura when her `la` runs past the session's
 * `startedat` (`battleReplayInput`'s `auraAt`), whatever the log says. The
 * page flings her with `aura` when `la` runs past its attack load's
 * `currenttime` (web `krallenAuraRuns`). The Descent start answer had no
 * `currenttime`, so the page fought without the aura and 66 Descent saves
 * since 16 Nov disagreed with the replay. It now sends the session's
 * `startedat` as `currenttime` (`descentAttack.ts`; the web side is tested in
 * `AttackSession.descent.test.ts`).
 *
 * Here the page's log is built by the page's rule at the clock the start now
 * serves, the server's battle by its own stamp, and each save is compared as
 * `recordBattleMismatches` does.
 */

const STARTED = 1_795_600_000;
const CAPACITY = DESCENT_FLINGER_CAPACITY[DESCENT_FLINGER_CAPACITY.length - 1]!;
const YARD_INDEX = 10;
const END_TICK = 20_000;
const ARMY = { C1: 35, C2: 45 };

/** Where and with which seed the attack goes in. */
interface Spot {
  readonly seed: number;
  readonly x: number;
  readonly y: number;
}
const SPOT: Spot = { seed: 11, x: -300, y: 250 };

const fling = (
  { x, y }: Spot,
  t: number,
  monsters: Record<string, number>,
  champion: { t: number; l: number; s: string; aura?: boolean }
): FlingEvent => ({ kind: "fling", t, x, y, r: 60, monsters: { ...monsters }, champion: { ...champion } }) as FlingEvent;

/** The page's rule (web `krallenAuraRuns`): the aura runs while `la` is after the load's clock. */
const pageAura = (la: number | undefined, currenttime: number | undefined): boolean =>
  typeof currenttime === "number" && la !== undefined && la > currenttime;

/** The log the page sends: Fomor L3 with the army, then Krallen L1, with `aura` when the page gives it. */
const pageLog = (aura: boolean, spot: Spot): FlingLog => ({
  v: 1,
  seed: spot.seed,
  events: [
    fling(spot, 10, ARMY, { t: 3, l: 3, s: "offensive" }),
    fling(spot, 12, {}, { t: 5, l: 1, s: "offensive", ...(aura ? { aura: true } : {}) }),
  ],
});

const yard = descentYardOf(YARD_INDEX);
const defence = defenderForcesOf({
  buildingdata: yard.buildingdata,
  academy: yard.academy,
  champion: yard.champion,
  monsters: yard.monsters,
  buildinghealthdata: {},
});

/** The replay input as `descentReplayInput` builds it, for a Krallen whose aura runs out at `la`. */
const inputFor = (log: FlingLog, la: number | undefined) =>
  battleReplayInput({
    flinglog: descentFightableLog(log, CAPACITY, undefined),
    session: { startedat: STARTED, entryHoused: { "1": { ...ARMY } }, defenderForces: defence } as never,
    defender: {
      type: "iwm",
      kind: "inferno",
      buildingdata: yard.buildingdata as never,
      buildinghealthdata: {},
      resources: yard.resources as never,
    },
    attacker: { champion: [{ t: 3, l: 3 }, { t: 5, l: 1, ...(la !== undefined && { la }) }], catapult: 0, siege: null } as never,
    tick: END_TICK,
    descentYard: YARD_INDEX + 1,
  })!;

const krallenOf = (log: FlingLog) =>
  (log.events.find((event) => event.kind === "fling" && event.champion?.t === 5) as Extract<FlingEvent, { kind: "fling" }>).champion;

/**
 * The page's battle and the server's for one Krallen: the page fights its log
 * as it sends it (the engine reads the log's `aura`), the server its own stamp.
 */
const bothSides = (la: number | undefined, currenttime: number | undefined, spot: Spot = SPOT) => {
  const aura = pageAura(la, currenttime);
  const serverInput = inputFor(pageLog(aura, spot), la);
  // The page's battle: the same input, but Krallen as the page flung her.
  const pageInput = {
    ...serverInput,
    log: {
      ...serverInput.log,
      events: serverInput.log.events.map((event): FlingEvent => {
        if (event.kind !== "fling" || event.champion?.t !== 5) return event;
        const { aura: _stamped, ...champion } = event.champion as typeof event.champion & { aura?: boolean };
        return { ...event, champion: { ...champion, ...(aura ? { aura: true } : {}) } } as FlingEvent;
      }),
    },
  };
  const server = replayAbandonedAttack(serverInput);
  const page = replayAbandonedAttack(pageInput);
  const save = {
    damage: page.damage,
    destroyed: undefined,
    buildinghealthdata: page.buildinghealthdata,
    buildingdata: yard.buildingdata,
    attackloot: page.attackloot,
    attackerchampion: page.attackerchampion,
  };
  return {
    serverAura: krallenOf(serverInput.log)?.aura === true,
    pageAura: krallenOf(pageInput.log)?.aura === true,
    fields: battleMismatches(save, server, yard.buildingdata as never),
  };
};

describe("Descent: Krallen's loot aura, the page's against the replay's", () => {
  test("her aura running past the start: both give it (the start's clock is the session's `startedat`)", () => {
    expect(bothSides(STARTED + 86_400, STARTED)).toEqual({ serverAura: true, pageAura: true, fields: [] });
    expect(bothSides(STARTED + 1, STARTED)).toEqual({ serverAura: true, pageAura: true, fields: [] });
  });

  test("her aura out by the start, or none: neither gives it", () => {
    expect(bothSides(STARTED, STARTED)).toEqual({ serverAura: false, pageAura: false, fields: [] });
    expect(bothSides(STARTED - 60, STARTED)).toEqual({ serverAura: false, pageAura: false, fields: [] });
    expect(bothSides(undefined, STARTED)).toEqual({ serverAura: false, pageAura: false, fields: [] });
  });

  test("the bug: a start with no clock left the page without the aura, and saves disagreed on the loot", () => {
    const spots: Spot[] = [11, 22, 33].flatMap((seed) =>
      [[-300, 250], [300, 250], [0, -350]].map(([x, y]) => ({ seed, x: x!, y: y! }))
    );
    const before = spots.map((spot) => bothSides(STARTED + 86_400, undefined, spot));
    for (const one of before) expect([one.serverAura, one.pageAura]).toEqual([true, false]);
    expect(before.filter((one) => one.fields.includes("attackloot")).length).toBeGreaterThan(0);
    // With the start's clock every one of them agrees.
    for (const spot of spots) expect(bothSides(STARTED + 86_400, STARTED, spot).fields).toEqual([]);
  });
});
