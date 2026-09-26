import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAttackData, loadAttack, saveAttack, viewBase } from "./base";
import type { AttackData, BaseLoadResponse } from "./types";
import type { AttackRoster } from "@/game/attack/attackTarget";
import { ATTACK_CHAMPION_PROPS, ATTACK_MONSTER_PROPS } from "@/game/attack/attackStats";

/** A real own-yard load of the sandbox account, captured from the dev server. */
const sandbox = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../test/fixtures/baseload-sandbox-yard.json", import.meta.url)),
    "utf8",
  ),
) as BaseLoadResponse;

/**
 * What the server was actually sent.
 *
 * The three calls are form posts, so the thing worth testing is the thing the
 * server has to agree with: the path, the `type`, and structure
 * JSON-stringified into a single form field rather than sent as nested JSON.
 */
const sent: { url: string; body: URLSearchParams }[] = [];

const stubFetch = (payload: Record<string, unknown> = {}): void => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit) => {
      sent.push({ url, body: new URLSearchParams(String(init.body)) });
      return Promise.resolve(
        new Response(JSON.stringify({ error: 0, ...payload }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }),
  );
};

afterEach(() => {
  vi.unstubAllGlobals();
  sent.length = 0;
});

/**
 * The sandbox yard's own roster, as the map would gather it: its housed
 * monsters (`monsters.housed`) at its academy levels, and both its champions.
 */
const sandboxRoster = (): AttackRoster => {
  const housed = (sandbox.monsters?.housed ?? {}) as Record<string, number>;
  const levels: Record<string, number> = {};
  for (const [id, entry] of Object.entries(sandbox.academy ?? {})) {
    if (typeof entry?.level === "number") levels[id] = entry.level;
  }
  return {
    monsters: housed,
    levels,
    champions: sandbox.champion ?? [],
    flingerLevel: 4,
    catapultLevel: 1,
    sources: [{ baseid: sandbox.baseid, m: sandbox.monsters ?? {} }],
    siege: null,
  };
};

describe("buildAttackData", () => {
  it("declares every housed monster type with its count and full stat block", () => {
    const data = buildAttackData(sandboxRoster());

    expect(data.monsters.map((monster) => [monster.id, monster.count])).toEqual([
      ["C14", 25],
      ["C15", 2],
    ]);
    // The whole block, not the combat subset: the server compares every key
    // of its own `props`, including the hatching and training ladders.
    expect(data.monsters[0]!.stats).toEqual(ATTACK_MONSTER_PROPS["C14"]);
    for (const key of ["speed", "health", "damage", "cTime", "cResource", "cStorage", "bucket", "targetGroup", "hTime", "hResource"]) {
      expect(data.monsters[0]!.stats).toHaveProperty(key);
    }
  });

  it("declares every owned champion as G<t> with its full prop block", () => {
    const data = buildAttackData(sandboxRoster());

    expect(data.champions.map((champion) => champion.type)).toEqual(["G5", "G3"]);
    expect(data.champions[0]!.stats).toEqual(ATTACK_CHAMPION_PROPS["G5"]!.props);
    for (const key of ["healtime", "feedShiny", "offset_x", "bonusFeedTime", "movement", "attack"]) {
      expect(data.champions[0]!.stats).toHaveProperty(key);
    }
  });

  it("leaves out an id the stat table does not know rather than sending it", () => {
    const roster: AttackRoster = {
      monsters: { C1: 3, XX: 9 },
      levels: {},
      champions: [{ t: 9, hp: 1, l: 1, ft: 0, fd: 0, fb: 0, pl: 0, status: 0 }],
      flingerLevel: 1,
      catapultLevel: 0,
      sources: [],
      siege: null,
    };
    const data = buildAttackData(roster);
    expect(data.monsters.map((monster) => monster.id)).toEqual(["C1"]);
    expect(data.champions).toEqual([]);
  });

  it("skips a zero count", () => {
    const data = buildAttackData({ ...sandboxRoster(), monsters: { C1: 0, C2: 4 } });
    expect(data.monsters.map((monster) => monster.id)).toEqual(["C2"]);
  });
});

describe("loadAttack", () => {
  it("posts wmattack for a wild monster camp with attackData as one JSON field", async () => {
    stubFetch({ attackid: 4711, basesaveid: 9, buildingdata: {} });
    const response = await loadAttack("21970243208", "wild", sandboxRoster());

    const call = sent[0]!;
    expect(call.url).toContain("/base/load");
    expect(call.body.get("type")).toBe("wmattack");
    expect(call.body.get("baseid")).toBe("21970243208");
    expect(call.body.get("mapversion")).toBe("2");

    const data = JSON.parse(String(call.body.get("attackData"))) as AttackData;
    expect(data).toEqual(buildAttackData(sandboxRoster()));
    expect(response.attackid).toBe(4711);
  });

  it("posts attack for a player's main yard and for an outpost", async () => {
    stubFetch();
    await loadAttack("1000", "main", sandboxRoster());
    await loadAttack("1001", "outpost", sandboxRoster());
    expect(sent.map((call) => call.body.get("type"))).toEqual(["attack", "attack"]);
  });
});

describe("viewBase", () => {
  it("sends view for a player cell with no attackData", async () => {
    stubFetch();
    await viewBase("1000", "main");

    const call = sent[0]!;
    expect(call.url).toContain("/base/load");
    expect(call.body.get("type")).toBe("view");
    expect(call.body.get("baseid")).toBe("1000");
    expect(call.body.has("attackData")).toBe(false);
  });

  it("sends wmview for a wild monster camp with no attackData", async () => {
    stubFetch();
    await viewBase("21970243208", "wild");
    expect(sent[0]!.body.get("type")).toBe("wmview");
    expect(sent[0]!.body.has("attackData")).toBe(false);
  });
});

describe("saveAttack", () => {
  it("posts each structured field as its own JSON string and the scalars as strings", async () => {
    stubFetch({ basesaveid: 9 });
    await saveAttack({
      baseid: "21970243208",
      basesaveid: 9,
      attackid: 4711,
      over: true,
      buildinghealthdata: { "3": 120 },
      damage: 42,
      destroyed: 0,
      attackloot: { r1: 10, r2: 0, r3: 0, r4: 0 },
      resources: { r1: -10, r2: 0, r3: 0, r4: 0 },
      attackreport: "Flung 25 C14",
      flinglog: { v: 1, seed: 7, events: [] },
    });

    const call = sent[0]!;
    expect(call.url).toContain("/base/save");
    expect(call.body.get("baseid")).toBe("21970243208");
    expect(call.body.get("basesaveid")).toBe("9");
    expect(call.body.get("attackid")).toBe("4711");
    expect(call.body.get("over")).toBe("1");
    expect(call.body.get("buildinghealthdata")).toBe('{"3":120}');
    expect(call.body.get("damage")).toBe("42");
    expect(call.body.get("destroyed")).toBe("0");
    expect(call.body.get("attackloot")).toBe('{"r1":10,"r2":0,"r3":0,"r4":0}');
    expect(call.body.get("resources")).toBe('{"r1":-10,"r2":0,"r3":0,"r4":0}');
    expect(call.body.get("attackreport")).toBe("Flung 25 C14");
    expect(JSON.parse(String(call.body.get("flinglog")))).toEqual({ v: 1, seed: 7, events: [] });
  });

  it("sends nothing for a field that was not given", async () => {
    stubFetch({ basesaveid: 9 });
    await saveAttack({ baseid: "1000", basesaveid: 9, attackid: 1 });

    const call = sent[0]!;
    expect([...call.body.keys()].sort()).toEqual(["attackid", "baseid", "basesaveid"]);
  });

  it("sends over as 0 when the attack continues", async () => {
    stubFetch({ basesaveid: 9 });
    await saveAttack({ baseid: "1000", basesaveid: 9, attackid: 1, over: false });
    expect(sent[0]!.body.get("over")).toBe("0");
  });
});
