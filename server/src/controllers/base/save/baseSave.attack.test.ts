import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
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
const ENTRY = { [HOME]: { C4: 12, C1: 4 } };

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

// The real replay runner, unless a test asks for a replay that times out
// (issue #23, C5). The query makes the real module one no mock replaces.
const REAL_RUNNER = "../../../services/base/combat/replayRunner.ts?real";
const realRunner = (await import(REAL_RUNNER)) as typeof import("../../../services/base/combat/replayRunner.js");
let replayTimesOut = false;
mock.module("../../../services/base/combat/replayRunner.js", () => ({
  ...realRunner,
  replayAbandonedInWorker: async (...args: Parameters<typeof realRunner.replayAbandonedInWorker>) => {
    if (replayTimesOut) throw new realRunner.ReplayTimeoutError(5_000);
    return realRunner.replayAbandonedInWorker(...args);
  },
}));

const { baseSave } = await import("./baseSave.js");
const { attackLootOf } = await import("../../../services/base/combat/attackLoot.js");
const { replayAbandonedAttack } = await import("../../../services/base/combat/abandonedAttack.js");
const { battleReplayInput, battleTick } = await import("../../../services/base/combat/battle.js");

const ctxFor = (body: Record<string, string>) =>
  ({
    authUser: { userid: ATTACKER, username: "attacker" },
    request: { body: { baseid: "1234", basesaveid: "9", attackid: String(ATTACK_ID), ...body } },
    ip: "127.0.0.1",
    path: "/base/save",
  }) as unknown as Context;

const CLAIM = { r1: 1e9, r2: 1e9, r3: 1e9, r4: 1e9 };

/** What the server's replay allows this attack, worked out the same way. */
const replayCap = (flinglog: unknown = LOG) =>
  attackLootOf({
    sent: CLAIM,
    reported: undefined,
    flinglog,
    session: { attackerid: ATTACKER, attackid: ATTACK_ID, startedat: 0, entryHoused: ENTRY },
    defender: { type: "tribe", buildingdata: YARD as never, buildinghealthdata: {}, resources: defender.resources },
    attacker: attackerSave,
    mapRoom3: false,
  }).cap;

// The mock outlives this file (bun keeps module mocks across files), so it is
// left delegating to the real runner.
afterEach(() => {
  replayTimesOut = false;
});

beforeEach(() => {
  replayTimesOut = false;
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

  test("the attacker keeps only what fits in their storage; the defender still loses it (#166)", async () => {
    const cap = replayCap();
    // No silos: a cap of 10,000. r1 has 200 of room, r2 none, r3 is over.
    attackerSave.resources = { r1: 9_800, r2: 10_000, r3: 12_000, r4: 100 };
    const ctx = ctxFor({
      over: "1",
      attackloot: JSON.stringify(cap),
      resources: JSON.stringify({ r1: -cap.r1 }),
      flinglog: JSON.stringify(LOG),
    });

    await baseSave(ctx, async () => {});

    const kept = { r1: Math.min(200, cap.r1), r2: 0, r3: 0, r4: Math.min(9_900, cap.r4) };
    expect(cap.r1).toBeGreaterThan(200);
    expect(attackerSave.resources).toEqual({ r1: 9_800 + kept.r1, r2: 10_000, r3: 12_000, r4: 100 + kept.r4 });
    expect((ctx.body as { lootcredited?: unknown }).lootcredited).toEqual(kept);
    expect(defender.resources.r1).toBe(5000 - cap.r1);
  });

  test("a bomb's cost leaves the pool before the loot fills it", async () => {
    const log = { ...LOG, events: [{ kind: "bomb", t: 40, x: 200, y: 200, id: "tw0" }, ...LOG.events] };
    const cap = replayCap(log);
    expect(cap.r1).toBeGreaterThan(0);
    attackerSave.catapult = 1;
    attackerSave.resources = { r1: 10_000, r2: 0, r3: 0, r4: 0 };

    await baseSave(
      ctxFor({ over: "1", attackloot: JSON.stringify(cap), flinglog: JSON.stringify(log) }),
      async () => {}
    );

    // tw0 costs 10,000 twigs: the pool is emptied, then refilled by the loot.
    expect(attackerSave.resources.r1).toBe(Math.min(10_000, cap.r1));
  });

  test("a Krallen flung in the attack raises the attacker's cap", async () => {
    const log = { ...LOG, events: [...LOG.events, { kind: "fling", t: 90, x: 400, y: 400, r: 200, monsters: {}, champion: { t: 5, l: 1 } }] };
    attackerSave.champion = [{ t: 5, l: 1 }];
    const cap = replayCap(log);
    expect(cap.r1).toBeGreaterThan(0);
    attackerSave.resources = { r1: 10_000, r2: 0, r3: 0, r4: 0 };

    await baseSave(
      ctxFor({ over: "1", attackloot: JSON.stringify(cap), flinglog: JSON.stringify(log) }),
      async () => {}
    );

    // Level 1 Krallen: `buffs` 0.2, so the cap is 12,000 rather than the 10,000 held.
    expect(attackerSave.resources.r1).toBe(Math.min(12_000, 10_000 + cap.r1));
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

describe("a fallen bunker's garrison through the save (issue #130)", () => {
  // Four Pokeys dropped on a stocked Monster Bunker bring it down, and never
  // reach the far one.
  const RAID = {
    v: 1,
    seed: 5,
    events: [{ kind: "fling", t: 80, x: 440, y: 440, r: 200, monsters: { C1: 4 } }],
  };
  const BUNKERS = {
    "2": { id: 2, t: 22, l: 1, X: 420, Y: 420, m: { C1: 5 } },
    "3": { id: 3, t: 22, l: 1, X: -600, Y: -600, m: { C2: 4 } },
  };

  const armed = () => {
    defender.buildingdata = { ...structuredClone(YARD), ...structuredClone(BUNKERS) };
  };

  /** What the server's own battle brings down, as the save works it out. */
  const serverFallen = () =>
    attackLootOf({
      sent: CLAIM,
      reported: undefined,
      flinglog: RAID,
      session: { attackerid: ATTACKER, attackid: ATTACK_ID, startedat: 0, entryHoused: ENTRY },
      defender: { type: "tribe", buildingdata: defender.buildingdata, buildinghealthdata: {}, resources: defender.resources },
      attacker: attackerSave,
      mapRoom3: false,
    }).fallen;

  const save = (health: Record<string, number>, over = true) =>
    baseSave(
      ctxFor({
        ...(over && { over: "1" }),
        flinglog: JSON.stringify(RAID),
        buildinghealthdata: JSON.stringify(health),
      }),
      async () => {}
    );

  test("a bunker the save and the server's battle both bring down loses its garrison", async () => {
    armed();
    expect(serverFallen()).toContain(2);

    await save({ "2": 0 });

    expect(defender.buildingdata["2"].m).toBeUndefined();
    expect(defender.buildingdata["2"]).toMatchObject({ id: 2, t: 22, l: 1 });
    expect(defender.buildingdata["3"].m).toEqual({ C2: 4 });
  });

  test("a save that claims a bunker the battle never reached fell empties nothing", async () => {
    armed();
    expect(serverFallen()).not.toContain(3);

    await save({ "2": 0, "3": 0 });

    expect(defender.buildingdata["3"].m).toEqual({ C2: 4 });
  });

  test("the server's battle decides, whatever the save reports (#23, C3)", async () => {
    armed();

    // The save says the bunker stands; the replay brought it down.
    await save({ "2": 1500 });

    expect(defender.buildingdata["2"].m).toBeUndefined();
    expect(defender.buildinghealthdata["2"]).toBe(0);
  });

  test("a save that does not end the attack empties nothing", async () => {
    armed();

    await save({ "2": 0 }, false);

    expect(defender.buildingdata["2"].m).toEqual({ C1: 5 });
  });
});

describe("the attacker's own row through the save (#23, C1)", () => {
  const champion = (hp: number, l = 2) => ({ t: 1, hp, l, ft: 0, fd: 0, fb: 0, pl: 0, status: 0 });
  const withGorgo = {
    ...LOG,
    events: [
      ...LOG.events,
      { kind: "fling", t: 90, x: 400, y: 400, r: 200, monsters: {}, champion: { t: 1, l: 2 } },
      { kind: "siege", t: 100, x: 400, y: 400, weapon: "jars" },
    ],
  };

  const save = (body: Record<string, string>) =>
    baseSave(ctxFor({ flinglog: JSON.stringify(withGorgo), ...body }), async () => {});

  beforeEach(() => {
    attackerSave.champion = [champion(500)];
    attackerSave.siege = { jars: { quantity: 2 } };
  });

  test("a crafted save cannot raise a champion's level or health, nor add siege", async () => {
    await save({
      over: "1",
      attackerchampion: JSON.stringify([champion(99_999, 6), { ...champion(1), t: 3 }]),
      attackersiege: JSON.stringify({ jars: { quantity: 99 }, rocket: { quantity: 5 } }),
    });

    expect(attackerSave.champion).toEqual([champion(500)]);
    // The one jar the log used is spent, whatever the save said the stock was.
    expect(attackerSave.siege).toEqual({ jars: { quantity: 1 } });
  });

  test("an honest save's champion damage and siege use still land", async () => {
    await save({
      over: "1",
      attackerchampion: JSON.stringify([champion(180)]),
      attackersiege: JSON.stringify({ jars: { quantity: 1 } }),
    });

    expect(attackerSave.champion).toEqual([champion(180)]);
    expect(attackerSave.siege).toEqual({ jars: { quantity: 1 } });
  });

  test("a save that does not end the attack changes neither", async () => {
    await save({ attackerchampion: JSON.stringify([champion(1)]) });

    expect(attackerSave.champion).toEqual([champion(500)]);
    expect(attackerSave.siege).toEqual({ jars: { quantity: 2 } });
  });
});

describe("the defender's monsters through the save (#23, C2)", () => {
  const HOUSING = { housed: { C1: 40, C3: 6 }, h: [["", 0, [["C1", 5, 3]]]], hid: [9], space: 120 };

  test("an attack save cannot touch them, final or not", async () => {
    defender.monsters = structuredClone(HOUSING);
    const wiped = JSON.stringify({ housed: {}, h: [], hid: [], space: 0 });

    await baseSave(ctxFor({ monsters: wiped, flinglog: JSON.stringify(LOG) }), async () => {});
    await baseSave(ctxFor({ over: "1", monsters: wiped, flinglog: JSON.stringify(LOG) }), async () => {});

    expect(defender.monsters).toEqual(HOUSING);
  });
});

describe("a replay past its deadline (#23, C5)", () => {
  test("lands nothing and leaves the attack to the finaliser", async () => {
    replayTimesOut = true;
    const caught = await baseSave(
      ctxFor({ over: "1", attackloot: JSON.stringify(CLAIM), flinglog: JSON.stringify(LOG) }),
      async () => {}
    ).catch((err: unknown) => err as { data?: { reason?: string } });

    expect(caught?.data?.reason).toBe("replayTimeout");
    expect(attackerSave.resources).toEqual({ r1: 100, r2: 100, r3: 100, r4: 100 });
    expect(defender.resources.r1).toBe(5000);
    // The row still carries the attack, for the finaliser to finish.
    expect(defender.attackid).toBe(ATTACK_ID);
  });
});

describe("the battle is the server's (#23, C3)", () => {
  // The camp, and a Booby Trap far from where the Ogres land, which never fires.
  const WITH_TRAP = { ...YARD, "3": { id: 3, t: 24, l: 1, X: -800, Y: -800 } };
  const TICK = 2_000;

  /** What the server's own replay of LOG to TICK does to the camp. */
  const serverBattle = (left = false) =>
    replayAbandonedAttack(
      battleReplayInput({
        flinglog: LOG,
        session: { attackerid: ATTACKER, attackid: ATTACK_ID, startedat: 0, entryHoused: ENTRY },
        defender: { type: "tribe", buildingdata: WITH_TRAP as never, buildinghealthdata: {}, resources: { r1: 5000, r2: 0, r3: 0, r4: 0 } },
        attacker: attackerSave,
        tick: battleTick(TICK),
        declareWar: false,
        left,
      })!
    );

  beforeEach(() => {
    defender.buildingdata = structuredClone(WITH_TRAP);
  });

  test("a crafted save's damage, health, destroyed and traps are never written", async () => {
    const battle = serverBattle();
    expect(battle.damage).toBeLessThan(100);

    await baseSave(
      ctxFor({
        over: "1",
        tick: String(TICK),
        flinglog: JSON.stringify(LOG),
        damage: "100",
        destroyed: "1",
        buildinghealthdata: JSON.stringify({ "0": 0, "1": 0, "3": 0 }),
        buildingdata: JSON.stringify({}),
        attackreport: "0:01 Flung 9999 Pokey\nResult: 100% damage, all of it",
      }),
      async () => {}
    );

    expect(defender.damage).toBe(Math.trunc(battle.damage));
    // The report is the replay's (C6), and says the battle as it went.
    expect(defender.attackreport).toBe(battle.attackreport);
    expect(String(defender.attackreport)).not.toContain("9999");
    expect(String(defender.attackreport)).not.toContain("Left the attack");
    expect(defender.destroyed).toBe(battle.destroyed);
    expect(defender.buildinghealthdata).toEqual(battle.buildinghealthdata);
    // The trap the battle never reached is still there.
    expect(defender.buildingdata["3"]).toMatchObject({ t: 24 });
  });

  test("an honest save lands exactly the figures its client showed", async () => {
    const battle = serverBattle();

    await baseSave(
      ctxFor({
        over: "1",
        tick: String(TICK),
        flinglog: JSON.stringify(LOG),
        damage: String(battle.damage),
        ...(battle.destroyed !== undefined && { destroyed: String(battle.destroyed) }),
        buildinghealthdata: JSON.stringify(battle.buildinghealthdata),
        attackloot: JSON.stringify(battle.attackloot),
      }),
      async () => {}
    );

    expect(defender.damage).toBe(Math.trunc(battle.damage));
    expect(defender.buildinghealthdata).toEqual(battle.buildinghealthdata);
    expect(attackerSave.resources.r1).toBe(100 + battle.attackloot.r1);
  });

  test("a save that says the player left gets the report's line for it, and nothing else changes", async () => {
    const battle = serverBattle(true);
    expect(battle.attackreport).toContain("Left the attack");

    await baseSave(ctxFor({ over: "1", tick: String(TICK), left: "1", flinglog: JSON.stringify(LOG) }), async () => {});

    expect(defender.attackreport).toBe(battle.attackreport);
    expect(defender.damage).toBe(Math.trunc(serverBattle().damage));
    expect(defender.buildinghealthdata).toEqual(serverBattle().buildinghealthdata);
  });

  test("a save that does not end the attack writes nothing of the battle", async () => {
    await baseSave(
      ctxFor({
        flinglog: JSON.stringify(LOG),
        damage: "100",
        buildinghealthdata: JSON.stringify({ "0": 0 }),
        buildingdata: JSON.stringify({}),
      }),
      async () => {}
    );

    expect(defender.damage).toBe(0);
    expect(defender.buildinghealthdata).toEqual({});
    expect(defender.attackreport ?? null).toBeNull();
    expect(defender.buildingdata["3"]).toMatchObject({ t: 24 });
  });
});
