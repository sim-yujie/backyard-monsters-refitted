import type { AchievementProgress, AchievementView, PublicAchievementView } from "@/api/achievements";
import { formatAmount } from "@/ui/format";

/**
 * What the achievements screen works out from the routes' lists
 * (`docs/design/achievements.md` §10.1, issue #204): the two groups and
 * their order, and the words on each row. Names, descriptions and rewards
 * come from the server; only the progress line's unit is the client's.
 */

/** The screen's last line (§5.3): hidden entries show as "???" until earned. */
export const FOOTER_TEXT = "Some achievements stay hidden until earned.";

/**
 * The unit before an entry's "4 / 5", by achievement number. An entry not
 * here reads as a bare "4 / 5", or "Not yet" when it is done in one step.
 */
const PROGRESS_UNITS: Readonly<Record<number, string>> = {
  1: "Town Hall",
  2: "Town Hall",
  3: "Town Hall",
  22: "Town Hall",
  4: "Fully evolved",
  5: "Fully evolved",
  7: "Camps taken",
  8: "Outposts taken",
  10: "Kozu Town Halls",
  11: "Juiced",
  12: "Blocks built",
  13: "Starter Kits",
  16: "Heavy Traps built",
  17: "Monsters unlocked",
  23: "Yards today",
  24: "Days in a row",
  25: "Friends",
  26: "Kozu attacks",
  27: "Outposts held",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** How full an entry's bar is, 0 to 1. */
export const progressRatio = (progress: AchievementProgress): number =>
  progress.target > 0 ? Math.min(1, Math.max(0, progress.value / progress.target)) : 0;

/** "Town Hall 4 / 5", "Juiced 1,200 / 5,000", or "Not yet" for a one-step entry. */
export const progressText = (entry: Pick<AchievementView, "id" | "progress">): string => {
  const { value, target } = entry.progress;
  const unit = PROGRESS_UNITS[entry.id];
  if (!unit && target === 1) return value >= 1 ? "Done" : "Not yet";
  const figures = `${formatAmount(value)} / ${formatAmount(target)}`;
  return unit ? `${unit} ${figures}` : figures;
};

/** "+10 Shiny". */
export const rewardText = (shiny: number): string => `+${formatAmount(shiny)} Shiny`;

/** "Earned 3 Oct 2026", in the player's own time zone. */
export const earnedText = (at: number | undefined): string => {
  if (at === undefined || !Number.isFinite(at)) return "Earned";
  const date = new Date(at * 1000);
  return `Earned ${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
};

/** "7 of 17 earned · 85 Shiny earned"; without Shiny (someone else's) "7 of 17 earned". */
export const summaryText = (earned: number, total: number, shinyEarned?: number): string => {
  const count = `${formatAmount(earned)} of ${formatAmount(total)} earned`;
  return shinyEarned === undefined ? count : `${count} · ${formatAmount(shinyEarned)} Shiny earned`;
};

/** The read-only screen's title: "Bob's achievements". */
export const playerTitle = (name: string | null | undefined): string => {
  const who = name?.trim();
  return who ? `${who}'s achievements` : "Achievements";
};

/** The placeholder badge's tier by reward (§10.4); someone else's list has no reward, so `plain`. */
export type BadgeTier = "bronze" | "silver" | "gold" | "plain";

export const badgeTier = (shiny: number | undefined): BadgeTier => {
  if (shiny === undefined) return "plain";
  if (shiny >= 20) return "gold";
  if (shiny >= 10) return "silver";
  return "bronze";
};

type Listed = Pick<PublicAchievementView, "id" | "status" | "at" | "hidden">;

/** Earned entries, newest first; ties in Flash's order. */
export const earnedGroup = <T extends Listed>(list: readonly T[]): T[] =>
  list
    .filter((entry) => entry.status === "earned")
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0) || a.id - b.id);

/** A hidden entry not earned yet: shown as "???" (#299). */
export const isSecret = (entry: Pick<PublicAchievementView, "status" | "hidden">): boolean =>
  entry.hidden === true && entry.status !== "earned";

/** Hidden "???" entries go after every visible one. */
const secretLast = (a: Pick<PublicAchievementView, "status" | "hidden">, b: Pick<PublicAchievementView, "status" | "hidden">): number =>
  Number(isSecret(a)) - Number(isSecret(b));

/** Entries still to do, closest to done first, hidden ones last; ties in Flash's order. */
export const toDoGroup = (list: readonly AchievementView[]): AchievementView[] =>
  list
    .filter((entry) => entry.status !== "earned")
    .sort((a, b) => secretLast(a, b) || progressRatio(b.progress) - progressRatio(a.progress) || a.id - b.id);

/** Someone else's entries not earned yet, in Flash's order, hidden ones last: there is no progress to sort by. */
export const notEarnedGroup = <T extends Listed>(list: readonly T[]): T[] =>
  list.filter((entry) => entry.status !== "earned").sort((a, b) => secretLast(a, b) || a.id - b.id);
