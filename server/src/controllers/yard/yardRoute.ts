import type z from "zod";
import type { Save } from "../../database/models/save.model.js";
import type { User } from "../../database/models/user.model.js";
import { postgres } from "../../server.js";
import { invalidateSightIfFlingerChanged } from "../../services/maproom/sight/sightService.js";
import { isAttackActive } from "../../services/base/isAttackActive.js";
import { settleKrallenHunts } from "../../services/events/krallenPenalty.js";
import { sqlProgressStore, type KrallenPenaltyNotice } from "../../services/events/progressStore.js";
import { notifyAndCount } from "../../services/notifications/notifications.js";
import { countRaidSession } from "../../services/raids/raidSchedule.js";
import { placeTrojanHorse } from "../../services/raids/trojanHorse.js";
import type { CompletedJob } from "../../services/yard/catchUp.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import type { KoaController } from "../../utils/KoaController.js";
import {
  catchUpLockedOutpost,
  catchUpLockedYard,
  runYardAction,
  type YardAction,
} from "./yardAction.js";

/**
 * `yardRoute(action)`: a yard action as a Koa controller, run against the
 * request's `postgres.em` (`docs/design/yard-buildings.md` §2.1). Everything
 * it does is in `yardAction.ts`; this file only binds it to Koa.
 *
 * After a successful action, once its transaction has committed, what the
 * catch-up finished goes into the player's notification list, one row per
 * kind of job, and the answer carries the unread count as `notifications`
 * for the yard's bell (issue #257, `services/notifications/notifications.ts`).
 * A failure there is logged and leaves the count out; the action stands.
 *
 * FROZEN (2026-09-27): `yardRoute(action: YardAction<Schema, Report>): KoaController`.
 */
export const yardRoute =
  <Schema extends z.ZodType, Report>(action: YardAction<Schema, Report>): KoaController =>
  async (ctx) => {
    const user: User = ctx.authUser;
    const answer = await runYardAction(postgres.em, user, action, ctx.request.body);
    // `runYardAction` stays drivable without a server (its own file comment),
    // so the actual Redis invalidation happens here instead (issue #329,
    // #330 WP1).
    await invalidateSightIfFlingerChanged(user, answer.flingerBefore, answer.flingerAfter);

    if (answer.outpost !== undefined) {
      const completed = (answer.body["completed"] ?? []) as CompletedJob[];
      const unread = await notifyAndCount(postgres.em, user.userid, answer.outpost, "jobs", completed);
      if (unread !== undefined) answer.body["notifications"] = unread;
    }

    ctx.status = answer.status;
    ctx.body = answer.body;
  };

/**
 * The catch-up on the owner's build-mode `/base/load` of their main yard,
 * locked and written (`catchUpLockedYard`): the save, and what finished.
 * The load is one more session towards the next wild monster raid, counted
 * in the same flush (`countRaidSession`, #226); the same lock also places the
 * Trojan Horse the moment the player qualifies for one (`placeTrojanHorse`,
 * issue #324), so two loads at once still place exactly one.
 */
export const catchUpOwnerYard = async (
  save: Save
): Promise<{ save: Save; completed: CompletedJob[]; trojanPlaced: boolean; krallenPenalties: KrallenPenaltyNotice[] }> => {
  // An alliance trade request that ran out, or whose alliance the player
  // left, gives back what it holds first, so the yard loads with it (one
  // indexed look when there is none; never throws). Loaded lazily: the load
  // path need not pull in the alliance modules.
  const { refundStaleRequests } = await import("../../services/alliance/trade.js");
  await refundStaleRequests(postgres.em, save.userid, getCurrentDateTime());
  let trojanPlaced = false;
  let krallenPenalties: KrallenPenaltyNotice[] = [];
  return catchUpLockedYard(postgres.em, save, async (locked, now, tx) => {
    countRaidSession(locked, now);
    trojanPlaced = placeTrojanHorse(locked, now);
    // The Krallen Hunt's penalty for hunts over since the last load, and the
    // one-time notice of any not yet told (`krallenPenalty.ts`).
    krallenPenalties = await settleKrallenHunts(tx, sqlProgressStore, locked, now, {
      underAttack: isAttackActive(locked),
    });
  }).then((result) => ({ ...result, trojanPlaced, krallenPenalties }));
};

/**
 * The catch-up on the owner's build-mode `/base/load` of one of their Map
 * Room 2 outposts, locked (main row, then outpost) and written
 * (`catchUpLockedOutpost`): the outpost, and what finished.
 */
export const catchUpOwnerOutpost = (
  user: User,
  outpost: Save
): Promise<{ save: Save; completed: CompletedJob[] }> =>
  catchUpLockedOutpost(postgres.em, user, outpost);
