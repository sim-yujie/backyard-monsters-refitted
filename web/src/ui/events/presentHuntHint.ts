import { EVENT_EXTRAS } from "./EventsPanel";

/**
 * The Christmas card's line on where the presents come from, just above its
 * ladder (`EVENT_EXTRAS`; `events.css` moves it there), as Halloween's pumpkin line
 * (`pumpkinHuntHint.ts`): they turn up in the yard while the event lasts,
 * and a tap sends a worker to pick one. No spawn rate (server
 * `services/yard/season.ts` keeps it).
 */

export const PRESENT_HUNT_HINT = "Tap a present in your yard to pick it. Golden ones hold Shiny!";

EVENT_EXTRAS.set("christmas", () => {
  // Plain text: the present's picture already stands by "Presents found" just under it (neon, round 2).
  const hint = document.createElement("p");
  hint.className = "events-hint events-hint--plain";
  hint.append(PRESENT_HUNT_HINT);
  return hint;
});
