import { describe, expect, mock, test } from "bun:test";
import type { Save } from "../../../database/models/save.model.js";

mock.module("../../../server.js", () => ({
  postgres: { em: { persist: () => {} } },
  redis: {},
}));

const { damageProtection } = await import("./damageProtection.js");

const now = () => Math.floor(Date.now() / 1000);
const EIGHT_HOURS = 8 * 60 * 60;

const yard = (type: string, damage: number, protectedUntil = 0) =>
  ({ type, damage, protected: protectedUntil, attacks: [{ starttime: now() - 60 }] }) as unknown as Save;

describe("damageProtection, outposts (issue #182)", () => {
  test("25% to 89% damage earns 8 hours", async () => {
    for (const damage of [25, 60, 89]) {
      const save = yard("outpost", damage);
      await damageProtection(save);
      expect(save.protected).toBeGreaterThanOrEqual(now() + EIGHT_HOURS - 1);
    }
  });

  test("a destroyed outpost earns none, so it can be taken over", async () => {
    const save = yard("outpost", 90);
    expect(await damageProtection(save)).toBe(false);
    expect(save.protected).toBe(0);
  });

  test("a destroyed outpost whose old protection ran out is cleared, not protected again", async () => {
    const save = yard("outpost", 95, now() - 10);
    await damageProtection(save);
    expect(save.protected).toBe(0);
  });

  test("under 25% earns none", async () => {
    const save = yard("outpost", 24);
    await damageProtection(save);
    expect(save.protected).toBe(0);
  });

  test("a main yard still earns 36 hours at 50% and more, destroyed or not", async () => {
    const save = yard("main", 95);
    await damageProtection(save);
    expect(save.protected).toBeGreaterThanOrEqual(now() + 36 * 60 * 60 - 1);
  });
});
