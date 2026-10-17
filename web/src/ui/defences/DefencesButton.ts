import { icon } from "@/ui/icons";
import "@/ui/styles/defences.css";

/**
 * The yard's Defences button (#363, owner §12.1): one of the dock's round
 * buttons, beside Mail, which opens the Defences screen. Hidden until the
 * scene knows the player is on Map Room 2 (`setAvailable`): only Map Room 2
 * main yards keep defence replays until #246.
 */
export class DefencesButton {
  readonly element: HTMLButtonElement;

  constructor(onOpen: () => void) {
    this.element = document.createElement("button");
    this.element.type = "button";
    this.element.className = "yard-dock__button yard-dock__button--defences";
    this.element.dataset["dock"] = "defences";
    this.element.setAttribute("aria-label", "Defences");
    this.element.title = "Defences: the attacks on your yard, to watch";

    const disc = document.createElement("span");
    disc.className = "yard-dock__disc";
    disc.append(icon("shield", 29));

    const label = document.createElement("span");
    label.className = "yard-dock__label";
    label.textContent = "Defences";

    this.element.append(disc, label);
    this.element.addEventListener("click", () => onOpen());
    this.element.hidden = true;
  }

  setAvailable(available: boolean): void {
    this.element.hidden = !available;
  }

  destroy(): void {
    this.element.remove();
  }
}
