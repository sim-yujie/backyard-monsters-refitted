import type { CompletedJob } from "@/api/types";

/**
 * The tutorial's event bus (issue #227, `docs/design/tutorial.md` §9.2).
 *
 * The screens and scenes the guide watches say what happened here, once, in
 * the foundation package (WP0); the guided start and the screen tips listen
 * without editing those screens again. Nothing here decides anything: an
 * event is a fact about the UI, emitted whether or not anyone listens.
 *
 * One bus for the whole app, because a screen and the plugin listening to it
 * live in different scenes' lifetimes (the map opens, the yard closes). A
 * listener cleans up after itself with the function {@link GuideBus.on}
 * returns.
 */

/**
 * Every screen that emits `screen` when it opens: the tip catalogue's ids
 * (§7.2). The guided start reads the same events.
 */
export const GuideScreen = {
  YARD: "yard",
  BUILD: "build",
  BUILDING: "building",
  REPAIR: "repair",
  MAIL: "mail",
  MONSTERS_UNLOCK: "monsters-unlock",
  MONSTERS_HATCH: "monsters-hatch",
  MONSTERS_HOUSING: "monsters-housing",
  MONSTERS_TRAIN: "monsters-train",
  MONSTERS_LAB: "monsters-lab",
  SHOP: "shop",
  PLANNER: "planner",
  MR1: "mr1",
  MR2: "mr2",
  ATTACK: "attack",
  BAITER: "baiter",
  CHAMPION: "champion",
  OUTPOSTS: "outposts",
} as const;
export type GuideScreen = (typeof GuideScreen)[keyof typeof GuideScreen];

/** The events and what each carries. */
export interface GuideEvents {
  /**
   * A screen opened (or switched to the tab the id names). `root` is the
   * screen's element; `header` its title row, where a "?" button can go.
   */
  screen: { id: GuideScreen; root: HTMLElement; header: HTMLElement | null };
  /** The Build menu opened (on `tab`, its category id) or closed. */
  buildMenu: { open: boolean; tab?: string };
  /** A new building is in hand (`type`), or was put down without building (`type` null). */
  carry: { type: number | null };
  /** The server accepted a new building from the Build menu. */
  placed: { type: number; id: number };
  /** The building panel opened on a building, or closed (`building` null). */
  panel: { building: { id: number; type: number } | null };
  /** Jobs the own yard's server catch-up finished (an answer with `completed`). */
  jobFinished: { jobs: readonly CompletedJob[] };
  /** A bank landed: what the server banked, per resource key. */
  banked: { banked: Readonly<Record<string, number>> };
  /** A map screen opened. */
  mapOpened: { map: "mr1" | "mr2" };
  /** A target was picked on Map Room 1 (its card opened): a tribe or a player's yard. */
  targetPicked: { baseid: string; kind: "tribe" | "player" };
  /** An attack ended and its result is on screen. */
  attackEnded: { baseid: string; destroyed: boolean };
}

export type GuideEventName = keyof GuideEvents;
type Listener<K extends GuideEventName> = (payload: GuideEvents[K]) => void;

/** A typed publish/subscribe bus. */
export class GuideBus {
  private readonly listeners = new Map<GuideEventName, Set<Listener<GuideEventName>>>();

  /** Listens to one event; returns the unsubscribe. */
  on<K extends GuideEventName>(name: K, listener: Listener<K>): () => void {
    let set = this.listeners.get(name);
    if (!set) {
      set = new Set();
      this.listeners.set(name, set);
    }
    set.add(listener as Listener<GuideEventName>);
    return () => {
      set.delete(listener as Listener<GuideEventName>);
    };
  }

  /**
   * Tells every listener, in the order they subscribed. A listener that
   * throws is reported and skipped, so a broken tip can never break the
   * screen that emitted.
   */
  emit<K extends GuideEventName>(name: K, payload: GuideEvents[K]): void {
    const set = this.listeners.get(name);
    if (!set) return;
    for (const listener of [...set]) {
      try {
        (listener as Listener<K>)(payload);
      } catch (error) {
        console.error(`guideBus "${name}" listener failed:`, error);
      }
    }
  }

  /** Drops every listener (tests). */
  clear(): void {
    this.listeners.clear();
  }
}

/** The app's one bus. */
export const guideBus = new GuideBus();
