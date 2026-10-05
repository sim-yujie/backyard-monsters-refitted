import { randomUUID } from "node:crypto";
import { redis } from "../../server.js";
import { lastSeenKey } from "../user/online.js";

/**
 * The open wild monster raid and the player's last screen, in Redis (#226
 * WP2, `docs/design/wild-raids.md` §7.1 and §8.2).
 *
 * - `wild-raid:<userid>`: the one open raid, from its warning to its finish.
 *   Nothing is applied to the save before finish, so losing the key (it
 *   expires, Redis restarts, the player reloads) cancels the raid and undoes
 *   nothing; the schedule is left as it was, so the raid is still due and
 *   comes back on the player's next yard visit (owner, Q1).
 * - `raid-screen:<userid>`: what the last presence ping said the player was
 *   looking at, for as long as the ping counts (120 s).
 *
 * Cancels (§7.1, with the owner's answer that quitting during the warning is
 * a cancel too):
 *
 * 1. No finish in time: the fight's key lives the fight's length at 1x plus
 *    2 minutes ({@link FIGHT_GRACE_SECONDS}).
 * 2. Presence lost: at finish, no presence mark from the last 120 s.
 * 3. A yard load: any own-main-yard build load cancels a raid that is
 *    fighting (the client left the fight); one still in its warning is
 *    cancelled only when the game had been closed, i.e. the presence mark had
 *    lapsed before the load ({@link cancelRaidOnYardLoad}). The web client
 *    loads the yard every time the player comes back from the map, and a
 *    warned raid waits for them there (§4.2).
 * 4. A warning never launched: its key lives until `attackAt` plus 15
 *    minutes ({@link WARNING_GRACE_SECONDS}).
 */

/** The warning's countdown: the fight starts this long after the raid opens (`WMATTACK.as:512-540`). */
export const WARNING_SECONDS = 5 * 60;

/** A warning not launched by `attackAt` plus this is gone. */
export const WARNING_GRACE_SECONDS = 15 * 60;

/** A fight not finished within its length at 1x plus this is gone. */
export const FIGHT_GRACE_SECONDS = 2 * 60;

/** A finish sooner than the fight's length at 2x minus this after start is refused. */
export const FINISH_EARLY_SLACK_SECONDS = 5;

/** The presence ping's life (`controllers/maproom/presence.ts`): no mark this recent at finish is a cancel. */
export const RAID_PRESENCE_SECONDS = 120;

export type RaidPhase = "warning" | "fighting";

/** What the last presence ping said the player was looking at (design §7.3). */
export interface RaidScreen {
  readonly where: "yard" | "other";
  readonly planner: boolean;
}

/**
 * The open raid. `plan` (WP1's army) and `outcome` (the engine's, kept at
 * fight start and never sent before finish) are opaque here.
 */
export interface OpenRaid {
  readonly id: string;
  readonly phase: RaidPhase;
  readonly tribe: string;
  readonly plan: unknown;
  readonly seed: number;
  /** Unix seconds the fight is due to start; "Engage now" brings it to now. */
  readonly attackAt: number;
  /** 1 once the player chose "Prepare defences". */
  readonly warned: 0 | 1;
  /** Unix seconds the fight started; set in the fight phase. */
  readonly startedAt?: number;
  /** The fight's length at 1x, seconds; set in the fight phase. */
  readonly fightSeconds?: number;
  readonly outcome?: unknown;
}

export const raidKey = (userid: number): string => `wild-raid:${userid}`;
export const raidScreenKey = (userid: number): string => `raid-screen:${userid}`;

/** A fresh raid id (`r_…`, design §8.1). */
export const newRaidId = (): string => `r_${randomUUID()}`;

/** How long a raid's key lives from `now`, by its phase. */
export const openRaidTtl = (raid: OpenRaid, now: number): number =>
  raid.phase === "fighting"
    ? Math.ceil(raid.fightSeconds ?? 0) + FIGHT_GRACE_SECONDS
    : Math.max(1, raid.attackAt - now + WARNING_GRACE_SECONDS);

const parseRaid = (raw: string | null): OpenRaid | null => {
  if (raw === null) return null;
  try {
    const raid = JSON.parse(raw) as OpenRaid;
    return typeof raid?.id === "string" ? raid : null;
  } catch {
    return null;
  }
};

const writeRaid = async (userid: number, raid: OpenRaid, now: number, mode: "NX" | "XX"): Promise<boolean> =>
  (await redis.set(raidKey(userid), JSON.stringify(raid), "EX", String(openRaidTtl(raid, now)), mode)) === "OK";

/** The player's open raid, or null. */
export const readOpenRaid = async (userid: number): Promise<OpenRaid | null> =>
  parseRaid(await redis.get(raidKey(userid)));

/**
 * Opens a raid in its warning phase, unless one is open already.
 *
 * @returns True when this raid is now the open one.
 */
export const openRaid = (userid: number, raid: OpenRaid, now: number): Promise<boolean> =>
  writeRaid(userid, { ...raid, phase: "warning" }, now, "NX");

/**
 * Rewrites the open raid ("Engage now", "Prepare defences", the fight's
 * start), its life recomputed for its phase. Never brings back a raid that
 * has gone in the meantime.
 *
 * @returns False when no raid was open.
 */
export const updateOpenRaid = (userid: number, raid: OpenRaid, now: number): Promise<boolean> =>
  writeRaid(userid, raid, now, "XX");

/** Cancels the open raid, if any. @returns True when one was open. */
export const cancelOpenRaid = async (userid: number): Promise<boolean> => (await redis.del(raidKey(userid))) > 0;

/**
 * Whether the player's presence mark has lapsed: their game was closed (or
 * offline) for the mark's whole life. Read before a load refreshes the mark.
 */
export const presenceLapsed = async (userid: number): Promise<boolean> => (await redis.get(lastSeenKey(userid))) === null;

/**
 * Cancel rule 3 on an own-main-yard build load: a fighting raid always, a
 * warning only when the game had been closed.
 *
 * @param gameWasClosed - {@link presenceLapsed}, read before this load wrote the mark.
 * @returns True when a raid was cancelled.
 */
export const cancelRaidOnYardLoad = async (userid: number, gameWasClosed: boolean): Promise<boolean> => {
  const raid = await readOpenRaid(userid);
  if (!raid) return false;
  if (raid.phase === "warning" && !gameWasClosed) return false;
  return cancelOpenRaid(userid);
};

/** What {@link takeRaidForFinish} found. */
export type RaidFinish =
  /** No open raid with that id: it timed out, was cancelled or was already finished. */
  | { readonly kind: "gone" }
  /** The raid is still in its warning. Left open. */
  | { readonly kind: "notFighting" }
  /** Sooner than the fight could have been watched at 2x. Left open until it times out. */
  | { readonly kind: "tooEarly"; readonly readyAt: number }
  /** The game was closed during the fight: cancelled and gone. */
  | { readonly kind: "cancelled"; readonly raid: OpenRaid }
  /** Taken, exactly once: the caller applies it. */
  | { readonly kind: "finished"; readonly raid: OpenRaid };

/** The earliest finish for a fight that started at `startedAt` and lasts `fightSeconds` at 1x. */
export const earliestFinish = (startedAt: number, fightSeconds: number): number =>
  startedAt + Math.ceil(fightSeconds / 2) - FINISH_EARLY_SLACK_SECONDS;

/**
 * The finish's checks (§7.1), and the raid taken out of Redis with `GETDEL`
 * so that of two finishes only one gets it. A refused finish leaves the raid
 * as it was.
 */
export const takeRaidForFinish = async (userid: number, raidId: string, now: number): Promise<RaidFinish> => {
  const open = await readOpenRaid(userid);
  if (!open || open.id !== raidId) return { kind: "gone" };
  if (open.phase !== "fighting" || open.startedAt === undefined) return { kind: "notFighting" };

  const readyAt = earliestFinish(open.startedAt, open.fightSeconds ?? 0);
  if (now < readyAt) return { kind: "tooEarly", readyAt };

  const taken = parseRaid(await redis.getdel(raidKey(userid)));
  if (!taken || taken.id !== raidId || taken.phase !== "fighting") return { kind: "gone" };

  const seen = Number(await redis.get(lastSeenKey(userid)));
  if (!(seen > 0) || seen < now - RAID_PRESENCE_SECONDS) return { kind: "cancelled", raid: taken };
  return { kind: "finished", raid: taken };
};

/**
 * The screen from a presence ping's body: `{ where: "yard" | "other",
 * planner: boolean }`. Anything else, an empty body above all (older clients,
 * Flash), is null and never gets a raid.
 */
export const parseRaidScreen = (body: unknown): RaidScreen | null => {
  if (typeof body !== "object" || body === null) return null;
  const { where, planner } = body as Record<string, unknown>;
  if ((where !== "yard" && where !== "other") || typeof planner !== "boolean") return null;
  return { where, planner };
};

/** Keeps the ping's screen for as long as the ping counts. */
export const recordRaidScreen = async (userid: number, screen: RaidScreen): Promise<void> => {
  await redis.setex(raidScreenKey(userid), RAID_PRESENCE_SECONDS, JSON.stringify(screen));
};

/** The last ping's screen, or null when it said none or has expired. */
export const readRaidScreen = async (userid: number): Promise<RaidScreen | null> => {
  const raw = await redis.get(raidScreenKey(userid));
  if (raw === null) return null;
  try {
    return parseRaidScreen(JSON.parse(raw));
  } catch {
    return null;
  }
};
