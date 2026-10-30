import { markKorathSeen } from "@/api/inferno";
import { emergencePlaying } from "@/game/inferno/emergenceHold";
import { korathStep } from "@/game/inferno/korathNotice";
import { bobOnScreen } from "@/ui/guide/BobBubble";
import { korathUnlocked } from "@/ui/inferno/KorathUnlocked";
import { CHAMPION_CAGE_TYPE, CHAMPION_CHAMBER_TYPE } from "../championModel";
import { YARD_PLUGINS, type YardMounts } from "../yardPlugins";
import { guideOpen } from "./achievements";

/**
 * Own-yard plugin for "Korath unlocked" (Inferno WP 5.2, owner I10): on the
 * main yard, when the load says the player has not been told yet
 * (`infernostate.korathNotice`, sent only with the new Inferno on), it waits
 * for a quiet moment (no popup, no Bob, no guided start, no emergence, nothing
 * in hand) and shows it once, then tells the server (`/bm/inferno/korath/seen`),
 * so the next load does not ask again. Its button goes to the cage, the
 * Chamber or the Build menu (`game/inferno/korathNotice.ts`).
 */

/** First look a moment after the yard opens, then every second until quiet. */
const FIRST_LOOK_MS = 1_500;
const LOOK_AGAIN_MS = 1_000;

/**
 * Shown in this tab already, so a yard opened again on the same load (a store
 * kept across a scene) does not show it twice before the server hears.
 */
let shown = false;

/** Forgets {@link shown}, for tests. */
export const resetKorathPlugin = (): void => {
  shown = false;
};

const popupOpen = (): boolean => document.querySelector(".popup-backdrop") !== null;

export const korathPlugin = (
  mounts: Pick<YardMounts, "store" | "overlay" | "scene">,
  seen: () => Promise<unknown> = markKorathSeen,
): (() => void) | void => {
  const { store, overlay, scene } = mounts;
  if (store.kind !== "main" || shown || store.save.infernostate?.korathNotice !== true) return;

  let alive = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const quiet = (): boolean =>
    !popupOpen() &&
    !bobOnScreen() &&
    !emergencePlaying() &&
    !guideOpen(store.save.onboarding) &&
    !scene.plannerOpen() &&
    !scene.carrying();

  const look = (): void => {
    timer = null;
    if (!alive || shown) return;
    if (!quiet()) {
      timer = setTimeout(look, LOOK_AGAIN_MS);
      return;
    }
    shown = true;
    const step = korathStep(store.save);
    korathUnlocked(overlay.modal, step, () => {
      switch (step.kind) {
        case "buildCage":
          scene.openBuildMenu(CHAMPION_CAGE_TYPE);
          break;
        case "buildChamber":
          scene.openBuildMenu(CHAMPION_CHAMBER_TYPE);
          break;
        case "openCage":
          scene.focusBuilding(step.cage, true);
          break;
        case "openChamber":
          scene.focusBuilding(step.chamber, true);
          break;
        case "cageBuilding":
          break;
      }
    });
    // Told: a failed call only means the next load asks again.
    void seen().catch(() => {});
  };
  timer = setTimeout(look, FIRST_LOOK_MS);

  return () => {
    alive = false;
    if (timer !== null) clearTimeout(timer);
  };
};

YARD_PLUGINS.push(korathPlugin);
