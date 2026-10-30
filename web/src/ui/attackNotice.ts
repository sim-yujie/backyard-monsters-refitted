import type { AttackNoticeStats } from "@/game/attack/attackNoticeStats";
import { iconAmount } from "@/ui/gameIcon";
import { RESOURCE_KEYS, resourceAmount, resourceName, type ResourceRealm } from "@/ui/resourceIcon";
import { formatAmount } from "@/ui/format";
import "@/ui/styles/attackNotice.css";

/**
 * An attack notice's numbers as icons (less-text job 3, 28 Oct 2026): the
 * broken wall and the damage the yard was left at, then a pile and an amount
 * for each resource taken, "[wall] 63% [twigs] 1,234 [goo] 500". The bell, the
 * away line and the mailbox put it after "Bramble attacked your yard". Every
 * icon carries its word, so a screen reader hears "Yard damage 63% Twigs
 * 1,234 lost Goo 500 lost"; nothing taken is no pile at all. The loot is the
 * defender's loss, so it shows red with a minus, "−1,234" (owner, 28 Oct);
 * the damage is not a resource and stays plain.
 */
export const attackStatsRow = (stats: AttackNoticeStats, realm: ResourceRealm): HTMLElement => {
  const row = document.createElement("span");
  row.className = "attack-stats";
  row.append(iconAmount("yarddamage2", `${stats.damage}%`, { className: "attack-stats__damage" }));
  for (const key of RESOURCE_KEYS) {
    const amount = stats.loot[key];
    if (amount) row.append(resourceAmount(key, amount, { realm, change: "loss", className: "attack-stats__loot" }));
  }
  return row;
};

/** The same numbers in words, for a tooltip: "Yard damage 63% · 1,234 Twigs lost · 500 Goo lost". */
export const attackStatsText = (stats: AttackNoticeStats, realm: ResourceRealm): string =>
  [
    `Yard damage ${stats.damage}%`,
    ...RESOURCE_KEYS.flatMap((key) => {
      const amount = stats.loot[key];
      return amount ? [`${formatAmount(amount)} ${resourceName(key, realm)} lost`] : [];
    }),
  ].join(" · ");
