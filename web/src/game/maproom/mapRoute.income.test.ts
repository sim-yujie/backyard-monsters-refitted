import { describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse, Resources, YardResponse } from "@/api/types";
import type { YardApi } from "@/api/yard";
import { IncomePrediction } from "@/game/yard/outpostIncome";
import { YardStore } from "@/game/yard/YardStore";
import { primeFromYard, takePrimedOwnYard } from "./mapRoute";

/**
 * The own yard handed from the yard to Map Room 2 (`primeFromYard`) with
 * outpost income running (#207): the map must show the pool the yard showed,
 * not that pool with the income since the yard's load added a second time.
 *
 * Owner, 13 Nov 2026: "entering map room 2 sometimes causes me to lose some
 * resource (just a bit)". The yard's store predicts the income into
 * `save.resources` but leaves `save.buildingresources.t` at the load's `t`.
 * The map predicted again from that old `t` on top of the already-predicted
 * pool, so its bar jumped up; then its first resource sync (`getarea`,
 * the server's pool, which pays no income) brought it back down with a red
 * "−" float, and back in the yard the pool was lower than the map had shown.
 */

const T0 = 1_000_000;
const CAP = 1e6;
const CAPS = { r1: CAP, r2: CAP, r3: CAP, r4: CAP };
const POOL = { r1: 1000, r2: 1000, r3: 1000, r4: 1000 };

/** A main-yard load whose one outpost earns 10 twigs and 5 goo a tick, paid up to T0 − 3. */
const load = (): BaseLoadResponse =>
  ({
    error: 0,
    id: 1,
    baseid: "1",
    basesaveid: 1,
    worldsize: [800, 800],
    currenttime: T0,
    savetime: T0,
    resources: POOL,
    credits: 100,
    buildingdata: { "1": { X: 0, Y: 0, t: 14, id: 1, l: 3 } },
    storedata: {},
    buildingresources: { t: T0 - 3, b2000242209: { r1: 10, r2: 0, r3: 0, r4: 5 } },
  }) as BaseLoadResponse;

const answer = (now: number, resources: Resources): YardResponse<null> =>
  ({
    error: 0,
    savetime: now,
    currenttime: now,
    resources,
    credits: 100,
    caps: CAPS,
    workers: { total: 1, busy: 0 },
    buildingdata: { "1": { X: 0, Y: 0, t: 14, id: 1, l: 3 } },
    buildinghealthdata: {},
    storedata: {},
    monsters: {},
    lockerdata: {},
    academy: {},
    champion: [],
    mushrooms: {},
    researchdata: {},
    completed: [],
    report: null,
  }) as unknown as YardResponse<null>;

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

/** A yard store on a clock the test moves, started (its first `state` answered at T0). */
const yardAt = async (state: () => Promise<YardResponse<null>>) => {
  let now = T0;
  const store = new YardStore({
    save: load(),
    api: { state: vi.fn(state) } as unknown as YardApi,
    clock: () => now,
    timers: { set: () => 0, clear: () => undefined },
  });
  store.start();
  await flush();
  return {
    store,
    at(seconds: number) {
      now = T0 + seconds;
      store.tick();
    },
  };
};

/** What Map Room 2 shows from a primed save at `now`, as `MapRoom2Scene.loadOwnCell` sets it up. */
const mapShows = (primed: BaseLoadResponse, now: number): Resources => {
  const income = new IncomePrediction(primed.buildingresources, primed.resources);
  return income.next(now, CAP) ?? primed.resources ?? {};
};

/** What Map Room 2 shows after its `getarea` sync brings the server's pool (`syncPool`). */
const mapShowsAfterSync = (primed: BaseLoadResponse, serverPool: Resources, now: number): Resources => {
  const income = new IncomePrediction(primed.buildingresources, primed.resources);
  income.next(now, CAP);
  income.rebase(serverPool);
  return income.next(now, CAP) ?? serverPool;
};

describe("the yard handed to Map Room 2 with outpost income running (#207)", () => {
  it("shows the pool the yard showed, not the income since the load added twice", async () => {
    const { store, at } = await yardAt(() => Promise.resolve(answer(T0, POOL)));
    // Three ticks (T0 + 7, 17, 27) predicted on the server's 1000.
    at(27);
    expect(store.resources.r1).toBe(1030);

    expect(primeFromYard(store, 0)).toBe(true);
    const primed = takePrimedOwnYard(0);
    expect(primed).not.toBeNull();

    expect(mapShows(primed!, T0 + 27)).toMatchObject({ r1: 1030, r4: 1015 });
    // The server still holds 1000 paid up to T0 − 3: the sync must not drop the bar.
    expect(mapShowsAfterSync(primed!, POOL, T0 + 27)).toMatchObject({ r1: 1030, r4: 1015 });
  });

  it("predicts from where the server last paid, after a yard answer moved it on", async () => {
    let next = answer(T0, POOL);
    const { store, at } = await yardAt(() => Promise.resolve(next));
    // A yard answer at T0 + 20: the server paid two ticks (to T0 + 17), 1020.
    next = answer(T0 + 20, { r1: 1020, r2: 1000, r3: 1000, r4: 1010 });
    at(20);
    await store.refresh();
    // Three more ticks predicted (T0 + 27, 37, 47).
    at(47);
    expect(store.resources.r1).toBe(1050);

    expect(primeFromYard(store, 0)).toBe(true);
    const primed = takePrimedOwnYard(0)!;
    expect(mapShows(primed, T0 + 47)).toMatchObject({ r1: 1050, r4: 1025 });
    expect(mapShowsAfterSync(primed, { r1: 1020, r2: 1000, r3: 1000, r4: 1010 }, T0 + 47)).toMatchObject({
      r1: 1050,
      r4: 1025,
    });
  });
});
