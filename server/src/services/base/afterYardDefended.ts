import type { EntityManager } from "@mikro-orm/postgresql";

import type { Save } from "../../database/models/save.model.js";
import { BaseType } from "../../enums/Base.js";
import { MapRoomVersion } from "../../enums/MapRoom.js";
import { logger } from "../../utils/logger.js";
import { scheduleAfterBotDefence } from "../bots/afterAttack.js";
import { isBot } from "../bots/isBot.js";
import { noticeYardAttack, type ResourceAmounts } from "../maproom/v2/outpostNotices.js";

export interface YardDefence {
  /** The defender's row, as the attack landed it (damage written). */
  readonly yard: Pick<Save, "baseid" | "saveuserid" | "type" | "mapversion" | "damage">;
  readonly attacker: { userid: number; username: string };
  /** The defender's loss as the attack landed it (never positive). */
  readonly defenderDelta: ResourceAmounts | null | undefined;
  /** Housed monsters lost with the yard's fallen Housings (issue #160). */
  readonly housedLost?: number;
  /** When the attack landed, in seconds. */
  readonly now: number;
}

/**
 * Runs once a Map Room 1 main yard's defence has landed, from both landings:
 * the attacker's final save (`baseSave.ts`) and the server finishing it from a
 * checkpoint (`finaliseAttack.ts`, which a bot's revenge lands through too).
 * Issue #241, `docs/design/bot-neighbours.md` §4.5 and §4.8.
 *
 * - A real defender is sent the defence notice, whoever attacked: a real
 *   player or a bot's revenge get the same words, so the notice can never
 *   tell a bot (decision 3). Its next own-yard load shows it in "While you
 *   were away" (`takeOutpostNotices`).
 * - A bot defender attacked by a real player books its repair and maybe a
 *   revenge (`scheduleAfterBotDefence`). It gets no notice: nobody reads a
 *   bot's mailbox.
 *
 * Nothing it learns reaches the attacker's response: it returns nothing, and a
 * failure to book bot jobs is logged, never thrown into the landing.
 */
export const afterYardDefended = async (em: EntityManager, defence: YardDefence): Promise<void> => {
  const { yard, attacker } = defence;
  if (yard.type !== BaseType.MAIN || yard.mapversion !== MapRoomVersion.V1) return;
  if (!yard.saveuserid || yard.saveuserid === attacker.userid) return;

  if (!(await isBot(yard.saveuserid, em))) {
    await noticeYardAttack(em, defence);
    return;
  }
  if (await isBot(attacker.userid, em)) return;

  try {
    await scheduleAfterBotDefence(em, { bot: yard.saveuserid, attacker: attacker.userid, at: new Date(defence.now * 1000) });
  } catch (error) {
    logger.error("Could not book bot {bot}'s jobs after an attack", {
      event: "bot-after-attack-failed",
      bot: yard.saveuserid,
      attackerid: attacker.userid,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
