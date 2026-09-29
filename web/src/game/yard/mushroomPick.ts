import type { MushroomPickReport } from "@/api/types";
import type { YardRefusal } from "@/api/yard";
import { freeWorkers } from "./workers";
import type { YardActionResult, YardStoreAction, YardStoreReader } from "./YardStore";
import type { YardMushroom } from "./yardModel";

/**
 * Picking a yard mushroom (`docs/design/yard-buildings.md` §5.6, D14).
 *
 * The original sent a worker: the mushroom shook for 60 ticks, then resolved
 * (`client/scripts/BMUSHROOM.as:67-84`), and a golden one showed a popup
 * (`client/scripts/MUSHROOMS.as:246-250`) while an ordinary one got a worker's
 * quip (`:253-254`). Here a tap does the same: the mushroom shakes for
 * {@link SHAKE_MS}, then `POST /bm/yard/mushroom/pick` goes out and the
 * server decides the reward; the answer removes the mushroom and says what
 * it gave. A refusal (every worker busy, a stale list) stops the shake and
 * says why. The free-worker check runs before the shake too, so a busy yard
 * does not shake for nothing.
 *
 * Nothing here draws: the scene hands in a {@link MushroomPickView} (the
 * renderer's shake, the notices, the reward popup) and the store.
 */

/**
 * How long the shake runs before the request goes out: the original's 60
 * ticks (`BMUSHROOM.as:68`) at its 40 frames a second.
 */
export const SHAKE_MS = 1500;

/**
 * The tap box around a mushroom's base, world pixels: the drawn glyph
 * (`yardAtlas.ts`, 28 × 26 about an anchor near its foot) with a little slack
 * for a finger.
 */
const HIT = { left: 18, right: 18, top: 28, bottom: 8 } as const;

/**
 * The mushroom under a world point, or null. The frontmost wins where two
 * boxes overlap, as for buildings: mushrooms are drawn in list order.
 */
export const mushroomAt = (
  mushrooms: readonly YardMushroom[],
  worldX: number,
  worldY: number,
): YardMushroom | null => {
  for (let index = mushrooms.length - 1; index >= 0; index--) {
    const mushroom = mushrooms[index]!;
    const dx = worldX - mushroom.worldX;
    const dy = worldY - mushroom.worldY;
    if (dx >= -HIT.left && dx <= HIT.right && dy >= -HIT.top && dy <= HIT.bottom) {
      return mushroom;
    }
  }
  return null;
};

/** The worker quips for an ordinary mushroom (`pop_mushroom_msg2`..`4`, `MUSHROOMS.as:253`). */
export const ORDINARY_QUIPS: readonly string[] = [
  "Mmmm, mushroom soup.",
  "These things grow like weeds.",
  "Plain old fungus.",
];

/**
 * A mushroom is known by where it stands. Its index is only its place in the
 * list, which shifts when one before it is picked, so a pick queued behind
 * another looks its index up again just before it is sent.
 */
type Spot = Pick<YardMushroom, "x" | "y">;

/** The store key a pick runs under: `mushroom:<x>,<y>`. */
export const mushroomKey = (spot: Spot): string => `mushroom:${spot.x},${spot.y}`;

/** Where the mushroom standing at a spot is in the list now, or -1. */
export const indexOfMushroom = (mushrooms: readonly YardMushroom[], spot: Spot): number =>
  mushrooms.findIndex((one) => one.x === spot.x && one.y === spot.y);

const refuse = (reason: string, message: string): YardRefusal => ({
  reason,
  message,
  detail: {},
  local: true,
});

/**
 * Why the store's own state already says no, or null. The server's rules, in
 * its order: the mushroom must still be in the yard, and a worker must be free.
 */
export const pickRefusal = (
  store: Pick<YardStoreReader, "yard">,
  spot: Spot,
): YardRefusal | null => {
  if (indexOfMushroom(store.yard.mushrooms, spot) < 0) {
    return refuse("moved", "That mushroom is not there any more.");
  }
  if (freeWorkers(store.yard) === 0) return refuse("workers", "All your workers are busy.");
  return null;
};

/**
 * The request for the store's queue. `check` runs just before the send, after
 * every request ahead of it has answered, and finds the index the send uses.
 */
export const mushroomPickAction = (spot: Spot): YardStoreAction<MushroomPickReport> => {
  let index = -1;
  return {
    key: mushroomKey(spot),
    check: (store) => {
      index = indexOfMushroom(store.yard.mushrooms, spot);
      return pickRefusal(store, spot);
    },
    send: (api, ...yard) => api.pickMushroom(index, spot.x, spot.y, ...yard),
  };
};

/** What the picker draws through. */
export interface MushroomPickView {
  /** Starts the mushroom at a spot shaking; `stop` puts it back where it stood. */
  shake(spot: Spot): void;
  stop(spot: Spot): void;
  /** A golden mushroom: the popup (`pop_goldenmushroom_*`). */
  golden(shiny: number): void;
  /** An ordinary one: a toast with a worker's quip. */
  ordinary(quip: string): void;
  /** A refusal, in a toast. */
  refused(message: string): void;
}

/** The store as the picker uses it. */
export interface MushroomPickStore {
  readonly yard: YardStoreReader["yard"];
  run<Report>(action: YardStoreAction<Report>): Promise<YardActionResult<Report>>;
}

/** Timers, injectable so tests can run the clock by hand. */
export interface PickTimers {
  set(fn: () => void, ms: number): unknown;
}

const realTimers: PickTimers = { set: (fn, ms) => setTimeout(fn, ms) };

export class MushroomPicker {
  private readonly store: MushroomPickStore;
  private readonly view: MushroomPickView;
  private readonly timers: PickTimers;
  private readonly random: () => number;
  /** Mushrooms shaking or in flight, by {@link mushroomKey}: a second tap on one is ignored. */
  private readonly busy = new Set<string>();

  constructor(
    store: MushroomPickStore,
    view: MushroomPickView,
    options: { timers?: PickTimers; random?: () => number } = {},
  ) {
    this.store = store;
    this.view = view;
    this.timers = options.timers ?? realTimers;
    this.random = options.random ?? Math.random;
  }

  /** Whether this mushroom is shaking or its pick is in flight. */
  isPicking(spot: Spot): boolean {
    return this.busy.has(mushroomKey(spot));
  }

  /**
   * Picks a tapped mushroom: shake, then ask. Resolves once the answer has
   * been shown (or the refusal said); never throws.
   */
  pick(mushroom: Spot): Promise<void> {
    const key = mushroomKey(mushroom);
    if (this.busy.has(key)) return Promise.resolve();

    const early = pickRefusal(this.store, mushroom);
    if (early) {
      this.view.refused(early.message);
      return Promise.resolve();
    }

    this.busy.add(key);
    this.view.shake(mushroom);

    return new Promise<void>((resolve) => {
      this.timers.set(() => {
        void this.store
          .run(mushroomPickAction(mushroom))
          .then((result) => {
            this.view.stop(mushroom);
            if (!result.ok) {
              this.view.refused(result.refusal.message);
            } else if (result.report.golden) {
              this.view.golden(result.report.shiny);
            } else {
              const quip = ORDINARY_QUIPS[Math.floor(this.random() * ORDINARY_QUIPS.length)];
              this.view.ordinary(quip ?? ORDINARY_QUIPS[0]!);
            }
          })
          .finally(() => {
            this.busy.delete(key);
            resolve();
          });
      }, SHAKE_MS);
    });
  }
}
