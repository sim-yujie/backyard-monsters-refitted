import type { User } from "../../database/models/user.model.js";
import { Status } from "../../enums/StatusCodes.js";
import { postgres } from "../../server.js";
import { readWaveStatus, startNextWave, surrenderWave } from "../../services/events/waves/waveFight.js";
import type { KoaController } from "../../utils/KoaController.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";

/**
 * The wave event on now (beta 10, Wild Monster Invasion and later wave events;
 * `services/events/waves/`):
 * - `GET /api/:apiVersion/bm/events/wave`: `{ wave }`, the event on now and
 *   the player's place in it (`WaveStatus`), or `{ wave: null }` with none on.
 * - `POST /api/:apiVersion/bm/events/wave/next`: "Next wave", fought by the
 *   server and answered as `/raid/start` is (`{ raid, fight }`) plus `wave`,
 *   the status it was called from. It lands through `/raid/finish` like any
 *   raid; the result carries `wave` (`WaveResult`).
 * - `POST /api/:apiVersion/bm/events/wave/surrender { id, tick }`: the wave
 *   lost, landing only the damage done up to `tick`; answers `{ result }` as
 *   `/raid/finish` does.
 */
export const waveStatusController: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  ctx.status = Status.OK;
  ctx.set("Cache-Control", "no-store");
  ctx.body = { error: 0, wave: await readWaveStatus(postgres.em.fork(), user.userid, getCurrentDateTime()) };
};

export const waveNextController: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  const start = await startNextWave(postgres.em, user, getCurrentDateTime());
  ctx.status = Status.OK;
  ctx.body = { error: 0, ...start };
};

export const waveSurrenderController: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  const body = (ctx.request.body ?? {}) as { id?: unknown; tick?: unknown };
  const result = await surrenderWave(postgres.em, user, body.id, body.tick, getCurrentDateTime());
  ctx.status = Status.OK;
  ctx.body = { error: 0, result };
};
