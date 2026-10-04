import type { BaseLoadResponse, MonstersSave } from "@/api/types";
import { JobKind, overdriveAt, savedAtOf, type YardJob } from "@/game/yard/jobs";
import { housedSpace, readHatchYard, secondsOf, spaceOf, type QueueStack } from "./hatchPlan";

/**
 * What a hatch the client saw finish does to the save, ahead of the server
 * (#272): the monster is housed at once, so every housing count — the Monsters
 * screen's header, the Housing tab, the Hatch tab's room — shows it while it
 * is still walking to its pen, rather than up to 10 s later when the `state`
 * call answers (#142). Whatever the server answers replaces it.
 *
 * The same step the server's `simulateProduction` takes for one hatchery
 * (`server/src/services/yard/production.ts` `settle`): a finished monster
 * moves into housing if the free space is at least its space, and the
 * hatchery takes the next monster from its own queue, or with a working HCC
 * from the head of the shared queue, or goes idle. With no room it stalls
 * (stage 2) and nothing is housed.
 */

/** One hatch the client predicted. */
export interface HatchPrediction {
  readonly hatchery: number;
  readonly monster: string;
  /** False when housing was full and the hatchery stalled instead. */
  readonly housed: boolean;
}

/** Seconds of 1x work done between `from` and `to`, overdrive included. */
const workBetween = (
  from: number,
  to: number,
  overdrive: { power: number; until: number } | null,
): number => {
  if (to <= from) return 0;
  if (!overdrive || overdrive.until <= from || overdrive.power <= 1) return to - from;
  const fast = Math.min(to, overdrive.until) - from;
  return fast * overdrive.power + Math.max(0, to - overdrive.until);
};

/** Takes one monster off the head of a queue (`takeHead`), or null when it is empty. */
const takeHead = (queue: QueueStack[]): { id: string; level: number } | null => {
  const head = queue[0];
  if (!head) return null;
  head[1] -= 1;
  if (head[1] <= 0) queue.shift();
  return { id: head[0], level: head[2] };
};

/** One hatchery's monster finishing at `at`, server clock. */
const predictOne = (
  save: BaseLoadResponse,
  hatcheryId: number,
  at: number,
): { save: BaseLoadResponse; hatched: HatchPrediction | null } => {
  const monsters = save.monsters;
  const hid: unknown[] = Array.isArray(monsters?.hid) ? monsters.hid : [];
  const slot = hid.findIndex((id) => Number(id) === hatcheryId);
  const yard = readHatchYard(save, at);
  const hatchery = yard.hatcheries.find((one) => one.id === hatcheryId);
  if (!monsters || slot < 0 || !hatchery?.monster || hatchery.stage !== 1 || !hatchery.works) {
    return { save, hatched: null };
  }
  const monster = hatchery.monster;
  const h: NonNullable<MonstersSave["h"]> = Array.isArray(monsters.h) ? [...monsters.h] : [];
  const hstage: number[] = Array.isArray(monsters.hstage) ? [...monsters.hstage] : [];

  const space = spaceOf(monster, yard.levels[monster] ?? 1);
  if (yard.capacity - housedSpace(yard) < space) {
    h[slot] = [monster, 0, hatchery.queue, hatchery.paidLevel];
    hstage[slot] = 2;
    const stalled: MonstersSave = { ...monsters, h, hstage };
    return { save: { ...save, monsters: stalled }, hatched: { hatchery: hatcheryId, monster, housed: false } };
  }

  const housed = { ...(monsters.housed ?? {}) };
  housed[monster] = (Number(housed[monster]) || 0) + 1;
  const queue = hatchery.queue.map((stack): QueueStack => [...stack]);
  const shared = yard.shared.map((stack): QueueStack => [...stack]);
  const next = takeHead(queue) ?? (yard.hcc?.works ? takeHead(shared) : null);
  if (next) {
    // Countdowns are measured from `saved`: the work already done since then,
    // plus the next monster's own time from `at`.
    const saved = Number(monsters.saved) || savedAtOf(save);
    const done = workBetween(saved, at, overdriveAt(save.storedata, saved));
    h[slot] = [next.id, done + secondsOf(next.id, yard.levels[next.id] ?? 1), queue, next.level];
    hstage[slot] = 1;
  } else {
    h[slot] = ["", 0, queue];
    hstage[slot] = 0;
  }
  const after: MonstersSave = { ...monsters, housed, h, hstage, hcc: shared };
  return { save: { ...save, monsters: after }, hatched: { hatchery: hatcheryId, monster, housed: true } };
};

/**
 * Every hatch among `jobs`, in the order they finished, then in the
 * hatcheries' service order as the server serves them.
 */
export const predictHatches = (
  save: BaseLoadResponse,
  jobs: readonly YardJob[],
): { save: BaseLoadResponse; hatched: HatchPrediction[] } => {
  const hid: unknown[] = Array.isArray(save.monsters?.hid) ? save.monsters.hid : [];
  const order = (id: number | null) => hid.findIndex((one) => Number(one) === id);
  const due = jobs
    .filter((job) => job.kind === JobKind.HATCH && job.buildingId !== null && job.endsAt !== null)
    .sort((a, b) => a.endsAt! - b.endsAt! || order(a.buildingId) - order(b.buildingId));
  const hatched: HatchPrediction[] = [];
  let next = save;
  for (const job of due) {
    const step = predictOne(next, job.buildingId!, job.endsAt!);
    next = step.save;
    if (step.hatched) hatched.push(step.hatched);
  }
  return { save: next, hatched };
};
