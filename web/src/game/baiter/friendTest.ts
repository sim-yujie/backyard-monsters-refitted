import type { FriendTestPayload, FriendTestReplay, FriendTestRow, FriendTestStart } from "@/api/baiterTests";
import type { AttackTarget } from "@/game/attack/attackTarget";
import type { FlingEvent } from "@/game/combat/rules";
import { CLIENT_RULES_VERSION } from "@/game/defences/defenceWatch";
import { rulesPlay } from "@/game/combat/rules/rulesCompat";
import {
  TEST_ROSTER,
  clampArmy,
  clampLevel,
  testRoster,
  type BaiterRun,
  type TestArmy,
  type TestChampion,
} from "./baiterSession";
import type { TestReport, TestResult } from "./testReport";

/**
 * A friend's test of a yard (beta 9 feature #4): the Baiter scene fighting
 * on ANOTHER player's main yard, served by the server, or the yard's owner
 * watching such a test again.
 *
 * - **tester**: the yard comes from `POST /baiter/test/start` with its seed
 *   and the inviter's cap; the test army is capped by THEIR Baiter; when it
 *   ends the drops go back with `POST /baiter/test/finish`, where the server
 *   fights it again and keeps it for the inviter.
 * - **owner**: a kept test from the Results tab, played back with the seed,
 *   the drops and the yard the server kept, and the tester's report.
 *
 * Nothing about a friend test reaches either player's yard: the scene's own
 * practice rules apply (nothing saved, nothing looted).
 */

/** The tester's side: whose yard, the ticket, the seed, the cap. */
export interface FriendTesterRun {
  readonly role: "tester";
  readonly inviter: { readonly userid: number; readonly name: string };
  readonly token: string;
  readonly seed: number;
  readonly cap: number;
  readonly expiresAt: number;
}

/** The owner's side: who tested, which kept test. */
export interface FriendOwnerRun {
  readonly role: "owner";
  readonly tester: string;
  readonly testId: number;
}

export type FriendRun = FriendTesterRun | FriendOwnerRun;

/** A test army as the server reads it: rows with something in them, and the champions. */
export const armyBody = (army: TestArmy): { monsters: Record<string, { count: number; level: number }>; champions: TestChampion[] } => {
  const monsters: Record<string, { count: number; level: number }> = {};
  for (const id of TEST_ROSTER) {
    const row = army.monsters[id];
    const count = Math.max(0, Math.floor(row?.count ?? 0));
    if (row && count > 0) monsters[id] = { count, level: clampLevel(id, row.level) };
  }
  return { monsters, champions: [...army.champions] };
};

/** The tester's run from the server's start answer, the army clamped to the inviter's cap. */
export const testerRunOf = (start: FriendTestStart, army: TestArmy): BaiterRun => ({
  save: start.load,
  army: clampArmy(army, start.cap),
  baiterLevel: start.baiterLevel,
  friend: {
    role: "tester",
    inviter: start.inviter,
    token: start.token,
    seed: start.seed,
    cap: start.cap,
    expiresAt: start.expiresAt,
  },
});

/** The army a kept test was fought with, read back from its payload. */
const payloadArmy = (payload: FriendTestPayload): TestArmy => {
  const sent = (payload.army ?? {}) as { monsters?: Record<string, { count?: number; level?: number }>; champions?: TestChampion[] };
  const monsters: Record<string, { count: number; level: number }> = {};
  for (const id of TEST_ROSTER) {
    const row = sent.monsters?.[id];
    monsters[id] = { count: Math.max(0, Math.floor(Number(row?.count ?? 0))), level: clampLevel(id, Number(row?.level ?? payload.levels[id] ?? 1)) };
  }
  return { monsters, champions: Array.isArray(sent.champions) ? sent.champions : [] };
};

const RESULT_LINES: Readonly<Record<TestResult, string>> = {
  held: "Your yard held",
  flattened: "Flattened",
  time: "Time ran out",
  stopped: "Stopped",
};

const clock = (seconds: number): string => {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};

/** A kept report, or a short one built from the list's figures when the server kept none. */
export const reportOf = (test: FriendTestRow, kept: unknown): TestReport => {
  if (kept && typeof kept === "object" && typeof (kept as TestReport).resultLine === "string") return kept as TestReport;
  return {
    result: test.result,
    resultLine: RESULT_LINES[test.result],
    damagePercent: test.damage,
    buildingsDestroyed: 0,
    buildingsTotal: 0,
    time: clock(test.seconds),
    attackersSent: 0,
    attackersBeaten: 0,
    champions: [],
    hint: null,
    towers: [],
    traps: [],
    bunkers: [],
    cagedChampions: [],
    attackers: [],
  };
};

/** The owner's run to watch a kept test, or null when this client cannot play it (a game update since). */
export const ownerRunOf = (answer: FriendTestReplay, ours: string = CLIENT_RULES_VERSION): BaiterRun | null => {
  const { test, replay } = answer;
  if (!test.playable || replay?.v !== 1 || !rulesPlay(test.rulesVersion, ours)) return null;
  const events = replay.events.filter((event): event is FlingEvent => {
    const { kind, t } = (event ?? {}) as { kind?: unknown; t?: unknown };
    return typeof kind === "string" && typeof t === "number" && Number.isFinite(t);
  });
  return {
    save: replay.load,
    army: payloadArmy(replay),
    baiterLevel: 0,
    replay: { seed: replay.seed, events, endTick: replay.tick, report: reportOf(test, replay.report) },
    friend: { role: "owner", tester: test.tester.name, testId: test.id },
  };
};

/**
 * The attack scene's target for a friend test: the other player's main yard
 * as the server served it (its defenders included), fought as a main yard,
 * with the test army and no Monster Lab ranks (a made-up army, as the server
 * fights it).
 */
export const friendTarget = (run: BaiterRun, friend: FriendRun): AttackTarget => {
  const load = { ...run.save };
  delete load.attackerbrains;
  delete load.attackerhealth;
  return {
    baseid: String(run.save.baseid ?? ""),
    kind: "main",
    name: friend.role === "tester" ? friend.inviter.name : "your yard",
    load,
    roster: testRoster(run.army),
  };
};

/** The strip's title: whose yard is under test, or who tested yours. */
export const friendTitle = (friend: FriendRun, replaying: boolean): string =>
  friend.role === "tester"
    ? replaying
      ? `Test replay: ${friend.inviter.name}'s yard`
      : `Testing ${friend.inviter.name}'s yard`
    : `Test by ${friend.tester}`;

/** The tester's report reads as THEIR yard, not the tester's own. */
export const testerReport = (report: TestReport): TestReport =>
  report.result === "held" ? { ...report, resultLine: "Their yard held" } : report;
