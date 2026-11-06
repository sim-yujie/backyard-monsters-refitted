import type { ResourceRealm } from "@/ui/resourceIcon";

/**
 * An attack notice's numbers, as the server stores them with it
 * (`message.attackstats`, `server/src/services/maproom/v2/outpostNotices.ts`,
 * less-text job 3, 28 Oct 2026): the damage the yard was left at, in percent,
 * and the loot taken, whole units by resource key. The bell, the away line
 * and the mailbox show them as icons after "Bramble attacked your yard"; a
 * notice from before 28 Oct has none and keeps its sentence.
 *
 * The server also keeps the housed monsters lost; they are not told (owner,
 * 27 Oct), so they are not read here.
 */
export interface AttackNoticeStats {
  /** Whole percent, 0 to 100. */
  readonly damage: number;
  readonly loot: Readonly<Partial<Record<"r1" | "r2" | "r3" | "r4", number>>>;
}

const LOOT_KEYS = ["r1", "r2", "r3", "r4"] as const;

/** The numbers in `value` (a notice's `attackstats`, or its away entry's `stats`), or null when it has none. */
export const attackNoticeStatsOf = (value: unknown): AttackNoticeStats | null => {
  if (typeof value !== "object" || value === null) return null;
  const { damage, loot } = value as { damage?: unknown; loot?: unknown };
  const percent = Number(damage);
  if (damage == null || !Number.isFinite(percent)) return null;
  const taken: Partial<Record<(typeof LOOT_KEYS)[number], number>> = {};
  if (typeof loot === "object" && loot !== null) {
    for (const key of LOOT_KEYS) {
      const amount = Math.floor(Number((loot as Record<string, unknown>)[key]));
      if (amount > 0) taken[key] = amount;
    }
  }
  return { damage: Math.min(100, Math.max(0, Math.round(percent))), loot: taken };
};

/** Which resources a notice of this kind counts in: Bone to Magma for an Inferno yard's. */
export const attackNoticeRealm = (kind: string): ResourceRealm =>
  kind.toLowerCase() === "infernoattacked" ? "inferno" : "surface";
