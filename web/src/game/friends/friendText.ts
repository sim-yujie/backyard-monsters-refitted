import type { FriendOnline } from "@/api/friends";
import { buildingName } from "@/game/yard/buildingArt";
import { formatAmount, formatCountdown } from "@/ui/format";

/**
 * How the friends screens and the bell word things (`docs/design/friends.md`
 * §3, issue #370). All plain English, like the other panels.
 */

/** "Online", "Seen today", "Seen this week", "Away"; empty when hidden. */
export const onlineText = (online: FriendOnline): string => {
  switch (online) {
    case "online":
      return "Online";
    case "today":
      return "Seen today";
    case "week":
      return "Seen this week";
    case "away":
      return "Away";
    default:
      return "";
  }
};

/** "12 of 100 friends". */
export const friendCountText = (count: number, max: number): string =>
  `${formatAmount(count)} of ${formatAmount(max)} ${max === 1 ? "friend" : "friends"}`;

/** "Level 12"; empty for a level the server did not send. */
export const levelLabel = (level: number): string => (level > 0 ? `Level ${level}` : "");

/** "3 waiting", the Account menu's count in words. */
export const waitingText = (count: number): string => `${formatAmount(count)} waiting`;

/**
 * One `friend` notification's payload, as the server writes it (§6.1): the
 * event and the other player, with a speed-up's `seconds` and the
 * `building` a help was about.
 */
export interface FriendNotice {
  readonly event?: unknown;
  readonly username?: unknown;
  readonly seconds?: unknown;
  readonly building?: unknown;
  readonly [detail: string]: unknown;
}

const nameOf = (notice: FriendNotice): string =>
  typeof notice.username === "string" && notice.username.trim() !== "" ? notice.username : "Someone";

/**
 * The building a help was about: its name as the server sent it, or the name
 * of its type number, else a plain stand-in.
 */
const buildingOf = (notice: FriendNotice): string => {
  const building = notice.building;
  if (typeof building === "string" && building.trim() !== "") return building;
  if (typeof building === "number") return buildingName(building) ?? "a building";
  if (typeof building === "object" && building !== null) {
    const { name, type } = building as { name?: unknown; type?: unknown };
    if (typeof name === "string" && name.trim() !== "") return name;
    if (typeof type === "number") return buildingName(type) ?? "a building";
  }
  return "a building";
};

/**
 * A `friend` notification's line (§6.1): "Bob wants to be your friend.",
 * "Bob is now your friend.", "Bob sent you a gift.", "Bob took 6m 30s off
 * your Storage Silo.", "Bob repaired your Cannon Tower." An event the client
 * does not know yet gets a general line.
 */
export const friendNoticeText = (notice: FriendNotice): string => {
  const name = nameOf(notice);
  switch (notice.event) {
    case "request":
      return `${name} wants to be your friend.`;
    case "accepted":
      return `${name} is now your friend.`;
    case "gift":
      return `${name} sent you a gift.`;
    case "helpSpeedup": {
      const seconds = Math.floor(Number(notice.seconds) || 0);
      const building = buildingOf(notice);
      const place = building === "a building" ? "a job in your yard" : `your ${building}`;
      return seconds > 0 ? `${name} took ${formatCountdown(seconds)} off ${place}.` : `${name} sped up ${place}.`;
    }
    case "helpRepair": {
      const building = buildingOf(notice);
      return building === "a building" ? `${name} repaired a building in your yard.` : `${name} repaired your ${building}.`;
    }
    default:
      return name === "Someone" ? "News from your friends." : `News from ${name}.`;
  }
};

/** A `friend` row's line: its one entry's words, or one line per entry if several came together. */
export const friendLineText = (jobs: readonly unknown[]): string => {
  const notices = jobs.filter((job): job is FriendNotice => typeof job === "object" && job !== null);
  if (notices.length === 0) return "News from your friends.";
  return notices.map(friendNoticeText).join(" ");
};
