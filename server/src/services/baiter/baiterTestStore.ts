import { gunzipSync, gzipSync } from "node:zlib";

import type { EntityManager } from "@mikro-orm/postgresql";

import type { FlingLog } from "../../game-rules/combat/index.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { blockedIdsOf } from "../friends/friendRules.js";
import { CARD_COLUMNS, CARD_JOIN, cardOf, placeholders, type CardRow } from "../friends/friendViews.js";
import { MAX_REPLAY_BYTES, MAX_REPLAY_RAW_BYTES } from "../defences/defenceReplayStore.js";
import { INVITE_SECONDS, RESULT_KEEP_SECONDS, RESULT_LIMIT, type TestResult } from "./baiterTestRules.js";

/**
 * Where friend tests live (beta 9 feature #4): `bym.baiter_invite`, one row per
 * inviter and tester while an invite is open, and `bym.baiter_test`, one row
 * per finished test of the inviter's main yard, with its replay
 * (migration `20261204_CreateBaiterTestTables.ts`). Plain SQL, as the friends
 * tables are; every function takes the entity manager and the time, so they
 * run under test.
 */

const at = (seconds: number): Date => new Date(seconds * 1000);
const secondsOf = (value: Date | string | number | null | undefined): number =>
  value === null || value === undefined ? 0 : Math.floor(new Date(value).getTime() / 1000);

/* ── Who may be invited ─────────────────────────────────────────────────── */

/** One player the inviter may invite: a friend, an alliance mate or both. */
export interface Candidate {
  userid: number;
  username: string;
  pic: string | null;
  photo: number | null;
  level: number;
  friend: boolean;
  alliance: boolean;
}

/** A player's account facts the checks read. */
interface AccountRow {
  userid: number | string;
  banned: boolean;
  blocked_users: unknown;
  alliance_id: number | string | null;
}

const accounts = async (em: EntityManager, ids: readonly number[]): Promise<Map<number, AccountRow>> => {
  if (ids.length === 0) return new Map();
  const rows = await em.execute<AccountRow[]>(
    `SELECT userid, banned, blocked_users, alliance_id FROM bym."user" WHERE userid IN (${placeholders(ids)})`,
    [...ids]
  );
  return new Map(rows.map((row) => [Number(row.userid), row]));
};

const allianceOf = (row: AccountRow | undefined): number => Math.max(0, Number(row?.alliance_id ?? 0) || 0);

/**
 * Whether `tester` may test `inviter`'s yard now: two accounts, neither
 * banned, neither blocking the other, and friends or in the same alliance.
 * Read fresh on every invite and every test: a friendship that ended or an
 * alliance left ends the right to test with it.
 */
export const mayTest = async (em: EntityManager, inviter: number, tester: number): Promise<boolean> => {
  if (inviter === tester) return false;
  const found = await accounts(em, [inviter, tester]);
  const a = found.get(inviter);
  const b = found.get(tester);
  if (!a || !b || a.banned || b.banned) return false;
  if (blockedIdsOf(a.blocked_users).includes(tester) || blockedIdsOf(b.blocked_users).includes(inviter)) return false;
  const alliance = allianceOf(a);
  if (alliance > 0 && alliance === allianceOf(b)) return true;
  const [link] = await em.execute(`SELECT 1 FROM bym.friend WHERE userid = ? AND friend_userid = ?`, [inviter, tester]);
  return Boolean(link);
};

/** The inviter's friends and alliance mates, each once, in name order. */
export const candidatesOf = async (em: EntityManager, inviter: number): Promise<Candidate[]> => {
  const [me] = (await accounts(em, [inviter])).values();
  const alliance = allianceOf(me);
  const rows = await em.execute<(CardRow & { banned: boolean; blocked_users: unknown; friend: boolean; mate: boolean })[]>(
    `SELECT ${CARD_COLUMNS}, u.banned, u.blocked_users,
            (f.userid IS NOT NULL) AS friend,
            (? > 0 AND u.alliance_id = ?) AS mate
       FROM ${CARD_JOIN}
       LEFT JOIN bym.friend f ON f.userid = ? AND f.friend_userid = u.userid
      WHERE u.userid <> ?
        AND (f.userid IS NOT NULL OR (? > 0 AND u.alliance_id = ?))
      ORDER BY lower(u.username), u.userid
      LIMIT 400`,
    [alliance, alliance, inviter, inviter, alliance, alliance]
  );
  const blocked = new Set(blockedIdsOf(me?.blocked_users));
  return rows
    .filter((row) => !row.banned && !blocked.has(Number(row.userid)) && !blockedIdsOf(row.blocked_users).includes(inviter))
    .map((row) => ({ ...cardOf(row), friend: Boolean(row.friend), alliance: Boolean(row.mate) }));
};

/* ── Invites ────────────────────────────────────────────────────────────── */

/** An open invite, from either side. */
export interface InviteRow {
  inviter: number;
  tester: number;
  createdAt: number;
  expiresAt: number;
  tests: number;
}

interface InviteDbRow {
  inviter_userid: number | string;
  tester_userid: number | string;
  created_at: Date;
  expires_at: Date;
  tests: number | string;
}

const inviteOf = (row: InviteDbRow): InviteRow => ({
  inviter: Number(row.inviter_userid),
  tester: Number(row.tester_userid),
  createdAt: secondsOf(row.created_at),
  expiresAt: secondsOf(row.expires_at),
  tests: Number(row.tests) || 0,
});

/**
 * Opens (or renews for another 24 h) an invite to each of `testers`. A renewed
 * invite keeps its test count.
 */
export const openInvites = async (em: EntityManager, inviter: number, testers: readonly number[], now: number): Promise<void> => {
  for (const tester of testers) {
    await em.execute(
      `INSERT INTO bym.baiter_invite (inviter_userid, tester_userid, created_at, expires_at, tests)
       VALUES (?, ?, ?, ?, 0)
       ON CONFLICT (inviter_userid, tester_userid)
       DO UPDATE SET created_at = EXCLUDED.created_at, expires_at = EXCLUDED.expires_at,
                     tests = CASE WHEN bym.baiter_invite.expires_at > ? THEN bym.baiter_invite.tests ELSE 0 END`,
      [inviter, tester, at(now), at(now + INVITE_SECONDS), at(now)]
    );
  }
};

/** Ends an invite at once; true when there was an open one. */
export const closeInvite = async (em: EntityManager, inviter: number, tester: number, now: number): Promise<boolean> => {
  const rows = await em.execute<{ tester_userid: number }[]>(
    `DELETE FROM bym.baiter_invite WHERE inviter_userid = ? AND tester_userid = ? AND expires_at > ? RETURNING tester_userid`,
    [inviter, tester, at(now)]
  );
  return rows.length > 0;
};

/** The inviter's open invites, soonest to lapse last. */
export const invitesSent = async (em: EntityManager, inviter: number, now: number): Promise<InviteRow[]> =>
  (
    await em.execute<InviteDbRow[]>(
      `SELECT * FROM bym.baiter_invite WHERE inviter_userid = ? AND expires_at > ? ORDER BY expires_at DESC`,
      [inviter, at(now)]
    )
  ).map(inviteOf);

/** The open invites to `tester`, newest first. */
export const invitesReceived = async (em: EntityManager, tester: number, now: number): Promise<InviteRow[]> =>
  (
    await em.execute<InviteDbRow[]>(
      `SELECT * FROM bym.baiter_invite WHERE tester_userid = ? AND expires_at > ? ORDER BY expires_at DESC`,
      [tester, at(now)]
    )
  ).map(inviteOf);

/** The open invite from `inviter` to `tester`, or null. */
export const openInvite = async (em: EntityManager, inviter: number, tester: number, now: number): Promise<InviteRow | null> => {
  const [row] = await em.execute<InviteDbRow[]>(
    `SELECT * FROM bym.baiter_invite WHERE inviter_userid = ? AND tester_userid = ? AND expires_at > ?`,
    [inviter, tester, at(now)]
  );
  return row ? inviteOf(row) : null;
};

/** Counts one more test on the invite; the new count, or null when the invite is gone. */
export const countTest = async (em: EntityManager, inviter: number, tester: number): Promise<number | null> => {
  const [row] = await em.execute<{ tests: number }[]>(
    `UPDATE bym.baiter_invite SET tests = tests + 1 WHERE inviter_userid = ? AND tester_userid = ? RETURNING tests`,
    [inviter, tester]
  );
  return row ? Number(row.tests) : null;
};

/** Removes every invite that has lapsed; the count removed. */
export const dropLapsedInvites = async (em: EntityManager, now: number): Promise<number> =>
  (await em.execute<{ inviter_userid: number }[]>(`DELETE FROM bym.baiter_invite WHERE expires_at <= ? RETURNING inviter_userid`, [at(now)]))
    .length;

/** Player cards by id, for names and faces on the lists. */
export const cardsOf = async (em: EntityManager, ids: readonly number[]): Promise<Map<number, ReturnType<typeof cardOf>>> => {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await em.execute<CardRow[]>(
    `SELECT ${CARD_COLUMNS} FROM ${CARD_JOIN} WHERE u.userid IN (${placeholders(unique)})`,
    unique
  );
  return new Map(rows.map((row) => [Number(row.userid), cardOf(row)]));
};

/* ── Results ────────────────────────────────────────────────────────────── */

/** Everything needed to play a test again and show its report. */
export interface TestPayload {
  readonly v: 1;
  /** The inviter's main yard as the test was served it. */
  readonly load: JsonObject;
  readonly seed: number;
  readonly events: FlingLog["events"];
  readonly tick: number;
  /** Each roster monster's level in the test army. */
  readonly levels: JsonObject;
  /** The test army as sent: counts, levels, champions. */
  readonly army: JsonObject;
  /** The test champions as fought. */
  readonly champion: unknown;
  /** The tester's report, when the server's battle agreed with it; null otherwise. */
  readonly report: JsonObject | null;
  /** The server's own short report line. */
  readonly attackreport: string;
}

/** One finished test, to keep. */
export interface TestRecord {
  readonly inviter: number;
  readonly tester: { readonly userid: number; readonly username: string; readonly pic: string | null };
  readonly baseid: string;
  readonly foughtAt: number;
  readonly damage: number;
  readonly result: TestResult;
  /** Seconds from the first drop to the end. */
  readonly seconds: number;
  readonly rulesVersion: string;
  readonly payload: TestPayload;
}

/** The payload, gzipped; null when it is too big to keep (the row is kept without it). */
export const encodeTestPayload = (payload: TestPayload): Buffer | null => {
  const stored = gzipSync(JSON.stringify(payload));
  return stored.byteLength <= MAX_REPLAY_BYTES ? stored : null;
};

/** A stored payload, unzipped; throws when it is not one. */
export const decodeTestPayload = (stored: Uint8Array): TestPayload => {
  const payload = JSON.parse(gunzipSync(stored, { maxOutputLength: MAX_REPLAY_RAW_BYTES }).toString("utf8"));
  if (payload?.v !== 1) throw new Error(`Baiter test payload has format ${JSON.stringify(payload?.v)}, not 1`);
  return payload as TestPayload;
};

/**
 * Keeps a finished test and prunes the inviter's list: older than 7 days or
 * beyond the newest {@link RESULT_LIMIT}. The new row's id.
 */
export const storeTest = async (em: EntityManager, record: TestRecord): Promise<number> => {
  const replay = encodeTestPayload(record.payload);
  return em.transactional(async (tx) => {
    const [row] = await tx.execute<{ id: number | string }[]>(
      `INSERT INTO bym.baiter_test
         (inviter_userid, tester_userid, tester_username, tester_pic, baseid, fought_at, damage, result, seconds,
          rules_version, has_report, replay, replay_bytes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
      [
        record.inviter,
        record.tester.userid,
        record.tester.username,
        record.tester.pic,
        record.baseid,
        at(record.foughtAt),
        Math.max(0, Math.min(100, Math.floor(record.damage))),
        record.result,
        Math.max(0, Math.floor(record.seconds)),
        record.rulesVersion,
        record.payload.report !== null,
        replay,
        replay?.byteLength ?? 0,
      ]
    );
    await pruneTests(tx as EntityManager, record.inviter, record.foughtAt);
    return Number(row!.id);
  });
};

/** Drops the inviter's tests that are too old or beyond the newest {@link RESULT_LIMIT}; the count dropped. */
export const pruneTests = async (em: EntityManager, inviter: number, now: number): Promise<number> => {
  const old = await em.execute<{ id: number }[]>(
    `DELETE FROM bym.baiter_test WHERE inviter_userid = ? AND fought_at < ? RETURNING id`,
    [inviter, at(now - RESULT_KEEP_SECONDS)]
  );
  const over = await em.execute<{ id: number }[]>(
    `DELETE FROM bym.baiter_test
      WHERE id IN (SELECT id FROM bym.baiter_test WHERE inviter_userid = ? ORDER BY fought_at DESC, id DESC OFFSET ?)
      RETURNING id`,
    [inviter, RESULT_LIMIT]
  );
  return old.length + over.length;
};

/** One kept test as the list shows it. */
export interface TestRow {
  id: number;
  tester: { userid: number; username: string; pic: string | null };
  baseid: string;
  foughtAt: number;
  damage: number;
  result: TestResult;
  seconds: number;
  rulesVersion: string;
  hasReport: boolean;
  hasReplay: boolean;
}

interface TestDbRow {
  id: number | string;
  tester_userid: number | string;
  tester_username: string;
  tester_pic: string | null;
  baseid: string;
  fought_at: Date;
  damage: number | string;
  result: TestResult;
  seconds: number | string;
  rules_version: string;
  has_report: boolean;
  replay_bytes: number | string;
}

const LIST_COLUMNS = `id, tester_userid, tester_username, tester_pic, baseid, fought_at, damage, result, seconds,
  rules_version, has_report, replay_bytes`;

const testOf = (row: TestDbRow): TestRow => ({
  id: Number(row.id),
  tester: { userid: Number(row.tester_userid), username: row.tester_username, pic: row.tester_pic ?? null },
  baseid: row.baseid,
  foughtAt: secondsOf(row.fought_at),
  damage: Number(row.damage) || 0,
  result: row.result,
  seconds: Number(row.seconds) || 0,
  rulesVersion: row.rules_version,
  hasReport: Boolean(row.has_report),
  hasReplay: Number(row.replay_bytes) > 0,
});

/** The inviter's kept tests, newest first, within the last 7 days. */
export const listTests = async (em: EntityManager, inviter: number, now: number): Promise<TestRow[]> =>
  (
    await em.execute<TestDbRow[]>(
      `SELECT ${LIST_COLUMNS} FROM bym.baiter_test
        WHERE inviter_userid = ? AND fought_at >= ?
        ORDER BY fought_at DESC, id DESC LIMIT ?`,
      [inviter, at(now - RESULT_KEEP_SECONDS), RESULT_LIMIT]
    )
  ).map(testOf);

/** One of the inviter's tests with its payload; null when it is not theirs or not kept. */
export const loadTest = async (
  em: EntityManager,
  inviter: number,
  id: number,
  now: number
): Promise<{ test: TestRow; replay: Uint8Array | null } | null> => {
  const [row] = await em.execute<(TestDbRow & { replay: Uint8Array | null })[]>(
    `SELECT ${LIST_COLUMNS}, replay FROM bym.baiter_test WHERE id = ? AND inviter_userid = ? AND fought_at >= ?`,
    [id, inviter, at(now - RESULT_KEEP_SECONDS)]
  );
  return row ? { test: testOf(row), replay: row.replay ?? null } : null;
};
