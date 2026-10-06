import type { User } from "../../database/models/user.model.js";
import { Status } from "../../enums/StatusCodes.js";
import { raidRefusedErr } from "../../errors/errors.js";
import { postgres } from "../../server.js";
import {
  engageRaid,
  finishRaid,
  makeRaidDue,
  prepareRaid,
  setRaidPreference,
  startRaid,
} from "../../services/raids/raidFlow.js";
import { parseRaidPreference } from "../../services/raids/raidSchedule.js";
import { devPlaceTrojanHorse } from "../../services/raids/trojanHorse.js";
import type { KoaController } from "../../utils/KoaController.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { devCheckEnabled } from "../maproom/botCheck.js";

/**
 * `POST /api/:apiVersion/bm/raid/<step>`: a wild monster raid on the player's
 * own yard (#226 WP3, `docs/design/wild-raids.md` §4.2). The raid itself is
 * opened by the presence ping (`controllers/maproom/presence.ts`); these are
 * the player's answers to it. Each is a real game action (`realActions.ts`),
 * so watching a raid keeps the player online. Refusals are
 * `raidRefusedErr` (`errors.ts`), `{ error, reason }`.
 *
 * - `engage { id }`: "Engage now". Answers `{ raid }`.
 * - `prepare { id }`: "Prepare defences". Answers `{ raid }`.
 * - `start { id }`: the fight, run by the server. Answers `{ raid, fight }`.
 * - `finish { id }`: the fight is over on the client. Answers `{ result }`.
 * - `frequency { preference: "more" | "same" | "less" }`. Answers
 *   `{ preference, nextAttack }`.
 * - `dev/due` (local server only): the next raid is due now.
 * - `dev/trojan` (local server only): a Trojan Horse now, score and the
 *   once-per-account flag both ignored (`docs/design/trojan-horse.md` §7).
 */

const raidIdOf = (body: unknown): unknown => (body as { id?: unknown } | undefined)?.id;

export const raidEngage: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  ctx.status = Status.OK;
  ctx.body = { error: 0, raid: await engageRaid(user.userid, raidIdOf(ctx.request.body), getCurrentDateTime()) };
};

export const raidPrepare: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  ctx.status = Status.OK;
  ctx.body = { error: 0, raid: await prepareRaid(user.userid, raidIdOf(ctx.request.body), getCurrentDateTime()) };
};

export const raidStart: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  const start = await startRaid(postgres.em, user, raidIdOf(ctx.request.body), getCurrentDateTime());
  ctx.status = Status.OK;
  ctx.body = { error: 0, ...start };
};

export const raidFinish: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  const result = await finishRaid(postgres.em, user, raidIdOf(ctx.request.body), getCurrentDateTime());
  ctx.status = Status.OK;
  ctx.body = { error: 0, result };
};

export const raidFrequency: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  const preference = parseRaidPreference((ctx.request.body as { preference?: unknown } | undefined)?.preference);
  if (preference === null) throw raidRefusedErr("badRequest");
  ctx.status = Status.OK;
  ctx.body = { error: 0, ...(await setRaidPreference(postgres.em, user, preference)) };
};

/** DEV only: `app.routes.ts` mounts it on a local server alone, and it refuses anywhere else as well. */
export const raidDevDue: KoaController = async (ctx) => {
  if (!devCheckEnabled()) throw raidRefusedErr("badRequest");
  const user: User = ctx.authUser;
  ctx.status = Status.OK;
  ctx.body = { error: 0, ...(await makeRaidDue(postgres.em, user, getCurrentDateTime())) };
};

/** DEV only: `app.routes.ts` mounts it on a local server alone, and it refuses anywhere else as well. */
export const raidDevTrojan: KoaController = async (ctx) => {
  if (!devCheckEnabled()) throw raidRefusedErr("badRequest");
  const user: User = ctx.authUser;
  ctx.status = Status.OK;
  ctx.body = { error: 0, ...(await devPlaceTrojanHorse(postgres.em, user, getCurrentDateTime())) };
};
