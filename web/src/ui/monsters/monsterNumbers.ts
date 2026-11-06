import { monsterStat } from "@/game/combat/rules";
import { hatchCost, hatchTime, housingSpace } from "@/game/monsters/monsterCatalogue";
import { formatAmount, formatCountdown } from "@/ui/format";
import { iconAmount, type GameIconName } from "@/ui/gameIcon";
import { resourceAmount, type ResourceRealm } from "@/ui/resourceIcon";

/** A monster's speed at `level` as a card spells it: whole, or one decimal. */
export const speedText = (id: string, level: number): string =>
  String(Math.round(monsterStat(id, "speed", level) * 10) / 10);

/** Seconds to hatch one `id` at academy `level`, spelled as a countdown; "-" when unknown. */
export const hatchTimeText = (id: string, level: number): string => {
  const seconds = hatchTime(id, level);
  return seconds === undefined ? "-" : formatCountdown(seconds);
};

/**
 * One of a monster card's numbers: its painted icon (or Goo's pile), the word
 * a screen reader says for it, and the value, "400 → 480" when the next level
 * changes it.
 */
export interface MonsterStat {
  readonly icon: GameIconName | "goo";
  readonly label: string;
  readonly value: string;
  readonly changed: boolean;
}

/**
 * A monster's six numbers at academy `level`, and what `next` changes:
 * health, damage (a healer's, Vorg's, is a negative damage, shown as
 * "+60" heals), speed, housing space, Goo to hatch one and the hatch time.
 * A value reads "400 → 480" only where the next level moves it.
 */
export const monsterStats = (id: string, level: number, next: number | null = null): MonsterStat[] => {
  const pair = (now: string, then: string | null, label: string, icon: MonsterStat["icon"]): MonsterStat =>
    then === null || then === now
      ? { icon, label, value: now, changed: false }
      : { icon, label, value: `${now} → ${then}`, changed: true };
  const at = <T>(read: (lvl: number) => T): [T, T | null] => [read(level), next === null ? null : read(next)];
  const number = (read: (lvl: number) => number, spell = formatAmount): [string, string | null] => {
    const [now, then] = at(read);
    return [spell(now), then === null ? null : spell(then)];
  };
  const damage = monsterStat(id, "damage", level);
  return [
    pair(...number((lvl) => monsterStat(id, "health", lvl)), "Health", "health"),
    damage < 0
      ? pair(...number((lvl) => -monsterStat(id, "damage", lvl), (heal) => `+${formatAmount(heal)}`), "Heals", "health")
      : pair(...number((lvl) => monsterStat(id, "damage", lvl)), "Damage", "damage"),
    pair(...at((lvl) => speedText(id, lvl)), "Speed", "speed"),
    pair(...number((lvl) => housingSpace(id, lvl) ?? 0), "Housing space", "housing"),
    pair(...number((lvl) => hatchCost(id, lvl) ?? 0), "Hatch cost", "goo"),
    pair(...at((lvl) => hatchTimeText(id, lvl)), "Hatch time", "time"),
  ];
};

/**
 * The monster card's numbers as a grid of icon and number, the changed ones
 * picked out: "[heart] 400 → 480 · [claw] 30 · [shoe] 16 …". Every icon keeps its word for a screen
 * reader and on hover ("Health 400 → 480"); Goo is Magma in the Inferno's
 * `realm`.
 */
export const statGrid = (stats: readonly MonsterStat[], realm: ResourceRealm = "surface"): HTMLElement => {
  const grid = document.createElement("ul");
  grid.className = "monster-stats";
  grid.append(
    ...stats.map((stat) => {
      const item = document.createElement("li");
      item.className = stat.changed ? "monster-stats__item monster-stats__item--up" : "monster-stats__item";
      item.dataset["stat"] = stat.label;
      item.append(
        stat.icon === "goo"
          ? resourceAmount("r4", stat.value, { realm })
          : iconAmount(stat.icon, stat.value, { size: 24, label: stat.label }),
      );
      return item;
    }),
  );
  return grid;
};
