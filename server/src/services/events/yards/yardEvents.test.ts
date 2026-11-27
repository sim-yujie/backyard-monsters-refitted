import { describe, expect, test } from "bun:test";

import { BLACK_SPURTZ_TYPE, SPURTZ_TYPE, spurtzAllowed } from "../../../config/SpurtzConfig.js";
import { CARNAGE_GLIMMERS, yardEventByKey } from "../../../game-data/events/yardEvents.js";
import { Reward } from "../../../enums/Rewards.js";
import { townHallDown } from "./eventYardLanding.js";
import { copyOfOwnYard, COPY_YARD_LOOT, eventYardViews, playerLockOf } from "./yardEventGate.js";
import { liveYardEventRun, readYardRuns, startYardRun, stopYardRun, yardEventRunEvents, yardRunIdAt } from "./yardEventRun.js";
import { applySpurtzReward, prizesDue } from "./yardPrizes.js";
import { landedState, repairsAt, standingHealth, YARD_REPAIR_SECONDS, type YardState } from "./yardStore.js";
import { EVENT_COPY_YARDS } from "../../../game-data/tribes/events/index.js";
import type { EventPlayerSave } from "../eventPlayer.js";

const DAY = 24 * 60 * 60;
const carnage = yardEventByKey("carnage")!;
const brukwar = yardEventByKey("brukwar")!;

const state = (over: Partial<YardState> = {}): YardState => ({
  health: {},
  destroyed: false,
  damage: 0,
  firstAttackedAt: 1_000,
  looted: {},
  ...over,
});

describe("yard event runs", () => {
  test("one at a time; stop ends it now; ids are <key>-<start>", () => {
    const started = startYardRun([], "carnage", 1_000)!;
    expect(started).toEqual([{ event: "carnage", startsAt: 1_000, endsAt: 1_000 + 7 * DAY }]);
    expect(startYardRun(started, "brukwar", 2_000)).toBeNull();
    expect(liveYardEventRun(2_000, started)?.id).toBe("carnage-1000");
    const stopped = stopYardRun(started, 5_000)!;
    expect(stopped[0]!.endsAt).toBe(5_000);
    expect(liveYardEventRun(5_000, stopped)).toBeNull();
    expect(stopYardRun(stopped, 6_000)).toBeNull();
  });

  test("an attack lands on the run it began in, even after the run ended", () => {
    const runs = [
      { event: "carnage" as const, startsAt: 1_000, endsAt: 2_000 },
      { event: "carnage" as const, startsAt: 3_000, endsAt: 4_000 },
    ];
    expect(yardRunIdAt("carnage", 1_500, runs)).toBe("carnage-1000");
    expect(yardRunIdAt("carnage", 2_500, runs)).toBe("carnage-1000");
    expect(yardRunIdAt("carnage", 3_500, runs)).toBe("carnage-3000");
    expect(yardRunIdAt("carnage", 500, runs)).toBeNull();
    expect(yardRunIdAt("brukwar", 3_500, runs)).toBeNull();
  });

  test("the stored value drops unknown events and bad windows", () => {
    expect(
      readYardRuns({
        runs: [
          { event: "carnage", startsAt: 10, endsAt: 20 },
          { event: "wmi1", startsAt: 10, endsAt: 20 },
          { event: "brukwar", startsAt: 30, endsAt: 30 },
        ],
      })
    ).toEqual([{ event: "carnage", startsAt: 10, endsAt: 20 }]);
  });

  test("each run is an Events page entry of kind yards", () => {
    const [entry] = yardEventRunEvents([{ event: "brukwar", startsAt: 1_764_230_400, endsAt: 1_764_230_400 + DAY }]);
    expect(entry).toMatchObject({ id: "brukwar-1764230400", kind: "yards", title: "Brukkarg War" });
  });
});

describe("who attacks which yard", () => {
  test("Creature Carnage is for Town Hall 2 to 4 who finished the guided start", () => {
    const save = (hall: number, tutorialstage = 205) =>
      ({ buildingdata: { 0: { t: 14, l: hall, X: 0, Y: 0, id: 0 } }, tutorialstage }) as unknown as EventPlayerSave;
    expect(playerLockOf(carnage, save(1))).toBe("townHall");
    expect(playerLockOf(carnage, save(2))).toBeNull();
    expect(playerLockOf(carnage, save(4))).toBeNull();
    expect(playerLockOf(carnage, save(5))).toBe("townHall");
    expect(playerLockOf(brukwar, save(9))).toBeNull();
  });

  test("the first yard not wrecked is next; a damaged one shows its damage until it repairs", () => {
    const states = new Map([
      ["906", state({ destroyed: true })],
      ["907", state({ health: { 3: 10 }, damage: 40, firstAttackedAt: 1_000 })],
    ]);
    const views = eventYardViews(carnage, states, 0, 2_000);
    expect(views).toHaveLength(10);
    expect(views[0]).toMatchObject({ baseid: "906", destroyed: true, next: false });
    expect(views[1]).toMatchObject({ baseid: "907", next: true, damage: 40, repairsAt: 1_000 + YARD_REPAIR_SECONDS });
    const later = eventYardViews(carnage, states, 0, 1_000 + YARD_REPAIR_SECONDS);
    expect(later[1]).toMatchObject({ damage: 0, repairsAt: 0, next: true });
  });

  test("Brukkarg yard k waits for 5k waves; the fifth is the copy", () => {
    const views = eventYardViews(brukwar, new Map(), 7, 0);
    expect(views.map((one) => one.wavesNeeded)).toEqual([0, 3, 8, 13, 18]);
    expect(views.map((one) => one.copy)).toEqual([false, false, false, false, true]);
  });
});

describe("damage and repair", () => {
  test("a yard is whole a day after its first hit, never while wrecked", () => {
    const hit = state({ health: { 5: 0 }, firstAttackedAt: 100 });
    expect(standingHealth(hit, 100 + YARD_REPAIR_SECONDS - 1)).toEqual({ 5: 0 });
    expect(standingHealth(hit, 100 + YARD_REPAIR_SECONDS)).toEqual({});
    expect(repairsAt(hit, 200)).toBe(100 + YARD_REPAIR_SECONDS);
  });

  test("a landing keeps the first hit's time while damaged, restarts it once repaired", () => {
    const after = { health: { 1: 5 }, destroyed: false, damage: 10, looted: { r1: 5 } };
    expect(landedState(state({ firstAttackedAt: 100 }), after, 200).firstAttackedAt).toBe(100);
    expect(landedState(state({ firstAttackedAt: 100 }), after, 100 + YARD_REPAIR_SECONDS).firstAttackedAt).toBe(
      100 + YARD_REPAIR_SECONDS
    );
    expect(landedState(null, after, 300).firstAttackedAt).toBe(300);
  });

  test("the win is the Town Hall down", () => {
    const buildings = { 0: { t: 14, id: 7 }, 1: { t: 21, id: 8 } };
    expect(townHallDown(buildings, { 8: 0 })).toBe(false);
    expect(townHallDown(buildings, { 7: 0 })).toBe(true);
    expect(townHallDown(buildings, {})).toBe(false);
  });
});

describe("the copy of the player's own yard", () => {
  test("keeps the buildings, bunkers, academy and champions, not the player's resources or harvests", () => {
    const save = {
      level: 33,
      buildingdata: { 1: { t: 1, st: 9_000, id: 1, X: 0, Y: 0 }, 2: { t: 22, m: { C5: 4 }, id: 2, X: 0, Y: 0 } },
      academy: { C5: { level: 4 } },
      champion: [{ t: 2, l: 5 }],
      resources: { r1: 99_000_000 },
    };
    const copy = copyOfOwnYard(EVENT_COPY_YARDS.brukwar!, save) as Record<string, unknown>;
    expect(copy.baseid).toBe("905");
    expect(copy.level).toBe(33);
    expect((copy.buildingdata as Record<string, Record<string, unknown>>)["1"]!.st).toBeUndefined();
    expect((copy.buildingdata as Record<string, Record<string, unknown>>)["2"]!.m).toEqual({ C5: 4 });
    expect(copy.academy).toEqual({ C5: { level: 4 } });
    expect(copy.champion).toEqual([{ t: 2, l: 5 }]);
    expect((copy.resources as Record<string, number>).r1).toBe(COPY_YARD_LOOT.r1);
  });
});

describe("prizes", () => {
  test("Creature Carnage pays Glimmers for each yard (the placeholder table)", () => {
    expect(CARNAGE_GLIMMERS).toHaveLength(10);
    expect(prizesDue(carnage, 3).map((prize) => prize.glimmers)).toEqual(CARNAGE_GLIMMERS.slice(0, 3));
  });

  test("Brukkarg War: 3 yards 1 Spurtz Cannon, 4 yards 2, 5 yards Black Diamond", () => {
    expect(prizesDue(brukwar, 2)).toEqual([]);
    expect(prizesDue(brukwar, 5).map((prize) => prize.spurtz)).toEqual([1, 2, 3]);

    const save = { rewards: {}, buildingdata: { 4: { t: SPURTZ_TYPE, l: 3, id: 4 }, 5: { t: 21, id: 5 } } } as never as {
      rewards: Record<string, unknown>;
      buildingdata: Record<string, Record<string, unknown>>;
    };
    applySpurtzReward(save, 1);
    expect(spurtzAllowed(SPURTZ_TYPE, save.rewards)).toBe(1);
    applySpurtzReward(save, 2);
    expect(spurtzAllowed(SPURTZ_TYPE, save.rewards)).toBe(2);
    expect(spurtzAllowed(BLACK_SPURTZ_TYPE, save.rewards)).toBe(0);
    applySpurtzReward(save, 3);
    expect(save.rewards[Reward.BRUKWAR_DIAMOND_SPURTZ]).toEqual({ id: Reward.BRUKWAR_DIAMOND_SPURTZ });
    expect(spurtzAllowed(SPURTZ_TYPE, save.rewards)).toBe(0);
    expect(spurtzAllowed(BLACK_SPURTZ_TYPE, save.rewards)).toBe(2);
    expect(save.buildingdata["4"]).toEqual({ t: BLACK_SPURTZ_TYPE, l: 3, id: 4 });
    expect(save.buildingdata["5"]!.t).toBe(21);
  });

  test("Flash's old Spurtz reward ids (Town Hall 9 unlock, sandbox yards) open nothing", () => {
    const old = { [Reward.SPURTZ1]: { id: Reward.SPURTZ1 }, [Reward.SPURTZ2]: { id: Reward.SPURTZ2 }, [Reward.DIAMOND_SPURTZ]: { id: Reward.DIAMOND_SPURTZ } };
    expect(spurtzAllowed(SPURTZ_TYPE, old)).toBe(0);
    expect(spurtzAllowed(BLACK_SPURTZ_TYPE, old)).toBe(0);
  });

  test("no reward, no Spurtz", () => {
    expect(spurtzAllowed(SPURTZ_TYPE, {})).toBe(0);
    expect(spurtzAllowed(SPURTZ_TYPE, null)).toBe(0);
    expect(spurtzAllowed(21, { [Reward.BRUKWAR_SPURTZ2]: { id: Reward.BRUKWAR_SPURTZ2 } })).toBe(0);
  });
});
