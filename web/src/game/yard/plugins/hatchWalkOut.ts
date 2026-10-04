import type { BaseLoadResponse } from "@/api/types";
import { prefersReducedMotion } from "@/game/attack/AttackBattleLayer";
import { walkOutOfHatchery, type MonsterWalkIn } from "@/game/guide/MonsterWalkIn";
import { housedCount } from "@/game/monsters/housing";
import { JobKind } from "@/game/yard/jobs";
import { YardView, type YardRenderer } from "@/game/yard/YardRenderer";
import { YardChangeReason, type YardChange, type YardStore } from "@/game/yard/YardStore";
import { YARD_PLUGINS, type YardMounts, type YardPlugin } from "../yardPlugins";

/**
 * Hatched monsters walk out of their Hatchery to Housing (issue #228), as the
 * guided start's Pokeys walk in from the yard's edge (`MonsterWalkIn`).
 * Drawing only: the server houses them.
 *
 * Two things say a monster hatched:
 *
 * - **The client's prediction.** When a hatchery's countdown reaches zero the
 *   store houses the monster in its copy of the save at once, so every housing
 *   count includes it, and announces the job (`predicted`, with `hatched`
 *   saying what each hatch did; #272). The walk starts then, from that
 *   Hatchery. A hatch housing had no room for stalls instead, and nothing
 *   walks. The server's answer, up to 10 s later (#142), confirms it.
 * - **The server's catch-up.** Every answer lists what hatched since the last
 *   one, per type (`completed`, kind `hatch`). That is the same monsters again
 *   plus any the prediction could not see: a hatchery making one faster than
 *   the store asks (an overdrive), or one finished while the tab slept. Only
 *   those extra walk, from a Hatchery making that monster.
 *
 * While a monster walks its pen leaves it out (`YardRenderer.holdLife`), so it
 * is never in two places; it joins the pen when it arrives. Nothing walks
 * under reduced motion, in the blueprint, or with the planner open; the pens
 * fill as before.
 *
 * Mounted on every own yard, main or outpost, with a Hatchery or not.
 */

/** One walk to start: who, how many, from where, and what the pens may show meanwhile. */
export interface HatchWalk {
  readonly monster: string;
  readonly count: number;
  /** Hatchery building ids to walk from, best first; the first one on the yard is used. */
  readonly hatcheries: readonly number[];
  /** The most of `monster` the pens show while they walk. */
  readonly cap: number;
}

/** The monster hatchery `id` is making (`monsters.h[i][0]` where `hid[i]` is `id`), or null. */
export const hatchingMonster = (monsters: BaseLoadResponse["monsters"], id: number): string | null => {
  const index = Array.isArray(monsters?.hid) ? monsters.hid.indexOf(id) : -1;
  const slot = index >= 0 ? monsters?.h?.[index] : undefined;
  const monster = Array.isArray(slot) ? slot[0] : undefined;
  return typeof monster === "string" && monster !== "" ? monster : null;
};

/** Every hatchery id, those making `monster` first. */
export const hatcheriesFor = (monsters: BaseLoadResponse["monsters"], monster: string): number[] => {
  const ids = Array.isArray(monsters?.hid) ? monsters.hid.filter((id): id is number => typeof id === "number") : [];
  const making = ids.filter((id) => hatchingMonster(monsters, id) === monster);
  return [...making, ...ids.filter((id) => !making.includes(id))];
};

/**
 * The walks one store change starts, and how many of each type have walked
 * ahead of the server since its last answer (`ahead`, carried to the next call).
 *
 * A prediction walks one monster from its Hatchery for each hatch it housed,
 * with the pens held at what is housed less those, as the save already counts
 * them. A server answer walks what it hatched
 * beyond those, with the pens held at what is housed less them, and starts the
 * count again; a predicted hatch the server did not make (housing filled up)
 * is forgotten with it.
 */
export const plannedWalks = (
  change: YardChange,
  save: BaseLoadResponse,
  ahead: ReadonlyMap<string, number>,
): { walks: HatchWalk[]; ahead: Map<string, number> } => {
  const walks: HatchWalk[] = [];
  if (change.reason === YardChangeReason.PREDICTED) {
    const next = new Map(ahead);
    const housed = (change.hatched ?? []).filter((hatch) => hatch.housed);
    for (const hatch of housed) {
      const walking = housed.filter((one) => one.monster === hatch.monster).length;
      walks.push({
        monster: hatch.monster,
        count: 1,
        hatcheries: [hatch.hatchery],
        cap: housedCount(save, hatch.monster) - walking,
      });
      next.set(hatch.monster, (next.get(hatch.monster) ?? 0) + 1);
    }
    return { walks, ahead: next };
  }
  if (change.reason !== YardChangeReason.ACTION && change.reason !== YardChangeReason.REFRESH) {
    return { walks, ahead: new Map(ahead) };
  }
  for (const job of change.completed) {
    if (job.kind !== JobKind.HATCH) continue;
    const monster = String(job.id);
    const count = Math.floor(Number(job.detail["count"]));
    const extra = (Number.isFinite(count) ? count : 0) - (ahead.get(monster) ?? 0);
    if (extra <= 0) continue;
    walks.push({
      monster,
      count: extra,
      hatcheries: hatcheriesFor(save.monsters, monster),
      cap: housedCount(save, monster) - extra,
    });
  }
  return { walks, ahead: new Map() };
};

/** What the walks need from the yard. */
export interface HatchWalkMounts {
  readonly store: Pick<YardStore, "save" | "yard" | "subscribe">;
  readonly renderer: Pick<YardRenderer, "standAmongBuildings" | "leaveBuildings" | "yardToWorld" | "holdLife" | "view">;
  /** Whether walks are left out just now: the planner is open. */
  readonly quiet?: () => boolean;
  readonly reducedMotion?: boolean;
}

export class HatchWalkOuts {
  private readonly walks = new Set<MonsterWalkIn>();
  private ahead = new Map<string, number>();
  private readonly unsubscribe: () => void;

  constructor(private readonly mounts: HatchWalkMounts) {
    this.unsubscribe = mounts.store.subscribe((change) => this.onChange(change));
  }

  /** How many walks are under way, for tests. */
  get walking(): number {
    return this.walks.size;
  }

  destroy(): void {
    this.unsubscribe();
    const walks = [...this.walks];
    this.walks.clear();
    for (const walk of walks) walk.destroy();
  }

  private onChange(change: YardChange): void {
    const { store, renderer } = this.mounts;
    const planned = plannedWalks(change, store.save, this.ahead);
    this.ahead = planned.ahead;
    if (planned.walks.length === 0) return;
    if (this.mounts.reducedMotion || renderer.view !== YardView.ISO || this.mounts.quiet?.()) return;
    for (const walk of planned.walks) this.start(walk);
  }

  private start(planned: HatchWalk): void {
    const { store, renderer } = this.mounts;
    const release = renderer.holdLife(planned.monster, planned.cap);
    for (const hatchery of planned.hatcheries) {
      let walk: MonsterWalkIn | null = null;
      walk = walkOutOfHatchery(renderer, store.yard, hatchery, planned.monster, planned.count, () => {
        release();
        // Over by itself: take it down. Over because `destroy` took it down: already gone.
        const done = walk;
        if (done && this.walks.delete(done)) queueMicrotask(() => done.destroy());
      });
      if (walk) {
        this.walks.add(walk);
        return;
      }
    }
    release();
  }
}

export const hatchWalkOutPlugin: YardPlugin = (mounts: YardMounts) => {
  const walks = new HatchWalkOuts({
    store: mounts.store,
    renderer: mounts.renderer,
    quiet: () => mounts.scene.plannerOpen(),
    reducedMotion: prefersReducedMotion(),
  });
  return () => walks.destroy();
};

YARD_PLUGINS.push(hatchWalkOutPlugin);
