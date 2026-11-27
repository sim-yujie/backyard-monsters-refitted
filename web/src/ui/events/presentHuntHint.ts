import { EVENT_EXTRAS } from "./EventsPanel";
import { PRESENT_ICON } from "@/game/yard/presentArt";

/**
 * The Christmas card's line on where the presents come from, under its
 * ladder (`EVENT_EXTRAS`), as Halloween's pumpkin line
 * (`pumpkinHuntHint.ts`): they turn up in the yard while the event lasts,
 * and a tap sends a worker to pick one. No spawn rate (server
 * `services/yard/season.ts` keeps it).
 */

export const PRESENT_HUNT_HINT = "Tap a present in your yard to pick it. Golden ones hold Shiny!";

export { PRESENT_ICON };

EVENT_EXTRAS.set("christmas", () => {
  const hint = document.createElement("p");
  hint.className = "events-hint";
  const icon = document.createElement("img");
  icon.className = "events-hint__icon";
  icon.src = PRESENT_ICON;
  icon.alt = "";
  hint.append(icon, PRESENT_HUNT_HINT);
  return hint;
});
