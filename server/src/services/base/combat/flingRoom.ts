import {
  bucketCost,
  championByType,
  championStat,
  flingerPayload,
  type FlingLog,
  type MonsterLevels,
} from "../../../game-rules/combat/index.js";

/**
 * How full one fling may be in a normal attack (owner, 12 Nov 2026: "ensure
 * edited game isnt allowed"): a Map Room 1 or 2 player yard, a wild monster
 * camp, an outpost or a Map Room 1 tribe.
 *
 * Flash filled the Flinger in `ATTACK.BucketAdd` (`ATTACK.as:589-617`): a
 * picked champion goes in first and takes its own `bucket` from the payload,
 * then monsters while they fit. The web client does the same (`Bucket`,
 * `web/src/game/attack/bucket.ts`), so an honest log never has a fling over
 * the room, and one that has is an edited game. The Inferno cuts its flings
 * to its own Flinger instead (`descentFightableLog`); this is everything else.
 *
 * Pure: `recordFlingRoom.ts` turns what it finds into a log line, a report
 * row and, in `reject` mode, a refusal.
 */

/**
 * The room one fling of a normal attack has: the Flinger pinned to level 4
 * whatever the attacker has built (`GLOBAL.as:863`, `flingerPayload`), 2,250.
 * It is what the web client's `Bucket.capacity` fills to on every normal
 * attack, so nothing the attacker builds, upgrades or loses while the attack
 * runs (a Flinger upgrade, a Map Room 2 bonus, an outpost) moves it.
 *
 * Flash added a quarter under Declare War (`ATTACK.as:593-595`). The web
 * client does not, so neither does this: a page that started to would need
 * the session's `declareWar` here too.
 */
export const NORMAL_FLINGER_ROOM = flingerPayload();

/** The room a flung champion takes ahead of the monsters: its own `bucket` at its level, 0 for an unknown type. */
export const championRoomOf = (champion: { readonly t: number; readonly l: number } | undefined): number => {
  if (!champion) return 0;
  const id = championByType(champion.t);
  return id ? championStat(id, "bucket", champion.l) : 0;
};

/**
 * A fling log as the web client sends it from the release after
 * v2.0.0-beta.6.15: `championRoom: 1` says its champion takes its own room in
 * the Flinger. The mark is kept out of the shared rules' `FlingLog`, whose
 * bytes set the rules version that stored defence replays are stamped with.
 */
export type MarkedFlingLog = FlingLog & { readonly championRoom?: 1 };

/** One fling fuller than the Flinger holds. */
export interface FlingOverRoom {
  /** Which fling of the log it is, from 1, counting flings only. */
  readonly fling: number;
  /** Fast ticks since attack start, as the log has it. */
  readonly t: number;
  /** The room it takes, under the rule its log is held to. */
  readonly used: number;
  readonly room: number;
}

/**
 * Whether the log is held to the champion-first rule: a page from the release
 * after v2.0.0-beta.6.15 marks its log ({@link MarkedFlingLog}). An older
 * page's log has no mark, and its champion rode on top of a full Flinger, so
 * it is held to what that page did: the monsters alone within the room. A
 * player still on an old page when the release goes out is never refused for
 * it; an edited game that drops the mark gains at most one champion's room
 * (240 at most, Gorgo's).
 */
export const championTakesRoom = (log: Pick<MarkedFlingLog, "championRoom">): boolean => log.championRoom === 1;

/**
 * Every fling of the log fuller than `room`, in log order: the champion's
 * own room plus its monsters' (`championTakesRoom`), or the monsters alone for
 * an older page's log. Counted as sent, before the replay trims a fling to
 * the monsters the attacker had (`fightableLog`): an honest page sends no
 * more than it has, and the champion at the level it is flung at, which is
 * never below the level it fights at.
 *
 * @param log - The fling log, parsed.
 * @param room - What one fling may carry ({@link NORMAL_FLINGER_ROOM}).
 * @param levels - The academy levels the attack is fought at.
 */
export const flingsOverRoom = (log: MarkedFlingLog, room: number, levels: MonsterLevels | undefined): FlingOverRoom[] => {
  const championFirst = championTakesRoom(log);
  const over: FlingOverRoom[] = [];
  let fling = 0;
  for (const event of log.events) {
    if (event.kind !== "fling") continue;
    fling += 1;
    const used = bucketCost(event.monsters, levels) + (championFirst ? championRoomOf(event.champion) : 0);
    if (used > room) over.push({ fling, t: event.t, used, room });
  }
  return over;
};
