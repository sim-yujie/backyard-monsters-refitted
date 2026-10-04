import type { BaseLoadResponse } from "@/api/types";
import {
  harvesterFullAt,
  hatcheryJobs,
  lockerJobs,
  researchJobs,
  savedAtOf,
  trainingJobs,
} from "./jobs";
import { animPolicy, WorkKind } from "./yardAnim";

/**
 * Which buildings are working, and until when — what decides whether a
 * harvester, the Monster Locker, a hatchery, the Academy or the Lab runs its
 * animation (#255; the per-class rules are in `yardAnim.ts`).
 *
 * The answer is one number per building: the moment, on the server's clock,
 * its work stops. The renderer compares it with the clock every frame, which
 * is one comparison per animated building, and a harvester that fills up
 * between two store changes stops on its own. `Infinity` means "until the
 * save changes": a hatchery with more monsters queued, or an outpost
 * harvester, which the autobank keeps emptying. A building with no entry is
 * idle.
 *
 * Everything is read off the same job predictions the store and the job list
 * use (`jobs.ts`), so the animation and the timers cannot disagree:
 *
 * - a harvester works until its buffer is full (`harvesterFullAt`): not while
 *   a build, upgrade or fortify runs, not below half health, not when full;
 * - every Monster Locker works while any monster is unlocking, because the
 *   original asks the one global `CREATURELOCKER._unlocking`
 *   (`client/scripts/BUILDING8.as:32`);
 * - an Academy works while its training runs, the Lab while its research does;
 * - a hatchery works while its monster is at stage 1 — not stage 2, waiting
 *   for housing (`BUILDING13.as:34`) — and past the end of that monster when
 *   more are queued behind it, so it does not stall for the ten seconds the
 *   store waits before asking the server for the next one.
 */

/** Building id → the server-clock second its work stops. */
export type WorkMap = ReadonlyMap<number, number>;

/** The slices of a save the reading needs. */
export type WorkSave = Pick<
  BaseLoadResponse,
  | "type"
  | "savetime"
  | "currenttime"
  | "buildingdata"
  | "buildinghealthdata"
  | "lockerdata"
  | "storedata"
  | "academy"
  | "monsters"
>;

/** Where the renderer reads a yard's work from: the save it is drawing, and the clock. */
export interface WorkSource {
  save(): WorkSave;
  /** Unix seconds, server clock. */
  now(): number;
}

/** An outpost's save `type` (`yardModel.ts`). */
const OUTPOST_TYPE = "outpost";

/** Nobody is working. */
export const NO_WORK: WorkMap = new Map();

/**
 * The moment a building's animation stops: never for a type whose strip runs
 * regardless, otherwise its entry, or already for a building with none. The
 * renderer runs a strip while the clock is before it.
 */
export const workUntil = (type: number, id: number, work: WorkMap): number => {
  if (!animPolicy(type)?.work) return Number.POSITIVE_INFINITY;
  return work.get(id) ?? Number.NEGATIVE_INFINITY;
};

const later = (map: Map<number, number>, id: number | null, until: number | null): void => {
  if (id === null || until === null) return;
  map.set(id, Math.max(map.get(id) ?? Number.NEGATIVE_INFINITY, until));
};

/** A hatchery queue with at least one monster still in it. */
const hasQueue = (queue: unknown): boolean =>
  Array.isArray(queue) && queue.some((stack) => Array.isArray(stack) && Number(stack[1]) > 0);

/** Every working building in a save; see the module comment. */
export const readWork = (save: WorkSave): WorkMap => {
  const savedAt = savedAtOf(save);
  const buildings = save.buildingdata ?? {};
  const health = save.buildinghealthdata ?? null;
  const outpost = save.type === OUTPOST_TYPE;
  const work = new Map<number, number>();

  const lockers: number[] = [];
  for (const [key, raw] of Object.entries(buildings)) {
    if (!raw || typeof raw.t !== "number") continue;
    const id = typeof raw.id === "number" ? raw.id : Number(key);
    const kind = animPolicy(raw.t)?.work;
    if (kind === WorkKind.UNLOCK) lockers.push(id);
    if (kind !== WorkKind.HARVEST) continue;
    if (outpost) {
      // An outpost harvester never stays full: `BRESOURCE.Setup` starts it
      // producing on every load (`BRESOURCE.as:507-517`) and the autobank
      // empties it. A countdown or a wreck still stops it, which is what
      // asking when an empty buffer would fill answers.
      const runs = harvesterFullAt({ ...raw, id, st: 0 }, savedAt, health) !== null;
      if (runs) work.set(id, Number.POSITIVE_INFINITY);
      continue;
    }
    later(work, id, harvesterFullAt({ ...raw, id }, savedAt, health));
  }

  const unlocking = lockerJobs(save.lockerdata, null, save.storedata, savedAt).reduce(
    (end, job) => Math.max(end, job.endsAt ?? Number.NEGATIVE_INFINITY),
    Number.NEGATIVE_INFINITY,
  );
  if (unlocking > Number.NEGATIVE_INFINITY) {
    for (const id of lockers) later(work, id, unlocking);
  }

  for (const job of trainingJobs(save.academy, savedAt, buildings)) {
    later(work, job.buildingId, job.endsAt);
  }
  for (const job of researchJobs(buildings)) later(work, job.buildingId, job.endsAt);

  // Stage 2, waiting for housing, comes back with no end and is left idle.
  const queues = save.monsters?.h ?? [];
  const hatcheries = save.monsters?.hid ?? [];
  for (const job of hatcheryJobs(save.monsters, save.storedata, savedAt)) {
    if (job.endsAt === null) continue;
    const queued = hasQueue(queues[hatcheries.indexOf(Number(job.id))]?.[2]);
    later(work, job.buildingId, queued ? Number.POSITIVE_INFINITY : job.endsAt);
  }

  return work;
};

/**
 * A source for a yard that is not the player's own — a visit or an attack —
 * whose save does not change while it is on screen: the clock runs on from
 * the load's `currenttime`.
 */
export const fixedWorkSource = (
  save: WorkSave,
  clock = () => Date.now() / 1000,
): WorkSource => {
  const offset = save.currenttime - clock();
  return { save: () => save, now: () => clock() + offset };
};
