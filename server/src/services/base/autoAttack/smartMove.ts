import type { Save } from "../../../database/models/save.model.js";
import type { User } from "../../../database/models/user.model.js";
import { MapRoomVersion } from "../../../enums/MapRoom.js";
import { autoAttackRefusedErr, baseUnderAttackErr, lastAttackLandingErr } from "../../../errors/errors.js";
import { redis } from "../../../server.js";
import { getCurrentDateTime } from "../../../utils/getCurrentDateTime.js";
import { logger } from "../../../utils/logger.js";
import { playerMapVersion } from "../../maproom/playerMapVersion.js";
import { ownYardsInReach } from "../../maproom/v2/ownYardsInReach.js";
import { rangeCheckV2 } from "../../maproom/v2/validateRange.js";
import { isCampInPlay } from "../../maproom/campInPlay.js";
import { attackLandingDeferred } from "../finaliseAttack.js";
import { isAttackActive } from "../isAttackActive.js";
import { TRIBE_NAMES, planNeeds, type PlanShortfall } from "./attackPlan.js";
import { findAttackPlan, type StoredPlan } from "./attackPlanStore.js";
import { AUTO_ATTACK_LOCK_SECONDS, autoAttackLockKey, campOf, type Camp, type NoRoom } from "./autoAttack.js";
import { movesKey, planMoves, type MovePlan, type YardMove } from "./movePlan.js";
import { labelsOf, makeRepeatMoves, repeatYardsFor, sizeOfFor, undoRepeatMoves, type YardLabel } from "./repeatMoves.js";

/**
 * Smart moving for hand attacks (beta 9, owner's grilling of 24 Nov 2026).
 *
 * When a player taps Attack on a Map Room 2 tribe camp they have a saved
 * Repeat plan for, and the yards whose Flinger reaches the camp do not hold
 * that plan's monsters, the web offers to move them in from the player's
 * other yards first and go straight into the battle ("Move & attack").
 *
 * The owner's rules:
 *
 * - The army is the saved Repeat plan's for the camp's tribe and level, its
 *   monsters only: champions and bombs never move, and a hand attack has no
 *   fee, so neither counts here (unlike Repeat attack's own check). A damaged
 *   camp still gets the whole plan's army.
 * - Only with the account's "Smart moving" setting on (`user.smart_moving_off`,
 *   on by default), only for a camp on the player's own world.
 * - The moves are Smart Repeat attack's (`movePlan.ts`, `repeatMoves.ts`):
 *   free, instant, the same transfer rules and locks, and made only when the
 *   key the player agreed to is exactly the moves the server works out now.
 * - One request moves and starts the attack (the attack load, `baseLoad.ts`):
 *   every check that writes nothing runs before the moves, and should the
 *   attack still not start (any refusal), the moves go back
 *   ({@link undoRepeatMoves}).
 */

/** What the web offers on Attack, as `POST /worldmapv2/smartmove` answers it. */
export type SmartMoveVerdict =
  /** The account's setting is off: the normal Attack window. */
  | "off"
  /** No saved plan for the camp's tribe and level: the normal Attack window. */
  | "none"
  /** No Flinger reaches the camp: nothing can move in. */
  | "outOfRange"
  /** The yards in range hold the plan's army already. */
  | "ready"
  /** The sheet: these moves gather it. */
  | "moves"
  /** Even every yard together lacks some of it. */
  | "short"
  /** It could be gathered, but the yards in range have no room for it. */
  | "housing";

export interface SmartMoveAnswer {
  readonly baseid: string;
  readonly verdict: SmartMoveVerdict;
  /** The camp, for the sheet's head; null for `off`. */
  readonly camp: { readonly tribe: string; readonly level: number; readonly damage: number } | null;
  /** The plan's monsters, per id; empty without a plan. */
  readonly monsters: Readonly<Record<string, number>>;
  /** The moves to make (`moves` only). */
  readonly moves: readonly YardMove[];
  /** Their key, sent back with the attack load; null without moves. */
  readonly movesKey: string | null;
  /** Each monster type short (`short` only), as Repeat attack's shortfall lists it. */
  readonly missing: readonly PlanShortfall[];
  /** No room in range (`housing` only). */
  readonly noRoom: NoRoom | null;
  /** Where each yard the moves or the room name sits. */
  readonly yards: Readonly<Record<string, YardLabel>>;
}

/** The camp's damage now; 0 once it has regenerated. */
const damageOf = (camp: Camp): number => (camp.row && !camp.expired ? (camp.row.damage ?? 0) : 0);

/** The planner's verdict for a plan's monsters, from the yards as they are now (nothing written). */
const handMoves = async (
  user: User,
  camp: Camp,
  stored: StoredPlan,
  now: number,
): Promise<{ move: MovePlan; reaching: string[]; yards: Record<string, YardLabel> }> => {
  const reaching = await ownYardsInReach(user, camp.cell);
  const yards = await repeatYardsFor(user, reaching, now);
  const move = planMoves(planNeeds(stored.plan).monsters, yards, sizeOfFor(user.save!));
  return { move, reaching, yards: labelsOf(yards, move) };
};

/**
 * What the web offers when the player taps Attack on a camp. Reads only:
 * nothing is caught up, written or reserved.
 *
 * @param user - The player, with their main save populated.
 * @param baseid - The camp.
 * @throws {ClientSafeError} `autoAttackRefusedErr("notMapRoom2" | "notACamp")`
 *   for anything but a Map Room 2 camp on the player's own world; the web
 *   then opens the normal Attack window.
 */
export const smartMoveFor = async (user: User, baseid: string): Promise<SmartMoveAnswer> => {
  const userSave = user.save!;
  if (playerMapVersion(userSave) !== MapRoomVersion.V2) throw autoAttackRefusedErr("notMapRoom2");
  const now = getCurrentDateTime();
  const camp = await campOf(userSave, baseid, now);
  const head = { tribe: TRIBE_NAMES[camp.key.wmid] ?? "Wild monster", level: camp.key.level, damage: damageOf(camp) };
  const nothing = { monsters: {}, moves: [], movesKey: null, missing: [], noRoom: null, yards: {} };
  if (user.smart_moving_off) return { baseid, verdict: "off", camp: null, ...nothing };

  const stored = await findAttackPlan(user.userid, camp.key);
  if (!stored) return { baseid, verdict: "none", camp: head, ...nothing };
  const monsters = planNeeds(stored.plan).monsters;

  const { verdict: range } = await rangeCheckV2(user, { baseid, cell: camp.cell });
  if (!range.ok) return { baseid, verdict: "outOfRange", camp: head, ...nothing, monsters };

  const { move, yards } = await handMoves(user, camp, stored, now);
  const base = { baseid, camp: head, ...nothing, monsters, yards };
  switch (move.kind) {
    case "ready":
      return { ...base, verdict: "ready" };
    case "moves":
      return { ...base, verdict: "moves", moves: move.moves, movesKey: movesKey(move.moves) };
    case "short":
      return {
        ...base,
        verdict: "short",
        missing: move.short.map((item) => ({ kind: "monster", id: item.id, need: item.need, have: item.have })),
      };
    case "housing":
      return { ...base, verdict: "housing", noRoom: { need: move.need, free: move.free } };
  }
};

/** What {@link startWithSmartMoves} hands the attack start, and what it made. */
export interface SmartMoved {
  /** The moves made before the attack started. */
  readonly moves: readonly YardMove[];
}

/**
 * Moves the plan's army into the yards in range, then starts the hand attack
 * (`start`, the attack load's `baseModeAttack`), as one request: "Move &
 * attack" goes straight into the battle.
 *
 * Every check that writes nothing runs first: the setting, the camp (Map Room
 * 2, the player's world, nobody attacking it, its last attack landed), the
 * plan, the range, and that the moves needed now are exactly `acceptedKey`.
 * The moves are then made in one transaction, under the yards' locks
 * (`makeRepeatMoves`, which checks the key again). Should `start` throw (any
 * refusal of the attack load), the moves are put back before the error goes
 * on, so a refused attack leaves every yard as it was.
 *
 * The caller has already checked the page's battle rules, finished the
 * player's last attack and the Discord age rule (`baseLoad.ts`).
 *
 * @param user - The player, with their main save populated.
 * @param baseid - The camp.
 * @param acceptedKey - The `movesKey` the sheet showed.
 * @param start - Starts the attack; runs after the moves.
 * @throws {ClientSafeError} `autoAttackRefusedErr` (`smartMoveOff`,
 *   `notMapRoom2`, `notACamp`, `noPlan`, `outOfRange`, `inFlight`,
 *   `movesChanged`, and `missing` / `noRoom` when the army can no longer be
 *   gathered), `baseUnderAttackErr`, `lastAttackLandingErr`, or whatever
 *   `start` throws, each with no move left behind.
 */
export const startWithSmartMoves = async <T>(
  user: User,
  baseid: string,
  acceptedKey: string,
  start: () => Promise<T>,
): Promise<T & { smartMoved: SmartMoved }> => {
  const userid = user.userid;
  const userSave: Save = user.save!;
  if (user.smart_moving_off) throw autoAttackRefusedErr("smartMoveOff");
  if (playerMapVersion(userSave) !== MapRoomVersion.V2) throw autoAttackRefusedErr("notMapRoom2");

  // One Repeat or smart move at a time per player: a double tap, or a Repeat
  // attack running in another tab, never moves the same monsters twice.
  const locked = await redis.set(autoAttackLockKey(userid), "1", "EX", String(AUTO_ATTACK_LOCK_SECONDS), "NX");
  if (locked !== "OK") throw autoAttackRefusedErr("inFlight");
  try {
    const now = getCurrentDateTime();
    const camp = await campOf(userSave, baseid, now);
    // The attack load's own refusals that need no write, asked before anything moves.
    if (camp.row && !camp.expired && isAttackActive(camp.row)) throw baseUnderAttackErr();
    if (camp.row && camp.expired && (await isCampInPlay(camp.row.basesaveid))) throw baseUnderAttackErr();
    if (camp.row && (await attackLandingDeferred(camp.row.basesaveid))) throw lastAttackLandingErr();

    const stored = await findAttackPlan(userid, camp.key);
    if (!stored) throw autoAttackRefusedErr("noPlan");
    const { verdict: range } = await rangeCheckV2(user, { baseid, cell: camp.cell });
    if (!range.ok) throw autoAttackRefusedErr("outOfRange");

    const { move, reaching, yards } = await handMoves(user, camp, stored, now);
    if (move.kind === "short") {
      const missing = move.short.map((item) => ({ kind: "monster" as const, id: item.id, need: item.need, have: item.have }));
      throw autoAttackRefusedErr("missing", { missing });
    }
    if (move.kind === "housing") throw autoAttackRefusedErr("noRoom", { noRoom: { need: move.need, free: move.free }, yards });
    if (move.kind !== "moves" || movesKey(move.moves) !== acceptedKey) throw autoAttackRefusedErr("movesChanged");

    const moved = await makeRepeatMoves(user, planNeeds(stored.plan).monsters, reaching, acceptedKey, now);
    let started: T;
    try {
      started = await start();
    } catch (err) {
      // The attack did not start: every monster goes back where it came from.
      await undoRepeatMoves(user, moved, now);
      throw err;
    }
    logger.info("Smart moving by {username} for camp {baseid}: {count} moves, then the attack", {
      event: "smart-move",
      userid,
      username: user.username,
      baseid,
      ...camp.key,
      count: moved.length,
      moved,
    });
    return { ...started, smartMoved: { moves: moved } };
  } finally {
    await redis.del(autoAttackLockKey(userid));
  }
};
