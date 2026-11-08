import type { EntityManager } from "@mikro-orm/postgresql";
import { TruceStatus } from "../../../enums/TruceStatus.js";
import type { TruceInfo } from "../getTruces.js";

/**
 * Who is HOSTILE to the viewer on Map Room 2 (owner, 8 Nov 2026): a player with at least one
 * attack between the two of them, in either direction, with no time limit, unless a truce with
 * them is running. The map paints a hostile player's yard and outposts with the red border and
 * the cell carries `ho: 1` (`userCell.ts`). A friend or alliance-mate who is also hostile is shown
 * as the friend or alliance-mate: the client decides that order (`cellVisuals.relationOf`).
 *
 * The rule lives here in two halves so it is easy to change:
 *  - {@link attackedBetween}: which players have an attack with the viewer (the time window, if
 *    one is ever wanted, goes in its query: `AND attacktime > now() - interval '7 days'`);
 *  - {@link isHostile}: what can switch it off (a running truce today).
 *
 * An outpost attack logs the owner's main yard as defender (`attackers.ts`), so attacks on and
 * from outposts count too. Both directions use an index (`attack_logs` is indexed by attacker
 * and by defender), one query per map area, never one per cell.
 */
export const attackedBetween = async (
  em: EntityManager,
  userid: number | undefined,
  ownerIds: readonly number[],
): Promise<Set<number>> => {
  const others = [...new Set(ownerIds)].filter((id) => id !== userid);
  if (userid === undefined || others.length === 0) return new Set();
  const marks = others.map(() => "?").join(", ");
  const rows = await em.execute<{ other: number }[]>(
    `SELECT attacker_userid AS other FROM bym.attack_logs WHERE defender_userid = ? AND attacker_userid IN (${marks})
     UNION
     SELECT defender_userid AS other FROM bym.attack_logs WHERE attacker_userid = ? AND defender_userid IN (${marks})`,
    [userid, ...others, userid, ...others],
  );
  return new Set(rows.map((row) => Number(row.other)));
};

/** A truce both players agreed to that has not ended yet (a request still waiting does not count). */
export const truceRunning = (truce: TruceInfo | undefined, now: number): boolean =>
  truce?.trucestate === TruceStatus.ACCEPTED && (truce.expires_at ?? 0) > now;

/** The hostile rule for one other player: an attack between you, and no truce running. */
export const isHostile = (attacked: boolean, truce: TruceInfo | undefined, now: number): boolean =>
  attacked && !truceRunning(truce, now);
