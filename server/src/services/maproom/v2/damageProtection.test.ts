import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Save } from "../../../database/models/save.model.js";

const store = new Map<string, string>();
const ttls = new Map<string, number>();

mock.module("../../../server.js", () => ({
  postgres: { em: { persist: () => {} } },
  redis: {
    get: async (key: string) => store.get(key) ?? null,
    setex: async (key: string, ttl: number, value: string) => {
      store.set(key, value);
      ttls.set(key, ttl);
      return "OK";
    },
    del: async (key: string) => (store.delete(key) ? 1 : 0),
  },
}));

const { damageProtection, protectAfterAttack } = await import("./damageProtection.js");
const { catchUpBuildings } = await import("../../yard/catchUpBuildings.js");
const { BaseMode } = await import("../../../enums/Base.js");
const { readTakeoverGrant } = await import("./takeoverGrantStore.js");

const now = () => Math.floor(Date.now() / 1000);
const EIGHT_HOURS = 8 * 60 * 60;
const ATTACKER = 2505;

const yard = (type: string, damage: number, protectedUntil = 0) =>
  ({
    type,
    damage,
    protected: protectedUntil,
    basesaveid: 900,
    baseid: "2000240208",
    attacks: [{ starttime: now() - 60 }],
  }) as unknown as Save;

beforeEach(() => {
  store.clear();
  ttls.clear();
});

describe("damageProtection, outposts", () => {
  test("25% and more earns 8 hours", async () => {
    for (const damage of [25, 60, 89, 95]) {
      const save = yard("outpost", damage);
      await damageProtection(save);
      expect(save.protected).toBeGreaterThanOrEqual(now() + EIGHT_HOURS - 1);
    }
  });

  test("under 25% earns none", async () => {
    const save = yard("outpost", 24);
    await damageProtection(save);
    expect(save.protected).toBe(0);
  });
});

describe("protectAfterAttack (issue #182, the owner's one-chance rule)", () => {
  test("a player outpost left at 90%+ gives the attacker a 10-minute grant, protection from its end", async () => {
    const save = yard("outpost", 92);
    const grant = await protectAfterAttack(save, ATTACKER);

    expect(grant).not.toBeNull();
    expect(grant!.attackerid).toBe(ATTACKER);
    expect(grant!.expiresAt).toBeGreaterThanOrEqual(now() + 599);
    expect(grant!.expiresAt).toBeLessThanOrEqual(now() + 600);
    expect(save.protected).toBe(grant!.expiresAt + EIGHT_HOURS);
    expect(await readTakeoverGrant(900)).toEqual(grant);
    expect(ttls.get("takeover-grant:900")).toBeGreaterThanOrEqual(600);
  });

  test("an outpost at 25-89% gets the usual 8 hours and no grant", async () => {
    const save = yard("outpost", 60);
    expect(await protectAfterAttack(save, ATTACKER)).toBeNull();
    expect(save.protected).toBeGreaterThanOrEqual(now() + EIGHT_HOURS - 1);
    expect(store.size).toBe(0);
  });

  test("a main yard, destroyed or not, gets its 36 hours and no grant", async () => {
    const save = yard("main", 95);
    expect(await protectAfterAttack(save, ATTACKER)).toBeNull();
    expect(save.protected).toBeGreaterThanOrEqual(now() + 36 * 60 * 60 - 1);
    expect(store.size).toBe(0);
  });
});

describe("attacking ends bought protection, and its notice with it (#200)", () => {
  const DAY = 24 * 60 * 60;

  /** A main yard under Holiday Protection for another day, with a Production Overdrive running. */
  const protectedYard = () =>
    ({
      type: "main",
      damage: 0,
      protected: now() + DAY,
      attacks: [],
      buildingdata: {},
      buildinghealthdata: {},
      storedata: {
        PRO2: { q: 1, s: now() - DAY, e: now() + DAY },
        POD: { q: 1, s: now(), e: now() + 3600 },
      },
    }) as unknown as Save;

  /** The store notices the yard's catch-up raises by `at`: what "Protection ended" is made from. */
  const noticesBy = (save: Save, at: number): string[] =>
    catchUpBuildings(save as never, now(), at)
      .filter((job) => job.kind === "storeItem")
      .map((job) => (job as { id: string }).id);

  test.each([BaseMode.ATTACK, BaseMode.WMATTACK, BaseMode.IATTACK, BaseMode.IWMATTACK])(
    "an attack (%s) ends the protection and drops its entry: no \"Protection ended\" later",
    async (mode) => {
      const save = protectedYard();
      await damageProtection(save, mode);

      expect(save.protected).toBe(0);
      expect(Object.keys(save.storedata ?? {})).toEqual(["POD"]);
      expect(noticesBy(save, now() + 2 * DAY)).toEqual(["POD"]);
    }
  );

  test("a player who did not attack still hears it when the protection runs out", async () => {
    const save = protectedYard();
    await damageProtection(save);

    expect(save.protected).toBeGreaterThan(now());
    expect(noticesBy(save, now() + 2 * DAY)).toContain("PRO2");
  });

  test("an attacker with no protection bought keeps its store as it was", async () => {
    const save = { ...protectedYard(), storedata: { POD: { q: 1, e: now() + 3600 } } } as unknown as Save;
    const before = save.storedata;
    await damageProtection(save, BaseMode.ATTACK);
    expect(save.storedata).toBe(before);
  });
});
