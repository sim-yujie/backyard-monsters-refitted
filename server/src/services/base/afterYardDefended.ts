import type { EntityManager } from "@mikro-orm/postgresql";

import type { Save } from "../../database/models/save.model.js";
import { BaseType } from "../../enums/Base.js";
import { MapRoomVersion } from "../../enums/MapRoom.js";
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
  /** The defence replay the landing recorded first, for the notice's Watch button (#359); null for none. */
  readonly replayId?: number | null;
}

/**
 * Runs once a Map Room 1 or Map Room 2 main yard's defence has landed, from
 * both landings: the attacker's final save (`baseSave.ts`) and the server
 * finishing it from a checkpoint (`finaliseAttack.ts`). Issue #241; Map Room 2
 * by issue #361, `docs/design/defence-replays.md` §8.
 *
 * A real defender is sent the defence notice, carrying on Map Room 2 the
 * defence replay the landing recorded for its Watch button. Its next own-yard
 * load shows it in "While you were away" (`takeOutpostNotices`). A seeded Map
 * Room 2 dev player (`seededPlayers.ts`) is told as a real defender is;
 * `db:seed:mr2` leaves their saves on `mapversion` 1 (the column's default)
 * though they sit on a Map Room 2 world, so they come through here.
 *
 * A retired bot's yard gets nothing: nobody reads its mailbox. Until beta 9 an
 * attack on a bot also booked its repair and maybe a revenge for the bot
 * sweep, which was removed with the rest of the bot system (bots
 * decommissioned, owner 12 + 13 Nov 2026).
 *
 * Nothing it learns reaches the attacker's response: it returns nothing.
 */
export const afterYardDefended = async (em: EntityManager, defence: YardDefence): Promise<void> => {
  const { yard, attacker } = defence;
  if (yard.type !== BaseType.MAIN) return;
  if (yard.mapversion !== MapRoomVersion.V1 && yard.mapversion !== MapRoomVersion.V2) return;
  if (!yard.saveuserid || yard.saveuserid === attacker.userid) return;

  if (!(await isBot(yard.saveuserid, em))) await noticeYardAttack(em, defence);
};
