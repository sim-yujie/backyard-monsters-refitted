import type { MolochGroup } from "@/api/inferno";
import { monsterName } from "@/game/combat/rules/report";
import {
  CAVE_ART,
  CAVE_NAME,
  CAVERN_DEFENCE,
  EARTHQUAKE,
  EMERGE_COMPLETE_ART,
  ENGAGE_ATTACK,
  ENTER_CAVERN,
  ENTER_CAVERN_INVITE,
  MOLOCH_ALERT_TITLE,
  MOLOCH_MONSTER_HINTS,
  MOLOCH_PORTRAIT,
  TRANSFER_MONSTERS,
  UPGRADE_NOW,
} from "@/game/inferno/emergenceText";
import { monsterPortrait, showPortrait } from "@/game/portraits";
import { alarmPulse } from "@/ui/alarmPulse";
import { Popup } from "@/ui/Popup";
import "@/ui/styles/inferno.css";

/**
 * The screens of Moloch's emergence on the own main yard (WP 1.10,
 * `docs/design/inferno.md` §2.2 and §4): Moloch's dialogue, the cave's note
 * and menu, the EARTHQUAKE banner, Moloch's warning before each raid (WP
 * 1.9), and, after a raid, "stage passed" and the last popup. A popup on a
 * phone, centred on a desktop; the pictures are
 * Flash's own (`portrait_moloch.png`, `popup_emergecomplete.v2.jpg`, the
 * cave's `top.5.v2.png`).
 */

const element = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const button = (label: string, className: string, onClick: () => void): HTMLButtonElement => {
  const node = element("button", className, label);
  node.type = "button";
  node.addEventListener("click", onClick);
  return node;
};

const picture = (src: string, className: string, alt: string): HTMLImageElement => {
  const image = element("img", className);
  image.src = src;
  image.alt = alt;
  image.decoding = "async";
  return image;
};

/** Moloch beside his line: the shape of every one of his popups (`POPUPS.DisplayDialogue`). */
const molochSays = (text: string): HTMLElement => {
  const head = element("div", "inferno-says");
  head.append(picture(MOLOCH_PORTRAIT, "inferno-says__portrait", "Moloch"), element("p", "inferno-says__line", text));
  return head;
};

/**
 * One of Moloch's lines with "Next" (`INFERNO_EMERGENCE_POPUPS.ShowDialogue`):
 * the intro before the first raid, a taunt after each. Mounted on `host`.
 */
export const molochDialogue = (host: HTMLElement, text: string, onClose: () => void = () => {}): Popup => {
  const popup = new Popup({ title: "Moloch", className: "inferno-popup inferno-popup--moloch", onClose });
  const actions = element("div", "inferno-popup__actions");
  actions.append(button("Next", "btn btn--primary", () => popup.close()));
  popup.setContent(molochSays(text), actions);
  return popup.mount(host);
};

/**
 * The cave's note below its last level (`ShowRSVP`): what the player can make
 * of it so far, and "Upgrade Now" while the hall is below 5.
 */
export const caveNote = (host: HTMLElement, text: string, upgrade: (() => void) | null): Popup => {
  const popup = new Popup({ title: CAVE_NAME, className: "inferno-popup inferno-popup--note" });
  const nodes: Node[] = [molochSays(text)];
  if (upgrade) {
    const actions = element("div", "inferno-popup__actions");
    actions.append(
      button(UPGRADE_NOW, "btn btn--primary", () => {
        popup.close();
        upgrade();
      }),
    );
    nodes.push(actions);
  }
  popup.setContent(...nodes);
  return popup.mount(host);
};

export interface CaveMenuActions {
  readonly enter: () => void;
  readonly transfer: () => void;
}

/**
 * The open cave's menu (`INFERNOPORTAL.Click` at level 5, the building's
 * options in Flash): Enter Cavern and Transfer Monsters.
 */
export const caveMenu = (host: HTMLElement, actions: CaveMenuActions): Popup => {
  const popup = new Popup({ title: CAVE_NAME, className: "inferno-popup inferno-popup--menu" });
  const art = picture(CAVE_ART, "inferno-menu__art", CAVE_NAME);
  const buttons = element("div", "inferno-popup__actions inferno-menu__actions");
  buttons.append(
    button(TRANSFER_MONSTERS, "btn btn--ghost", () => {
      popup.close();
      actions.transfer();
    }),
    button(ENTER_CAVERN, "btn btn--primary", () => {
      popup.close();
      actions.enter();
    }),
  );
  popup.setContent(art, buttons);
  return popup.mount(host);
};

/**
 * Moloch's warning before each of his raids (`INFERNO_EMERGENCE_ATTACKPOPUP`):
 * Moloch, one card per group of his army in the order they come, and one
 * button, "Engage Attack". Under the cards, the `emerge_mondesc` line of the
 * card last pointed at, focused or tapped (Flash: on mouse-over), the first
 * card's to begin with. No way to close it but that button, as in Flash: `engage` starts
 * the raid and answers whether the warning is done with; on false (the
 * server busy or out of reach) the button comes back to press again.
 */
export const molochWarning = (
  host: HTMLElement,
  groups: readonly MolochGroup[],
  engage: () => Promise<boolean>,
  onClose: () => void = () => {},
): Popup => {
  const popup = new Popup({
    title: MOLOCH_ALERT_TITLE,
    className: "inferno-popup inferno-popup--warning",
    dismissable: false,
    onClose,
  });
  alarmPulse(popup);
  const head = element("div", "inferno-warning");
  const army = element("ul", "inferno-army");
  army.setAttribute("aria-label", "Moloch's monsters");
  const about = element("p", "inferno-army__about");
  about.setAttribute("aria-live", "polite");
  const cards: HTMLElement[] = [];
  const show = (card: HTMLElement, monster: string): void => {
    for (const one of cards) one.classList.toggle("is-shown", one === card);
    about.textContent = MOLOCH_MONSTER_HINTS[monster] ?? "";
  };
  for (const group of groups) {
    const card = element("li", "inferno-army__card");
    card.tabIndex = 0;
    cards.push(card);
    for (const event of ["pointerenter", "focus", "click"]) {
      card.addEventListener(event, () => show(card, group.monster));
    }
    const image = element("img", "inferno-army__portrait");
    image.alt = "";
    image.decoding = "async";
    showPortrait(image, monsterPortrait(group.monster, "card"));
    card.append(
      image,
      element("span", "inferno-army__name", monsterName(group.monster)),
      element("span", "inferno-army__count", `×${group.count}`),
    );
    army.append(card);
  }
  const first = cards[0];
  if (first && groups[0]) show(first, groups[0].monster);
  const side = element("div", "inferno-warning__army");
  side.append(army, about);
  head.append(picture(MOLOCH_PORTRAIT, "inferno-warning__portrait", "Moloch"), side);

  const actions = element("div", "inferno-popup__actions");
  const start = button(ENGAGE_ATTACK, "btn btn--primary inferno-warning__engage", () => {
    start.disabled = true;
    start.textContent = "Engaging…";
    const reset = (): void => {
      start.disabled = false;
      start.textContent = ENGAGE_ATTACK;
    };
    engage().then(
      (done) => (done ? popup.close() : reset()),
      () => reset(),
    );
  });
  actions.append(start);
  popup.setContent(head, actions);
  popup.mount(host);
  // The way on is the button: focus starts there, not on the first card.
  start.focus();
  return popup;
};

/**
 * "Stage passed" after each of Moloch's raids, won or lost (`ShowStagePassed`,
 * `ai_caverndefense`). Flash's "Brag to your friends" posted to Facebook and
 * is left out.
 */
export const stagePassed = (host: HTMLElement, onClose: () => void): Popup => {
  const popup = new Popup({ title: "Stage passed", className: "inferno-popup inferno-popup--stage", onClose });
  const actions = element("div", "inferno-popup__actions");
  actions.append(button("Next", "btn btn--primary", () => popup.close()));
  popup.setContent(molochSays(CAVERN_DEFENCE), actions);
  return popup.mount(host);
};

/**
 * The last popup, after the fifth raid (`ShowComplete`, `entercavern_popup`
 * over `popup_emergecomplete.v2.jpg`): Enter Cavern while the hall is at 5.
 */
export const emergenceComplete = (host: HTMLElement, enter: (() => void) | null, onClose: () => void = () => {}): Popup => {
  const popup = new Popup({ title: "The way to Inferno is open", className: "inferno-popup inferno-popup--complete", onClose });
  const nodes: Node[] = [
    picture(EMERGE_COMPLETE_ART, "inferno-complete__art", "Moloch's Skull of Doom"),
    element("p", "inferno-complete__line", ENTER_CAVERN_INVITE),
  ];
  if (enter) {
    const actions = element("div", "inferno-popup__actions");
    actions.append(
      button(ENTER_CAVERN, "btn btn--primary", () => {
        popup.close();
        enter();
      }),
    );
    nodes.push(actions);
  }
  popup.setContent(...nodes);
  return popup.mount(host);
};

/** The warning bar's "EARTHQUAKE !" (`UI2._warning`, `emerge_earthquake`). */
export const earthquakeBanner = (host: HTMLElement): HTMLElement => {
  const banner = element("p", "inferno-quake", EARTHQUAKE);
  banner.setAttribute("role", "alert");
  host.append(banner);
  return banner;
};
