import { postgres } from "../../server.js";
import { Status } from "../../enums/StatusCodes.js";
import type { User } from "../../database/models/user.model.js";
import {
  ConstellationStepSchema,
  RemoveGoalSchema,
  SetGoalSchema,
  TerritoryBoardSchema,
} from "../../schemas/AllianceSchemas.js";
import { getUserAlliance } from "../../services/alliance/allianceAccess.js";
import { getAllianceMessages } from "../../services/alliance/allianceMessages.js";
import { AllianceMessageType } from "../../enums/Alliance.js";
import {
  lightStar,
  removeGoal,
  setGoal,
  suggestStar,
  territoryBoard,
} from "../../services/alliance/allianceProgress.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import type { KoaController } from "../../utils/KoaController.js";

/**
 * The alliance dashboard's actions (beta 7 alliances phase 2, design v5 §8,
 * §9, §11): light and suggest constellation steps, add and remove weekly
 * goals, read a territory board. Every rule is in
 * `services/alliance/allianceProgress.ts`; the window reloads `myalliance`
 * after each.
 */

/** POST /alliance/lightstar {constellation}: Leader and Officers. */
export const lightStarController: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  const { constellation } = ConstellationStepSchema.parse(ctx.request.body);
  const lit = await lightStar(postgres.em, user.userid, constellation, getCurrentDateTime());
  ctx.status = Status.OK;
  ctx.body = { error: 0, step: lit.step, price: lit.price, stars: lit.stars };
};

/** POST /alliance/suggeststar {constellation}: any member. */
export const suggestStarController: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  const { constellation } = ConstellationStepSchema.parse(ctx.request.body);
  const added = await suggestStar(postgres.em, user.userid, constellation);
  ctx.status = Status.OK;
  ctx.body = { error: 0, added };
};

/** POST /alliance/setgoal {kind, tier}: Leader and Officers. */
export const setGoalController: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  const { kind, tier } = SetGoalSchema.parse(ctx.request.body);
  await setGoal(postgres.em, user.userid, kind, tier, getCurrentDateTime());
  ctx.status = Status.OK;
  ctx.body = { error: 0 };
};

/** POST /alliance/removegoal {goal_id}: Leader and Officers, at 0 progress. */
export const removeGoalController: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  const { goal_id } = RemoveGoalSchema.parse(ctx.request.body);
  await removeGoal(postgres.em, user.userid, goal_id, getCurrentDateTime());
  ctx.status = Status.OK;
  ctx.body = { error: 0 };
};

/** GET /alliance/territory?type=: a type's board (own type by default). */
export const territoryController: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  const { type } = TerritoryBoardSchema.parse(ctx.query ?? {});
  const alliance = type ? null : await getUserAlliance(user);
  const board = type ?? alliance?.type;
  ctx.status = Status.OK;
  ctx.body = {
    error: 0,
    type: board ?? null,
    rows: board ? await territoryBoard(postgres.em, board, getCurrentDateTime()) : [],
  };
};

/**
 * GET /alliance/news: the alliance's automatic lines (joins, leaves, stars
 * lit, goals, attacks...), newest first, for the All news panel (design v5
 * §7b). Chat messages stay in the Alliance chat room.
 */
export const allianceNewsController: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  const alliance = await getUserAlliance(user);
  const feed = alliance ? await getAllianceMessages(alliance.id) : [];
  ctx.status = Status.OK;
  ctx.body = {
    error: 0,
    news: feed
      .filter((entry) => entry.messageType !== AllianceMessageType.MESSAGE && entry.body)
      .toReversed()
      .map(({ displayName, body, ts, messageType, cell }) => ({ name: displayName, text: body, ts, type: messageType, cell })),
  };
};
