import { playerAchievements, type PlayerAchievements } from "@/api/achievements";
import { earnedGroup } from "@/game/achievements/achievements";
import { formatAmount } from "@/ui/format";
import { icon } from "@/ui/maproom1/icons";
import { achievementBadge } from "./badge";
import "./achievements.css";

/**
 * Another player's achievements in one line, for the map's panels
 * (`docs/design/achievements.md` §10.3, issue #204 WP7): "Achievements 7 / 16"
 * with the newest few badges, a button that opens the read-only list. It is
 * fetched when the line is made, not carried in any map answer.
 *
 * A panel rebuilds as its data refreshes, so answers are kept a minute per
 * player: a rebuilt line fills at once and the route's limiter (30 a minute)
 * is not spent on the same player. A player the route refuses (unknown,
 * banned, too many asks) or a failed fetch hides the line; it is extra, and
 * the panel reads fine without it.
 */

/** How long an answer, or a refusal, is reused. */
export const LINE_FRESH_MS = 60_000;

/** Badges shown, newest first. */
export const NEWEST_BADGES = 3;

export interface AchievementsLineOptions {
  /** Opens the read-only list: `AchievementsDoor.openPlayer`. */
  readonly onOpen: (userid: number, name: string) => void;
  /** The route, for a test. */
  readonly fetch?: (userid: number) => Promise<PlayerAchievements>;
  /** The clock, for a test. */
  readonly now?: () => number;
}

interface Cached {
  readonly at: number;
  readonly answer: Promise<PlayerAchievements | null>;
  /** Set once the answer is in: null for a refusal or failure. */
  settled?: PlayerAchievements | null;
}

const cache = new Map<number, Cached>();

/** Forgets every kept answer; for tests. */
export const clearAchievementsLineCache = (): void => cache.clear();

const lookUp = (userid: number, options: AchievementsLineOptions): Cached => {
  const now = (options.now ?? Date.now)();
  const kept = cache.get(userid);
  if (kept && now - kept.at < LINE_FRESH_MS) return kept;
  const fetch = options.fetch ?? playerAchievements;
  const entry: Cached = {
    at: now,
    answer: fetch(userid).then(
      (player) => (entry.settled = player),
      () => (entry.settled = null),
    ),
  };
  cache.set(userid, entry);
  return entry;
};

/** The line for `userid`, named `name` until the answer names them. */
export const achievementsLine = (
  userid: number,
  name: string,
  options: AchievementsLineOptions,
): HTMLButtonElement => {
  const line = document.createElement("button");
  line.type = "button";
  line.className = "ach-line";
  const label = document.createElement("span");
  label.className = "ach-line__label";
  label.textContent = "Achievements";
  const badges = document.createElement("span");
  badges.className = "ach-line__badges";
  const count = document.createElement("span");
  count.className = "ach-line__count";
  count.textContent = "…";
  line.append(label, badges, count, icon("chevronRight", 16, "ach-line__more"));
  line.setAttribute("aria-label", `${name}'s achievements`);
  line.addEventListener("click", () => options.onOpen(userid, name));

  const fill = (player: PlayerAchievements | null): void => {
    if (!player) {
      line.hidden = true;
      return;
    }
    const figures = `${formatAmount(player.earned)} / ${formatAmount(player.total)}`;
    count.textContent = figures;
    line.setAttribute("aria-label", `${name}'s achievements: ${figures} earned`);
    badges.replaceChildren(
      ...earnedGroup(player.achievements)
        .slice(0, NEWEST_BADGES)
        .map((entry) => achievementBadge(entry.id, "plain", true)),
    );
  };

  const entry = lookUp(userid, options);
  if (entry.settled !== undefined) fill(entry.settled);
  else void entry.answer.then(fill);
  return line;
};
