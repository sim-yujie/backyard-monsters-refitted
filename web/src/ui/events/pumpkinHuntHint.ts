import { EVENT_EXTRAS } from "./EventsPanel";

/**
 * The Halloween card's line on where the pumpkins come from, under its
 * ladder (`EVENT_EXTRAS`): they grow in the yard during the event, and a tap
 * sends a worker to pick one. It names no spawn rate (owner's call,
 * 20 Oct 2026); the rate lives in server `services/yard/season.ts`.
 */

/** The yard pumpkin's picture (the small pumpkin decoration's top). */
export const PUMPKIN_ICON = "/assets/buildings/decorations/pumpkins/top.png";

export const PUMPKIN_HUNT_HINT =
  "Pumpkins grow in your yard while Halloween lasts. Tap one to send a worker to pick it; each one counts.";

EVENT_EXTRAS.set("halloween", () => {
  const hint = document.createElement("p");
  hint.className = "events-hint";
  const icon = document.createElement("img");
  icon.className = "events-hint__icon";
  icon.src = PUMPKIN_ICON;
  icon.alt = "";
  hint.append(icon, PUMPKIN_HUNT_HINT);
  return hint;
});
