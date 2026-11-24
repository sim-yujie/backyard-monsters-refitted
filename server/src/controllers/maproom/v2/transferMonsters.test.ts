import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Context } from "koa";

/**
 * `POST /worldmapv2/transferassets` (outposts plan WP0). A transfer that
 * involves an outpost needs both yards on one world, nothing moves while
 * either yard has an attack running, and the rows are locked main yard first.
 */

const ME = 2505;
const MAIN = "2000241207";
const OUTPOST = "2000241208";

type Row = Record<string, unknown>;

let saves: Row[];
let cells: Row[];
let locked: number[];
let flushed: number;
let sessions: Set<number>;

const { Save } = await import("../../../database/models/save.model.js");

const yard = (baseid: string, basesaveid: number, type: string): Row => ({
  baseid,
  basesaveid,
  type,
  userid: ME,
  saveuserid: ME,
  attackid: 0,
  attacks: [],
  monsters: { housed: { C1: 10 } },
  // One level-6 housing, room for the whole army either way.
  buildingdata: { "1": { id: 1, t: 15, l: 6 } },
  buildinghealthdata: {},
});

const em = {
  findOne: async (_entity: unknown, where: Row) => {
    locked.push(where.basesaveid as number);
    return saves.find((save) => save.basesaveid === where.basesaveid) ?? null;
  },
  persist: () => {},
  flush: async () => {
    flushed += 1;
  },
};

mock.module("../../../server.js", () => ({
  postgres: {
    em: {
      find: async (
        entity: unknown,
        where: { baseid: { $in: string[] } },
        options?: { orderBy?: { baseid: "ASC" | "DESC" } }
      ) => {
        const rows = (entity === Save ? saves : cells).filter((row) =>
          where.baseid.$in.includes(row.baseid as string)
        );
        const sign = options?.orderBy?.baseid === "DESC" ? -1 : 1;
        return rows.sort((a, b) => sign * String(a.baseid).localeCompare(String(b.baseid)));
      },
      populate: async (user: Row) => {
        user.save = saves[0];
      },
      transactional: async (run: (tx: typeof em) => Promise<unknown>) => run(em),
      // The player's main row, found by user id to count a quest (the hatch quest, patch 7.8).
      execute: async (sql: string, params: unknown[]) => {
        if (!sql.includes('bym."user"')) throw new Error("no database");
        return params[0] === ME ? [{ basesaveid: saves[0]!.basesaveid }] : [];
      },
    },
  },
  redis: {},
}));

mock.module("../../../services/base/attackSessionStore.js", () => ({
  startAttackSession: async () => {},
  readAttackSession: async (basesaveid: number) =>
    sessions.has(basesaveid) ? { attackerid: 77, attackid: 1, startedat: 0 } : null,
  endAttackSession: async () => {},
}));

const { transferMonsters } = await import("./transferMonsters.js");

/** Five C1 from the main yard to the outpost, as the web client posts it: the counts moved (#196). */
const movedBody = (from = MAIN, to = OUTPOST, moved: Record<string, number> = { C1: 5 }) => ({
  frombaseid: from,
  tobaseid: to,
  moved: JSON.stringify(moved),
});

/** Five C1 from the main yard to the outpost, as Flash posts it: both rosters in full. */
const body = (from = MAIN, to = OUTPOST) => ({
  frombaseid: from,
  tobaseid: to,
  monsters: JSON.stringify([{ housed: { C1: 5 } }, { housed: { C1: 15 } }]),
});

const run = async (request: Row) => {
  const ctx = { authUser: { userid: ME }, request: { body: request } } as unknown as Context;
  try {
    await transferMonsters(ctx, async () => {});
    return { ok: true as const, rule: undefined };
  } catch (caught) {
    return { ok: false as const, rule: (caught as { data?: { rule?: string } }).data?.rule, caught };
  }
};

beforeEach(() => {
  saves = [yard(MAIN, 2526, "main"), yard(OUTPOST, 900, "outpost")];
  cells = [
    { baseid: MAIN, world: { uuid: "world-a" } },
    { baseid: OUTPOST, world: { uuid: "world-a" } },
  ];
  locked = [];
  flushed = 0;
  sessions = new Set();
});

describe("transferMonsters, world and attack checks", () => {
  test("an outpost on another world is refused before anything is locked", async () => {
    cells[1] = { baseid: OUTPOST, world: { uuid: "world-b" } };
    const result = await run(body());
    expect(result.rule).toBe("world");
    expect(locked).toEqual([]);
    expect(flushed).toBe(0);
  });

  test("an outpost with no map cell is refused", async () => {
    cells = [cells[0]!];
    expect((await run(body())).rule).toBe("world");
  });

  test("an attack session on the outpost refuses, either direction", async () => {
    sessions.add(900);
    expect((await run(body())).rule).toBe("underAttack");
    expect((await run(body(OUTPOST, MAIN))).rule).toBe("underAttack");
    expect(flushed).toBe(0);
  });

  test("a running attack on the main yard refuses", async () => {
    Object.assign(saves[0]!, { attackid: 7, attacks: [{ starttime: Math.floor(Date.now() / 1000) - 30 }] });
    expect((await run(body())).rule).toBe("underAttack");
    expect(flushed).toBe(0);
  });

  test("a quiet same-world transfer goes through, with the main row locked first", async () => {
    const result = await run(body(OUTPOST, MAIN));
    expect(result.ok).toBe(true);
    expect(locked).toEqual([2526, 900]);
    expect(saves[0]!.monsters).toMatchObject({ housed: { C1: 15 } });
    expect(saves[1]!.monsters).toMatchObject({ housed: { C1: 5 } });
    expect(flushed).toBe(1);
  });
});

describe("transferMonsters, the move as a delta (#196)", () => {
  /** The main yard's hatchery finishes a Pokey a minute ago, after the player's map read. */
  const hatchedSinceRead = (): void => {
    const now = Math.floor(Date.now() / 1000);
    Object.assign(saves[0]!, {
      monsters: { housed: { C1: 10 }, h: [["C1", 1]], hid: [2], hstage: [1], saved: now - 60 },
      buildingdata: { "1": { id: 1, t: 15, l: 6 }, "2": { id: 2, t: 13, l: 1 } },
    });
  };

  test("moves the posted counts and keeps a monster hatched after the client's read", async () => {
    hatchedSinceRead();
    // The player saw 10 Pokeys and sent 5.
    const result = await run(movedBody());
    expect(result.ok).toBe(true);
    expect((saves[0]!.monsters as { housed: unknown }).housed).toEqual({ C1: 6 });
    expect((saves[1]!.monsters as { housed: unknown }).housed).toEqual({ C1: 15 });
  });

  test("Flash's replacement blobs move the same counts and lose nothing either", async () => {
    hatchedSinceRead();
    const result = await run(body());
    expect(result.ok).toBe(true);
    expect((saves[0]!.monsters as { housed: unknown }).housed).toEqual({ C1: 6 });
    expect((saves[1]!.monsters as { housed: unknown }).housed).toEqual({ C1: 15 });
  });

  test("refuses sending more than the yard houses, and a request with nothing to move", async () => {
    expect((await run(movedBody(MAIN, OUTPOST, { C1: 11 }))).rule).toBe("holdings");
    expect((await run({ frombaseid: MAIN, tobaseid: OUTPOST })).rule).toBe("quantities");
    expect(flushed).toBe(0);
  });
});

describe("transferMonsters, the hatch quest (patch 7.8)", () => {
  /** A daily set holding one "hatch N of `monster`" quest at 0, for today. */
  const hatchQuest = (monster: string, need: number) => ({
    v: 1,
    daily: {
      period: new Date().toISOString().slice(0, 10),
      swaps: 0,
      bonus: false,
      quests: [{ slot: 0, kind: "hatchMonster", variant: monster, need, have: 0, claimed: false, rewards: [] }],
    },
  });
  const hatchHave = () => (saves[0]!.dailyquests as { daily: { quests: { have: number }[] } }).daily.quests[0]!.have;

  test("a monster that finished hatching since the yard's last catch-up counts once, and no later catch-up counts it again", async () => {
    const { catchUpYard } = await import("../../../services/yard/catchUp.js");
    const { jobQuestEvents } = await import("../../../services/quests/hooks.js");
    const now = Math.floor(Date.now() / 1000);
    // The main yard's hatchery finished a Pokey a minute ago.
    Object.assign(saves[0]!, {
      dailyquests: hatchQuest("C1", 50),
      monsters: { housed: { C1: 10 }, h: [["C1", 1]], hid: [2], hstage: [1], saved: now - 60 },
      buildingdata: { "1": { id: 1, t: 15, l: 6 }, "2": { id: 2, t: 13, l: 1 } },
    });

    expect((await run(movedBody())).ok).toBe(true);
    expect((saves[0]!.monsters as { housed: unknown }).housed).toEqual({ C1: 6 });
    expect(hatchHave()).toBe(1);
    expect(jobQuestEvents(catchUpYard(saves[0] as never, now))).toEqual({});

    // Moving them back finds nothing new to count.
    expect((await run(movedBody(OUTPOST, MAIN))).ok).toBe(true);
    expect(hatchHave()).toBe(1);
  });
});

describe("transferMonsters, Housing finished while the outpost was closed (patch, 24 Nov 2026)", () => {
  /** The outpost's only Housing was still building at its last write, `ago` seconds back, with 30 minutes to go. */
  const closedOutpost = (ago: number): Row => {
    const now = Math.floor(Date.now() / 1000);
    return Object.assign(saves[1]!, {
      savetime: now - ago,
      monsters: { housed: {} },
      buildingdata: { "1": { id: 1, t: 15, l: 1, cB: 1800, prefab: 6 } },
    });
  };

  test("it counts once its time has passed, and the outpost's stored buildings are not changed", async () => {
    const outpost = closedOutpost(3600);
    const result = await run(movedBody());
    expect(result.ok).toBe(true);
    expect((outpost.monsters as { housed: unknown }).housed).toEqual({ C1: 5 });
    expect(outpost.buildingdata).toEqual({ "1": { id: 1, t: 15, l: 1, cB: 1800, prefab: 6 } });
  });

  test("it does not count while still building: the transfer is refused", async () => {
    const outpost = closedOutpost(60);
    const result = await run(movedBody());
    expect(result.ok).toBe(false);
    expect(result.rule).toBe("capacity");
    expect((outpost.monsters as { housed: unknown }).housed).toEqual({});
    expect(flushed).toBe(0);
  });
});

describe("transferMonsters, a resource-paid Starter Kit on an unopened outpost (patch, 24 Nov 2026)", () => {
  /**
   * The Regular kit placed with resources `ago` seconds back, the outpost not
   * opened since: its Housing is a prefab (level 2, 260) with its countdown.
   */
  const kitted = async (ago: (kitSeconds: number, housingSeconds: number) => number): Promise<Row> => {
    const { kitBuildings, starterKit } = await import("../../../services/yard/starterKit.js");
    const { buildingdata, seconds } = kitBuildings(starterKit(1)!, "resources", {});
    const housing = Object.values(buildingdata).find((building) => Number(building.t) === 15)!;
    expect(housing).toMatchObject({ prefab: 2 });
    expect(Number(housing.cB)).toBeGreaterThan(0);
    return Object.assign(saves[1]!, {
      savetime: Math.floor(Date.now() / 1000) - ago(seconds, Number(housing.cB)),
      monsters: { housed: {} },
      buildingdata,
    });
  };

  test("past the last prefab's finish, the kit's Housing takes the monsters", async () => {
    const outpost = await kitted((kitSeconds) => kitSeconds + 60);
    const stored = structuredClone(outpost.buildingdata);
    const result = await run(movedBody());
    expect(result.ok).toBe(true);
    expect((outpost.monsters as { housed: unknown }).housed).toEqual({ C1: 5 });
    expect(outpost.buildingdata).toEqual(stored);
  });

  test("before its Housing's countdown is done, the transfer is refused", async () => {
    const outpost = await kitted((_kitSeconds, housingSeconds) => housingSeconds - 60);
    const result = await run(movedBody());
    expect(result.rule).toBe("capacity");
    expect((outpost.monsters as { housed: unknown }).housed).toEqual({});
    expect(flushed).toBe(0);
  });
});
