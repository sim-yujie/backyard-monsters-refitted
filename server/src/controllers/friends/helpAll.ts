import type { EntityManager } from "@mikro-orm/postgresql";
import z from "zod";

import type { User } from "../../database/models/user.model.js";
import type { FriendRefusal } from "../../errors/errors.js";
import { friendRefusedErr } from "../../errors/errors.js";
import { countAfterCommit } from "../../services/alliance/allianceProgress.js";
import { notifyFriendOfAll } from "../../services/friends/friendNotifications.js";
import { HELP_ALL_MAX_TARGETS } from "../../services/friends/helpConfig.js";
import { markHelped } from "../../services/friends/helpedMark.js";
import { recordHelps, repairsToday } from "../../services/friends/helpFacts.js";
import { isRefusal, rewardsLeftOf } from "../../services/friends/helpRules.js";
import { flingerClockOf, type FlingerClock } from "../../services/yard/derivedLevels.js";
import type { ResourceAmounts } from "../../services/yardplanner/costs.js";
import type { BuildingData } from "../../types/BuildingData.js";
import { logger } from "../../utils/logger.js";
import type { FriendsBody } from "./friends.js";
import { parsedList } from "./gift.js";
import { dropOwnerSight, giveOneHelp, helpNoticeOf, helpRecordOf, openHelpVisit, type LandedHelp } from "./help.js";

/**
 * `POST /bm/friends/help/all` `{ userid, targets: [{ buildingId, kind }] }`:
 * Help all on a friend's yard as one request (owner, 26 Nov 2026: "one batch
 * request like Gift all"). Before, the web sent one `POST /bm/friends/help`
 * per building, and each locked, caught up and wrote both yards again.
 *
 * One transaction, as one help's (`help.ts`), opened once: both main saves
 * locked (lower user id first, the single help's order, so a single help and
 * a Help all on the same yards run one after the other and never deadlock),
 * caught up once, the gates read once. A refusal about the whole visit (not
 * friends, a block or a ban, `tooNew`, either yard fought over) refuses the
 * whole request, as the first single help would have, and writes nothing.
 *
 * Then each target in the order given, by exactly the single help's rules
 * (`giveOneHelp`): 5 friends a job, each once; one repair a friend's yard a
 * UTC day; the reward only for the first 5 helps of the helper's UTC day,
 * counted across the request. A refusal about one building (`alreadyHelped`,
 * `helpersFull`, `nothingToHelp`, `repairedToday`) passes it over, as the
 * web's one-by-one Help all did (a repair after one landed was no longer
 * offered); none other can come up once the visit is open, and any would
 * stop there. The web passes over the same four (`BUILDING_REFUSALS`), so
 * the two never part ways. One `friend_help`
 * row per help, written in one insert; one flush. When no help went through,
 * everything rolls back, as a refused single help does.
 *
 * The answer: `helps`, one entry per target reached, in order: `{ buildingId,
 * kind, ok: true, secondsSaved | healed, reward, rewardsLeft, building }` (what
 * one help answers), or `{ buildingId, kind, ok: false, reason }`. Targets
 * after a stop have none. `rewardsLeft` is the helper's after the request.
 *
 * After the commit, as after a single help but once: the owner's sight
 * dropped if their Flinger moved, a `friend` bell line per help (one insert),
 * and the helped mark.
 *
 * The cost to the server is the same for 1 help or 10: one lock pair, one
 * catch-up, a fixed number of reads, one insert of rows, one flush.
 */

const id = z.coerce.number().int().positive();

export const HelpAllSchema = z
  .object({
    userid: id,
    targets: z.preprocess(
      parsedList,
      z
        .array(
          z
            .object({
              buildingId: z.coerce.number().int().nonnegative(),
              kind: z.enum(["speedup", "repair"]),
            })
            .strict()
        )
        .min(1)
        .max(HELP_ALL_MAX_TARGETS)
    ),
  })
  .strict();

/** Refusals about one building: Help all passes it over and goes on (the web's `BUILDING_REFUSALS`, the same four). */
const PASSED_OVER: ReadonlySet<FriendRefusal> = new Set<FriendRefusal>([
  "alreadyHelped",
  "helpersFull",
  "nothingToHelp",
  "repairedToday",
]);

/** One target's outcome, as the route answers it. */
export type HelpAllOutcome =
  | {
      buildingId: number;
      kind: LandedHelp["kind"];
      ok: true;
      secondsSaved?: number;
      healed?: true;
      reward: ResourceAmounts;
      rewardsLeft: number;
      building: BuildingData;
    }
  | { buildingId: number; kind: LandedHelp["kind"]; ok: false; reason: FriendRefusal };

interface HelpAllDone {
  helps: HelpAllOutcome[];
  landed: LandedHelp[];
  rewardsLeft: number;
  helperName: string;
  ownerFlingerBefore: FlingerClock;
  ownerFlingerAfter: FlingerClock;
}

/** Thrown out of the transaction when no help went through, so the catch-up rolls back; carries the answer. */
class NothingLanded extends Error {
  constructor(readonly helps: HelpAllOutcome[], readonly rewardsLeft: number) {
    super("Help all: no help went through");
  }
}

/**
 * Gives every help in `targets`; see the file's comment.
 *
 * @param user - The helper (`ctx.authUser`).
 * @param body - `{ userid, targets }`.
 * @param now - Unix seconds.
 */
export const helpAllAnswer = async (em: EntityManager, user: User, body: unknown, now: number): Promise<FriendsBody> => {
  const { userid: owner, targets } = HelpAllSchema.parse(body);
  const helper = user.userid;
  if (owner === helper) throw friendRefusedErr("self");

  let done: HelpAllDone;
  try {
    done = await countAfterCommit(() =>
      em.transactional(async (tx): Promise<HelpAllDone> => {
        const visit = await openHelpVisit(tx, helper, owner, now);
        // The helper's repairs in this yard today: read once, at the first repair, then counted here.
        let repairs: number | null = null;
        const repairsHere = async () => (repairs ??= (await repairsToday(tx, helper, [owner], now)).get(owner) ?? 0);

        const helps: HelpAllOutcome[] = [];
        const landed: LandedHelp[] = [];
        for (const { buildingId, kind } of targets) {
          const given = await giveOneHelp(visit, helper, buildingId, kind, visit.helpsBefore + landed.length, repairsHere, now);
          if (isRefusal(given)) {
            helps.push({ buildingId, kind, ok: false, reason: given.reason });
            if (PASSED_OVER.has(given.reason)) continue;
            break;
          }
          landed.push(given);
          if (kind === "repair") repairs = (repairs ?? 0) + 1;
          helps.push({
            buildingId,
            kind,
            ok: true,
            ...(kind === "speedup" ? { secondsSaved: given.secondsSaved } : { healed: true as const }),
            reward: given.reward,
            rewardsLeft: rewardsLeftOf(visit.helpsBefore + landed.length),
            building: given.building,
          });
        }
        const rewardsLeft = rewardsLeftOf(visit.helpsBefore + landed.length);
        // Nothing went through: roll the catch-up back, as a refused single help does.
        if (landed.length === 0) throw new NothingLanded(helps, rewardsLeft);

        await recordHelps(
          tx,
          landed.map((help) => helpRecordOf(visit, helper, owner, help, now))
        );
        await tx.flush();
        return {
          helps,
          landed,
          rewardsLeft,
          helperName: visit.mySide.username,
          ownerFlingerBefore: visit.ownerFlingerBefore,
          ownerFlingerAfter: flingerClockOf(visit.theirs, now),
        };
      })
    );
  } catch (err) {
    if (err instanceof NothingLanded) return { error: 0, helps: err.helps, rewardsLeft: err.rewardsLeft };
    throw err;
  }

  await dropOwnerSight(owner, done.ownerFlingerBefore, done.ownerFlingerAfter);
  await notifyFriendOfAll(
    em,
    owner,
    done.landed.map((help) => helpNoticeOf(helper, done.helperName, help)),
    new Date(now * 1000)
  );
  // The owner's open yard reads itself again on their next presence ping (#374).
  await markHelped(owner, now);

  const passed = done.helps.length - done.landed.length;
  logger.info(`Help all by ${helper} on ${owner}: ${done.landed.length} helped, ${passed} refused, of ${targets.length}`);
  return { error: 0, helps: done.helps, rewardsLeft: done.rewardsLeft };
};
