import { parseDefenderForces, type BattleBuffs, type SideBuffs } from "@/game/combat/rules";

/**
 * The shop boosts a battle is fought with, as the attack strip shows them
 * (beta.4): one short label and a line per side that has any. The boosts are
 * the ones the server froze into the load's `defenderforces`
 * (`combat/rules/defence.ts`); the screen only reads them.
 */
export interface BoostSummary {
  readonly label: string;
  /** One line per side's towers or monsters, for the tooltip and screen readers. */
  readonly lines: readonly string[];
}

const MONSTER_BOOSTS: ReadonlyArray<readonly [keyof SideBuffs, string]> = [
  ["monsterDamage", "25% more damage"],
  ["monsterArmour", "30% less damage taken"],
  ["monsterSpeed", "50% faster"],
];

const monsterLine = (whose: string, side: SideBuffs | undefined): string | null => {
  const boosts = MONSTER_BOOSTS.filter(([key]) => side?.[key]).map(([, words]) => words);
  return boosts.length > 0 ? `${whose} monsters: ${boosts.join(", ")}` : null;
};

/**
 * What to show for `buffs`, seen by the player on `side`: the attacker in an
 * attack, the defender in a wild raid or a defence replay. Null when neither
 * side has a boost.
 */
export const boostSummary = (
  buffs: BattleBuffs | undefined,
  side: "attacker" | "defender",
): BoostSummary | null => {
  const mine = side === "attacker" ? buffs?.attacker : buffs?.defender;
  const yourTowers = side === "defender" ? "Your" : "Their";
  const lines = [
    monsterLine("Your", mine),
    buffs?.defender?.towerDamage ? `${yourTowers} towers: 25% more damage` : null,
    monsterLine(side === "attacker" ? "Their" : "The attacker's", side === "attacker" ? buffs?.defender : buffs?.attacker),
  ].filter((line): line is string => line !== null);
  if (lines.length === 0) return null;
  const boosted = Boolean(monsterLine("", mine)) || (side === "defender" && Boolean(buffs?.defender?.towerDamage));
  return { label: boosted ? "Boosted" : "Foe boosted", lines };
};

/** The boosts an attack load serves, or none. */
export const loadBoosts = (load: { readonly defenderforces?: unknown } | null | undefined): BattleBuffs | undefined =>
  parseDefenderForces(load?.defenderforces)?.buffs;
