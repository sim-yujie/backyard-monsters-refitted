import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

/**
 * The attack gate and old pages (beta 10, owner's pick B+, 27 Nov 2026): a
 * page left open across a release that changed monster numbers is told to
 * reload ("New version"), never banned, while a stat changed by hand still
 * bans as before.
 *
 * "The server changed" is played by editing the server's live table in place
 * (and putting it back after each test); the page's payload is the beta 9
 * table as `buildAttackData` sends it, which is also the kept snapshot.
 */

// The gate does nothing on a local server: play a deployed one.
process.env.ENV = "test";

const banned: string[] = [];
const logAttackViolation = mock(async (user: { banned?: boolean }, message: string) => {
  user.banned = true;
  banned.push(message);
});
mock.module("../base/reportManager.js", () => ({ logAttackViolation }));

const info = mock((..._args: unknown[]) => {});
mock.module("../../utils/logger.js", () => ({
  logger: { info, warn: mock(() => {}), error: mock(() => {}), debug: mock(() => {}) },
}));

const { validateAttack } = await import("./validateAttack.js");
const { monsterStats } = await import("../../game-data/stats/monsterStats.js");
const { championStats } = await import("../../game-data/stats/championStats.js");
const { CURRENT_ATTACK_STATS, ATTACK_STATS_VERSION } = await import("../../game-data/stats/attackStatsVersion.js");
const { PAST_ATTACK_STATS } = await import("../../game-data/stats/pastAttackStats.js");

type Payload = {
  monsters: { id: string; count: number; stats: Record<string, unknown> }[];
  champions: { type: string; stats: Record<string, unknown> }[];
};

/** What a page holding today's table sends for these monsters and champions (`buildAttackData`). */
const pagePayload = (monsters: string[], champions: string[] = []): Payload =>
  structuredClone({
    monsters: monsters.map((id) => ({ id, count: 5, stats: { ...CURRENT_ATTACK_STATS.monsters[id] } })),
    champions: champions.map((type) => ({ type, stats: { ...CURRENT_ATTACK_STATS.champions[type]!.props } })),
  });

const newUser = () => ({ userid: 2503, username: "yardtester", banned: false });

/** The outcome of an attack start: "ok", the refusal's reason, or "banned". */
const outcome = async (payload: Payload, user = newUser()): Promise<string> => {
  try {
    await validateAttack(user as never, payload as never, 2 as never, { route: "base/load:wmattack" });
    return user.banned ? "banned?" : "ok";
  } catch (err) {
    if (user.banned) return "banned";
    return (err as { data?: { reason?: string } }).data?.reason ?? String(err);
  }
};

// Every server-side edit a test makes is undone after it.
const saved = structuredClone({ monsters: monsterStats, champions: championStats });
afterEach(() => {
  for (const [id, stat] of Object.entries(saved.monsters)) monsterStats[id]!.props = structuredClone(stat.props);
  for (const id of Object.keys(monsterStats)) if (!(id in saved.monsters)) delete monsterStats[id];
  for (const [id, stat] of Object.entries(saved.champions)) championStats[id]!.props = structuredClone(stat.props);
});
beforeEach(() => {
  banned.length = 0;
  logAttackViolation.mockClear();
  info.mockClear();
});

describe("the beta 9 snapshot", () => {
  test("is kept, and today's table is it", () => {
    expect(PAST_ATTACK_STATS.map((one) => one.version)).toContain(ATTACK_STATS_VERSION);
  });
});

describe("an attack start from a current page", () => {
  test("goes on", async () => {
    expect(await outcome(pagePayload(["C1", "C5", "IC2"], ["G1", "G3"]))).toBe("ok");
    expect(logAttackViolation).not.toHaveBeenCalled();
  });
});

describe("an old page after a release that changed only training and hatching numbers", () => {
  test("is told to reload, never banned (acceptance check 1)", async () => {
    // The beta 10 kind of change: Ichi hatches 20% slower and costs 10% more goo, and so on.
    const page = pagePayload(["C1", "C8", "C13"], ["G2"]);
    for (const id of ["C1", "C8", "C13"]) {
      const props = monsterStats[id]!.props as unknown as Record<string, number[]>;
      for (const key of ["cTime", "cResource", "hTime", "hResource"]) {
        props[key] = props[key]!.map((value) => Math.round(value * 1.2 + 1));
      }
    }

    const user = newUser();
    expect(await outcome(page, user)).toBe("newVersion");
    expect(user.banned).toBe(false);
    expect(logAttackViolation).not.toHaveBeenCalled();
    expect(info.mock.calls[0]![1]).toMatchObject({
      event: "attack-start-old-page",
      reason: "stats",
      route: "base/load:wmattack",
      username: "yardtester",
    });
  });

  test("a champion's feeding numbers alone: reload, not ban", async () => {
    const page = pagePayload([], ["G1"]);
    championStats.G1!.props.feedCount = championStats.G1!.props.feedCount.map((n) => n + 1);
    championStats.G1!.props.healtime = championStats.G1!.props.healtime.map((n) => n * 2);
    expect(await outcome(page)).toBe("newVersion");
    expect(logAttackViolation).not.toHaveBeenCalled();
  });

  test("a stat the server added since: the old page sends none, reload", async () => {
    const page = pagePayload(["C1"]);
    (monsterStats.C1!.props as unknown as Record<string, number[]>).hBonus = [1, 2, 3];
    expect(await outcome(page)).toBe("newVersion");
  });
});

describe("an old page after a release that changed a combat number", () => {
  test("holding a shipped table's ladder: reload, not ban", async () => {
    const page = pagePayload(["C1"]);
    monsterStats.C1!.props.health = monsterStats.C1!.props.health.map((n) => n + 50);
    expect(await outcome(page)).toBe("newVersion");
    expect(logAttackViolation).not.toHaveBeenCalled();
  });

  test("naming a monster the server has since dropped: reload", async () => {
    const page = pagePayload(["C1", "C2"]);
    const c2 = monsterStats.C2!;
    delete monsterStats.C2;
    try {
      expect(await outcome(page)).toBe("newVersion");
    } finally {
      monsterStats.C2 = c2;
    }
  });
});

describe("a page that changed a stat by hand", () => {
  test("a combat stat no table ever held still bans (control)", async () => {
    const page = pagePayload(["C1"]);
    page.monsters[0]!.stats.damage = [999, 999, 999, 999, 999, 999];
    const user = newUser();
    expect(await outcome(page, user)).toBe("banned");
    expect(banned[0]).toContain("C1's stat 'damage' was modified");
  });

  test("still bans when it also carries an old economy ladder", async () => {
    const page = pagePayload(["C1", "C3"]);
    monsterStats.C3!.props.hTime = [99];
    page.monsters[0]!.stats.health = [1e6, 1e6, 1e6, 1e6, 1e6, 1e6];
    expect(await outcome(page)).toBe("banned");
    expect(banned[0]).toContain("'health'");
  });

  test("a champion's combat stat no table ever held bans", async () => {
    const page = pagePayload([], ["G1"]);
    page.champions[0]!.stats.damage = [1, 2, 3, 4, 5, 6];
    expect(await outcome(page)).toBe("banned");
  });

  test("a stat sent as text instead of numbers bans, not crashes", async () => {
    const page = pagePayload(["C1"]);
    page.monsters[0]!.stats.speed = ["fast"];
    expect(await outcome(page)).toBe("banned");
  });

  test("an unknown monster id no table knew bans", async () => {
    const page = pagePayload(["C1"]);
    page.monsters.push({ id: "C999", count: 1, stats: {} });
    expect(await outcome(page)).toBe("banned");
  });

  test("an economy ladder changed by hand is refused, not banned: the server reads none of it", async () => {
    const page = pagePayload(["C1"]);
    page.monsters[0]!.stats.cResource = [1, 1, 1, 1, 1, 1];
    expect(await outcome(page)).toBe("newVersion");
    expect(logAttackViolation).not.toHaveBeenCalled();
  });
});
