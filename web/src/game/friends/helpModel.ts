import {
  REFUSAL_TEXT,
  tooNewText,
  type GateHold,
  type HelpBlock,
  type HelpKind,
  type HelpOffer,
  type HelpResult,
  type ResourceAmounts,
} from "@/api/friends";
import type { BuildingData } from "@/api/types";
import type { YardBuilding } from "@/game/yard/yardModel";
import { formatAmount, formatCountdown } from "@/ui/format";

/**
 * Helping in a friend's yard (`docs/design/friends.md` §3.3 and §4, issue
 * #374): what the help block says each building can take, put into the words
 * the help panel, the wrench markers and the "Helping Bob" line show.
 *
 * The server decides everything (§7 rule 6). The time a speed-up would save
 * is worked out here only to say it before the press, the same way the
 * server does (`floor(5%)` of the time left); the thank-you uses the
 * server's own number.
 */

/** A speed-up takes this share of the time left (`BFOUNDATION.HelpB`, the server's `HELP_RULES`). */
export const SPEEDUP_SHARE = 0.05;
/** Friends who can speed up one job. */
export const HELPERS_PER_JOB = 5;

/** What one kind of help says on the panel: allowed, or refused with words. */
export type HelpChoice =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string; readonly text: string };

/** One building's help, as the panel shows it. Absent kinds have nothing to help with. */
export interface BuildingHelpView {
  readonly speedup?: HelpChoice;
  readonly repair?: HelpChoice;
  /** Today's rewarded helps are used up: a help still goes through, for nothing. */
  readonly rewardUsedUp?: true;
}

/**
 * A help refusal in words. The shared refusal table words them for the
 * whole friends screen; a few read better said about helping. `tooNew` says
 * which gate holds and when it lifts (`tooNewText`).
 */
export const HELP_REFUSAL_TEXT: Readonly<Record<string, string>> = {
  nothingToHelp: "There is nothing left to help with here.",
  repairedToday: "You already repaired a building here today.",
  rateLimited: "You have helped a lot this hour. Try again later.",
  alreadyHelped: "You have already sped up this job.",
  helpersFull: "5 friends have already sped up this job.",
  underAttack: "They are under attack right now. Try again when it is over.",
  notFriends: "You are not friends with this player any more.",
  cannotSend: "You can't help this player.",
};

/**
 * A refusal reason as the help panel says it; a `tooNew` with the gate that
 * holds it (`hold`, from the help block or the refusal) says which and when.
 *
 * @param now - Unix seconds
 */
export const helpRefusalText = (reason: string, hold?: GateHold, now?: number): string =>
  reason === "tooNew"
    ? tooNewText(hold, now)
    : (HELP_REFUSAL_TEXT[reason] ??
      (Object.prototype.hasOwnProperty.call(REFUSAL_TEXT, reason)
        ? REFUSAL_TEXT[reason as keyof typeof REFUSAL_TEXT]
        : "That can't be done right now."));

const choiceOf = (offer: true | string | undefined, hold: GateHold | undefined, now?: number): HelpChoice | undefined => {
  if (offer === undefined) return undefined;
  if (offer === true) return { allowed: true };
  return { allowed: false, reason: offer, text: helpRefusalText(offer, hold, now) };
};

/**
 * One building's entry of the help block, or null when the block says nothing about it.
 *
 * @param now - Unix seconds, for how long a `tooNew` has left
 */
export const buildingHelp = (block: HelpBlock | null, id: number, now?: number): BuildingHelpView | null => {
  const offer: HelpOffer | undefined = block?.buildings[String(id)];
  if (!offer) return null;
  const speedup = choiceOf(offer.speedup, block?.gate, now);
  const repair = choiceOf(offer.repair, block?.gate, now);
  if (!speedup && !repair) return null;
  return { ...(speedup && { speedup }), ...(repair && { repair }), ...(block?.rewardsLeft === 0 && { rewardUsedUp: true as const }) };
};

/** The buildings that can take a help now: the ones with a wrench. */
export const helpableIds = (block: HelpBlock | null): Set<number> => {
  const ids = new Set<number>();
  if (!block) return ids;
  for (const [id, offer] of Object.entries(block.buildings)) {
    if (offer.speedup === true || offer.repair === true) ids.add(Number(id));
  }
  return ids;
};

/**
 * The buildings still damaged whose repair is used up for today
 * (`repairedToday`: one repair a friend's yard a UTC day, owner 16 Nov 2026)
 * and that have no other help open: they wear a grey wrench. A visit draws
 * no damage, so without it the yard looks fully repaired once today's repair
 * is given (owner's bug report, 16 Nov 2026: "it all repaired").
 */
export const spentRepairIds = (block: HelpBlock | null): Set<number> => {
  const ids = new Set<number>();
  if (!block) return ids;
  for (const [id, offer] of Object.entries(block.buildings)) {
    if (offer.repair === "repairedToday" && offer.speedup !== true) ids.add(Number(id));
  }
  return ids;
};

/**
 * Whether a refusal stands on the building's button from then on. One about
 * the whole visit or that lifts by itself does not: the friend's yard under
 * attack, not friends any more (the scene says so), and the spam limit
 * (`rateLimited`, bug report #50), which lifts within the hour.
 */
export const refusalStays = (reason: string): boolean =>
  reason !== "underAttack" && reason !== "notFriends" && reason !== "rateLimited";

/** "Helping Bob". No count: there is no daily cap on helps (owner, 15 Nov 2026: was 20). */
export const helpingLine = (name: string): string => `Helping ${name}`;

/** The seconds left on a building's job now; its frozen time when paused. Null with no job. */
export const timeLeft = (building: YardBuilding, now: number): number | null => {
  const countdown = building.countdown;
  if (!countdown || countdown.kind === "rebuild") return null;
  return countdown.paused ? countdown.seconds : Math.max(0, Math.floor(countdown.endsAt - now));
};

/**
 * The building a help answers with, counted from the visit's own `savetime`.
 * The server answers with its countdowns as seconds left now, having saved
 * the yard now; the visit's save still counts from when it was loaded, so a
 * running countdown moves forward by the time since. A frozen one is not
 * counted from any time and stays as it is.
 */
export const fromVisitSave = <T extends BuildingData>(raw: T, elapsed: number, paused: boolean): T => {
  if (paused || elapsed <= 0) return raw;
  const out: T = { ...raw };
  for (const key of ["cB", "cU", "cF", "cR"] as const) {
    const left = raw[key];
    if (typeof left === "number" && left > 0) out[key] = left + Math.floor(elapsed);
  }
  return out;
};

/** What a speed-up would take off this much time left: `floor(5%)`. */
export const speedupSeconds = (left: number): number => Math.max(0, Math.floor(left * SPEEDUP_SHARE));

/** The friends who sped up the job now running (`hl`). */
export const helpersOf = (building: YardBuilding): number => {
  const list = (building.raw as { hl?: unknown }).hl;
  return Array.isArray(list) ? Math.min(list.length, HELPERS_PER_JOB) : 0;
};

const JOB_WORD: Readonly<Record<string, string>> = { build: "build", upgrade: "upgrade", fortify: "fortify" };

/** "the Storage Silo upgrade": the job a speed-up shortens. */
export const jobName = (building: YardBuilding): string => {
  const kind = building.countdown?.kind;
  const word = kind ? JOB_WORD[kind] : undefined;
  return word ? `the ${building.name} ${word}` : `the ${building.name}`;
};

/** The speed-up button's line: "Takes 6m 30s off the Storage Silo upgrade (5% of the time left)". */
export const speedupText = (building: YardBuilding, now: number): string => {
  const left = timeLeft(building, now);
  const seconds = left === null ? 0 : speedupSeconds(left);
  return seconds > 0
    ? `Takes ${formatCountdown(seconds)} off ${jobName(building)} (5% of the time left).`
    : `Speeds up ${jobName(building)} by 5% of the time left.`;
};

/** "3 of 5 friends have helped". */
export const helpersText = (helpers: number): string =>
  `${helpers} of ${HELPERS_PER_JOB} friends ${helpers === 1 ? "has" : "have"} helped`;

/** The repair button's line. */
export const repairText = (building: YardBuilding): string => `Repairs this ${building.name} now.`;

const RESOURCE_WORDS: Readonly<Record<string, string>> = { r1: "Twigs", r2: "Pebbles", r3: "Putty", r4: "Goo" };

/** "1,250 of each resource", or each named when they differ; empty for nothing. */
export const rewardText = (reward: ResourceAmounts): string => {
  const entries = (["r1", "r2", "r3", "r4"] as const)
    .map((key) => [key, Math.max(0, Math.floor(reward[key] ?? 0))] as const)
    .filter(([, amount]) => amount > 0);
  if (entries.length === 0) return "";
  const first = entries[0]![1];
  if (entries.length === 4 && entries.every(([, amount]) => amount === first)) {
    return `${formatAmount(first)} of each resource`;
  }
  return entries.map(([key, amount]) => `${formatAmount(amount)} ${RESOURCE_WORDS[key]}`).join(", ");
};

/** The thank-you after a help: what it did and what it earned. */
export const thanksText = (kind: HelpKind, result: HelpResult, owner: string, building: string): string => {
  const did =
    kind === "speedup" && result.secondsSaved
      ? `You took ${formatCountdown(result.secondsSaved)} off ${owner}'s ${building}.`
      : kind === "repair"
        ? `You repaired ${owner}'s ${building}.`
        : `You helped with ${owner}'s ${building}.`;
  const earned = rewardText(result.reward);
  return `Thanks for helping! ${did}${earned ? ` You earned ${earned}.` : ""}`;
};

/** Every repair the block still offers, now refused with `repairedToday` (one repair a yard a day). */
const repairsUsedUp = (buildings: Readonly<Record<string, HelpOffer>>): Record<string, HelpOffer> => {
  const out: Record<string, HelpOffer> = {};
  for (const [key, offer] of Object.entries(buildings)) {
    out[key] = offer.repair === true ? { ...offer, repair: "repairedToday" } : offer;
  }
  return out;
};

/**
 * The help block after a help went through: the rewarded helps left today
 * and the building's entry as it now stands. A speed-up leaves the job
 * helped by this player; a repair leaves nothing to repair, and, as the
 * server allows one repair a friend's yard a UTC day (owner, 16 Nov 2026),
 * every other repair in the yard now says `repairedToday`.
 */
export const afterHelp = (block: HelpBlock, id: number, kind: HelpKind, rewardsLeft: number): HelpBlock => {
  const key = String(id);
  const buildings: Record<string, HelpOffer> = {};
  for (const [other, offer] of Object.entries(block.buildings)) {
    let next: HelpOffer = offer;
    if (other === key) {
      if (kind === "speedup") next = { ...next, speedup: "alreadyHelped" };
      else {
        const { repair: _repair, ...rest } = next;
        next = rest;
      }
    } else if (kind === "repair" && next.repair === true) {
      next = { ...next, repair: "repairedToday" };
    }
    if (next.speedup !== undefined || next.repair !== undefined) buildings[other] = next;
  }
  return { rewardsLeft, buildings };
};

/**
 * The help block after a help was refused: the reason now stands for that
 * kind on that building, so the panel and the wrench agree with the server;
 * a `tooNew`'s gate (`hold`) is kept so the panel says which and when.
 * A refusal about the whole visit (not friends, the yard under attack) is
 * left to the caller ({@link refusalStays}).
 */
export const afterRefusal = (block: HelpBlock, id: number, kind: HelpKind, reason: string, hold?: GateHold): HelpBlock => {
  const key = String(id);
  const offer = block.buildings[key];
  if (!offer) return block;
  // Today's repair in this yard is given: no other building can take one either.
  if (reason === "repairedToday") {
    return { ...block, buildings: { ...repairsUsedUp(block.buildings), [key]: { ...offer, repair: reason } } };
  }
  const gate =
    reason === "tooNew" && hold
      ? { gate: { reason, ...(hold.from !== undefined && { from: hold.from }), ...(hold.rule && { rule: hold.rule }) } }
      : {};
  return { ...block, ...gate, buildings: { ...block.buildings, [key]: { ...offer, [kind]: reason } } };
};
