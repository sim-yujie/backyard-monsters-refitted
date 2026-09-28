import {
  attackGate,
  battlesText,
  formatRespawn,
  initials,
  pinTone,
  presenceText,
  ReasonKey,
  respawnIn,
  type Mr1Gate,
  type Mr1Own,
  type Mr1Reason,
  type Mr1Target,
  type Mr1World,
} from "@/game/maproom1/mr1Model";
import { tribeInfo } from "@/game/maproom1/tribes";
import { monsterName, portraitUrl } from "@/ui/attack/ArmyPanel";
import { button, el, icon, type IconName } from "./icons";

/**
 * The card for one target: the Options popup of Flash's map
 * (`com/monsters/maproom/views/MapBasePopup.as`) grown into the approved
 * "MR1 · Target" card. Beside the pin on the map, beside the list on a wide
 * screen, and a bottom sheet on a phone; the same content in each.
 *
 * Attack stays on the card when it is off, greyed, with the reason under it
 * (and a way out when there is one: Build Flinger, Hatch). Attacking a player
 * while protected says so on the card before the tap, in place of Flash's
 * confirm box. Truce and Message are left out until there is a mail screen.
 */

export type CardAction = NonNullable<Mr1Reason["action"]>;

export interface CardHandlers {
  readonly onClose: () => void;
  readonly onView: (target: Mr1Target) => void;
  readonly onAttack: (target: Mr1Target) => void;
  readonly onAction: (action: CardAction) => void;
}

export interface CardState {
  readonly world: Mr1World;
  readonly own: Mr1Own | null;
  readonly now: number;
}

/** "7:12" that counts itself down: the scene's once-a-second tick rewrites every one. */
export const countdown = (
  until: number,
  now: number,
  className = "mr1-countdown",
): HTMLElement => {
  const span = el("strong", className, formatRespawn(until - now));
  span.dataset["until"] = String(until);
  return span;
};

/** A tribe's picture or a player's initials, framed in the pin's colour. */
export const avatar = (target: Mr1Target, size: "sm" | "md" | "lg"): HTMLElement => {
  const box = el("span", `mr1-avatar mr1-avatar--${size} mr1-tone--${pinTone(target)}`);
  box.setAttribute("aria-hidden", "true");
  if (target.kind === "tribe") {
    box.classList.add("mr1-avatar--tribe");
    const art = el("img", "mr1-avatar__art");
    art.src = tribeInfo(target.tribe).art;
    art.alt = "";
    art.decoding = "async";
    box.append(art);
  } else {
    box.textContent = initials(target.name);
  }
  return box;
};

/** "You can send Pokey ×16 Octo-ooze ×6", or null with nothing housed. */
export const armyChips = (own: Mr1Own | null, label = "You can send"): HTMLElement | null => {
  if (!own?.army.length) return null;
  const row = el("div", "mr1-send");
  row.append(el("span", "mr1-send__label", label));
  for (const line of own.army) {
    const chip = el("span", "mr1-send__chip");
    const picture = el("img", "mr1-send__icon");
    picture.src = portraitUrl(line.id);
    picture.alt = "";
    picture.decoding = "async";
    picture.addEventListener("error", () => picture.remove(), { once: true });
    chip.append(picture, `${monsterName(line.id)} ×${line.count}`);
    row.append(chip);
  }
  return row;
};

const REASON_ICONS: Readonly<Record<string, IconName>> = {
  [ReasonKey.NO_FLINGER]: "flinger",
  [ReasonKey.FLINGER_BUSY]: "wrench",
  [ReasonKey.NO_MONSTERS]: "home",
  [ReasonKey.NEW_PLAYER]: "shield",
  [ReasonKey.DAMAGE_PROTECTION]: "shield",
  [ReasonKey.UNDER_ATTACK]: "attack",
  [ReasonKey.TRUCE]: "truce",
  [ReasonKey.WRECKED]: "clock",
};

const ACTION_LABELS: Readonly<Record<CardAction, string>> = {
  buildFlinger: "Build Flinger",
  hatch: "Hatch",
};

/** The reason under a greyed Attack, with a live countdown for a wrecked camp. */
const reasonLine = (
  reason: Mr1Reason,
  target: Mr1Target,
  state: CardState,
  id: string,
): HTMLElement => {
  const line = el("p", "mr1-reason");
  line.id = id;
  if (reason.key === ReasonKey.PLAYING) {
    line.append(el("span", "mr1-dot mr1-dot--online"));
  } else {
    line.append(icon(REASON_ICONS[reason.key] ?? "lock", 16, "mr1-icon mr1-reason__icon"));
  }
  const words = el("span");
  words.append(el("strong", undefined, `${reason.title}.`), " ");
  if (
    reason.key === ReasonKey.WRECKED &&
    target.kind === "tribe" &&
    target.respawnAt !== null
  ) {
    words.append("Its camp comes back in ", countdown(target.respawnAt, state.now), ".");
  } else {
    words.append(reason.detail);
  }
  line.append(words);
  return line;
};

const actionButton = (label: string, name: IconName, className: string): HTMLButtonElement => {
  const control = button(className);
  control.append(icon(name, 18), label);
  return control;
};

let cardSerial = 0;

/** Builds the card for `target`. Rebuilt whenever what it says changes. */
export const targetCard = (
  target: Mr1Target,
  state: CardState,
  handlers: CardHandlers,
  variant: "float" | "panel" | "sheet",
): HTMLElement => {
  const serial = ++cardSerial;
  const gate: Mr1Gate = attackGate(target, state.own, state.world, state.now);
  const card = el("section", `mr1-card mr1-card--${variant}`);
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-label", target.name);
  card.dataset["target"] = target.key;

  if (variant === "sheet") card.append(el("div", "mr1-card__grip"));

  const head = el("div", "mr1-card__head");
  const titles = el("div", "mr1-card__titles");
  const titleRow = el("div", "mr1-card__title-row");
  titleRow.append(
    el("h2", "mr1-card__title u-display", target.name),
    el("span", "chip", `Level ${target.level}`),
  );
  titles.append(titleRow);
  if (target.kind === "tribe") {
    titles.append(
      el(
        "span",
        "mr1-card__sub mr1-card__sub--tribe",
        variant === "sheet" ? "Wild monsters · keeps your protection" : "Wild monsters",
      ),
    );
  } else {
    const presence = el("span", "mr1-card__sub");
    if (presenceText(target, state.now) === "Playing now")
      presence.append(el("span", "mr1-dot mr1-dot--online"));
    presence.append(presenceText(target, state.now));
    titles.append(presence);
  }
  const close = button("btn btn--icon mr1-card__close");
  close.setAttribute("aria-label", "Close");
  close.append(icon("close", 18));
  close.addEventListener("click", handlers.onClose);
  head.append(avatar(target, variant === "sheet" ? "md" : "lg"), titles, close);
  card.append(head);

  if (target.kind === "tribe") {
    card.append(el("p", "mr1-card__blurb", tribeInfo(target.tribe).blurb));
    if (variant !== "sheet") {
      const facts = el("div", "mr1-card__facts");
      const left = respawnIn(target, state.now);
      const fact = (name: IconName, text: string): HTMLElement => {
        const line = el("span", "mr1-card__fact");
        line.append(icon(name, 16), text);
        return line;
      };
      facts.append(
        fact(
          "respawn",
          left === null
            ? "Wreck its Town Hall to win. The camp comes back 10 minutes later."
            : "You wrecked this camp. It is rebuilding.",
        ),
        fact("shield", "Attacking a tribe keeps your protection."),
      );
      if (target.damage !== null && target.damage > 0 && left === null) {
        facts.append(fact("attack", `Already ${Math.round(target.damage)}% damaged by you.`));
      }
      card.append(facts);
    }
  } else {
    const stats = el("div", "mr1-card__stats");
    const stat = (count: number, words: string, warn: boolean): HTMLElement => {
      const tile = el("div", warn ? "mr1-stat mr1-stat--warn" : "mr1-stat");
      tile.append(
        el("span", "mr1-stat__value u-display", String(count)),
        el("span", "mr1-stat__label", words),
      );
      return tile;
    };
    if (target.attacksFrom || target.attacksTo) {
      stats.append(
        stat(
          target.attacksFrom,
          target.attacksFrom === 1 ? "time they attacked you" : "times they attacked you",
          target.attacksFrom > 0,
        ),
        stat(
          target.attacksTo,
          target.attacksTo === 1 ? "time you attacked them" : "times you attacked them",
          false,
        ),
      );
      card.append(stats);
    } else {
      card.append(el("p", "mr1-card__sub", battlesText(target)));
    }
  }

  if (gate.warning) {
    const note = el("div", "mr1-warning");
    note.setAttribute("role", "note");
    note.append(icon("shield", 18, "mr1-icon mr1-warning__icon"));
    const words = el("span");
    words.append(el("strong", undefined, gate.warning.strong), " ", gate.warning.rest);
    note.append(words);
    card.append(note);
  }

  const army = gate.reason?.key === ReasonKey.NO_MONSTERS ? null : armyChips(state.own);
  if (army) card.append(army);

  const actions = el("div", "mr1-card__actions");
  const view = actionButton("View", "eye", "btn btn--outline mr1-card__button");
  view.addEventListener("click", () => handlers.onView(target));
  if (gate.viewOff) {
    view.disabled = true;
    view.title = gate.viewOff;
  }
  const attack = actionButton(
    "Attack",
    gate.reason ? "lock" : "attack",
    "btn btn--primary mr1-card__button",
  );
  if (gate.reason) {
    attack.disabled = true;
    attack.setAttribute("aria-describedby", `mr1-why-${serial}`);
  } else {
    attack.addEventListener("click", () => handlers.onAttack(target));
  }
  actions.append(view, attack);
  card.append(actions);

  if (gate.reason) {
    const why = el("div", "mr1-card__why");
    why.append(reasonLine(gate.reason, target, state, `mr1-why-${serial}`));
    const action = gate.reason.action;
    if (action) {
      const way = button("btn btn--outline mr1-card__way", ACTION_LABELS[action]);
      way.addEventListener("click", () => handlers.onAction(action));
      why.append(way);
    }
    card.append(why);
  }

  card.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      handlers.onClose();
    }
  });
  return card;
};
