import { User } from "../../database/models/user.model.js";
import { loadFailureErr, newVersionErr } from "../../errors/errors.js";
import { logAttackViolation } from "../base/reportManager.js";
import { monsterStats, mr3MonsterStats } from "../../game-data/stats/monsterStats.js";
import type { AttackData } from "../../schemas/AttackSchema.js";
import { type ChampionProps, championStats } from "../../game-data/stats/championStats.js";
import { CHAMPION_PROPS, MONSTER_PROPS } from "../../game-rules/combat/combatStatsData.js";
import { laddersMatch, pastChampionLadder, pastKnows, pastMonsterLadder } from "../../game-data/stats/pastAttackStats.js";
import { MapRoomVersion } from "../../enums/MapRoom.js";
import { Env } from "../../enums/Env.js";
import { logger } from "../../utils/logger.js";

// TODO:
// Validate monster count from flinger

/** What the "old page" log line carries besides the user: the route, the page's stamps, its address. */
export type OldPageLogFields = Readonly<Record<string, unknown>>;

/** How many mismatches the "old page" log line lists. */
const OLD_PAGE_LOG_LIMIT = 5;

/**
 * Validates the attack data sent by the client.
 * Ensures the structure is intact and all monster/champion stats match server-side definitions.
 *
 * A mismatch a page left open across a release would send is not tampering
 * (beta 10, owner's pick B+, 27 Nov 2026: never ban a player for a stale
 * page). It is refused with "New version" (`newVersionErr`, the page's
 * Reload card), nothing spent, nobody banned, when every mismatch is one of:
 *
 * - a stat the battle does not read: one the server's combat table
 *   (`game-rules/combat/combatStatsData.ts`) does not carry for that monster
 *   or champion, the training, hatching and feeding ladders above all. The
 *   rules stamp does not cover those, and the server reads nothing of
 *   `attackData` but this check, so refusing them costs no safety;
 * - a ladder, or a monster or champion, that a table this game has shipped
 *   held (`pastAttackStats.ts`).
 *
 * Any other mismatch bans and logs as before: a combat stat a page sends
 * that is neither the server's nor any shipped table's was changed by hand.
 *
 * @param {User} user - The user initiating the attack.
 * @param {AttackData} attackData - The payload sent from the client for an attack.
 * @param {MapRoomVersion} [mapVersion] - The map version of the attack, if applicable.
 * @param {OldPageLogFields} [logFields] - Added to the "old page" log line (route, stamps, address).
 * @throws Will throw an error if the data is missing, malformed, or tampered with.
 * @throws {ClientSafeError} `newVersionErr` when the data is an older page's.
 */
export const validateAttack = async (
  user: User,
  attackData: AttackData,
  mapVersion?: MapRoomVersion,
  logFields: OldPageLogFields = {}
) => {
  if (process.env.ENV === Env.LOCAL) return;

  if (!attackData || Object.keys(attackData).length === 0) {
    const message = "Attack payload was missing. Client modified.";
    await logAttackViolation(user, message);
    throw loadFailureErr();
  }

  if (!attackData.champions || !attackData.monsters) {
    const message = "Attack payload structure changed. Client modified.";
    await logAttackViolation(user, message);
    throw loadFailureErr();
  }

  const isInMaproom3 = mapVersion === MapRoomVersion.V3;
  /** Mismatches an older page would send: refused, never banned. */
  const stale: string[] = [];
  /** Mismatches no shipped page sends: banned. */
  const tampered: string[] = [];

  for (const monster of attackData.monsters) {
    const { id, stats } = monster;

    if (!monsterStats[id]) {
      const message = `Invalid monster ID: ${id}. Client modified.`;
      (pastKnows("monsters", id) ? stale : tampered).push(message);
      continue;
    }

    const expectedProps = (isInMaproom3 ? mr3MonsterStats[id]?.props : monsterStats[id].props) ?? {};
    const combatProps = MONSTER_PROPS[id]?.props ?? {};

    for (const key of Object.keys(expectedProps) as Array<keyof typeof expectedProps>) {
      const received = stats?.[key];
      const expected = expectedProps[key];
      if (laddersMatch(received, expected)) continue;

      const message = `${id}'s stat '${key}' was modified. Received: ${received} but expected ${expected}`;
      const battleReadsIt = key in combatProps;
      (!battleReadsIt || pastMonsterLadder(id, key, received) ? stale : tampered).push(message);
    }
  }

  for (const champion of attackData.champions) {
    const { type, stats } = champion;

    if (!championStats[type]) {
      const message = `Invalid champion type: ${type}. Client modified.`;
      (pastKnows("champions", type) ? stale : tampered).push(message);
      continue;
    }

    const championProps: ChampionProps = championStats[type].props;
    const combatProps = CHAMPION_PROPS[type]?.props ?? {};

    for (const key of Object.keys(championProps) as Array<keyof typeof championProps>) {
      const received = stats?.[key];
      const expected = championProps[key];
      if (laddersMatch(received, expected)) continue;

      const message = `${type}'s stat '${key}' was modified. Received: ${received} but expected ${expected}`;
      const battleReadsIt = key in combatProps;
      (!battleReadsIt || pastChampionLadder(type, key, received) ? stale : tampered).push(message);
    }
  }

  if (tampered.length > 0) {
    await logAttackViolation(user, tampered[0]);
    throw loadFailureErr();
  }

  if (stale.length > 0) {
    logger.info("Attack start refused for {username}: the page holds older monster stats", {
      ...logFields,
      event: "attack-start-old-page",
      reason: "stats",
      userid: user.userid,
      username: user.username,
      mismatches: stale.length,
      first: stale.slice(0, OLD_PAGE_LOG_LIMIT),
    });
    throw newVersionErr();
  }
};
