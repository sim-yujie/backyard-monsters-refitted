import { LockMode, type EntityManager } from "@mikro-orm/core";
import { Save } from "../../database/models/save.model.js";
import type { User } from "../../database/models/user.model.js";
import { BaseType } from "../../enums/Base.js";
import { MapRoomVersion } from "../../enums/MapRoom.js";
import { raidRefusedErr } from "../../errors/errors.js";
import { footprintOf, TROJAN_HORSE_TYPE } from "../../game-data/buildingFootprints.js";
import type { BuildingData, BuildingDataMap, BuildingHealthData } from "../../types/BuildingData.js";
import { calculateEmpirePoints } from "../base/calculateEmpirePoints.js";
import { nextBuildingId, type BuildSave } from "../yard/build.js";
import { overlaps, rectOf } from "../yardplanner/layoutGeometry.js";
import { RAIDED_MAP_ROOMS, readSchedule, scheduleColumn } from "./raidSchedule.js";

/**
 * Placing the Trojan Horse — building **27** — on the player's main yard,
 * once per account (`docs/design/trojan-horse.md` §2, §7, issue #324). The
 * army, the fight and the letter popup are later work packages (WP2-WP4);
 * this is only the placing, the once-per-account flag, and keeping a client
 * save from touching the building it drops.
 */

/** `points + basevalue` over this makes the horse appear (design §2). */
export const TROJAN_SCORE_THRESHOLD = 2_000_000;

/**
 * Its usual spot: centred at the far north edge, outside the build plot
 * (design §2, `client/scripts/CUSTOMATTACKS.as:34-44`).
 */
export const TROJAN_HORSE_SPOT = { x: -70, y: -800 } as const;

/** How many footprint-widths either side of the usual spot the search below looks. */
const SEARCH_STEPS = 20;

/** Whether `rect` is clear of every building already on the yard. */
const isClear = (buildingdata: BuildingDataMap, rect: ReturnType<typeof rectOf>): boolean =>
  !Object.values(buildingdata).some((building) =>
    overlaps(rect, rectOf(Number(building.t), Number(building.X), Number(building.Y)))
  );

/**
 * The horse's usual spot, or the nearest free one along the same north-edge
 * row (design §2: "If the revamp yard cannot hold a building there, the
 * nearest legal spot on the north edge is used."). In practice this is never
 * found occupied — nothing else is placed this far outside the plot — but the
 * search runs all the same.
 */
const freeSpot = (buildingdata: BuildingDataMap): { x: number; y: number } => {
  const { x, y } = TROJAN_HORSE_SPOT;
  const step = footprintOf(TROJAN_HORSE_TYPE).w;
  if (isClear(buildingdata, rectOf(TROJAN_HORSE_TYPE, x, y))) return { x, y };
  for (let i = 1; i <= SEARCH_STEPS; i++) {
    for (const candidate of [x - i * step, x + i * step]) {
      if (isClear(buildingdata, rectOf(TROJAN_HORSE_TYPE, candidate, y))) return { x: candidate, y };
    }
  }
  return { x, y };
};

/** Adds the horse to `buildingdata` at a free spot, unconditionally. */
const placeHorse = (
  save: BuildSave
): { id: number; x: number; y: number; buildingdata: BuildingDataMap } => {
  const spot = freeSpot(save.buildingdata ?? {});
  const id = nextBuildingId(save);
  const building = { id, t: TROJAN_HORSE_TYPE, X: spot.x, Y: spot.y } as unknown as BuildingData;
  return { id, x: spot.x, y: spot.y, buildingdata: { ...(save.buildingdata ?? {}), [String(id)]: building } };
};

/** The slice of a locked save {@link placeTrojanHorse} reads and writes. */
export interface TrojanHorseSave {
  type?: string;
  mapversion?: number;
  points?: string | null;
  basevalue?: string | null;
  aiattacks?: unknown;
  buildingdata?: BuildingDataMap | null;
  buildinghealthdata?: BuildingHealthData | null;
}

/**
 * The gate (design §2, §7): the player's own main yard, on Map Room 1 or 2
 * (the same yards wild raids run on, {@link RAIDED_MAP_ROOMS}), over the
 * score threshold, with no horse placed yet. Called inside the owner's
 * build-mode load, under the row lock `catchUpLockedYard` already holds
 * (`controllers/yard/yardRoute.ts`'s `catchUpOwnerYard`), so two loads at
 * once still place exactly one horse: the second runs after the first's
 * transaction has committed and finds `trojan.placedAt` already set.
 *
 * Flash's `aiattacks.s1` is never read here (design §7, §9): an old value
 * left over from nowhere (this is a new server) does not block the horse.
 *
 * @returns Whether the horse was placed just now, for the load's one-time
 *   camera pan (design §3.1).
 */
export const placeTrojanHorse = (locked: TrojanHorseSave, now: number): boolean => {
  if (locked.type !== BaseType.MAIN) return false;
  if (!RAIDED_MAP_ROOMS.has(Number(locked.mapversion ?? MapRoomVersion.V1))) return false;

  const schedule = readSchedule(locked.aiattacks);
  if (schedule.trojan) return false;

  const empire = calculateEmpirePoints(locked.points ?? "0", locked.basevalue ?? "0");
  if (empire <= TROJAN_SCORE_THRESHOLD) return false;

  const { buildingdata } = placeHorse(locked);
  locked.buildingdata = buildingdata;
  locked.aiattacks = scheduleColumn({ ...schedule, trojan: { placedAt: now } });
  return true;
};

/** The caller's main yard, locked (as `services/raids/raidFlow.ts`'s own `lockMain` does it). */
const lockMainYard = async (tx: EntityManager, user: User): Promise<Save> => {
  const basesaveid = user.save?.basesaveid;
  if (basesaveid == null) throw raidRefusedErr("notMainYard");
  const locked = await tx.findOne(Save, { basesaveid }, { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true });
  if (!locked || locked.type !== BaseType.MAIN || locked.userid !== user.userid) throw raidRefusedErr("notMainYard");
  return locked;
};

/**
 * DEV only, never mounted in production (`controllers/raid/raid.ts`'s
 * `raidDevTrojan`, design §7): places a horse now, ignoring the score and the
 * once-per-account flag, for testing (Flash had a console command `trojan`).
 * A horse already on the yard is reported back rather than a second one being
 * added.
 */
export const devPlaceTrojanHorse = (
  em: EntityManager,
  user: User,
  now: number
): Promise<{ placed: boolean; id: number; x: number; y: number }> =>
  em.transactional(async (tx) => {
    const locked = await lockMainYard(tx, user);
    const already = Object.entries(locked.buildingdata ?? {}).find(
      ([, building]) => Number(building?.t) === TROJAN_HORSE_TYPE
    );
    if (already) {
      const [key, building] = already;
      return { placed: false, id: Number(building.id ?? key), x: Number(building.X), y: Number(building.Y) };
    }

    const { id, x, y, buildingdata } = placeHorse(locked);
    locked.buildingdata = buildingdata;
    const schedule = readSchedule(locked.aiattacks);
    locked.aiattacks = scheduleColumn({ ...schedule, trojan: { placedAt: now } });
    await tx.flush();
    return { placed: true, id, x, y };
  });

/**
 * `buildingdata` a client save may never touch (design §7 "Save protection"):
 * every stored horse kept exactly as it was, and anything the submitted data
 * adds, moves or drops in its place discarded. Nothing legitimate sends a
 * building 27 at all — the server places and removes it — so this only
 * matters against a forged request (`controllers/base/save/baseSave.ts`).
 */
export const protectTrojanHorse = (
  stored: BuildingDataMap | null | undefined,
  submitted: BuildingDataMap
): BuildingDataMap => {
  const storedHorses = Object.entries(stored ?? {}).filter(
    ([, building]) => Number(building?.t) === TROJAN_HORSE_TYPE
  );
  const submittedHasHorse = Object.values(submitted).some((building) => Number(building?.t) === TROJAN_HORSE_TYPE);
  if (storedHorses.length === 0 && !submittedHasHorse) return submitted;

  const next: BuildingDataMap = {};
  for (const [key, building] of Object.entries(submitted)) {
    if (Number(building?.t) !== TROJAN_HORSE_TYPE) next[key] = building;
  }
  for (const [key, building] of storedHorses) next[key] = building;
  return next;
};
