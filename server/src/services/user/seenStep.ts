/**
 * "Last seen" as other players see it: the friends list and the alliance
 * Members tab (owner, 25 Nov 2026 grilling, beta 9). Rough steps only, never
 * a time: online now, today, this week, 1-4 weeks, over a month.
 *
 * Online is the server's own rule (`onlinePlayers`, the dot the maps show);
 * the rest counts from `user.last_seen_at` (the last own-yard load, written at
 * most hourly by `touchLastSeen`), which is never sent itself.
 *
 * A player who turned "Show when I'm online" off (`user.hide_online`) shows
 * only the two inactive steps: nothing while they are online or were seen in
 * the last week, then 1-4 weeks or over a month, so friends and alliance
 * mates can still tell who has quit.
 */

/** The five steps, most recent first. */
export const SEEN_STEPS = ["online", "today", "week", "weeks", "month"] as const;

export type SeenStep = (typeof SEEN_STEPS)[number];

/** "1-4 weeks" ends and "over a month" starts at this many days (4 weeks). */
export const SEEN_WEEKS_DAYS = 28;

const DAY_SECONDS = 24 * 60 * 60;

/** The steps a hidden player still shows: the inactive ones. */
const SHOWN_WHEN_HIDDEN: ReadonlySet<SeenStep> = new Set(["weeks", "month"]);

/**
 * How recently a player was about, as another player sees it.
 *
 * @param {boolean} hidden - They turned "Show when I'm online" off
 * @param {boolean} online - The server counts them online now
 * @param {number | null} lastSeen - Their `last_seen_at`, unix seconds, or null (never recorded: over a month)
 * @param {number} now - Unix seconds
 * @returns {SeenStep | null} The step, or null when nothing shows (a hidden player who is still active)
 */
export const seenStepOf = (hidden: boolean, online: boolean, lastSeen: number | null, now: number): SeenStep | null => {
  if (online) return hidden ? null : "online";
  const step = offlineStep(lastSeen, now);
  if (hidden && !SHOWN_WHEN_HIDDEN.has(step)) return null;
  return step;
};

const offlineStep = (lastSeen: number | null, now: number): Exclude<SeenStep, "online"> => {
  if (lastSeen === null) return "month";
  const ago = now - lastSeen;
  if (ago < DAY_SECONDS) return "today";
  if (ago < 7 * DAY_SECONDS) return "week";
  if (ago < SEEN_WEEKS_DAYS * DAY_SECONDS) return "weeks";
  return "month";
};
