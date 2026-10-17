import type { EntityManager } from "@mikro-orm/postgresql";
import { gunzipSync, gzipSync } from "node:zlib";

import { DefenceReplay } from "../../database/models/defencereplay.model.js";
import type { FlingLog } from "../../game-rules/combat/types.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { logger } from "../../utils/logger.js";
import { RULES_VERSION } from "./rulesVersion.js";

/**
 * Storing defence replays (`docs/design/defence-replays.md` §3, issue #358):
 * one row per landed attack on a player's main yard, with the inputs to fight
 * the battle again gzipped into `replay`, and only the newest
 * {@link DEFENCE_REPLAY_LIMIT} per defender kept.
 *
 * Nothing here decides which attacks are recorded, and nothing asks whether
 * either side is a bot: the landing's gate does the first (§5), and the second
 * must never be told apart (§9).
 */

/** How many replays a defender keeps; older ones are deleted [owner]. */
export const DEFENCE_REPLAY_LIMIT = 20;

/** The payload's own format, `v` in the JSON. */
export const DEFENCE_REPLAY_PAYLOAD_VERSION = 1;

/**
 * The most a stored payload may weigh, gzipped. A whole yard and a full fling
 * log come to ~10-15 KB (§3); anything near this is not a battle the client
 * sent in good faith, so its row is kept without a replay rather than bloat
 * the table.
 */
export const MAX_REPLAY_BYTES = 256 * 1024;

/** The most a payload may unzip to, so a damaged row cannot exhaust memory. */
export const MAX_REPLAY_RAW_BYTES = 8 * 1024 * 1024;

/**
 * Everything needed to play the battle again (§3). `load` is the attack load
 * as served to the attacker, allow-listed to what the attack scene reads, with
 * its `buildingdata` and `buildinghealthdata` the ones the server fought; the
 * recording (#359) fills it.
 */
export interface DefenceReplayPayload {
  readonly v: typeof DEFENCE_REPLAY_PAYLOAD_VERSION;
  readonly load: JsonObject;
  readonly seed: number;
  /** The fightable log the server replayed (`LandedAttack.fought`). */
  readonly events: FlingLog["events"];
  /** The tick the battle ran to. */
  readonly tick: number;
  /** The attacker's monster levels and ranks as fought. */
  readonly levels: JsonObject;
  readonly ranks?: JsonObject;
  /** The attacker's champion and brains, and siege, as fought. */
  readonly champion?: unknown;
  readonly siege?: JsonObject | null;
  readonly declareWar: boolean;
  /** The attack report text. */
  readonly report?: unknown;
}

/** One landed attack, as the landing hands it over. */
export interface DefenceReplayRecord {
  readonly defenderUserid: number;
  /** The defender's main yard. */
  readonly baseid: string;
  readonly mapVersion: number;
  readonly attacker: {
    readonly userid: number;
    readonly username: string;
    readonly picSquare?: string | null;
  };
  /** When the attack session started, and when it landed. */
  readonly attackedAt: Date;
  readonly landedAt: Date;
  /** The yard's whole damage % before and after the attack. */
  readonly damageBefore: number;
  readonly damageAfter: number;
  /** What the defender lost (`defenderDelta`). */
  readonly loot: JsonObject;
  /** Housed monsters the defender lost. */
  readonly housedLost: number;
  /** The attacker left: landed from its checkpoint by the finaliser. */
  readonly left: boolean;
  /** Null when the inputs were missing (e.g. Redis lost the load, §9). */
  readonly payload: DefenceReplayPayload | null;
}

/** A payload as stored: gzipped JSON. */
export const encodeReplay = (payload: DefenceReplayPayload): Buffer =>
  gzipSync(JSON.stringify({ ...payload, v: DEFENCE_REPLAY_PAYLOAD_VERSION }));

/**
 * A stored payload back. Throws on a payload that does not unzip, is bigger
 * than {@link MAX_REPLAY_RAW_BYTES} unzipped, or is of another format.
 */
export const decodeReplay = (stored: Uint8Array): DefenceReplayPayload => {
  const payload = JSON.parse(gunzipSync(stored, { maxOutputLength: MAX_REPLAY_RAW_BYTES }).toString("utf8"));
  if (payload?.v !== DEFENCE_REPLAY_PAYLOAD_VERSION) {
    throw new Error(`Defence replay payload has format ${JSON.stringify(payload?.v)}, not ${DEFENCE_REPLAY_PAYLOAD_VERSION}`);
  }
  return payload as DefenceReplayPayload;
};

/**
 * What goes in `replay`: the payload gzipped, or null when there is none or it
 * is over {@link MAX_REPLAY_BYTES} (logged; the row is still written).
 */
export const storedReplay = (record: DefenceReplayRecord): Buffer | null => {
  if (!record.payload) return null;
  const stored = encodeReplay(record.payload);
  if (stored.byteLength <= MAX_REPLAY_BYTES) return stored;
  logger.warn("defence-replay-too-big: {bytes} bytes for defender {userid}; row kept without its replay", {
    bytes: stored.byteLength,
    userid: record.defenderUserid,
  });
  return null;
};

/**
 * Deletes the defender's replays beyond their newest {@link DEFENCE_REPLAY_LIMIT}.
 * A notice that pointed at one loses its `replayid` (the column's foreign key).
 *
 * @returns How many rows went.
 */
export const pruneDefenceReplays = async (em: EntityManager, defenderUserid: number): Promise<number> => {
  const deleted = await em.execute<{ id: number }[]>(
    `DELETE FROM "bym"."defence_replay"
      WHERE "id" IN (
        SELECT "id" FROM "bym"."defence_replay"
         WHERE "defender_userid" = ?
         ORDER BY "landed_at" DESC, "id" DESC
        OFFSET ?
      )
      RETURNING "id"`,
    [defenderUserid, DEFENCE_REPLAY_LIMIT],
  );
  return deleted.length;
};

/**
 * Writes one landed attack's row, then prunes the defender's to the newest
 * {@link DEFENCE_REPLAY_LIMIT}, in one transaction. Attacks on one yard cannot
 * overlap, so two inserts never race to prune.
 *
 * @param rulesVersion - The combat rules the battle was fought under; this
 *   server's own unless a test says otherwise.
 * @returns The new row's id, for the notice's Watch button.
 */
export const storeDefenceReplay = async (
  em: EntityManager,
  record: DefenceReplayRecord,
  rulesVersion: string = RULES_VERSION,
): Promise<number> => {
  const replay = storedReplay(record);
  return em.transactional(async (tx) => {
    const id = await tx.insert(DefenceReplay, {
      defender_userid: record.defenderUserid,
      baseid: record.baseid,
      map_version: record.mapVersion,
      attacker_userid: record.attacker.userid,
      attacker_username: record.attacker.username,
      attacker_pic_square: record.attacker.picSquare ?? null,
      attacked_at: record.attackedAt,
      landed_at: record.landedAt,
      damage_before: record.damageBefore,
      damage_after: record.damageAfter,
      loot: record.loot,
      housed_lost: record.housedLost,
      attacker_left: record.left,
      rules_version: rulesVersion,
      replay,
      replay_bytes: replay?.byteLength ?? 0,
    });
    await pruneDefenceReplays(tx, record.defenderUserid);
    return Number(id);
  });
};
