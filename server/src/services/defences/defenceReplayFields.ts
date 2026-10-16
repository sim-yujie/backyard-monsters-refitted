import type { JsonObject } from "../../types/JsonObject.js";

/**
 * What of an attack load a defence replay keeps (issue #359), on its own so
 * the Defences API (#360) can cut a stored yard down again without loading
 * Redis.
 */

/**
 * The attack load's fields a replay keeps, as the web client reads them:
 * `readYard` (`game/yard/yardModel.ts`) draws the yard from the first group,
 * and `AttackSession.load` builds the battle from the second.
 */
export const DEFENCE_REPLAY_LOAD_FIELDS = [
  // The yard as drawn: its kind, name and level, buildings, health and pool,
  // the caged champion, the mushrooms, and the clock its countdowns run from.
  "type",
  "basename",
  "level",
  "buildingdata",
  "buildinghealthdata",
  "resources",
  "champion",
  "mushrooms",
  "savetime",
  "currenttime",
  // The battle as served (issues #167, #179, #195, #201, #219, #352).
  "cellheight",
  "defenderforces",
  "attpowerups",
  "attackerlevel",
  "attackeracademy",
  "attackerranks",
  "attackerbrains",
] as const;

/**
 * The attack load cut down to {@link DEFENCE_REPLAY_LOAD_FIELDS}, plus the one
 * purchase the yard's drawing reads: its expansion (`storedata.ENL`, the yard's
 * size). The rest of `storedata` is the defender's shop history and stays out.
 *
 * @param response - The attack load as served.
 */
export const defenceReplayLoadOf = (response: Readonly<Record<string, unknown>>): JsonObject => {
  const load: JsonObject = {};
  for (const field of DEFENCE_REPLAY_LOAD_FIELDS) {
    if (response[field] !== undefined) load[field] = response[field] as JsonObject[string];
  }
  const storedata = response.storedata as Record<string, unknown> | null | undefined;
  if (storedata && typeof storedata === "object" && storedata.ENL !== undefined) {
    load.storedata = { ENL: storedata.ENL as JsonObject[string] };
  }
  return load;
};
