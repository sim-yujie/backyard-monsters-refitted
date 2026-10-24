import { LockMode } from "@mikro-orm/core";
import type { KoaController } from "../../utils/KoaController.js";
import type { User } from "../../database/models/user.model.js";
import { Save } from "../../database/models/save.model.js";
import { postgres } from "../../server.js";
import { Status } from "../../enums/StatusCodes.js";
import { BaseType } from "../../enums/Base.js";
import { baseNotFoundErr } from "../../errors/errors.js";
import { UpdateSoundSchema } from "../../schemas/AuthSchemas.js";
import { soundSettingsOf, withSoundSettings } from "../../services/sound/soundSettings.js";

/** The player's main yard, or null before they have one. */
const mainSaveOf = (user: User): Promise<Save | null> => {
  const basesaveid = user.save?.basesaveid;
  if (basesaveid == null) return Promise.resolve(null);
  return postgres.em.findOne(Save, { basesaveid, type: BaseType.MAIN, userid: user.userid });
};

/**
 * `GET /player/sound`: the player's music and effects switches, as saved
 * with their main yard, the defaults filled in
 * (`services/sound/soundSettings.ts`). An account without a yard yet is a
 * brand-new yard: music off, effects on.
 *
 * @returns `{ error: 0, sound: { music, effects } }`.
 */
export const getSoundSettings: KoaController = async (ctx) => {
  const save = await mainSaveOf(ctx.authUser);

  ctx.status = Status.OK;
  ctx.body = {
    error: 0,
    sound: save ? soundSettingsOf(save) : { music: false, effects: true },
  };
};

/**
 * `POST /player/sound`: turns music or effects on or off, saved with the
 * main yard so it follows the account. The body names only the switch that
 * changed (`UpdateSoundSchema`); the whole block comes back.
 *
 * The row is locked for the write, so a yard action or a load writing
 * `stats` at the same moment cannot lose the change or have its own lost.
 * Unlike Flash, which saved the switches only in the own yard (`SOUNDS.as:
 * 299,317`), this works from any screen: the account menu is on all of them.
 *
 * @returns `{ error: 0, sound: { music, effects } }`.
 */
export const updateSoundSettings: KoaController = async (ctx) => {
  const change = UpdateSoundSchema.parse(ctx.request.body);
  const user: User = ctx.authUser;
  const basesaveid = user.save?.basesaveid;
  if (basesaveid == null) throw baseNotFoundErr();

  const sound = await postgres.em.transactional(async (em) => {
    const save = await em.findOne(
      Save,
      { basesaveid, type: BaseType.MAIN, userid: user.userid },
      { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true }
    );
    if (!save) throw baseNotFoundErr();

    save.stats = withSoundSettings(save.stats, change);
    em.persist(save);
    await em.flush();
    return soundSettingsOf(save);
  });

  ctx.status = Status.OK;
  ctx.body = { error: 0, sound };
};
