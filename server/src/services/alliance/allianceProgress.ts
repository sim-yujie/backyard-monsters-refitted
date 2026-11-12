import { AsyncLocalStorage } from "node:async_hooks";
import type { EntityManager } from "@mikro-orm/core";
import type { EntityManager as SqlEntityManager } from "@mikro-orm/postgresql";

import {
  DAILY_QUEST_POINTS_CAP,
  GOAL_MENU,
  GOAL_POINTS,
  GOAL_TIERS,
  GOALS_PER_WEEK,
  TERRITORY_BADGE_TOP,
  TYPE_SCALE,
  CONSTELLATION_STEPS,
  type GoalRules,
  type GoalTier,
} from "../../config/AllianceConfig.js";
import { AllianceMessageType, AllianceRole, type AllianceType } from "../../enums/Alliance.js";
import { Status } from "../../enums/StatusCodes.js";
import { ClientSafeError } from "../../middleware/clientSafeError.js";
import { logger } from "../../utils/logger.js";
import { defenceQuestEvents } from "../quests/hooks.js";
import {
  constellationOf,
  constellationsOf,
  effectValue,
  nextStepPrice,
  stepsOf,
  type LitSteps,
} from "./allianceBonuses.js";
import { allianceFactor, noteFactorChange } from "./productionHistory.js";

/**
 * Alliance points, weekly goals, the constellations' Light and Suggest, and
 * the territory boards (beta 7 alliances phase 2, design v5 §8, §9, §11, §16).
 *
 * Points come only from members' daily quests (1 each, up to
 * `DAILY_QUEST_POINTS_CAP` a member a UTC day) and from weekly goals reached.
 * Goal progress arrives as quest events (`noteAllianceEvents`), buffered and
 * written every few seconds, so a yard action never waits on it; a goal pays
 * once, by the UPDATE that crosses its target. Territory is a daily tally of
 * members' outposts per alliance, kept per type.
 */

type Sql = SqlEntityManager;
const sql = (em: EntityManager) => em as unknown as Sql;

const DAY = 86_400;

/** The UTC day of `now` (Unix seconds), as `YYYY-MM-DD`. */
export const utcDay = (now: number): string => new Date(now * 1000).toISOString().slice(0, 10);

/** The Monday (UTC) that starts the week of `now`, as `YYYY-MM-DD` (design v5 §8). */
export const weekOf = (now: number): string => {
  const weekday = (new Date(now * 1000).getUTCDay() + 6) % 7;
  return utcDay(now - weekday * DAY);
};

/** When the week of `now` ends (next Monday 00:00 UTC), Unix seconds. */
export const weekEndsAt = (now: number): number => Date.parse(`${weekOf(now)}T00:00:00Z`) / 1000 + 7 * DAY;

/** The goals a type may pick: the shared menu plus its own. */
export const goalMenuFor = (type: AllianceType): GoalRules[] => GOAL_MENU.filter((g) => !g.only || g.only === type);

/** A goal's target for a type and tier. */
export const goalTarget = (type: AllianceType, rules: GoalRules, tier: GoalTier): number =>
  rules.targets[GOAL_TIERS.indexOf(tier)]! * (TYPE_SCALE[type] ?? 1);

/** What a goal pays for a type and tier. */
export const goalPoints = (type: AllianceType, tier: GoalTier): number => GOAL_POINTS[tier] * (TYPE_SCALE[type] ?? 1);

/**
 * Goal progress in a batch of quest events: the plain keys only (not
 * `hatch:C1`), loot as all four resources together, upgrades of harvesters
 * and towers together. Undone counts (negative) are ignored.
 */
export const goalAmounts = (events: Readonly<Record<string, number>> | null | undefined): Record<string, number> => {
  const out: Record<string, number> = {};
  const add = (kind: string, value: unknown) => {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) out[kind] = (out[kind] ?? 0) + n;
  };
  for (const [key, value] of Object.entries(events ?? {})) {
    if (key.includes(":")) continue;
    if (/^lootR[1-4]$/.test(key)) add("loot", value);
    else if (key === "upgradeResource" || key === "upgradeDefence") add("upgrade", value);
    else if (GOAL_MENU.some((g) => g.kind === key)) add(key, value);
  }
  return out;
};

/** A refusal the window shows as it is. */
export const progressRefusedErr = (reason: string, message: string, status = Status.CONFLICT) =>
  new ClientSafeError({ message, status, data: { reason }, isClientFriendly: true });

/** The feed line hook, set by the alliance messages module at boot (keeps this module free of Redis). */
type FeedLine = (allianceId: number, userid: number, type: AllianceMessageType, body: string) => Promise<void>;
let feedLine: FeedLine = async () => {};
export const setProgressFeed = (fn: FeedLine) => {
  feedLine = fn;
};

/** Puts an automatic line in an alliance's feed and chat room (logged, never thrown). */
export const say = (allianceId: number, userid: number, type: AllianceMessageType, body: object) =>
  feedLine(allianceId, userid, type, JSON.stringify(body)).catch((err) =>
    logger.error(`Alliance feed line ${type} failed: ${err}`)
  );

/** Pays the alliance for the goals an UPDATE just finished, and says so in the feed. */
const payGoals = async (
  em: EntityManager,
  userid: number,
  done: { alliance_id: number; kind: string; tier: string; points: number }[]
) => {
  for (const goal of done) {
    await sql(em).execute(`UPDATE bym.alliance SET points = points + ? WHERE id = ?`, [goal.points, goal.alliance_id]);
    void say(goal.alliance_id, userid, AllianceMessageType.GOAL_DONE, {
      kind: goal.kind,
      tier: goal.tier,
      points: goal.points,
    });
  }
};

/**
 * Adds a member's progress to their alliance's goals of this week, and their
 * share (per mille of each target) to their help tally. A goal reached pays
 * its points once.
 */
export const addGoalProgress = async (
  em: EntityManager,
  userid: number,
  amounts: Readonly<Record<string, number>>,
  now: number
): Promise<void> => {
  const kinds = Object.entries(amounts).filter(([kind, n]) => n > 0 && kind !== "hold");
  if (kinds.length === 0) return;
  const [member] = await sql(em).execute<{ alliance_id: number | null }[]>(
    `SELECT alliance_id FROM bym."user" WHERE userid = ?`,
    [userid]
  );
  const allianceId = member?.alliance_id ? Number(member.alliance_id) : null;
  if (!allianceId) return;
  const week = weekOf(now);
  let helps = 0;
  const done: { alliance_id: number; kind: string; tier: string; points: number }[] = [];
  for (const [kind, amount] of kinds) {
    const rows = await sql(em).execute<
      { alliance_id: number; kind: string; tier: string; points: number; target: number; added: number; done: boolean }[]
    >(
      `UPDATE bym.alliance_goal g
          SET progress = LEAST(g.target, g.progress + ?),
              done_at = CASE WHEN g.progress + ? >= g.target THEN now() ELSE NULL END
        WHERE g.alliance_id = ? AND g.week = ?::date AND g.kind = ? AND g.done_at IS NULL
        RETURNING g.alliance_id, g.kind, g.tier, g.points, g.target,
                  LEAST(g.target, g.progress) AS added, g.done_at IS NOT NULL AS done`,
      [amount, amount, allianceId, week, kind]
    );
    for (const row of rows) {
      helps += Math.round((Math.min(amount, Number(row.target)) * 1000) / Math.max(1, Number(row.target)));
      if (row.done) done.push(row);
    }
  }
  if (helps > 0) {
    await sql(em).execute(
      `INSERT INTO bym.alliance_contribution (alliance_id, userid, day, goal_helps) VALUES (?, ?, ?::date, ?)
       ON CONFLICT (alliance_id, userid, day) DO UPDATE SET goal_helps = alliance_contribution.goal_helps + EXCLUDED.goal_helps`,
      [allianceId, userid, utcDay(now), helps]
    );
  }
  await payGoals(em, userid, done);
};

/**
 * A member claimed a daily quest: 1 point for the alliance while they are
 * under today's cap, and 1 towards a "Finish daily quests" goal either way.
 * Call it inside the claim's transaction. Returns whether a point was paid.
 */
export const creditDailyQuest = async (em: EntityManager, userid: number, now: number): Promise<boolean> => {
  // A unit-test fake without SQL (`allianceQuery`): no alliance, nothing to pay.
  if (typeof (em as unknown as Partial<Sql>).execute !== "function") return false;
  const rows = await sql(em).execute<{ alliance_id: number }[]>(
    `INSERT INTO bym.alliance_contribution (alliance_id, userid, day, quest_points)
     SELECT alliance_id, userid, ?::date, 1 FROM bym."user" WHERE userid = ? AND alliance_id IS NOT NULL
     ON CONFLICT (alliance_id, userid, day) DO UPDATE SET quest_points = alliance_contribution.quest_points + 1
       WHERE alliance_contribution.quest_points < ?
     RETURNING alliance_id`,
    [utcDay(now), userid, DAILY_QUEST_POINTS_CAP]
  );
  const paid = rows.length > 0;
  if (paid) await sql(em).execute(`UPDATE bym.alliance SET points = points + 1 WHERE id = ?`, [rows[0]!.alliance_id]);
  await addGoalProgress(em, userid, { dailyQuests: 1 }, now);
  return paid;
};

// ---------------------------------------------------------------------------
// Quest events, buffered (`setQuestEventListener` in services/quests/state.ts)
// ---------------------------------------------------------------------------

type EventBatch = Map<number, Record<string, number>>;

const pending: EventBatch = new Map();

const addToBatch = (batch: EventBatch, userid: number, amounts: Readonly<Record<string, number>>) => {
  const mine = batch.get(userid) ?? {};
  for (const [kind, n] of Object.entries(amounts)) mine[kind] = (mine[kind] ?? 0) + n;
  batch.set(userid, mine);
};

/**
 * Goal progress noted inside {@link countAfterCommit}'s work waits here and is
 * queued only when that work resolves, so a rolled-back transaction (a refused
 * kit buy, a failed save) never counts towards a goal.
 */
const commitScope = new AsyncLocalStorage<EventBatch>();

/**
 * Runs `work` (an `em.transactional(...)` call) and queues the goal progress
 * noted during it only once it resolves; a throw drops it. Nested scopes hand
 * theirs to the outer scope, which decides.
 */
export const countAfterCommit = async <T>(work: () => Promise<T>): Promise<T> => {
  const outer = commitScope.getStore();
  const staged: EventBatch = new Map();
  const result = await commitScope.run(staged, work);
  for (const [userid, amounts] of staged) addToBatch(outer ?? pending, userid, amounts);
  return result;
};

/**
 * Queues goal progress for a player; written by the next flush. Sync and
 * cheap. Inside {@link countAfterCommit} it waits for the commit.
 */
export const noteAllianceEvents = (userid: number, events: Readonly<Record<string, number>> | null | undefined) => {
  if (!userid) return;
  const amounts = goalAmounts(events);
  if (Object.keys(amounts).length === 0) return;
  addToBatch(commitScope.getStore() ?? pending, userid, amounts);
};

/**
 * Fortress's "Outposts attacked but not taken" goal (design v5 §16): one
 * attack on a member's outpost that the outpost held (the quests' held
 * defence, `defenceQuestEvents`), by a player outside the defender's alliance,
 * counted at most once per attacker per outpost per UTC day
 * (`bym.alliance_defence_credit`), so two friends cannot farm it. Called after
 * the attack's landing has committed. Returns whether it counted; a failure is
 * logged, never thrown.
 */
export const noteOutpostDefended = async (
  em: EntityManager,
  defender: { userid: number; outpost: number },
  attackerUserid: number,
  damageAfter: number,
  now: number
): Promise<boolean> => {
  if (!defenceQuestEvents(damageAfter).defenceWin) return false;
  if (!defender.userid || !attackerUserid || defender.userid === attackerUserid) return false;
  try {
    const rows = await sql(em).execute<{ userid: number; alliance_id: number | null }[]>(
      `SELECT userid, alliance_id FROM bym."user" WHERE userid IN (?, ?)`,
      [defender.userid, attackerUserid]
    );
    const allianceOf = (id: number) => rows.find((r) => Number(r.userid) === id)?.alliance_id ?? null;
    const mine = allianceOf(defender.userid);
    if (mine === null) return false;
    if (allianceOf(attackerUserid) === mine) return false;
    const fresh = await sql(em).execute<{ outpost: number }[]>(
      `INSERT INTO bym.alliance_defence_credit (outpost, attacker, day) VALUES (?, ?, ?::date)
       ON CONFLICT DO NOTHING RETURNING outpost`,
      [defender.outpost, attackerUserid, utcDay(now)]
    );
    if (fresh.length === 0) return false;
    noteAllianceEvents(defender.userid, { outpostDefended: 1 });
    return true;
  } catch (err) {
    logger.error(`Alliance outpost defence for user ${defender.userid} failed: ${err}`);
    return false;
  }
};

/** Test seam: the progress queued and not yet flushed, per player. */
export const pendingAllianceEvents = (userid: number): Readonly<Record<string, number>> | undefined =>
  pending.get(userid);

/** Writes every queued progress. A failure drops that player's batch (logged), never the others. */
export const flushAllianceEvents = async (em: EntityManager, now: number): Promise<void> => {
  const batch = [...pending.entries()];
  pending.clear();
  for (const [userid, amounts] of batch) {
    try {
      await em.fork().transactional((tx) => addGoalProgress(tx, userid, amounts, now));
    } catch (err) {
      logger.error(`Alliance goal progress for user ${userid} failed: ${err}`);
    }
  }
};

// ---------------------------------------------------------------------------
// Weekly goals
// ---------------------------------------------------------------------------

const lockLeadOrOfficer = async (em: EntityManager, userid: number) => {
  const [row] = await sql(em).execute<{ alliance_id: number | null; alliance_role: AllianceRole | null }[]>(
    `SELECT alliance_id, alliance_role FROM bym."user" WHERE userid = ? FOR UPDATE`,
    [userid]
  );
  if (!row?.alliance_id) throw progressRefusedErr("notMember", "You are not in an alliance.", Status.FORBIDDEN);
  if (row.alliance_role !== AllianceRole.LEADER && row.alliance_role !== AllianceRole.OFFICER) {
    throw progressRefusedErr("notOfficer", "Only the Leader and Officers can do that.", Status.FORBIDDEN);
  }
  const [alliance] = await sql(em).execute<
    { id: number; type: AllianceType; stars: LitSteps | string | null; points: number; points_spent: number; suggestions: unknown }[]
  >(`SELECT id, type, stars, points, points_spent, suggestions FROM bym.alliance WHERE id = ? FOR UPDATE`, [row.alliance_id]);
  if (!alliance) throw progressRefusedErr("notMember", "You are not in an alliance.", Status.FORBIDDEN);
  return { ...alliance, stars: parseJson<LitSteps>(alliance.stars) };
};

const parseJson = <T extends object>(raw: unknown): T =>
  ((typeof raw === "string" ? JSON.parse(raw) : raw) ?? {}) as T;

/** Adds a goal for this week (Leader and Officers; design v5 §8). */
export const setGoal = async (em: EntityManager, userid: number, kind: string, tier: GoalTier, now: number) =>
  em.transactional(async (tx) => {
    const alliance = await lockLeadOrOfficer(tx, userid);
    const rules = goalMenuFor(alliance.type).find((g) => g.kind === kind);
    if (!rules || !GOAL_TIERS.includes(tier)) throw progressRefusedErr("noSuchGoal", "That goal is not on your menu.");
    const week = weekOf(now);
    const [count] = await sql(tx).execute<{ n: number; same: number }[]>(
      `SELECT count(*)::int AS n, count(*) FILTER (WHERE kind = ?)::int AS same
         FROM bym.alliance_goal WHERE alliance_id = ? AND week = ?::date`,
      [kind, alliance.id, week]
    );
    if (Number(count?.same) > 0) throw progressRefusedErr("goalTaken", "That goal is already set this week.");
    if (Number(count?.n) >= GOALS_PER_WEEK) {
      throw progressRefusedErr("goalsFull", `Up to ${GOALS_PER_WEEK} goals a week.`);
    }
    await sql(tx).execute(
      `INSERT INTO bym.alliance_goal (alliance_id, week, kind, tier, target, points, set_by) VALUES (?, ?::date, ?, ?, ?, ?, ?)`,
      [alliance.id, week, kind, tier, goalTarget(alliance.type, rules, tier), goalPoints(alliance.type, tier), userid]
    );
    void say(alliance.id, userid, AllianceMessageType.GOAL_SET, { kind, tier });
  });

/** Removes a goal of this week, only while nothing counts towards it (design v5 §8). */
export const removeGoal = async (em: EntityManager, userid: number, goalId: number, now: number) =>
  em.transactional(async (tx) => {
    const alliance = await lockLeadOrOfficer(tx, userid);
    const rows = await sql(tx).execute<{ id: number }[]>(
      `DELETE FROM bym.alliance_goal WHERE id = ? AND alliance_id = ? AND week = ?::date AND progress = 0 AND kind <> 'hold'
       RETURNING id`,
      [goalId, alliance.id, weekOf(now)]
    );
    if (rows.length === 0) {
      // "Hold" reads live outposts, so it can go too while the week's tally has not run.
      const hold = await sql(tx).execute<{ id: number }[]>(
        `DELETE FROM bym.alliance_goal WHERE id = ? AND alliance_id = ? AND week = ?::date AND kind = 'hold' AND done_at IS NULL
         RETURNING id`,
        [goalId, alliance.id, weekOf(now)]
      );
      if (hold.length === 0) throw progressRefusedErr("goalStarted", "A goal can only be removed before anyone adds to it.");
    }
  });

// ---------------------------------------------------------------------------
// Constellations: Light (Leader, Officers) and Suggest (members)
// ---------------------------------------------------------------------------

/**
 * Lights the next star of one of the alliance's own constellations, paying
 * the step's price from the points to spend (design v5 §9). The members'
 * production factor change is recorded first (`productionHistory.ts`), so
 * time already away is not paid at the new rate. Clears suggestions for it.
 */
export const lightStar = async (em: EntityManager, userid: number, id: string, now: number) => {
  const lit = await em.transactional(async (tx) => {
    const alliance = await lockLeadOrOfficer(tx, userid);
    if (!constellationOf(alliance.type, id)) {
      throw progressRefusedErr("noSuchConstellation", "That constellation is not your alliance's.");
    }
    const steps = stepsOf(alliance.stars, id);
    const price = nextStepPrice(alliance.type, steps);
    if (price === null) throw progressRefusedErr("full", "All 10 stars are already lit.");
    const toSpend = Number(alliance.points) - Number(alliance.points_spent);
    if (toSpend < price) throw progressRefusedErr("notEnoughPoints", `You need ${price - toSpend} more points.`);

    const stars = { ...alliance.stars, [id]: steps + 1 };
    await noteFactorChange(
      tx,
      { allianceId: alliance.id },
      allianceFactor(alliance.type, alliance.stars),
      allianceFactor(alliance.type, stars),
      now
    );
    const suggestions = Object.fromEntries(
      Object.entries(parseJson<Record<string, string>>(alliance.suggestions)).filter(([, c]) => c !== id)
    );
    await sql(tx).execute(
      `UPDATE bym.alliance SET stars = ?::jsonb, points_spent = points_spent + ?, suggestions = ?::jsonb WHERE id = ?`,
      [JSON.stringify(stars), price, JSON.stringify(suggestions), alliance.id]
    );
    return { allianceId: alliance.id, step: steps + 1, price, stars };
  });
  void say(lit.allianceId, userid, AllianceMessageType.STAR_LIT, { id, step: lit.step });
  return lit;
};

/**
 * A member suggests the next step of a constellation (design v5 §9a,
 * PROPOSED): one suggestion each at a time, cleared when a step of it is lit.
 * A feed line says so; officers see the count.
 */
export const suggestStar = async (em: EntityManager, userid: number, id: string) => {
  const done = await em.transactional(async (tx) => {
    const [row] = await sql(tx).execute<{ alliance_id: number | null }[]>(
      `SELECT alliance_id FROM bym."user" WHERE userid = ?`,
      [userid]
    );
    if (!row?.alliance_id) throw progressRefusedErr("notMember", "You are not in an alliance.", Status.FORBIDDEN);
    const [alliance] = await sql(tx).execute<{ type: AllianceType; stars: unknown; suggestions: unknown }[]>(
      `SELECT type, stars, suggestions FROM bym.alliance WHERE id = ? FOR UPDATE`,
      [row.alliance_id]
    );
    if (!alliance || !constellationOf(alliance.type, id)) {
      throw progressRefusedErr("noSuchConstellation", "That constellation is not your alliance's.");
    }
    const steps = stepsOf(parseJson<LitSteps>(alliance.stars), id);
    if (nextStepPrice(alliance.type, steps) === null) throw progressRefusedErr("full", "All 10 stars are already lit.");
    const suggestions = parseJson<Record<string, string>>(alliance.suggestions);
    if (suggestions[String(userid)] === id) return null;
    suggestions[String(userid)] = id;
    await sql(tx).execute(`UPDATE bym.alliance SET suggestions = ?::jsonb WHERE id = ?`, [
      JSON.stringify(suggestions),
      row.alliance_id,
    ]);
    return { allianceId: Number(row.alliance_id), step: steps + 1 };
  });
  if (done) void say(done.allianceId, userid, AllianceMessageType.STAR_SUGGESTED, { id, step: done.step });
  return done !== null;
};

// ---------------------------------------------------------------------------
// Territory: a daily tally, one board per type (design v5 §11)
// ---------------------------------------------------------------------------

/** The `bym.job_run` name of the daily tally; its period is the UTC day. */
export const TERRITORY_JOB = "alliance-territory";

/**
 * Tallies every alliance's members' outposts for today, once a UTC day
 * (claimed in `bym.job_run`, so two servers run it once). On a Monday it
 * also settles last week's "Hold outposts" goals from this tally. Returns
 * how many alliances were tallied, or null when today's has run.
 */
export const runTerritoryTally = async (em: EntityManager, now: number): Promise<number | null> => {
  const day = utcDay(now);
  const claimed = await sql(em.fork()).execute<{ job: string }[]>(
    `INSERT INTO bym.job_run (job, period, ran_at) VALUES (?, ?, now()) ON CONFLICT DO NOTHING RETURNING job`,
    [TERRITORY_JOB, day]
  );
  if (claimed.length === 0) return null;
  try {
    return await em.fork().transactional(async (tx) => {
      // The held-defence credits only matter for the day they were given.
      await sql(tx).execute(`DELETE FROM bym.alliance_defence_credit WHERE day < ?::date - 7`, [day]);
      const rows = await sql(tx).execute<{ alliance_id: number }[]>(
        `INSERT INTO bym.alliance_territory (alliance_id, day, type, outposts)
         SELECT a.id, ?::date, a.type, count(s.basesaveid)::int
           FROM bym.alliance a
           JOIN bym."user" u ON u.alliance_id = a.id
           LEFT JOIN bym.save s ON s.saveuserid = u.userid AND s.type = 'outpost'
          GROUP BY a.id, a.type
         ON CONFLICT (alliance_id, day) DO NOTHING
         RETURNING alliance_id`,
        [day]
      );
      if (weekOf(now) === day) {
        const lastWeek = weekOf(now - DAY);
        const done = await sql(tx).execute<{ alliance_id: number; kind: string; tier: string; points: number }[]>(
          `UPDATE bym.alliance_goal g
              SET progress = LEAST(g.target, t.outposts), done_at = CASE WHEN t.outposts >= g.target THEN now() END
             FROM bym.alliance_territory t
            WHERE g.kind = 'hold' AND g.done_at IS NULL AND g.week = ?::date
              AND t.alliance_id = g.alliance_id AND t.day = ?::date
            RETURNING g.alliance_id, g.kind, g.tier, g.points, g.done_at`,
          [lastWeek, day]
        );
        await payGoals(
          tx,
          0,
          done.filter((g) => (g as unknown as { done_at: unknown }).done_at)
        );
      }
      return rows.length;
    });
  } catch (err) {
    await sql(em.fork()).execute(`DELETE FROM bym.job_run WHERE job = ? AND period = ?`, [TERRITORY_JOB, day]);
    throw err;
  }
};

/** One row of a territory board. */
export interface TerritoryRow {
  rank: number;
  alliance_id: number;
  name: string;
  image: number;
  month: number;
  all_time: number;
  /** Top `TERRITORY_BADGE_TOP` of last month's board: 1, 2, 3; else null. */
  badge: number | null;
}

/** The first day of the month of `now`, and of the month before, as `YYYY-MM-DD`. */
export const monthsOf = (now: number): { month: string; lastMonth: string } => {
  const d = new Date(now * 1000);
  const month = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const lastMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
  return { month: month.toISOString().slice(0, 10), lastMonth: lastMonth.toISOString().slice(0, 10) };
};

/**
 * A type's territory board: this month and all time, ranked by this month,
 * with last month's top 3 badges. Only alliances of that type now are listed;
 * days counted under another type stay on that type's board.
 */
export const territoryBoard = async (em: EntityManager, type: AllianceType, now: number, limit = 50) => {
  const { month, lastMonth } = monthsOf(now);
  const rows = await sql(em).execute<
    { alliance_id: number; name: string; image: number; month: number; all_time: number; last_month: number }[]
  >(
    `SELECT a.id AS alliance_id, a.name, a.image,
            COALESCE(SUM(t.outposts) FILTER (WHERE t.day >= ?::date), 0)::int AS month,
            COALESCE(SUM(t.outposts), 0)::int AS all_time,
            COALESCE(SUM(t.outposts) FILTER (WHERE t.day >= ?::date AND t.day < ?::date), 0)::int AS last_month
       FROM bym.alliance a
       LEFT JOIN bym.alliance_territory t ON t.alliance_id = a.id AND t.type = a.type
      WHERE a.type = ?
      GROUP BY a.id
      ORDER BY month DESC, all_time DESC, a.id
      LIMIT ?`,
    [month, lastMonth, month, type, limit]
  );
  const badges = [...rows]
    .filter((r) => r.last_month > 0)
    .sort((a, b) => b.last_month - a.last_month)
    .slice(0, TERRITORY_BADGE_TOP)
    .map((r) => r.alliance_id);
  return rows.map(
    (r, i): TerritoryRow => ({
      rank: i + 1,
      alliance_id: Number(r.alliance_id),
      name: r.name,
      image: Number(r.image),
      month: Number(r.month),
      all_time: Number(r.all_time),
      badge: badges.includes(r.alliance_id) ? badges.indexOf(r.alliance_id) + 1 : null,
    })
  );
};

// ---------------------------------------------------------------------------
// The dashboard view (`myalliance`)
// ---------------------------------------------------------------------------

/** Today, the week's goals and top helpers, for the Overview (design v5 §7b). */
export const progressView = async (em: EntityManager, allianceId: number, type: AllianceType, now: number) => {
  const day = utcDay(now);
  const week = weekOf(now);
  const [today] = await sql(em).execute<{ contributed: number; members: number; points_today: number }[]>(
    `SELECT (SELECT count(*)::int FROM bym.alliance_contribution c
              WHERE c.alliance_id = ? AND c.day = ?::date AND (c.quest_points > 0 OR c.goal_helps > 0)) AS contributed,
            (SELECT count(*)::int FROM bym."user" u WHERE u.alliance_id = ?) AS members,
            (SELECT COALESCE(SUM(quest_points), 0)::int FROM bym.alliance_contribution c
              WHERE c.alliance_id = ? AND c.day = ?::date) AS points_today`,
    [allianceId, day, allianceId, allianceId, day]
  );
  const goals = await sql(em).execute<
    { id: number; kind: string; tier: string; target: number; points: number; progress: number; done_at: Date | null }[]
  >(
    `SELECT id, kind, tier, target, points, progress, done_at FROM bym.alliance_goal
      WHERE alliance_id = ? AND week = ?::date ORDER BY id`,
    [allianceId, week]
  );
  let held: number | null = null;
  if (goals.some((g) => g.kind === "hold")) {
    const [row] = await sql(em).execute<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM bym.save s JOIN bym."user" u ON u.userid = s.saveuserid
        WHERE u.alliance_id = ? AND s.type = 'outpost'`,
      [allianceId]
    );
    held = Number(row?.n ?? 0);
  }
  const helpers = await sql(em).execute<{ userid: number; username: string; quests: number; helps: number }[]>(
    `SELECT c.userid, u.username, SUM(c.quest_points)::int AS quests, SUM(c.goal_helps)::int AS helps
       FROM bym.alliance_contribution c JOIN bym."user" u ON u.userid = c.userid AND u.alliance_id = c.alliance_id
      WHERE c.alliance_id = ? AND c.day >= ?::date
      GROUP BY c.userid, u.username
      ORDER BY helps DESC, quests DESC, c.userid
      LIMIT 3`,
    [allianceId, week]
  );
  const helpedToday = await sql(em).execute<{ userid: number }[]>(
    `SELECT userid FROM bym.alliance_contribution
      WHERE alliance_id = ? AND day = ?::date AND (quest_points > 0 OR goal_helps > 0)`,
    [allianceId, day]
  );
  const names = Object.fromEntries(goalMenuFor(type).map((g) => [g.kind, g.name]));
  return {
    today: {
      contributed: Number(today?.contributed ?? 0),
      members: Number(today?.members ?? 0),
      points_today: Number(today?.points_today ?? 0),
      helped_ids: helpedToday.map((r) => Number(r.userid)),
    },
    week_ends_at: weekEndsAt(now),
    goals: goals.map((g) => ({
      id: Number(g.id),
      kind: g.kind,
      name: names[g.kind] ?? g.kind,
      tier: g.tier,
      target: Number(g.target),
      points: Number(g.points),
      progress: g.kind === "hold" && !g.done_at ? Math.min(Number(g.target), held ?? 0) : Number(g.progress),
      done: Boolean(g.done_at),
      // A goal goes only before anyone adds to it ("hold" reads live, so until settled).
      removable: g.kind === "hold" ? !g.done_at : Number(g.progress) === 0,
    })),
    goal_menu: goalMenuFor(type).map((g) => ({
      kind: g.kind,
      name: g.name,
      only: g.only ?? null,
      tiers: GOAL_TIERS.map((tier) => ({ tier, target: goalTarget(type, g, tier), points: goalPoints(type, tier) })),
    })),
    goals_per_week: GOALS_PER_WEEK,
    top_helpers: helpers.map((h) => ({
      userid: Number(h.userid),
      username: h.username,
      quests: Number(h.quests),
      // Share of goals moved, in percent of one goal.
      goal_share: Math.round(Number(h.helps) / 10),
    })),
  };
};

/** The alliance's rank on its own type's board this month (null with no tally yet). */
export const territoryRankOf = async (em: EntityManager, allianceId: number, type: AllianceType, now: number) => {
  const board = await territoryBoard(em, type, now, 1000);
  const mine = board.find((r) => r.alliance_id === allianceId);
  return mine ? { rank: mine.rank, of: board.length, month: mine.month, badge: mine.badge } : null;
};

/**
 * The Constellation tab's data (design v5 §9a): each of the type's 4
 * constellations with its steps lit, every effect's value at each step
 * (start, then stars 1-10), the next step's price, and how many members
 * suggest it.
 */
export const constellationView = (type: AllianceType, stars: LitSteps | null, suggestions: Record<string, string> | null) =>
  constellationsOf(type).map((c) => {
    const steps = stepsOf(stars, c.id);
    return {
      id: c.id,
      name: c.name,
      kind: c.kind,
      steps,
      next_price: nextStepPrice(type, steps),
      prices: Array.from({ length: CONSTELLATION_STEPS }, (_, i) => nextStepPrice(type, i)),
      suggest_count: Object.values(suggestions ?? {}).filter((id) => id === c.id).length,
      effects: c.effects.map((e) => ({
        stat: e.stat,
        values: Array.from({ length: CONSTELLATION_STEPS + 1 }, (_, i) => effectValue(e, i)),
      })),
    };
  });

/** The last step lit: who, which, when (design v5 §9a "Last lit"). */
export const lastLit = async (em: EntityManager, allianceId: number) => {
  const [row] = await sql(em).execute<{ body: string; username: string; created_at: Date }[]>(
    `SELECT m.body, u.username, m.created_at FROM bym.alliance_message m JOIN bym."user" u ON u.userid = m.user_id
      WHERE m.alliance_id = ? AND m.message_type = 'star_lit' ORDER BY m.id DESC LIMIT 1`,
    [allianceId]
  );
  if (!row) return null;
  const facts = parseJson<{ id?: string; step?: number }>(row.body);
  return { id: facts.id ?? null, step: Number(facts.step) || 0, by: row.username, at: Math.floor(new Date(row.created_at).getTime() / 1000) };
};
