import { describe, expect, test } from "bun:test";

import { krallenHunt, type EventDefinition } from "../../game-data/events/events.js";
import { countAttackLoot, lootEventsOn, lootTotal } from "./lootEvents.js";
import { memoryProgressStore, type EventProgressStore } from "./progressStore.js";

const HUNT = krallenHunt(2030, 3);
const IN = Date.UTC(2030, 2, 20) / 1000;
const BEFORE = Date.UTC(2030, 2, 14, 23) / 1000;
const AFTER = Date.UTC(2030, 3, 1) / 1000;
const OTHER: EventDefinition = { ...HUNT, id: "pumpkins", ladder: { label: "P", tiers: [{ need: 1, rewards: [] }] } };
const EVENTS = [HUNT, OTHER];
const TH = (level: number) => ({ "0": { id: 0, t: 14, X: 0, Y: 0, l: level } });
const READY = { buildingdata: TH(6), tutorialstage: 205 };
const em = {} as never;

describe("lootTotal", () => {
  test("adds the four resources, whole and at least 0", () => {
    expect(lootTotal({ r1: 10.7, r2: 5, r3: -4, r4: Number.NaN })).toBe(15);
    expect(lootTotal(null)).toBe(0);
  });
});

describe("lootEventsOn", () => {
  test("only attack-loot ladders, only inside their window", () => {
    expect(lootEventsOn(IN, EVENTS).map((event) => event.id)).toEqual([HUNT.id]);
    expect(lootEventsOn(BEFORE, EVENTS)).toEqual([]);
    expect(lootEventsOn(AFTER, EVENTS)).toEqual([]);
  });
});

describe("countAttackLoot", () => {
  const count = (save: unknown, credit: unknown, now = IN, store: EventProgressStore = memoryProgressStore(), skipTutorial = false) =>
    countAttackLoot(em, 7, save as never, credit as never, now, { store, events: EVENTS, skipTutorial });

  test("adds the sum to the hunt for a Town Hall 6 player, and keeps adding", async () => {
    const store = memoryProgressStore();
    expect(await count(READY, { r1: 100, r2: 200, r3: 300, r4: 400 }, IN, store)).toEqual(new Map([[HUNT.id, 1000]]));
    expect(await count(READY, { r4: 5 }, IN, store)).toEqual(new Map([[HUNT.id, 1005]]));
    expect(store.rows.has("7:pumpkins")).toBe(false);
  });

  test("nothing for no loot, outside the window, Town Hall 5, or the guided start not done", async () => {
    const store = memoryProgressStore();
    expect((await count(READY, { r1: 0 }, IN, store)).size).toBe(0);
    expect((await count(READY, { r1: 9 }, AFTER, store)).size).toBe(0);
    expect((await count({ ...READY, buildingdata: TH(5) }, { r1: 9 }, IN, store)).size).toBe(0);
    expect((await count({ ...READY, tutorialstage: 50 }, { r1: 9 }, IN, store)).size).toBe(0);
    expect(store.rows.size).toBe(0);
    expect((await count({ ...READY, tutorialstage: 50 }, { r1: 9 }, IN, store, true)).get(HUNT.id)).toBe(9);
  });

  test("a store that throws is logged, not thrown", async () => {
    const broken = { ...memoryProgressStore(), addToCounter: () => Promise.reject(new Error("db down")) };
    expect((await count(READY, { r1: 9 }, IN, broken)).size).toBe(0);
  });
});
