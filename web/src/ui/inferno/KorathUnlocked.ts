import {
  KORATH_UNLOCKED_LINE,
  KORATH_UNLOCKED_TITLE,
  korathStepText,
  type KorathStep,
} from "@/game/inferno/korathNotice";
import { championPortrait, showPortrait } from "@/game/portraits";
import { Popup } from "@/ui/Popup";
import "@/ui/styles/inferno.css";

/** Korath's last evolution, whose painting the popup shows. */
const KORATH_TOP_LEVEL = 6;

/**
 * "Korath unlocked" (Inferno WP 5.2, `game/inferno/korathNotice.ts`): Korath's
 * painted portrait, Flash's line and what to do next, with one button that
 * goes there (`act`, after the popup closes). Flash's own picture for it was
 * a video of Korath walking (`mc_promo_walk.flv`), which the game server does
 * not have; the portrait is the Champion Cage's own painting at his top
 * level (level 1 is a small lava rock), so the player sees what he grows into.
 */
export const korathUnlocked = (
  host: HTMLElement,
  step: KorathStep,
  act: () => void,
  onClose: () => void = () => {},
): Popup => {
  const popup = new Popup({ title: KORATH_UNLOCKED_TITLE, className: "inferno-popup inferno-popup--korath", onClose });
  const art = document.createElement("img");
  art.className = "inferno-korath__art";
  art.alt = "Korath";
  art.decoding = "async";
  showPortrait(art, championPortrait("G4", KORATH_TOP_LEVEL, "card"));

  const text = korathStepText(step);
  const lead = document.createElement("p");
  lead.className = "inferno-korath__lead";
  lead.textContent = KORATH_UNLOCKED_LINE;
  const line = document.createElement("p");
  line.className = "inferno-complete__line inferno-korath__line";
  line.textContent = text.line;

  const actions = document.createElement("div");
  actions.className = "inferno-popup__actions";
  const go = document.createElement("button");
  go.type = "button";
  go.className = "btn btn--primary";
  go.textContent = text.button;
  go.addEventListener("click", () => {
    popup.close();
    act();
  });
  actions.append(go);

  popup.setContent(art, lead, line, actions);
  return popup.mount(host);
};
