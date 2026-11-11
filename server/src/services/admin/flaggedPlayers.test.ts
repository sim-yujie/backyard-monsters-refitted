import { describe, expect, test } from "bun:test";

import { readEntries, readEntry, summarise, type FlagYard } from "./flaggedPlayers.js";

/**
 * The Flagged list's reading of `bym.report` entries: each check's message
 * (fight, economy, attack payload) becomes a kind, an outcome, the fields or
 * rules that did not match and the base, and a row's entries sum up per
 * player. The three messages are the ones the checks write today
 * (`saveBattle.ts`, `recordVerdict.ts`, `reportManager.ts`).
 */

const at = (minute: number) => `2026-11-10T00:${String(minute).padStart(2, "0")}:00.000Z`;

describe("readEntry", () => {
  test("a refused fight: base, fields, refused", () => {
    expect(
      readEntry({
        message: "Attack save on base 201 rejected (reject): disagrees with the replay on damage, buildinghealthdata, attackloot",
        timestamp: at(4),
      }),
    ).toEqual({
      time: at(4),
      kind: "fight",
      outcome: "refused",
      fields: ["damage", "buildinghealthdata", "attackloot"],
      baseid: "201",
      message: "Attack save on base 201 rejected (reject): disagrees with the replay on damage, buildinghealthdata, attackloot",
    });
  });

  test("a fight only flagged in log mode", () => {
    expect(
      readEntry({ message: "Attack save on base 77 flagged (log): disagrees with the replay on attackersiege", timestamp: at(1) }),
    ).toMatchObject({ kind: "fight", outcome: "flagged", fields: ["attackersiege"], baseid: "77" });
  });

  test("an economy save: the rule names, once each, without their ids or details", () => {
    const message =
      'ECONOMY SAVE REJECTED (mode=reject): base 1200, 31s since the last save — overCap [12, 14] {"r1":5}; ' +
      "capMismatch; overCap [15]; pointsJumped (recorded only); and 4 more";
    expect(readEntry({ message, timestamp: at(2) })).toMatchObject({
      kind: "economy",
      outcome: "refused",
      fields: ["overCap", "capMismatch", "pointsJumped"],
      baseid: "1200",
    });
    expect(
      readEntry({ message: "ECONOMY SAVE FLAGGED (mode=log): base 9, 5s since the last save — resourceBudget", timestamp: at(3) }),
    ).toMatchObject({ kind: "economy", outcome: "flagged", fields: ["resourceBudget"], baseid: "9" });
  });

  test("a tampered attack payload, and anything else, as they are", () => {
    expect(readEntry({ message: "ATTACK VIOLATION: Attack payload was missing. Client modified.", timestamp: at(5) })).toMatchObject({
      kind: "attack",
      outcome: null,
      fields: [],
      baseid: null,
    });
    expect(readEntry({ message: "Something new", timestamp: at(6) })).toMatchObject({ kind: "other", outcome: null });
  });

  test("never throws on a broken entry; one without a message is skipped", () => {
    expect(readEntry(null)).toBeNull();
    expect(readEntry({ timestamp: at(1) })).toBeNull();
    expect(readEntry({ message: "x", timestamp: "not a time" })).toMatchObject({ time: "", kind: "other" });
  });
});

describe("readEntries", () => {
  test("newest first; the row's empty-object default reads as no entries", () => {
    const entries = readEntries([
      { message: "a", timestamp: at(1) },
      { message: "b", timestamp: at(9) },
      { message: "c", timestamp: at(5) },
    ]);
    expect(entries.map((entry) => entry.message)).toEqual(["b", "c", "a"]);
    expect(readEntries({})).toEqual([]);
    expect(readEntries(null)).toEqual([]);
  });
});

describe("summarise", () => {
  const bot: FlagYard = { baseid: "201", type: "main", owner: { userid: 201, username: "yardlord", bot: true } };
  const row = {
    userid: 552,
    report_username: "Bluetenit",
    username: "Bluetenit",
    banned: false,
    ban_reason: {},
    violations: 4,
    attack_violations: 0,
    lastupdate_at: at(30),
    report: [
      { message: "Attack save on base 201 rejected (reject): disagrees with the replay on damage, buildinghealthdata, attackloot", timestamp: at(4) },
      { message: "Attack save on base 202 rejected (reject): disagrees with the replay on buildinghealthdata, attackerchampion", timestamp: at(10) },
      { message: "Attack save on base 201 flagged (log): disagrees with the replay on attackloot", timestamp: at(12) },
      { message: "ECONOMY SAVE REJECTED (mode=reject): base 1300, 30s since the last save — overCap [12]", timestamp: at(20) },
    ],
  };

  test("counts per check and outcome, fields and yards most often first, first and last time", () => {
    const player = summarise(row, readEntries(row.report), new Map([["201", bot]]));
    expect(player).toMatchObject({
      userid: 552,
      username: "Bluetenit",
      banned: false,
      gone: false,
      violations: 4,
      attackViolations: 0,
      counts: { fight: { refused: 2, flagged: 1 }, economy: { refused: 1, flagged: 0 }, attack: 0, other: 0 },
      first: at(4),
      last: at(20),
      entries: 4,
      banReason: null,
    });
    expect(player.fields).toEqual([
      { name: "attackloot", count: 2 },
      { name: "buildinghealthdata", count: 2 },
      { name: "attackerchampion", count: 1 },
      { name: "damage", count: 1 },
      { name: "overCap", count: 1 },
    ]);
    expect(player.yards).toEqual([
      { ...bot, count: 2 },
      { baseid: "1300", owner: null, type: null, count: 1 },
      { baseid: "202", owner: null, type: null, count: 1 },
    ]);
  });

  test("a gone account keeps the report's name; a ban reason is shown", () => {
    const player = summarise(
      { ...row, username: null, banned: null, ban_reason: { message: "Cheating", timestamp: at(40) } },
      [],
      new Map(),
    );
    expect(player).toMatchObject({ username: "Bluetenit", gone: true, banned: false, first: null, last: null, entries: 0 });
    expect(player.banReason).toEqual({ message: "Cheating", time: at(40) });
  });
});
