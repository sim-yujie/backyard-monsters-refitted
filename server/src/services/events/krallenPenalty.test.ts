import { describe, expect, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/core";

import { championEntry } from "../../game-data/championCatalogue.js";
import { KRALLEN_TYPE } from "../../game-data/events/eventRewards.js";
import { krallenHunt, krallenHuntMinimum } from "../../game-data/events/events.js";
import type { ChampionData } from "../../schemas/ChampionSchema.js";
import { CHAMPION_CHAMBER_TYPE, maxHealthOf } from "../yard/champion.js";
import { eventView } from "./eventViews.js";
import { lowerKrallen, settleKrallenHunts, type PenaltySave } from "./krallenPenalty.js";
import { memoryProgressStore, NO_PROGRESS } from "./progressStore.js";

const em = {} as EntityManager;
const USER = 7;
const MARCH = krallenHunt(2030, 3);
const APRIL = krallenHunt(2030, 4);
const MARCH_END = Date.UTC(2030, 3, 1) / 1000;
const APRIL_END = Date.UTC(2030, 4, 1) / 1000;
const MARCH_START = Date.UTC(2030, 2, 15) / 1000;
const EVENTS = [MARCH, APRIL];
const entry = championEntry(KRALLEN_TYPE)!;

const krallen = (level: number, more: Partial<ChampionData> = {}): ChampionData => {
  const one: ChampionData = { t: KRALLEN_TYPE, l: level, hp: 0, ft: 0, fd: 0, fb: 0, pl: 1, status: 0, hk: MARCH_START, ...more };
  one.hp = maxHealthOf(one, entry);
  return one;
};
const saveWith = (...champions: ChampionData[]): PenaltySave => ({ userid: USER, champion: champions, buildingdata: {} });
const krallenIn = (save: PenaltySave) => (save.champion as ChampionData[]).find((one) => one.t === KRALLEN_TYPE);

/** A store whose hunt `id` holds `counter` loot and `claimed` tiers. */
const storeWith = (rows: Record<string, { counter: number; claimed?: number[] }> = {}) => {
  const store = memoryProgressStore();
  for (const [id, row] of Object.entries(rows)) {
    store.rows.set(`${USER}:${id}`, { ...NO_PROGRESS, counter: row.counter, claimedTiers: row.claimed ?? [] });
  }
  return store;
};

const settle = (store: ReturnType<typeof memoryProgressStore>, save: PenaltySave, now = MARCH_END + 60, underAttack = false) =>
  settleKrallenHunts(em, store, save, now, { events: EVENTS, underAttack });

describe("the hunt's minimum", () => {
  test("half the goal by her level when the hunt began; none without her", () => {
    expect([0, 1, 2, 3, 4, 5].map(krallenHuntMinimum)).toEqual([0, 45e6, 75e6, 125e6, 150e6, 150e6]);
  });
});

describe("settleKrallenHunts", () => {
  test("below the minimum she loses one level, health no higher than the new full health", async () => {
    const store = storeWith({ [MARCH.id]: { counter: 124_999_999 } });
    const save = saveWith(krallen(3, { la: 9_999_999_999 }));
    const told = await settle(store, save);
    const after = krallenIn(save)!;
    expect(after.l).toBe(2);
    expect(after.hp).toBe(maxHealthOf(after, entry));
    expect(after.hk).toBe(MARCH_END);
    // The aura stays on her entry; below level 3 the fight's level check leaves it off.
    expect(after.la).toBe(9_999_999_999);
    expect(told).toEqual([{ event: MARCH.id, from: 3, to: 2 }]);
  });

  test("a level 1 Krallen is lost, aura and all; the other champions stay", async () => {
    const store = storeWith({ [MARCH.id]: { counter: 44_999_999 } });
    const other: ChampionData = { t: 1, l: 2, hp: 100, status: 0 } as ChampionData;
    const save = saveWith(other, krallen(1, { la: 9_999_999_999 }));
    expect(await settle(store, save)).toEqual([{ event: MARCH.id, from: 1, to: 0 }]);
    expect(save.champion).toEqual([other]);
  });

  test("exactly at the minimum, or between it and the goal, she keeps her level", async () => {
    for (const counter of [125_000_000, 149_000_000]) {
      const save = saveWith(krallen(3));
      expect(await settle(storeWith({ [MARCH.id]: { counter } }), save)).toEqual([]);
      expect(krallenIn(save)!.l).toBe(3);
      expect(krallenIn(save)!.hk).toBe(MARCH_END);
    }
  });

  test("a level 5 Krallen drops to 4 below 150 million", async () => {
    const save = saveWith(krallen(5));
    await settle(storeWith({ [MARCH.id]: { counter: 149_999_999 } }), save);
    expect(krallenIn(save)!.l).toBe(4);
  });

  test("no row at all is no loot", async () => {
    const save = saveWith(krallen(2));
    expect(await settle(storeWith(), save)).toEqual([{ event: MARCH.id, from: 2, to: 1 }]);
  });

  test("a player who won her in that hunt had none at its start: never penalised", async () => {
    // Won at 60 million: claimed the first tier, level 1 now.
    const save = saveWith(krallen(1));
    expect(await settle(storeWith({ [MARCH.id]: { counter: 60_000_000, claimed: [0] } }), save)).toEqual([]);
    expect(krallenIn(save)!.l).toBe(1);
  });

  test("no Krallen: nothing changes, nothing is written", async () => {
    const store = storeWith();
    const save = saveWith();
    expect(await settle(store, save)).toEqual([]);
    expect(save.champion).toEqual([]);
    expect(store.rows.size).toBe(0);
  });

  test("never twice for one hunt, even if her mark were moved back", async () => {
    const store = storeWith({ [MARCH.id]: { counter: 0 } });
    const save = saveWith(krallen(4));
    await settle(store, save);
    expect(await settle(store, save, MARCH_END + 120)).toEqual([]);
    krallenIn(save)!.hk = MARCH_START;
    await settle(store, save, MARCH_END + 180);
    expect(krallenIn(save)!.l).toBe(3);
  });

  test("not while the hunt still runs", async () => {
    const save = saveWith(krallen(4));
    expect(await settle(storeWith({ [MARCH.id]: { counter: 0 } }), save, MARCH_END - 1)).toEqual([]);
    expect(krallenIn(save)!.l).toBe(4);
    expect(krallenIn(save)!.hk).toBe(MARCH_START);
  });

  test("not while an attack on the yard is on: the next load decides it", async () => {
    const store = storeWith({ [MARCH.id]: { counter: 0 } });
    const save = saveWith(krallen(4));
    await settle(store, save, MARCH_END + 60, true);
    expect(krallenIn(save)!.l).toBe(4);
    await settle(store, save, MARCH_END + 120);
    expect(krallenIn(save)!.l).toBe(3);
  });

  test("a Krallen without a mark is judged from the next hunt to end", async () => {
    const save = saveWith(krallen(4, { hk: undefined }));
    expect(await settle(storeWith({ [MARCH.id]: { counter: 0 } }), save)).toEqual([]);
    expect(krallenIn(save)!.l).toBe(4);
    expect(krallenIn(save)!.hk).toBe(MARCH_END + 60);
  });

  test("two hunts missed: each in turn, from the level the one before left her at", async () => {
    const save = saveWith(krallen(2));
    const told = await settle(storeWith({ [APRIL.id]: { counter: 44_000_000 } }), save, APRIL_END + 60);
    expect(told).toEqual([
      { event: MARCH.id, from: 2, to: 1 },
      { event: APRIL.id, from: 1, to: 0 },
    ]);
    expect(krallenIn(save)).toBeUndefined();
  });

  test("frozen: the chamber's copy follows", async () => {
    const save: PenaltySave = {
      userid: USER,
      champion: [krallen(1, { status: 1 })],
      buildingdata: { b9: { t: CHAMPION_CHAMBER_TYPE, fz: "[{\"t\":5}]" } as never },
    };
    await settle(storeWith(), save);
    expect(save.champion).toEqual([]);
    expect((save.buildingdata!["b9"] as { fz?: string }).fz).toBe("[]");
  });

  test("a penalty not yet told is told once", async () => {
    const store = storeWith();
    await store.recordKrallenPenalty(em, USER, MARCH.id, 4, 3);
    expect(await settle(store, saveWith(), MARCH_START)).toEqual([{ event: MARCH.id, from: 4, to: 3 }]);
    expect(await settle(store, saveWith(), MARCH_START)).toEqual([]);
  });
});

describe("lowerKrallen", () => {
  test("no Krallen: nothing", () => {
    expect(lowerKrallen([], {}).champions).toEqual([]);
  });
});

describe("the hunt card's minimum", () => {
  const scheduled = { event: MARCH, window: { startsAt: MARCH_START, endsAt: MARCH_END }, status: "active" as const };
  const player = (krallenLevel: number) => ({ townHall: 9, tutorialDone: true, krallenLevel });

  test("half her start goal with a Krallen at the start, none without", () => {
    expect(eventView(scheduled, NO_PROGRESS, MARCH_START, player(2)).krallen).toMatchObject({ startLevel: 2, minimum: 75e6 });
    expect(eventView(scheduled, NO_PROGRESS, MARCH_START, player(0)).krallen).toMatchObject({ startLevel: 0, minimum: 0 });
  });

  test("after a penalty the ended hunt keeps the level it began with", async () => {
    const store = storeWith({ [MARCH.id]: { counter: 10 } });
    await store.recordKrallenPenalty(em, USER, MARCH.id, 3, 2);
    const progress = (await store.read(em, USER, [MARCH.id])).get(MARCH.id)!;
    const view = eventView({ ...scheduled, status: "ended" }, progress, MARCH_END + 60, player(2));
    expect(view.krallen).toMatchObject({ level: 2, startLevel: 3, minimum: 125e6, penalty: { from: 3, to: 2 } });
    expect(view.ladder!.tiers[0]!.need).toBe(250_000_000);
  });
});
