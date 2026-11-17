import { RESOURCE_KEYS, type ResourceAmounts } from "../../../game-rules/combat/index.js";

/**
 * Points for attack loot (patch 7.7.2): one point for each resource looted,
 * as Flash gave them.
 *
 * ## Flash
 *
 * Every attack save sends `lootreport`, the whole of `ATTACK._loot` with the
 * defender's name and whether the attacked yard was an Inferno one
 * (`client/scripts/BASE.as:2761-2769`, `:3265`). `_loot` is what the battle
 * took, before the attacker's storage cap: `ATTACK.Loot` adds the gain to it
 * first and only then fits the pool's share under the cap
 * (`client/scripts/ATTACK.as:677-710`). The server handed the report back as
 * `loot` on the attacker's next yard load (the same fields:
 * `BASE.as:971`, `:1803-1817`), and `BASE.Process` added each resource above 0
 * to that yard's `_basePoints` (`BASE.PointsAdd`, `BASE.as:1785-1801`,
 * `:4863-4865`), which the yard's next save stored (`BASE.as:3195`). So the
 * points are what was taken, loot that did not fit included, and they land on
 * the yard the attacker comes home to (`ATTACK.as:996-1003`,
 * `BASE.as:3352-3358`): the main yard after a surface attack (an outpost's
 * points are the main yard's), the Inferno yard after an Inferno one, and the
 * main yard after a Descent attack, which Flash fights as an Inferno yard but
 * comes home from to the surface (`ATTACK.as:998-999`; the "You looted"
 * pop-up is hidden there, `BASE.as:1803`, but the points were added above it).
 *
 * ## Here
 *
 * The server adds them where it banks the loot, in the same write and under
 * the same once-only guard, so an attack that lands gives its points exactly
 * once and one that is refused, rolled back or never lands gives none. The
 * amount is the gain the landing hands to the attacker's pool before the
 * storage cap (`bankAttackLoot`, `fundPurse`), with the server's own loot
 * boosts in it.
 */

/** Flash's points for `loot`: each resource's whole amount above 0, summed. */
export const lootPoints = (loot: Partial<ResourceAmounts> | null | undefined): number => {
  if (!loot) return 0;
  let points = 0;
  for (const key of RESOURCE_KEYS) {
    const amount = Math.floor(Number(loot[key]));
    if (Number.isFinite(amount) && amount > 0) points += amount;
  }
  return points;
};

/**
 * Adds the points for `loot` to `save.points` (`BASE.PointsAdd`).
 *
 * @param save - The row the attacker comes home to: the main save, or the Inferno yard.
 * @param loot - What the attack took, before the attacker's storage cap.
 * @returns The points added.
 */
export const awardLootPoints = (
  save: { points?: string | null },
  loot: Partial<ResourceAmounts> | null | undefined
): number => {
  const points = lootPoints(loot);
  if (points > 0) {
    const before = Number(save.points ?? "0");
    save.points = String(Math.floor((Number.isFinite(before) ? before : 0) + points));
  }
  return points;
};
