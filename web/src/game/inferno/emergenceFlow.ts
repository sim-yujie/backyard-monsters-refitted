import { ATTACK_DELAY_MS, CAVE_MAX_LEVEL, FOCUS_DELAY_MS } from "./cave";
import { MOLOCH_INTRO, MOLOCH_TAUNTS } from "./emergenceText";

/**
 * The order of Moloch's emergence on the main yard (WP 1.10), as Flash plays
 * it (`INFERNO_EMERGENCE_EVENT.as` `SetupPortal`, `FocusOnPortal`,
 * `UpgradePortal`; `INFERNO_EMERGENCE_POPUPS.ShowStagePassed`). The server has
 * already raised the cave (WP 1.8); this only shows it. What it is shown on is
 * the {@link EmergenceView}, so the order is tested without a yard.
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
   * Moloch's raid, due now at this level. WP 1.9 opens it; until then the
   * cave just grows.
   */
  readonly raid?: (level: number) => void;
}

/** How long the turn waits each time something is open (`FocusOnPortal`'s 1 s). */
export const BUSY_RETRY_MS = 1_000;

/**
 * The cave went up to `raised` on this load: after a moment the camera turns
 * to it, Moloch speaks first if this is his first raid, then the cave grows
 * with the earthquake, and three seconds later his raid comes.
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
  const stop = view.earthquake();
  await wait(ATTACK_DELAY_MS);
  stop();
  if (alive()) deps.raid?.(raised);
};

/**
 * After Moloch's raid at `level`, won or lost (`ShowStagePassed`): "Stage
 * passed", his taunt for that level, and after the fifth the last popup.
 * For WP 1.9 to call when the raid lands.
 */
export const playStagePassed = async (level: number, view: EmergenceView): Promise<void> => {
  await view.stagePassed();
  const taunt = MOLOCH_TAUNTS[Math.min(Math.max(level, 1), MOLOCH_TAUNTS.length) - 1];
  if (taunt) await view.moloch(taunt);
  if (level >= CAVE_MAX_LEVEL) await view.complete();
};
