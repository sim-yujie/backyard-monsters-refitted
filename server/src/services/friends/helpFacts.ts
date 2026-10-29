import type { EntityManager } from "@mikro-orm/postgresql";

import { BaseType } from "../../enums/Base.js";
import type { BuildingDataMap, BuildingHealthData } from "../../types/BuildingData.js";
import type { ResourceAmounts } from "../yardplanner/costs.js";
import { secondsOf } from "./friendRules.js";
import { placeholders } from "./friendViews.js";
import {
  gateRefusal,
  helpsLeftOf,
  previewHelp,
  type BuildingHelp,
  type HelpFacts,
  type HelpKind,
  type HelpPreviewSave,
  type HelpRefusal,
  type HelpSide,
} from "./helpRules.js";

/**
 * What the help rules read from the database (issue #373): both players, the
 * friendship, the helper's helps today, and the `friend_help` rows themselves.
 * The rules are in `helpRules.ts`; the route that writes is
 * `controllers/friends/help.ts`.
 */

/** The UTC day `now` falls in, as `friend_help.help_day` stores it (`YYYY-MM-DD`). */
export const helpDayOf = (now: number): string => new Date(now * 1000).toISOString().slice(0, 10);

/** Helps the player has given in the UTC day `now` falls in. */
export const helpsToday = async (em: EntityManager, helper: number, now: number): Promise<number> => {
  const [row] = await em.execute<{ n: number }[]>(
    `SELECT count(*)::int AS n FROM bym.friend_help WHERE helper_userid = ? AND help_day = ?::date`,
    [helper, helpDayOf(now)]
  );
  return Number(row?.n ?? 0);
};

/** One side of a help as the gates read it, plus where its main yard is. */
export interface HelpSideRow extends HelpSide {
  username: string;
  basesaveid: number | null;
}

/** The players' accounts and main-yard levels, by user id; a missing player is absent. */
export const readSides = async (em: EntityManager, userids: readonly number[]): Promise<Map<number, HelpSideRow>> => {
  if (userids.length === 0) return new Map();
  const rows = await em.execute<(HelpSideRow & { userid: number | string })[]>(
    `SELECT u.userid, u.username, u.banned, u.blocked_users, u.save_basesaveid AS basesaveid,
            coalesce(s.createtime, 0) AS createtime, s.points, s.basevalue
       FROM bym."user" u LEFT JOIN bym.save s ON s.basesaveid = u.save_basesaveid
      WHERE u.userid IN (${placeholders(userids)})`,
    [...userids]
  );
  return new Map(
    rows.map((row) => [
      Number(row.userid),
      { ...row, userid: Number(row.userid), basesaveid: row.basesaveid === null ? null : Number(row.basesaveid) },
    ])
  );
};

/** When the helper and each of `others` became friends, unix seconds; non-friends are absent. */
export const friendsSince = async (em: EntityManager, helper: number, others: readonly number[]): Promise<Map<number, number>> => {
  if (others.length === 0) return new Map();
  const rows = await em.execute<{ friend_userid: number | string; created_at: Date }[]>(
    `SELECT friend_userid, created_at FROM bym.friend WHERE userid = ? AND friend_userid IN (${placeholders(others)})`,
    [helper, ...others]
  );
  return new Map(rows.map((row) => [Number(row.friend_userid), secondsOf(row.created_at) ?? 0]));
};

/** Everything the gates need for one helper and one owner, or null when either player is gone. */
export const helpFactsFor = async (em: EntityManager, helper: number, owner: number, now: number): Promise<HelpFacts | null> => {
  const [sides, since, today] = await Promise.all([
    readSides(em, [helper, owner]),
    friendsSince(em, helper, [owner]),
    helpsToday(em, helper, now),
  ]);
  const helperSide = sides.get(helper);
  const ownerSide = sides.get(owner);
  if (!helperSide || !ownerSide) return null;
  return { helper: helperSide, owner: ownerSide, friendsSince: since.get(owner) ?? null, helpsToday: today };
};

/** One `friend_help` row: a counted help, and the audit trail (§6.1, §7 rule 9). */
export interface HelpRecord {
  helper: number;
  owner: number;
  baseid: string;
  buildingId: number;
  kind: HelpKind;
  secondsSaved: number;
  reward: ResourceAmounts;
  now: number;
}

/** Writes one counted help. */
export const recordHelp = (tx: EntityManager, record: HelpRecord) =>
  tx.execute(
    `INSERT INTO bym.friend_help (helper_userid, owner_userid, baseid, building_id, kind, seconds_saved, reward, help_day, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, ?::date, ?)`,
    [
      record.helper,
      record.owner,
      record.baseid,
      record.buildingId,
      record.kind,
      record.secondsSaved,
      JSON.stringify(record.reward),
      helpDayOf(record.now),
      new Date(record.now * 1000),
    ]
  );

/** What help-mode `/base/load` adds to the yard (§6.2), WP2's `HelpBlock`. */
export interface HelpBlock {
  helpsLeft: number;
  buildings: BuildingHelp;
  /** When the age or level gates refuse (`tooNew`): which holds and when it lifts, for the panel's words. */
  gate?: HelpRefusal;
}

/** The owner's main yard as the preview reads it. */
interface OwnerYard extends HelpPreviewSave {
  userid: number;
  type: string;
}

/**
 * The `help` block of a help-mode load (§6.2): helps left today and, per
 * building, whether the visitor could speed it up or repair it, `true` or the
 * refusal. Only the owner's main yard can be helped (Q10), so anything else
 * gets no buildings.
 *
 * @param ownerSave - The yard the load answers with.
 */
export const helpBlock = async (em: EntityManager, helper: number, ownerSave: OwnerYard, now: number): Promise<HelpBlock> => {
  const owner = Number(ownerSave.userid);
  const facts = await helpFactsFor(em, helper, owner, now);
  const helpsLeft = helpsLeftOf(facts?.helpsToday ?? (await helpsToday(em, helper, now)));
  if (!facts || helper === owner || ownerSave.type !== BaseType.MAIN) return { helpsLeft, buildings: {} };
  const gate = gateRefusal(facts, now);
  const buildings = previewHelp(ownerSave, helper, now, gate);
  return gate?.reason === "tooNew" ? { helpsLeft, buildings, gate } : { helpsLeft, buildings };
};

/**
 * The friends list's `help` field (§6.2): for each friend, whether the caller
 * could speed up or repair anything in their main yard today; null when the
 * gates refuse. Reads only the buildings with a countdown, a repair or damage.
 */
export const friendsHelp = async (
  em: EntityManager,
  helper: number,
  friendIds: readonly number[],
  now: number
): Promise<Map<number, { speedup: boolean; repair: boolean } | null>> => {
  const out = new Map<number, { speedup: boolean; repair: boolean } | null>();
  if (friendIds.length === 0) return out;
  const [sides, since, today] = await Promise.all([
    readSides(em, [helper, ...friendIds]),
    friendsSince(em, helper, friendIds),
    helpsToday(em, helper, now),
  ]);
  const helperSide = sides.get(helper);
  const open = friendIds.filter((id) => {
    const side = sides.get(id);
    const ok =
      !!helperSide &&
      !!side &&
      side.basesaveid !== null &&
      gateRefusal({ helper: helperSide, owner: side, friendsSince: since.get(id) ?? null, helpsToday: today }, now) === null;
    if (!ok) out.set(id, null);
    return ok;
  });
  if (open.length === 0) return out;

  const rows = await em.execute<
    { userid: number | string; type: string; savetime: number; buildinghealthdata: BuildingHealthData | null; buildings: BuildingDataMap | null }[]
  >(
    `SELECT s.userid, s.type, s.savetime, s.buildinghealthdata,
            (SELECT jsonb_object_agg(e.k, e.v) FROM jsonb_each(coalesce(s.buildingdata, '{}'::jsonb)) AS e(k, v)
              WHERE e.v->'cB' IS NOT NULL OR e.v->'cU' IS NOT NULL OR e.v->'cF' IS NOT NULL
                 OR e.v->'hp' IS NOT NULL OR e.v->'rE' IS NOT NULL
                 OR s.buildinghealthdata->coalesce(e.v->>'id', e.k) IS NOT NULL) AS buildings
       FROM bym.save s WHERE s.basesaveid IN (${placeholders(open)})`,
    open.map((id) => sides.get(id)!.basesaveid)
  );
  for (const row of rows) {
    const id = Number(row.userid);
    if (row.type !== BaseType.MAIN) {
      out.set(id, null);
      continue;
    }
    const help = previewHelp(
      { type: row.type, savetime: Number(row.savetime), buildingdata: row.buildings ?? {}, buildinghealthdata: row.buildinghealthdata },
      helper,
      now,
      null
    );
    const entries = Object.values(help);
    out.set(id, {
      speedup: entries.some((entry) => entry.speedup === true),
      repair: entries.some((entry) => entry.repair === true),
    });
  }
  for (const id of open) if (!out.has(id)) out.set(id, null);
  return out;
};
