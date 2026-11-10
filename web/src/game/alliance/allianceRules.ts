import type {
  AllianceListing,
  AllianceMember,
  AllianceRefusal,
  AllianceRole,
  AllianceType,
  MyAlliance,
  TypeOption,
} from "@/api/alliance";
import { formatCountdown } from "@/ui/format";

/**
 * What the alliance window shows and allows, worked out without the page
 * (beta 7 phase 1): the type cards' words, which member buttons a rank gets,
 * Quick Join's pick, and each refusal's next step. The numbers are the
 * server's (`server/src/config/AllianceConfig.ts`); the strength and
 * weakness lines are placeholders until the balance pass (owner, 10 Nov 2026:
 * "we can nitpick on the balancing after the feature is done first").
 */

export interface TypeInfo {
  readonly type: AllianceType;
  readonly label: string;
  readonly members: number;
  readonly officers: number;
  /** One plain line: what the type is good at. PLACEHOLDER. */
  readonly strength: string;
  /** One plain line: what it gives up. PLACEHOLDER. */
  readonly weakness: string;
}

export const TYPE_INFO: Readonly<Record<AllianceType, TypeInfo>> = {
  midas: {
    type: "midas",
    label: "Midas' Council",
    members: 15,
    officers: 2,
    strength: "More resources and loot",
    weakness: "Weaker outposts",
  },
  conquest: {
    type: "conquest",
    label: "Conquest Horde",
    members: 30,
    officers: 4,
    strength: "Cheaper outpost takeovers",
    weakness: "Less loot",
  },
  fortress: {
    type: "fortress",
    label: "Fortress Legion",
    members: 60,
    officers: 6,
    strength: "Tougher outposts and buildings",
    weakness: "Raiders carry less home",
  },
};

/** "Up to 15 members": the first line of a type card (owner, 7 Nov: bare numbers were unclear). */
export const membersLine = (type: AllianceType): string => `Up to ${TYPE_INFO[type].members} members`;

export const ALLIANCE_NAME_MIN = 3;
export const ALLIANCE_NAME_MAX = 30;
export const ALLIANCE_DESC_MAX = 255;
export const SHIELD_COUNT = 41;

/** A shield's picture, 1 to 41 (Flash's own; `medium` is 46 px, `small` 25 px). */
export const shieldUrl = (image: number, size: "medium" | "small" = "medium"): string => {
  const shield = Number.isInteger(image) && image >= 1 && image <= SHIELD_COUNT ? image : 1;
  return `/assets/alliances/${shield}_${size}.png`;
};

/** Why a name cannot be sent as it is, or null. The server checks again (taken, banned words). */
export const nameProblem = (name: string): string | null => {
  const trimmed = name.trim();
  if (trimmed.length < ALLIANCE_NAME_MIN) return `At least ${ALLIANCE_NAME_MIN} letters.`;
  if (trimmed.length > ALLIANCE_NAME_MAX) return `At most ${ALLIANCE_NAME_MAX} letters.`;
  if (trimmed.includes("#")) return "No # in the name.";
  return null;
};

/** Why a description cannot be sent, or null. */
export const descriptionProblem = (text: string): string | null => {
  const trimmed = text.trim();
  if (!trimmed) return "Write a line about your alliance.";
  if (trimmed.length > ALLIANCE_DESC_MAX) return `At most ${ALLIANCE_DESC_MAX} letters.`;
  return null;
};

/** The alliance has a free seat. */
export const hasRoom = (listing: Pick<AllianceListing, "members" | "member_limit">): boolean =>
  listing.members < listing.member_limit;

/**
 * Quick Join's pick: the first alliance of the type (or any) with room, in
 * the server's marketplace order (room first, then the most active). Null
 * when none fits; the window then offers Any type.
 */
export const quickJoinPick = (
  listings: readonly AllianceListing[],
  type: AllianceType | "any",
): AllianceListing | null =>
  listings.find((listing) => (type === "any" || listing.type === type) && hasRoom(listing)) ?? null;

/** The words for a refusal, with the time left on a wait. */
export const refusalText = (refusal: Pick<AllianceRefusal, "message" | "availableAt">, now: number): string =>
  refusal.availableAt && refusal.availableAt > now
    ? `${refusal.message} (${formatCountdown(refusal.availableAt - now)} left)`
    : refusal.message;

/** What the window can do about a join-gate refusal: where the player goes next. */
export type GateStep = "buildObservatory" | "openMap" | null;

export const gateStep = (reason: string): GateStep =>
  reason === "noObservatory" ? "buildObservatory" : reason === "notMapRoom2" || reason === "noWorld" ? "openMap" : null;

const ROLE_ORDER: Readonly<Record<AllianceRole, number>> = { leader: 0, officer: 1, member: 2 };

/** Leader, then Officers, then Members; online first within a rank, then points. */
export const orderMembers = (members: readonly AllianceMember[]): AllianceMember[] =>
  [...members].sort(
    (a, b) =>
      ROLE_ORDER[a.role ?? "member"] - ROLE_ORDER[b.role ?? "member"] ||
      Number(b.online) - Number(a.online) ||
      b.points - a.points ||
      a.display_name.localeCompare(b.display_name),
  );

export const ROLE_WORD: Readonly<Record<AllianceRole, string>> = {
  leader: "Leader",
  officer: "Officer",
  member: "Member",
};

export type MemberAction = "promote" | "demote" | "handOver" | "kick" | "invite";

/**
 * The buttons a member's row gets for the viewer: the Leader promotes,
 * demotes, hands over and kicks anyone; an Officer kicks Members. Nobody acts
 * on themselves (Leave is at the foot).
 */
export const memberActions = (
  alliance: Pick<MyAlliance, "permissions" | "officer_limit">,
  member: Pick<AllianceMember, "user_id" | "role">,
  viewerId: number,
  officers: number,
): MemberAction[] => {
  if (member.user_id === viewerId) return [];
  const can = (action: string): boolean => alliance.permissions.includes(action);
  const role = member.role ?? "member";
  if (role === "leader") return [];
  const actions: MemberAction[] = [];
  if (can("setRank")) {
    if (role === "member" && officers < alliance.officer_limit) actions.push("promote");
    if (role === "officer") actions.push("demote");
  }
  if (can("handOver")) actions.push("handOver");
  if ((role === "member" && can("kickMember")) || (role === "officer" && can("kickOfficer"))) actions.push("kick");
  return actions;
};

/** How many Officers the alliance has. */
export const officerCount = (members: readonly Pick<AllianceMember, "role">[]): number =>
  members.filter((member) => member.role === "officer").length;

/** The Leader and Officers edit the advert (shield and description). */
export const canEdit = (alliance: Pick<MyAlliance, "permissions">): boolean => alliance.permissions.includes("editAd");

export const canInvite = (alliance: Pick<MyAlliance, "permissions">): boolean => alliance.permissions.includes("invite");

/** When the Leader may rename: now (null), or the words for the wait. */
export const renameWait = (alliance: Pick<MyAlliance, "rename_available_at" | "must_rename">, now: number): string | null =>
  !alliance.must_rename && alliance.rename_available_at && alliance.rename_available_at > now
    ? `Rename again in ${formatCountdown(alliance.rename_available_at - now)}`
    : null;

const SWITCH_REFUSALS: Readonly<Record<string, string>> = {
  sameType: "Already this type",
  tooManyMembers: "Too many members",
  tooManyOfficers: "Too many Officers",
  waitForDownSwitch: "Changed type recently",
};

/** A type switch quote in a few words: "Free, now", "Wait 14d", "Keeps 50 points", or why not. */
export const switchSummary = (option: TypeOption, now: number): string => {
  if (option.refusal) {
    const why = SWITCH_REFUSALS[option.refusal] ?? "Not now";
    return option.available_at && option.available_at > now
      ? `${why}: ${formatCountdown(option.available_at - now)}`
      : why;
  }
  return option.up ? "Free, at once" : `Keeps ${option.points_after} points`;
};

/** Pages in a search answer. */
export const pageCount = (total: number, pageSize: number): number =>
  Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, pageSize)));
