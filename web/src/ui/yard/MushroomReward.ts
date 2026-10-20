import type { Season } from "@/game/season";
import { Popup } from "@/ui/Popup";
import { resourceAmount } from "@/ui/resourceIcon";

/**
 * The golden mushroom popup (`docs/design/yard-buildings.md` §5.6), or at
 * Halloween the jack-o'-lantern one: the
 * original's `popup_mushroomshiny` with its title, its line and the
 * `goldmushroom.png` picture (`client/scripts/MUSHROOMS.as:246-250`; strings
 * `pop_goldenmushroom_title` and `pop_goldenmushroom_desc`). The Shiny is
 * spelled with the shared icon helper (#93).
 */

/** The picture, served by the game server (`server/public/assets/popups/goldmushroom.png`). */
export const GOLDEN_MUSHROOM_ART = "/assets/popups/goldmushroom.png";

export const GOLDEN_TITLE = "Your worker struck gold!";

/**
 * The Halloween dress of the same popup: the golden mushroom is a glowing
 * jack-o'-lantern (`game/season.ts`). Same reward, same roll.
 */
export const JACK_O_LANTERN_ART = "/assets/popups/jack-o-lantern.png";
export const JACK_O_LANTERN_TITLE = "Your worker found a jack-o'-lantern!";

/** What the popup says in each season: picture, title, and the line around the Shiny. */
const DRESS: Readonly<Record<Season, { art: string; title: string; before: string; after: string }>> = {
  normal: {
    art: GOLDEN_MUSHROOM_ART,
    title: GOLDEN_TITLE,
    before: "You've picked a golden mushroom worth ",
    after: ". Mushrooms grow back every day.",
  },
  halloween: {
    art: JACK_O_LANTERN_ART,
    title: JACK_O_LANTERN_TITLE,
    before: "You've picked a glowing jack-o'-lantern worth ",
    after: ". Pumpkins keep growing while Halloween lasts.",
  },
};

/**
 * Shows the popup in `container` (the overlay's modal layer) and returns it.
 * One button closes it, as do Escape and a click on the scrim.
 */
export const showGoldenMushroom = (container: HTMLElement, shiny: number, season: Season = "normal"): Popup => {
  const dress = DRESS[season];
  const popup = new Popup({ title: dress.title, className: "mushroom-reward" });

  const art = document.createElement("img");
  art.className = "mushroom-reward__art";
  art.src = dress.art;
  art.alt = "";

  const line = document.createElement("p");
  line.className = "mushroom-reward__text";
  line.append(dress.before, resourceAmount("shiny", shiny), dress.after);

  const ok = document.createElement("button");
  ok.type = "button";
  ok.className = "btn btn--primary";
  ok.textContent = "OK";
  ok.addEventListener("click", () => popup.close());

  popup.setContent(art, line, ok);
  return popup.mount(container);
};
