import { describe, expect, it } from "vitest";
import type { FriendTestReplay, FriendTestRow, FriendTestStart } from "@/api/baiterTests";
import type { BaseLoadResponse } from "@/api/types";
import { friendLineBaiter, friendNoticeText } from "@/game/friends/friendText";
import { armySize, emptyArmy, type TestArmy } from "./baiterSession";
import { armyBody, friendTarget, friendTitle, ownerRunOf, reportOf, testerReport, testerRunOf } from "./friendTest";
import type { TestReport } from "./testReport";

const yard = (): BaseLoadResponse =>
  ({
    baseid: "250300",
    buildingdata: { "1": { id: 1, t: 14, l: 3, X: 0, Y: 0 } },
    buildinghealthdata: {},
    resources: {},
    defenderforces: { bunkers: [] },
  }) as unknown as BaseLoadResponse;

const army = (rows: Record<string, [number, number]>): TestArmy => {
  const base = emptyArmy({ academy: {} } as BaseLoadResponse);
  const monsters = { ...base.monsters };
  for (const [id, [count, level]] of Object.entries(rows)) monsters[id] = { count, level };
  return { monsters, champions: [] };
};

const start = (cap = 600): FriendTestStart =>
  ({
    error: 0,
    token: "ticket-1",
    seed: 99,
    cap,
    baiterLevel: 1,
    inviter: { userid: 2503, name: "yardtester" },
    expiresAt: 2_000,
    load: yard(),
  }) as FriendTestStart;

const row = (extra: Partial<FriendTestRow> = {}): FriendTestRow => ({
  id: 5,
  tester: { userid: 2505, name: "agenttester", pic: null },
  foughtAt: 1_000,
  damage: 37,
  result: "held",
  seconds: 161,
  rulesVersion: "r1",
  hasReport: true,
  hasReplay: true,
  playable: true,
  ...extra,
});

describe("a friend's test (beta 9 #4)", () => {
  it("sends the server only rows with something in them, each at a level the monster has", () => {
    expect(armyBody(army({ C1: [10, 9], C2: [0, 3] }))).toEqual({ monsters: { C1: { count: 10, level: 6 } }, champions: [] });
  });

  it("the tester's run: their yard as served, the ticket and seed, the army cut to THEIR cap", () => {
    const run = testerRunOf(start(600), army({ C1: [100, 1] }));
    expect(run.save.baseid).toBe("250300");
    expect(armySize(run.army)).toBeLessThanOrEqual(600);
    expect(run.army.monsters["C1"]!.count).toBe(60);
    expect(run.friend).toEqual({
      role: "tester",
      inviter: { userid: 2503, name: "yardtester" },
      token: "ticket-1",
      seed: 99,
      cap: 600,
      expiresAt: 2_000,
    });
  });

  it("fights their yard as a main yard, with the test army and no Monster Lab ranks", () => {
    const save = { ...yard(), academy: { C1: { level: 6, powerup: 3 } } } as unknown as BaseLoadResponse;
    const run = { ...testerRunOf(start(), army({ C1: [5, 2] })), save };
    const target = friendTarget(run, run.friend!);
    expect(target).toMatchObject({ kind: "main", name: "yardtester", baseid: "250300" });
    expect(target.roster.monsters).toEqual({ C1: 5 });
    expect(target.roster.levels["C1"]).toBe(2);
    expect(target.roster.ranks).toBeUndefined();
    expect(target.load?.defenderforces).toEqual({ bunkers: [] });
  });

  it("titles the screen by whose yard it is", () => {
    const tester = testerRunOf(start(), army({})).friend!;
    expect(friendTitle(tester, false)).toBe("Testing yardtester's yard");
    expect(friendTitle(tester, true)).toBe("Test replay: yardtester's yard");
    expect(friendTitle({ role: "owner", tester: "agenttester", testId: 5 }, true)).toBe("Test by agenttester");
  });

  it("the tester's report says THEIR yard held", () => {
    const report = { result: "held", resultLine: "Your yard held" } as TestReport;
    expect(testerReport(report).resultLine).toBe("Their yard held");
    expect(testerReport({ ...report, result: "time", resultLine: "Time ran out" }).resultLine).toBe("Time ran out");
  });

  describe("the owner watching a kept test", () => {
    const replay = (test: FriendTestRow, report: unknown = null): FriendTestReplay =>
      ({
        error: 0,
        test,
        replay: {
          v: 1,
          load: yard(),
          seed: 7,
          events: [{ kind: "fling", t: 80, x: 1, y: 2, r: 0, monsters: { C1: 3 } }, { junk: true }],
          tick: 24_000,
          levels: { C1: 4 },
          army: { monsters: { C1: { count: 3, level: 4 } }, champions: [{ t: 1, l: 2, pl: 0 }] },
          report,
        },
      }) as unknown as FriendTestReplay;

    it("plays the kept yard, seed and drops, with the army it was fought with", () => {
      const run = ownerRunOf(replay(row(), { result: "held", resultLine: "Your yard held", damagePercent: 37 }), "r1")!;
      expect(run.friend).toEqual({ role: "owner", tester: "agenttester", testId: 5 });
      expect(run.replay).toMatchObject({ seed: 7, endTick: 24_000 });
      expect(run.replay!.events).toHaveLength(1);
      expect(run.army.monsters["C1"]).toEqual({ count: 3, level: 4 });
      expect(run.army.champions).toEqual([{ t: 1, l: 2, pl: 0 }]);
      expect(run.replay!.report.resultLine).toBe("Your yard held");
    });

    it("is not offered when the game's rules changed since", () => {
      expect(ownerRunOf(replay(row()), "r2")).toBeNull();
      expect(ownerRunOf(replay(row({ playable: false })), "r1")).toBeNull();
    });

    it("a test kept without the tester's report shows the list's figures", () => {
      const report = reportOf(row({ result: "time", damage: 61, seconds: 300 }), null);
      expect(report).toMatchObject({ result: "time", resultLine: "Time ran out", damagePercent: 61, time: "5:00" });
    });
  });

  it("notices: an invite opens Invited me, a test of the yard opens Results", () => {
    expect(friendNoticeText({ event: "baiterInvite", username: "yardtester" })).toBe("yardtester invited you to test their yard (24 h).");
    expect(friendNoticeText({ event: "baiterTest", username: "agenttester", damage: 37.9 })).toBe(
      "agenttester tested your yard: 37% damage. Watch it in your Baiter.",
    );
    expect(friendLineBaiter([{ event: "baiterInvite" }])).toBe("invitedMe");
    expect(friendLineBaiter([{ event: "baiterTest" }, { event: "gift" }])).toBe("results");
    expect(friendLineBaiter([{ event: "gift" }])).toBeNull();
  });
});
