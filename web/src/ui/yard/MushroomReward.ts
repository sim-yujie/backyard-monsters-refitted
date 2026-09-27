import { Popup } from "@/ui/Popup";
import { resourceAmount } from "@/ui/resourceIcon";

/**
 * The golden mushroom popup (`docs/design/yard-buildings.md` §5.6): the
 * original's `popup_mushroomshiny` with its title, its line and the
 * `goldmushroom.png` picture (`client/scripts/MUSHROOMS.as:246-250`; strings
 * `pop_goldenmushroom_title` and `pop_goldenmushroom_desc`). The Shiny is
 * spelled with the shared icon helper (#93).
 */

/** The picture, served by the game server (`server/public/assets/popups/goldmushroom.png`). */
export const GOLDEN_MUSHROOM_ART = "/assets/popups/goldmushroom.png";

export const GOLDEN_TITLE = "Your worker struck gold!";

/**
 * Shows the popup in `container` (the overlay's modal layer) and returns it.
 * One button closes it, as do Escape and a click on the scrim.
 */
export const showGoldenMushroom = (container: HTMLElement, shiny: number): Popup => {
  const popup = new Popup({ title: GOLDEN_TITLE, className: "mushroom-reward" });

  const art = document.createElement("img");
  art.className = "mushroom-reward__art";
  art.src = GOLDEN_MUSHROOM_ART;
  art.alt = "";

  const line = document.createElement("p");
  line.className = "mushroom-reward__text";
  line.append(
    "You've picked a golden mushroom worth ",
    resourceAmount("shiny", shiny),
    ". Mushrooms grow back every day.",
  );

  const ok = document.createElement("button");
  ok.type = "button";
  ok.className = "btn btn--primary";
  ok.textContent = "OK";
  ok.addEventListener("click", () => popup.close());

  popup.setContent(art, line, ok);
  return popup.mount(container);
};
