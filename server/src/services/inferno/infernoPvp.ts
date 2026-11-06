import { AttackPermission } from "../../enums/MapRoom.js";
import { HOUSING_BUNKER_TYPE, housedGarrisons } from "../../game-rules/combat/index.js";
import type { BuildingDataMap } from "../../types/BuildingData.js";
import type { NeighbourData } from "../../types/NeighbourData.js";
import { countsOf, type Counts } from "../yard/attackRoster.js";

/**
 * The rules of Inferno player attacks (`docs/design/inferno.md` §2.7, S3),
 * pure: who is in range, what each neighbour can be done to now, the
 * revenge counters an attack moves, and what an attacked yard's Housing
 * Bunkers still hold afterwards. The routes that read and write the rows are
 * `infernoNeighbours.ts`, `controllers/inferno/playerAttack.ts` and
 * `infernoPlayerLanding.ts`.
 */

/** Neighbours are Inferno yards within this many levels of the player's, up or down (`findInfernoNeighbours.ts`). */
export const INFERNO_LEVEL_RANGE = 7;

/** At most this many neighbours are found per search, from the newest Inferno yards. */
export const INFERNO_NEIGHBOUR_LIMIT = 25;

/** How many of the most recently changed Inferno yards a search looks through. */
export const INFERNO_NEIGHBOUR_SEARCH = 150;

/** Whether a yard at `theirs` is in range of a player at `mine`. */
export const inInfernoRange = (mine: number, theirs: number): boolean =>
  Math.abs(theirs - mine) <= INFERNO_LEVEL_RANGE;

/**
 * Revenge left on a neighbour: the attacks they made on the player that the
 * player has not yet paid back from out of range (Flash's "Vengeance enabled
 * X n", `map_status_vengeance`, `maproom_inferno/PlayerHandler.as:87`).
 */
export const vengeanceLeft = (entry: Pick<NeighbourData, "attacksfrom" | "retaliatecount"> | null | undefined): number =>
  Math.max(0, Math.floor(Number(entry?.attacksfrom ?? 0)) - Math.floor(Number(entry?.retaliatecount ?? 0)));

/** A neighbour's state now, as the permission reads it. */
export interface InfernoTargetState {
  /** The player's Inferno yard level, and the neighbour's. */
  readonly mine: number;
  readonly theirs: number;
  /** Revenge left on them ({@link vengeanceLeft}). */
  readonly vengeance: number;
  /** When their damage protection ends (unix seconds); 0 or past for none. */
  readonly protectedUntil: number;
  /** Their yard is being attacked now (`isAttackActive`). */
  readonly underAttack: boolean;
  readonly now: number;
}

/**
 * What the player can do to a neighbour now, in Flash's codes
 * (`maproom_inferno/PlayerHandler.as:98-121`): protected (5), being attacked
 * (7), out of range (3) unless revenge is left (4), higher level (2), or
 * attackable (1). Flash's server, which decided this, was not recovered; the
 * range is the neighbour search's, 7 levels either way, so a yard out of
 * range is reached only by revenge.
 */
export const infernoAttackPermission = (state: InfernoTargetState): AttackPermission => {
  if (state.protectedUntil > state.now) return AttackPermission.DAMAGE_PROTECTION;
  if (state.underAttack) return AttackPermission.UNDER_ATTACK;
  if (!inInfernoRange(state.mine, state.theirs)) {
    return state.vengeance > 0 ? AttackPermission.VENGEANCE_MODE : AttackPermission.LEVEL_RESTRICTION;
  }
  return state.theirs > state.mine ? AttackPermission.HIGHER_LEVEL : AttackPermission.ATTACKABLE;
};

/** Whether a permission lets the attack start. */
export const permitsAttack = (permission: AttackPermission): boolean =>
  permission === AttackPermission.ATTACKABLE ||
  permission === AttackPermission.HIGHER_LEVEL ||
  permission === AttackPermission.VENGEANCE_MODE;

/**
 * A fresh search's list with what the old one knew: the attack counters of
 * neighbours found again, and every old neighbour with revenge left, found or
 * not, so a re-search never takes away a player's revenge.
 */
export const keepRevenge = (previous: readonly NeighbourData[], found: readonly NeighbourData[]): NeighbourData[] => {
  const kept = found.map((entry) => {
    const old = previous.find((one) => one.userid === entry.userid);
    if (!old) return entry;
    return {
      ...entry,
      attacksfrom: old.attacksfrom ?? 0,
      attacksto: old.attacksto ?? 0,
      retaliatecount: old.retaliatecount ?? 0,
    };
  });
  const foundIds = new Set(found.map((entry) => entry.userid));
  for (const old of previous) {
    if (!foundIds.has(old.userid) && vengeanceLeft(old) > 0) kept.push(old);
  }
  return kept;
};

/**
 * The defender's list once `attacker` has attacked them: the attacker is on
 * it (first, when new, as `registerInfernoAttacker.ts` puts them) with one
 * more attack from them.
 */
export const withAttackFrom = (list: readonly NeighbourData[], attacker: NeighbourData): NeighbourData[] => {
  const known = list.find((entry) => entry.userid === attacker.userid);
  if (!known) return [{ ...attacker, attacksfrom: 1 }, ...list];
  return list.map((entry) =>
    entry.userid === attacker.userid ? { ...entry, attacksfrom: (entry.attacksfrom ?? 0) + 1 } : entry
  );
};

/**
 * The attacker's list once they have attacked `defender`: one more attack
 * on them, and one more paid back when it was revenge.
 */
export const withAttackOn = (
  list: readonly NeighbourData[],
  defender: NeighbourData,
  revenge: boolean
): NeighbourData[] => {
  const bump = (entry: NeighbourData): NeighbourData => ({
    ...entry,
    attacksto: (entry.attacksto ?? 0) + 1,
    ...(revenge && { retaliatecount: (entry.retaliatecount ?? 0) + 1 }),
  });
  const known = list.find((entry) => entry.userid === defender.userid);
  if (!known) return [...list, bump({ ...defender, attacksto: 0, retaliatecount: 0 })];
  return list.map((entry) => (entry.userid === defender.userid ? bump(entry) : entry));
};

/** The ids of the Housing Bunkers standing in `health` (absent counts as standing). */
const standingHousingBunkers = (
  buildingdata: BuildingDataMap | null | undefined,
  health: Readonly<Record<string, unknown>> | null | undefined
): number[] => {
  const ids: number[] = [];
  for (const [key, entry] of Object.entries(buildingdata ?? {})) {
    if (!entry || typeof entry !== "object" || Number(entry.t) !== HOUSING_BUNKER_TYPE) continue;
    const id = Math.floor(Number(entry.id ?? key));
    const value = health?.[String(id)];
    if (value === undefined || value === null || Number(value) > 0) ids.push(id);
  }
  return ids;
};

/**
 * What an attacked Inferno yard houses once the battle has landed, and what
 * it lost (`docs/design/inferno.md` §3.3, `HOUSINGBUNKER.as:149-353`).
 *
 * The housed monsters defended from the Housing Bunkers standing when the
 * battle began, dealt out as the engine dealt them (`housedGarrisons`). Each
 * Housing Bunker still standing at the end keeps what the battle left it,
 * the ones in it and the ones out alive (`bunkerGarrisons`); one that fell
 * loses every monster it housed, in or out. Monsters dealt to no bunker (none
 * was standing) stay as they were.
 *
 * @param input.buildingdata - The yard's buildings.
 * @param input.housed - `monsters.housed` as the battle began.
 * @param input.before - `buildinghealthdata` as the battle began.
 * @param input.after - The replay's `buildinghealthdata`.
 * @param input.garrisons - The replay's `bunkerGarrisons`.
 */
export const housedAfterBattle = (input: {
  buildingdata: BuildingDataMap | null | undefined;
  housed: unknown;
  before: Readonly<Record<string, unknown>> | null | undefined;
  after: Readonly<Record<string, unknown>>;
  garrisons: Readonly<Record<number, Readonly<Record<string, number>>>>;
}): { housed: Counts; lost: Counts } => {
  const start = countsOf(input.housed);
  const dealt = housedGarrisons(input.buildingdata as never, start, input.before ?? {});
  const kept: Counts = { ...start };
  for (const garrison of Object.values(dealt)) {
    for (const [id, count] of Object.entries(garrison)) kept[id] = (kept[id] ?? 0) - count;
  }
  for (const id of standingHousingBunkers(input.buildingdata, input.after)) {
    if (!dealt[id]) continue;
    for (const [monster, count] of Object.entries(input.garrisons[id] ?? {})) {
      kept[monster] = (kept[monster] ?? 0) + Math.max(0, Math.floor(count));
    }
  }
  const housed: Counts = {};
  const lost: Counts = {};
  for (const id of new Set([...Object.keys(start), ...Object.keys(kept)])) {
    const now = Math.max(0, Math.min(start[id] ?? 0, kept[id] ?? 0));
    if (now > 0) housed[id] = now;
    const gone = (start[id] ?? 0) - now;
    if (gone > 0) lost[id] = gone;
  }
  return { housed, lost };
};
