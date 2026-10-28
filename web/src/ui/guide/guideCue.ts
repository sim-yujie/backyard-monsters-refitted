import type { GuideCue } from "@/game/guide/steps";
import { monsterPortrait, showPortrait } from "@/game/portraits";
import { buttonUrl } from "@/game/yard/buildButtonArt";
import { gameIcon } from "@/ui/gameIcon";
import { goalsArt } from "@/ui/goals/goalsArt";
import { icon } from "@/ui/icons";
import { resourceIcon } from "@/ui/resourceIcon";

/**
 * The picture at the start of Bob's bubble (`GuideCue`, the text cut, 28 Oct):
 * the button he asks for as the button itself wears it (a dome with the
 * dock's line icon, the Goals art), the building's card picture, Pokeys with
 * their count, a resource pile or the Shiny coin, or a painted icon.
 *
 * Hidden from a screen reader: Bob's words name the same thing.
 */

/** The Pokey, the guide's monster (the dock's Monsters picture too). */
const POKEY = "C1";

const el = (className: string): HTMLSpanElement => {
  const span = document.createElement("span");
  span.className = className;
  return span;
};

const picture = (src: string, className: string): HTMLImageElement => {
  const image = document.createElement("img");
  image.className = className;
  image.alt = "";
  image.decoding = "async";
  image.draggable = false;
  image.src = src;
  return image;
};

/** A cue's picture, `.guide-cue` with a `--<kind>` modifier. */
export const guideCue = (cue: GuideCue): HTMLElement => {
  const element = el(`guide-cue guide-cue--${cue.kind}`);
  element.setAttribute("aria-hidden", "true");
  element.dataset["cue"] = cue.kind;
  switch (cue.kind) {
    case "icon":
      element.dataset["name"] = cue.name;
      element.append(icon(cue.name, 22));
      break;
    case "goals":
      element.append(goalsArt(22));
      break;
    case "building":
      element.dataset["type"] = String(cue.type);
      element.append(picture(buttonUrl(cue.type), "guide-cue__building"));
      break;
    case "pokeys": {
      const image = picture("", "guide-cue__monster");
      showPortrait(image, monsterPortrait(POKEY, "icon"));
      const count = el("guide-cue__count");
      count.textContent = `×${cue.count}`;
      element.append(image, count);
      break;
    }
    case "resource":
      element.dataset["name"] = cue.key;
      element.append(resourceIcon(cue.key, { decorative: true }));
      break;
    case "painted":
      element.dataset["name"] = cue.name;
      element.append(gameIcon(cue.name, { size: 32, decorative: true }));
      break;
  }
  return element;
};
