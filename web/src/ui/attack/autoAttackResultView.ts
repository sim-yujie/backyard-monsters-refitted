import type { AutoAttackResponse } from "@/api/autoAttack";
import { tribePictureUrl } from "@/game/maproom/tribeAvatars";
import { gameIcon } from "@/ui/gameIcon";
import { RESOURCE_KEYS, RESOURCE_NAMES, resourceAmount } from "@/ui/resourceIcon";

/**
 * The Repeat attack's result (owner, 16 Nov 2026: "I just want to know the
 * loot, and resource needed to take over"). Top to bottom: the camp and
 * whether it was won, the loot, and (from AutoAttackFlow) the take-over
 * price with Take over, then Watch and Close. No army, champion, moves,
 * bombs, deal or rules: the owner asked for them gone.
 */

const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** astra round 2: the camp's portrait, name and level, and "Victory!" or "Defeat". */
const head = (result: AutoAttackResponse): HTMLElement => {
  const box = make("div", "arv-head");
  const url = tribePictureUrl(result.tribe);
  if (url) {
    const picture = make("img", "arv-head__tribe");
    picture.src = url;
    picture.alt = "";
    box.append(picture);
  }
  const words = make("div", "arv-head__words");
  words.append(make("p", "arv-head__camp", `${result.tribe} camp · Level ${result.level}`));
  const outcome = make("p", `arv-head__outcome${result.conquered ? " arv-head__outcome--won" : ""}`);
  outcome.append(make("span", "arv-head__word", result.conquered ? "Victory!" : "Defeat"));
  words.append(outcome);
  box.append(words);
  return box;
};

/** The four resources won, zeros too, so the grid keeps its shape. */
const lootGrid = (result: AutoAttackResponse): HTMLElement => {
  const loot = make("ul", "arv-loot");
  loot.setAttribute("aria-label", "Loot");
  for (const key of RESOURCE_KEYS) {
    const amount = result.loot[key];
    const item = make("li", `arv-loot__item${amount > 0 ? "" : " arv-loot__item--none"}`);
    item.append(resourceAmount(key, amount, { change: "gain", tooltip: false }));
    item.title = `${RESOURCE_NAMES[key]}: ${Math.floor(amount).toLocaleString("en-US")}${amount >= 1 ? " gained" : ""}`;
    loot.append(item);
  }
  return loot;
};

const storageFull = (result: AutoAttackResponse): HTMLElement | null => {
  if (!RESOURCE_KEYS.some((key) => result.lootLeft[key] > 0)) return null;
  const note = make("p", "arv-note arv-note--storage");
  note.append(gameIcon("storagefull", { size: 24, decorative: true }), "Storage full: some loot left behind");
  return note;
};

const stalled = (result: AutoAttackResponse): HTMLElement | null =>
  result.damageAdded < 2 && !result.conquered
    ? make("p", "arv-note arv-note--stalled", "Low damage. Attack by hand to try new drop points.")
    : null;

/** A small heading over a part ("Loot", "Take over"). */
const partLabel = (text: string): HTMLElement => make("h3", "arv-label", text);

export interface ResultView {
  /** The camp and whether it was won. */
  readonly head: HTMLElement;
  /** The loot and its notes. */
  readonly loot: HTMLElement;
  /** Where the take-over offer goes, when the camp was conquered. */
  readonly offerHost: HTMLElement | null;
}

/** The result's parts; AutoAttackFlow adds the offer and the buttons. */
export const resultView = (result: AutoAttackResponse): ResultView => {
  const loot = make("section", "arv-part arv-part--loot");
  loot.setAttribute("aria-label", "Loot");
  loot.append(partLabel("Loot"), lootGrid(result));
  for (const note of [storageFull(result), stalled(result)]) if (note) loot.append(note);
  const offerHost = result.conquered ? make("div", "arv-offer") : null;
  return { head: head(result), loot, offerHost };
};
