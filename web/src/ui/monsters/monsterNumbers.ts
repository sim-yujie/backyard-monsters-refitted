import { monsterStat } from "@/game/combat/rules";
import { hatchTime } from "@/game/monsters/monsterCatalogue";
import { formatCountdown } from "@/ui/format";

/** A monster's speed at `level` as a card spells it: whole, or one decimal. */
export const speedText = (id: string, level: number): string =>
  String(Math.round(monsterStat(id, "speed", level) * 10) / 10);

/** Seconds to hatch one `id` at academy `level`, spelled as a countdown; "-" when unknown. */
export const hatchTimeText = (id: string, level: number): string => {
  const seconds = hatchTime(id, level);
  return seconds === undefined ? "-" : formatCountdown(seconds);
};
