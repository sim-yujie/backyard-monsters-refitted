import type { MolochGroup } from "@/api/inferno";
import { ATTACK_DELAY_MS, CAVE_MAX_LEVEL, FOCUS_DELAY_MS } from "./cave";
import { MOLOCH_INTRO, MOLOCH_TAUNTS } from "./emergenceText";

/**
 * The order of Moloch's emergence on the main yard (WP 1.10), as Flash plays
 * it (`INFERNO_EMERGENCE_EVENT.as` `SetupPortal`, `FocusOnPortal`,
 * `UpgradePortal`, `ShowWarningPopup`; `INFERNO_EMERGENCE_POPUPS.ShowStagePassed`).
 * The server has already raised the cave (WP 1.8) and opened Moloch's raid for
 * it (WP 1.9); this shows it and, on "Engage Attack", starts the raid. What it
 * is shown on is the {@link EmergenceView}, so the order is tested without a
 * yard.
 */

export interface EmergenceView {
  /** Draws the cave at a level; 0 hides it. */
  setCaveLevel(level: number): void;
  /** Turns the camera to the cave. */
  focusCave(): void;
  /** Whether something the player is busy with is open: the turn waits for it. */
  busy(): boolean;
  /** One of Moloch's lines with "Next"; resolves when it is closed. */
  moloch(text: string): Promise<void>;
  /** The EARTHQUAKE banner and the shake; returns the banner's removal. */
  earthquake(): () => void;
  /**
   * Moloch's warning with his army, one card per group, and "Engage Attack",
   * which calls `engage` until it answers true. Resolves once it has closed.
   */
  warning(groups: readonly MolochGroup[], engage: () => Promise<boolean>): Promise<void>;
  /** "Stage passed"; resolves when it is closed. */
  stagePassed(): Promise<void>;
  /** The last popup, after the fifth raid; resolves when it is closed. */
  complete(): Promise<void>;
}

export interface EmergenceDeps {
  readonly view: EmergenceView;
  readonly wait: (ms: number) => Promise<void>;
  /** False once the yard has gone: the rest is dropped. */
  readonly alive: () => boolean;
  /**
   * Moloch's raid for this raise: its groups for the warning, and its start
   * (true once done with: the fight handed on, or the raid gone). None when
   * the first raise found the yard at 10% health or less: the cave grows with
   * no earthquake and no raid, as Flash's `UpgradePortal` left them out.
   */
  readonly raid?: {
    readonly groups: readonly MolochGroup[];
    readonly start: () => Promise<boolean>;
  } | null;
}

/** How long the turn waits each time something is open (`FocusOnPortal`'s 1 s). */
export const BUSY_RETRY_MS = 1_000;

/**
 * The cave went up to `raised` on this load: after a moment the camera turns
 * to it, Moloch speaks first if this is his first raid, then the cave grows
 * with the earthquake, and three seconds later his warning comes, whose
 * "Engage Attack" starts the raid.
 */
export const playEmergence = async (raised: number, deps: EmergenceDeps): Promise<void> => {
  const { view, wait, alive } = deps;
  view.setCaveLevel(raised - 1);
  await wait(FOCUS_DELAY_MS);
  while (alive() && view.busy()) await wait(BUSY_RETRY_MS);
  if (!alive()) return;
  view.focusCave();
  if (raised === 1) {
    await view.moloch(MOLOCH_INTRO);
    if (!alive()) return;
  }
  view.setCaveLevel(raised);
  const raid = deps.raid;
  if (!raid) return;
  const stop = view.earthquake();
  await wait(ATTACK_DELAY_MS);
  stop();
  if (alive()) await view.warning(raid.groups, raid.start);
};

/**
 * After Moloch's raid at `level`, won or lost (`ShowStagePassed`): "Stage
 * passed", his taunt for that level, and after the fifth the last popup.
 * Played when the yard opens on what the raid landed.
 */
export const playStagePassed = async (level: number, view: EmergenceView): Promise<void> => {
  await view.stagePassed();
  const taunt = MOLOCH_TAUNTS[Math.min(Math.max(level, 1), MOLOCH_TAUNTS.length) - 1];
  if (taunt) await view.moloch(taunt);
  if (level >= CAVE_MAX_LEVEL) await view.complete();
};
