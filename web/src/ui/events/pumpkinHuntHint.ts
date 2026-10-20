import { EVENT_EXTRAS } from "./EventsPanel";

/**
 * The Halloween card's line on where the pumpkins come from, under its
 * ladder (`EVENT_EXTRAS`): they grow in the yard during the event, about one
 * an hour up to 10 at a time (server `services/yard/season.ts`), and a tap
 * sends a worker to pick one.
 */

/** The yard pumpkin's picture (the small pumpkin decoration's top). */
export const PUMPKIN_ICON = "/assets/buildings/decorations/pumpkins/top.png";

export const PUMPKIN_HUNT_HINT =
  "Pumpkins grow in your yard about once an hour, up to 10 at a time. Tap one to send a worker to pick it; each one counts.";

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
