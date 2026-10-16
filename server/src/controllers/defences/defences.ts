import type { EntityManager } from "@mikro-orm/core";
import z from "zod";
import { DefenceReplay } from "../../database/models/defencereplay.model.js";
import type { User } from "../../database/models/user.model.js";
import { Status } from "../../enums/StatusCodes.js";
import { defenceReplayLoadOf } from "../../services/defences/defenceReplayFields.js";
import { decodeReplay, DEFENCE_REPLAY_LIMIT, type DefenceReplayPayload } from "../../services/defences/defenceReplayStore.js";
import { RULES_VERSION } from "../../services/defences/rulesVersion.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { logger } from "../../utils/logger.js";

/**
 * The Defences screen's routes (`docs/design/defence-replays.md` §6, issue
 * #360), as functions of an entity manager and the caller so they run under
 * test; `routes.ts` binds them to Koa and `postgres.em`. Each reads the
 * caller's own rows only, and only reads.
 *
 * - `GET /api/:apiVersion/defences`             → `{ error: 0, defences: Defence[] }`
 * - `GET /api/:apiVersion/defences/:id/replay`  → `{ error: 0, defence: Defence, replay: payload }`
 *
 * Another player's replay, or one that does not exist, is the same `404`, so
 * an id says nothing about whose it is. A row kept without its inputs is
 * `410`. Nothing here, nor anything sent, says whether the attacker is a bot
 * (§9): the attacker is the name and picture frozen at landing, never their id.
 */

export interface DefencesAnswer {
  status: number;
  body: Record<string, unknown>;
}

/**
 * The Map Rooms whose defences are listed: Map Room 2 only until #246 turns
 * Map Room 1 on (owner decision 1). A row stays listed after its defender
 * moves on (§9); it was recorded on Map Room 2.
 */
export const LISTED_MAP_VERSIONS: readonly number[] = [2];

/** One defence as the list (and the replay's figures) send it. */
export interface Defence {
  id: number;
  attacker: { name: string; pic: string | null };
  /** Unix seconds: when the attack started, and when it landed (the order). */
  attackedAt: number;
  landedAt: number;
  /** The damage % this attack did (after - before), and the % it left the yard at. */
  damageDone: number;
  damageAfter: number;
  /** What the defender lost, whole positive amounts by resource (`r1`-`r4`). */
  loot: JsonObject;
  housedLost: number;
  /** The attacker left (tab closed, timed out): it landed from its checkpoint. */
  left: boolean;
  /** The combat rules it was fought under; the client compares its own. */
  rulesVersion: string;
  /** Its inputs were kept. */
  hasReplay: boolean;
  /** Kept, and fought under this server's rules; Watch also needs the client's to match (§4). */
  playable: boolean;
}

/** The columns a list row reads: everything but the payload itself. */
const LIST_FIELDS = [
  "id",
  "attacker_username",
  "attacker_pic_square",
  "attacked_at",
  "landed_at",
  "damage_before",
  "damage_after",
  "loot",
  "housed_lost",
  "attacker_left",
  "rules_version",
  "replay_bytes",
] as const;

type ListedRow = Pick<DefenceReplay, (typeof LIST_FIELDS)[number]>;

const seconds = (at: Date | string): number => Math.floor(new Date(at).getTime() / 1000);

const defenceOf = (row: ListedRow): Defence => {
  const hasReplay = Number(row.replay_bytes) > 0;
  return {
    id: Number(row.id),
    attacker: { name: row.attacker_username, pic: row.attacker_pic_square ?? null },
    attackedAt: seconds(row.attacked_at),
    landedAt: seconds(row.landed_at),
    damageDone: Math.max(0, row.damage_after - row.damage_before),
    damageAfter: row.damage_after,
    loot: row.loot ?? {},
    housedLost: row.housed_lost,
    left: row.attacker_left,
    rulesVersion: row.rules_version,
    hasReplay,
    playable: hasReplay && row.rules_version === RULES_VERSION,
  };
};

/** The caller's newest {@link DEFENCE_REPLAY_LIMIT} defences, newest first, without their payloads. */
export const listAnswer = async (em: EntityManager, user: User): Promise<DefencesAnswer> => {
  const rows = await em.find(
    DefenceReplay,
    { defender_userid: user.userid, map_version: { $in: [...LISTED_MAP_VERSIONS] } },
    { fields: LIST_FIELDS, orderBy: { landed_at: "DESC", id: "DESC" }, limit: DEFENCE_REPLAY_LIMIT },
  );
  return { status: Status.OK, body: { error: 0, defences: rows.map(defenceOf) } };
};

const IdSchema = z.object({ id: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER) });

const notFound = (): DefencesAnswer => ({
  status: Status.NOT_FOUND,
  body: { error: "That defence could not be found.", reason: "notFound" },
});

const gone = (): DefencesAnswer => ({
  status: Status.GONE,
  body: { error: "Replay not available.", reason: "noReplay" },
});

/**
 * The payload as sent: the stored one with its `load` cut to the allow-list
 * once more, so a row written by older code cannot send more of the defender's
 * save than the attack scene reads.
 */
const sentPayload = (payload: DefenceReplayPayload): DefenceReplayPayload => ({
  ...payload,
  load: defenceReplayLoadOf(payload.load ?? {}),
});

/**
 * One of the caller's defences with its replay payload unzipped, for the
 * viewer. `404` unless the caller was the defender; `410` when the row has no
 * payload, or it cannot be read (logged). A replay fought under other rules is
 * still sent (`playable` false): the client decides.
 *
 * @param rawParams - The route params (`id`).
 */
export const replayAnswer = async (em: EntityManager, user: User, rawParams: unknown): Promise<DefencesAnswer> => {
  const parsed = IdSchema.safeParse(rawParams ?? {});
  if (!parsed.success) return notFound();

  const row = await em.findOne(
    DefenceReplay,
    { id: parsed.data.id, defender_userid: user.userid, map_version: { $in: [...LISTED_MAP_VERSIONS] } },
    { fields: [...LIST_FIELDS, "replay"] },
  );
  if (!row) return notFound();
  if (!row.replay) return gone();

  let payload: DefenceReplayPayload;
  try {
    payload = decodeReplay(row.replay);
  } catch (error) {
    logger.warn("defence-replay-unreadable: replay {id}: {error}", { id: row.id, error: String(error) });
    return gone();
  }
  return { status: Status.OK, body: { error: 0, defence: defenceOf(row), replay: sentPayload(payload) } };
};
