import type { InfernoAmounts } from "@/api/inferno";
import {
  ATTACK,
  BATTLE_REPORT_TITLE,
  BATTLE_REPORT_TOTAL,
  CAPTURE_BODY,
  CAPTURE_BUTTON,
  CAPTURE_TITLE,
  CLOSE,
  DEPTH,
  DESCENT_MAP_ART,
  DESCENT_MAP_SIZE,
  DESCENT_TITLE,
  DESCENT_YARD_COUNT,
  DESCENT_YARD_SPOTS,
  MOLOCH_NEUTRAL,
  RETURN_HOME,
  battleReportLine,
  depthPercent,
  depthWarning,
  descentYardArt,
} from "@/game/inferno/descentText";
import { INFERNO_RESOURCE_NAMES, RESOURCE_KEYS } from "@/ui/resourceIcon";
import { Popup } from "@/ui/Popup";
import "@/ui/styles/inferno.css";

/**
 * The screens of Moloch's Descent (WP 1.13, `docs/design/inferno.md` §2.4 and
 * §4): the map of his 13 yards with the next one to attack, his lines as a
 * yard opens and after the fight, the battle report and the capture. A popup
 * on a phone, centred on a desktop. The map and Moloch's three faces are
 * Flash's own pictures; the yard markers and the fog over the yards below are
 * stand-ins (`.descent-yard`, `.descent-map__fog`), Flash's being vector art
 * in `assets.swf` that was never exported.
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

const actions = (...buttons: HTMLButtonElement[]): HTMLElement => {
  const row = element("div", "inferno-popup__actions");
  row.append(...buttons);
  return row;
};

/* ── Moloch's lines ── */

/**
 * One of Moloch's Descent lines (`POPUPS.DisplayDialogue` through
 * `ShowTauntDialog`, `ShowGloatDialog`, `ShowWhimperDialog`): his face beside
 * his words, in italics, and the player's answer as the one button.
 */
export const descentDialogue = (
  host: HTMLElement,
  portrait: string,
  line: { readonly moloch: string; readonly reply: string },
  onClose: () => void = () => {},
): Popup => {
  const popup = new Popup({ title: "Moloch", className: "inferno-popup inferno-popup--moloch", onClose });
  const head = element("div", "inferno-says");
  head.append(
    picture(portrait, "inferno-says__portrait", "Moloch"),
    element("p", "inferno-says__line inferno-says__line--descent", line.moloch),
  );
  popup.setContent(head, actions(button(line.reply, "btn btn--primary", () => popup.close())));
  return popup.mount(host);
};

/* ── The battle report ── */

const amountsOf = (amounts: InfernoAmounts): [number, number, number, number] => [
  Math.trunc(amounts.r1) || 0,
  Math.trunc(amounts.r2) || 0,
  Math.trunc(amounts.r3) || 0,
  Math.trunc(amounts.r4) || 0,
];

/**
 * The report after a yard is beaten (`ShowBattleReport`, Moloch's face beside
 * it): this attack's loot, then the Descent's running total in four boxes.
 * Flash's Brag button at yards 1, 4 and 7 posted to Facebook and is gone.
 */
export const descentBattleReport = (
  host: HTMLElement,
  loot: InfernoAmounts,
  total: InfernoAmounts,
  onClose: () => void = () => {},
): Popup => {
  const popup = new Popup({ title: BATTLE_REPORT_TITLE, className: "inferno-popup descent-report", onClose });
  const head = element("div", "inferno-says");
  head.append(
    picture(MOLOCH_NEUTRAL, "inferno-says__portrait", "Moloch"),
    element("p", "inferno-says__line", battleReportLine(amountsOf(loot))),
  );
  const boxes = element("dl", "descent-report__total");
  const totals = amountsOf(total);
  RESOURCE_KEYS.forEach((key, index) => {
    const box = element("div", "descent-report__box");
    box.append(element("dt", "descent-report__name", INFERNO_RESOURCE_NAMES[key]), element("dd", "descent-report__value", totals[index]!.toLocaleString("en-US")));
    boxes.append(box);
  });
  popup.setContent(
    head,
    element("p", "descent-report__heading", BATTLE_REPORT_TOTAL),
    boxes,
    actions(button(CLOSE, "btn btn--primary", () => popup.close())),
  );
  return popup.mount(host);
};

/* ── The capture ── */

/**
 * After the 13th win (`ShowCapturePopup`): Moloch is gone and his yard is the
 * player's. Its one button, Start Building!, opens the Inferno yard
 * (`ClosedCapturePopup`); it must be answered.
 */
export const descentCapture = (host: HTMLElement, startBuilding: () => void): Popup => {
  const popup = new Popup({
    title: CAPTURE_TITLE,
    className: "inferno-popup descent-capture",
    closable: false,
    dismissable: false,
  });
  popup.setContent(
    element("p", "inferno-complete__line", CAPTURE_BODY),
    actions(
      button(CAPTURE_BUTTON, "btn btn--primary", () => {
        popup.close();
        startBuilding();
      }),
    ),
  );
  return popup.mount(host);
};

/* ── The map ── */

/** The Descent as the map shows it: the server's `descent` state. */
export interface DescentMapState {
  /** Flash's counter: 1 + yards beaten. The next yard to attack is this one. */
  readonly level: number;
  /** One per yard: 1 once beaten. */
  readonly destroyed: readonly number[];
}

export interface DescentMapActions {
  /** Attack on the next yard, 1-13. Resolves once the attack scene opens or the start failed. */
  readonly attack: (yard: number) => Promise<void> | void;
  readonly onClose?: () => void;
}

/** The yard to attack next: the first not beaten, or null once all 13 are. */
export const nextDescentYard = (state: DescentMapState): number | null => {
  for (let yard = 1; yard <= DESCENT_YARD_COUNT; yard += 1) {
    if (state.destroyed[yard - 1] !== 1) return yard;
  }
  return null;
};

const percentOf = (value: number, of: number): string => `${+((value / of) * 100).toFixed(3)}%`;

/**
 * Flash's Descent map (`MAPROOM_DESCENT.Show`, `DescentMapRoom`,
 * `DescentView`): Moloch's yards down the 700 x 1842 map, one after the
 * other. A beaten yard is gone from the map (`SetLevelArt` hides it), the
 * yards past the next one are dark, and the fog covers the map below the
 * next one (`PositionShroud`). Only the next yard answers a tap: its card
 * shows the depth bar and Attack (`DescentBasePopup`, `PlayerHandler`).
 * Flash's View button looked at the yard first; no route serves that look,
 * so it is left out. The map scrolls down to the next yard as it opens.
 */
export const descentMap = (host: HTMLElement, state: DescentMapState, actions_: DescentMapActions): Popup => {
  const popup = new Popup({
    title: DESCENT_TITLE,
    className: "inferno-popup descent-map",
    ...(actions_.onClose ? { onClose: actions_.onClose } : {}),
  });
  const next = nextDescentYard(state);

  const scroller = element("div", "descent-map__scroll");
  const map = element("div", "descent-map__map");
  map.style.aspectRatio = `${DESCENT_MAP_SIZE.width} / ${DESCENT_MAP_SIZE.height}`;
  map.append(picture(DESCENT_MAP_ART, "descent-map__art", ""));

  if (next !== null) {
    const spot = DESCENT_YARD_SPOTS[next - 1]!;
    const fog = element("div", "descent-map__fog");
    fog.style.top = percentOf(spot.y, DESCENT_MAP_SIZE.height);
    map.append(fog);
  }

  let card: HTMLElement | null = null;
  const closeCard = (): void => {
    card?.remove();
    card = null;
  };

  DESCENT_YARD_SPOTS.forEach((spot, index) => {
    const yard = index + 1;
    if (state.destroyed[index] === 1) return;
    const isNext = yard === next;
    const marker = element("button", `descent-yard descent-yard--art${descentYardArt(yard)}${isNext ? " descent-yard--next" : " descent-yard--dark"}`);
    marker.type = "button";
    marker.style.left = percentOf(spot.x, DESCENT_MAP_SIZE.width);
    marker.style.top = percentOf(spot.y, DESCENT_MAP_SIZE.height);
    marker.dataset["yard"] = String(yard);
    marker.setAttribute("aria-label", `Moloch's yard ${yard}${isNext ? "" : " (not yet)"}`);
    marker.append(element("span", "descent-yard__number", String(yard)));
    if (!isNext) {
      marker.disabled = true;
    } else {
      marker.addEventListener("click", () => {
        if (card) {
          closeCard();
          return;
        }
        card = yardCard(yard, () => void actions_.attack(yard));
        card.style.left = marker.style.left;
        card.style.top = marker.style.top;
        if (spot.x > DESCENT_MAP_SIZE.width / 2) card.classList.add("descent-card--left");
        map.append(card);
      });
    }
    map.append(marker);
  });

  scroller.append(map);
  popup.setContent(scroller, actions(button(RETURN_HOME, "btn", () => popup.close())));
  popup.mount(host);

  // Down to the next yard, a little above it so its card shows.
  if (next !== null) {
    const spot = DESCENT_YARD_SPOTS[next - 1]!;
    requestAnimationFrame(() => {
      const height = map.getBoundingClientRect().height;
      scroller.scrollTop = Math.max(0, (spot.y / DESCENT_MAP_SIZE.height) * height - scroller.clientHeight / 2);
    });
  }
  return popup;
};

/** The next yard's card: how deep it is, a warning from yard 9, and Attack. */
const yardCard = (yard: number, attack: () => void): HTMLElement => {
  const card = element("div", "descent-card");
  card.setAttribute("role", "group");
  card.setAttribute("aria-label", `Moloch's yard ${yard}`);
  const depth = element("div", "descent-card__depth");
  const label = element("span", "descent-card__label", DEPTH);
  const bar = element("span", "descent-card__bar");
  const fill = element("span", "descent-card__fill");
  fill.style.width = `${depthPercent(yard)}%`;
  bar.append(fill);
  depth.append(label, bar);
  card.append(depth);
  const warning = depthWarning(yard);
  if (warning) card.append(element("p", "descent-card__warning", warning));
  const go = button(ATTACK, "btn btn--primary descent-card__attack", () => {
    go.disabled = true;
    attack();
  });
  card.append(go);
  return card;
};

/** Lets the card's Attack be pressed again, after a start that failed. */
export const enableDescentAttack = (popup: Popup): void => {
  const go = popup.element.querySelector<HTMLButtonElement>(".descent-card__attack");
  if (go) go.disabled = false;
};
