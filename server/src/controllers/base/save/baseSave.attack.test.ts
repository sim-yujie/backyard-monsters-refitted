import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Context } from "koa";

/**
 * Attack saves through `/base/save`. Loot (issue #163): only the save that
 * ends the attack credits anything, and it credits no more than the server's
 * replay of the battle gives. The army (issue #164): nothing the client sends
 * is written over it. The defender is a small wild monster camp so the replay
 * is quick; the rows are plain objects behind a stand-in ORM.
 */

const DEFENDER_OWNER = 1;
const ATTACKER = 2505;
const ATTACK_ID = 4242;
const HOME = "2000241207";

const YARD = {
  "0": { id: 0, t: 14, l: 1, X: 0, Y: 0 },
  "1": { id: 1, t: 20, l: 1, X: 200, Y: 200 },
};
const LOG = {
  v: 1,
  seed: 5,
  events: [{ kind: "fling", t: 80, x: 400, y: 400, r: 200, monsters: { C4: 12 } }],
};
const ENTRY = { [HOME]: { C4: 12 } };

let defender: Record<string, any>;
let attackerSave: Record<string, any>;
const store = new Map<string, string>();

mock.module("../../../server.js", () => ({
  postgres: {
    em: {
      populate: async (user: Record<string, unknown>) => {
        user.save = attackerSave;
      },
      findOne: async () => defender,
      find: async () => [],
      persist: () => {},
      flush: async () => {},
    },
  },
  redis: {
    get: async (key: string) => store.get(key) ?? null,
    setex: async () => "OK",
    set: async (key: string, value: string, ...options: string[]) => {
      if (options.includes("NX") && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    },
    del: async (key: string) => (store.delete(key) ? 1 : 0),
    srem: async () => 0,
  },
}));

mock.module("../../../utils/logger.js", () => ({
  logger: { warn: mock(() => {}), error: mock(() => {}), info: mock(() => {}), debug: mock(() => {}) },
}));

mock.module("../../../scripts/anticheat/anticheat.js", () => ({
  initAnticheat: async () => {},
  validateSave: async () => {},
}));

mock.module("../../../services/base/attackSessionStore.js", () => ({
  startAttackSession: async () => {},
  readAttackSession: async () => ({
    attackerid: ATTACKER,
    attackid: ATTACK_ID,
    startedat: Math.floor(Date.now() / 1000),
    entryHoused: ENTRY,
    defenderResources: { r1: 5000, r2: 0, r3: 0, r4: 0 },
  }),
  endAttackSession: async () => {},
}));

const { baseSave } = await import("./baseSave.js");
const { attackLootOf } = await import("../../../services/base/combat/attackLoot.js");

const ctxFor = (body: Record<string, string>) =>
  ({
    authUser: { userid: ATTACKER, username: "attacker" },
    request: { body: { baseid: "1234", basesaveid: "9", attackid: String(ATTACK_ID), ...body } },
    ip: "127.0.0.1",
    path: "/base/save",
  }) as unknown as Context;

const CLAIM = { r1: 1e9, r2: 1e9, r3: 1e9, r4: 1e9 };

/** What the server's replay allows this attack, worked out the same way. */
const replayCap = () =>
  attackLootOf({
    sent: CLAIM,
    reported: undefined,
    flinglog: LOG,
    session: { attackerid: ATTACKER, attackid: ATTACK_ID, startedat: 0, entryHoused: ENTRY },
    defender: { type: "tribe", buildingdata: YARD as never, buildinghealthdata: {}, resources: defender.resources },
    attacker: attackerSave,
    mapRoom3: false,
  }).cap;

beforeEach(() => {
  store.clear();
  defender = {
    basesaveid: 9,
    baseid: "1234",
    saveuserid: DEFENDER_OWNER,
    userid: DEFENDER_OWNER,
    type: "tribe",
    attackid: ATTACK_ID,
    savetime: 0,
    damage: 0,
    buildingdata: structuredClone(YARD),
    buildinghealthdata: {},
    resources: { r1: 5000, r2: 0, r3: 0, r4: 0 },
  };
  attackerSave = {
    baseid: HOME,
    saveuserid: ATTACKER,
    userid: ATTACKER,
    type: "main",
    academy: {},
    champion: [],
    buildingdata: {},
    resources: { r1: 100, r2: 100, r3: 100, r4: 100 },
  };
});

describe("attack loot through the save", () => {
  test("a save that does not end the attack credits nothing, whatever it claims", async () => {
    await baseSave(
      ctxFor({ attackloot: JSON.stringify(CLAIM), resources: JSON.stringify({ r1: -5000 }), flinglog: JSON.stringify(LOG) }),
      async () => {}
    );

    expect(attackerSave.resources).toEqual({ r1: 100, r2: 100, r3: 100, r4: 100 });
    expect(defender.resources.r1).toBe(5000);
  });

  test("the save that ends it credits no more than the replay, and nothing else it sends", async () => {
    const cap = replayCap();
    expect(cap.r1).toBeGreaterThan(0);

    await baseSave(
      ctxFor({
        over: "1",
        attackloot: JSON.stringify({ ...CLAIM, r1max: 1e12, bogus: 5 }),
        flinglog: JSON.stringify(LOG),
      }),
      async () => {}
    );

    expect(attackerSave.resources).toEqual({
      r1: 100 + cap.r1,
      r2: 100 + cap.r2,
      r3: 100 + cap.r3,
      r4: 100 + cap.r4,
    });
    // The defender lost at least what the attacker banked.
    expect(defender.resources.r1).toBeLessThanOrEqual(5000 - cap.r1);
  });

  test("a claim with no fling log is credited nothing", async () => {
    await baseSave(ctxFor({ over: "1", attackloot: JSON.stringify(CLAIM) }), async () => {});

    expect(attackerSave.resources).toEqual({ r1: 100, r2: 100, r3: 100, r4: 100 });
    expect(defender.resources.r1).toBe(5000);
  });
});

describe("the attacker's army through the save (issue #164)", () => {
  const ARMY = { housed: { C4: 12 }, saved: 0 };

  test("a crafted monsterupdate or attackcreatures cannot overwrite the army", async () => {
    attackerSave.monsters = structuredClone(ARMY);
    const crafted = { housed: { C4: 5000, C20: 400 } };

    await baseSave(
      ctxFor({ monsterupdate: JSON.stringify(crafted), attackcreatures: JSON.stringify(crafted) }),
      async () => {}
    );
    await baseSave(
      ctxFor({ over: "1", monsterupdate: JSON.stringify(crafted), attackcreatures: JSON.stringify(crafted) }),
      async () => {}
    );

    expect(attackerSave.monsters).toEqual(ARMY);
  });
});
