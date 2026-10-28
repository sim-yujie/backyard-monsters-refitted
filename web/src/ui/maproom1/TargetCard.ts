import { tutTarget, TutTarget } from "@/game/guide/targets";
import {
  attackGate,
  battleCounts,
  formatRespawn,
  initials,
  isPlayingNow,
  pinTone,
  presenceText,
  ReasonKey,
  respawnIn,
  type Mr1Gate,
  type Mr1Neighbour,
  type Mr1Own,
  type Mr1Reason,
  type Mr1Target,
  type Mr1World,
} from "@/game/maproom1/mr1Model";
import { avatarUrl } from "@/game/avatars";
import { tribeInfo } from "@/game/maproom1/tribes";
import { VICTORY_THRESHOLD } from "@/game/combat/rules";
import { monsterPortrait, showPortrait } from "@/game/portraits";
import { monsterName } from "@/ui/attack/ArmyPanel";
import { gameIcon } from "@/ui/gameIcon";
import { onlineDot } from "@/ui/onlineDot";
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
 * confirm box. Message and Truce sit in a row of their own on a neighbour
 * (not a tribe), as on the Map Room 2 cell panel; the scene opens the mailbox.
 *
 * Fewer words (less-text job 5, the owner's version, 27 Oct): no rule
 * sentences ("Deal 90% damage to wreck it", "The camp comes back 10 minutes
 * later", "Attacking a tribe keeps your protection"); a tribe's camp shows how
 * damaged it is as the broken wall, a bar and "35%"; an online player has only
 * the green dot by the name and a greyed Attack, no sentence under it.
 */

export type CardAction = NonNullable<Mr1Reason["action"]>;

export interface CardHandlers {
  readonly onClose: () => void;
  readonly onView: (target: Mr1Target) => void;
  readonly onAttack: (target: Mr1Target) => void;
  readonly onAction: (action: CardAction) => void;
  /** Writes to a neighbour (#193). Absent: no Message button. */
  readonly onMessage?: (target: Mr1Neighbour) => void;
  /** Proposes a truce to a neighbour (#203). Absent: no Truce button. */
  readonly onTruce?: (target: Mr1Neighbour) => void;
  /**
   * A neighbour's achievements line under the name and level (#204,
   * `ui/achievements/AchievementsLine.ts`). Absent: no line.
   */
  readonly achievementsLine?: (target: Mr1Neighbour) => HTMLElement;
  /**
   * A neighbour's Add friend, or how they stand to the player (friends WP11,
   * #378, `ui/friends/AddFriendButton.ts`), a row under Message and Truce. Absent: none.
   */
  readonly addFriend?: (target: Mr1Neighbour) => HTMLElement;
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

/**
 * A tribe's picture or a player's critter (issue #175), framed in the pin's
 * colour. A critter that fails to load falls back to the player's initials.
 */
export const avatar = (target: Mr1Target, size: "sm" | "md" | "lg"): HTMLElement => {
  const box = el("span", `mr1-avatar mr1-avatar--${size} mr1-tone--${pinTone(target)}`);
  box.setAttribute("aria-hidden", "true");
  const art = el("img", "mr1-avatar__art");
  art.alt = "";
  art.decoding = "async";
  if (target.kind === "tribe") {
    box.classList.add("mr1-avatar--tribe");
    art.src = tribeInfo(target.tribe).art;
  } else {
    box.classList.add("mr1-avatar--player");
    art.src = avatarUrl(target.avatar, size === "lg" ? "full" : "small");
    art.addEventListener("error", () => art.replaceWith(initials(target.name)), { once: true });
  }
  box.append(art);
  return box;
};

/**
 * A shield and a count for "Attacked you 2 times", a sword and a count for
 * "You attacked them 1 time", each with those words on hover and for screen
 * readers. Null when they never fought.
 */
export const battleIcons = (neighbour: Mr1Neighbour): HTMLElement | null => {
  const counts = battleCounts(neighbour);
  if (!counts.length) return null;
  const group = el("span", "mr1-battles");
  for (const { kind, count, label } of counts) {
    const badge = el("span", `mr1-battle mr1-battle--${kind}`);
    badge.title = label;
    badge.setAttribute("role", "img");
    badge.setAttribute("aria-label", label);
    badge.append(icon(kind === "attackedYou" ? "shield" : "attack", 13), String(count));
    group.append(badge);
  }
  return group;
};

/** "You can send Pokey ×16 Octo-ooze ×6", or null with nothing housed. */
export const armyChips = (own: Mr1Own | null, label = "You can send"): HTMLElement | null => {
  if (!own?.army.length) return null;
  const row = el("div", "mr1-send");
  row.append(el("span", "mr1-send__label", label));
  for (const line of own.army) {
    const chip = el("span", "mr1-send__chip");
    const picture = el("img", "mr1-send__icon");
    showPortrait(picture, monsterPortrait(line.id, "icon"));
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
  line.append(icon(REASON_ICONS[reason.key] ?? "lock", 16, "mr1-icon mr1-reason__icon"));
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

/**
 * How damaged a tribe's camp is: the broken wall, a bar with a notch where
 * the camp is wrecked (`VICTORY_THRESHOLD`), and "35%". The words are on hover
 * and for screen readers: "Yard damage 35%, wrecked at 90%".
 */
export const damageMeter = (damage: number): HTMLElement => {
  const percent = Math.min(100, Math.max(0, Math.round(damage)));
  const meter = el("div", "mr1-damage");
  const words = `Yard damage ${percent}%, wrecked at ${VICTORY_THRESHOLD}%`;
  meter.setAttribute("role", "meter");
  meter.setAttribute("aria-label", "Yard damage");
  meter.setAttribute("aria-valuemin", "0");
  meter.setAttribute("aria-valuemax", "100");
  meter.setAttribute("aria-valuenow", String(percent));
  meter.setAttribute("aria-valuetext", words);
  meter.title = words;
  const bar = el("span", "mr1-damage__bar");
  const fill = el("span", "mr1-damage__fill");
  fill.style.width = `${percent}%`;
  const notch = el("span", "mr1-damage__notch");
  notch.style.left = `${VICTORY_THRESHOLD}%`;
  bar.append(fill, notch);
  meter.append(gameIcon("yarddamage2", { size: 16, decorative: true }), bar, el("span", "mr1-damage__value", `${percent}%`));
  return meter;
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
  titleRow.append(el("h2", "mr1-card__title u-display", target.name));
  if (target.kind !== "tribe" && isPlayingNow(target, state.now)) titleRow.append(onlineDot());
  titleRow.append(el("span", "chip", `Level ${target.level}`));
  titles.append(titleRow);
  if (target.kind === "tribe") {
    titles.append(el("span", "mr1-card__sub mr1-card__sub--tribe", "Wild monsters"));
  } else {
    const seen = presenceText(target, state.now);
    const battles = battleIcons(target);
    if (seen || battles) {
      const sub = el("span", "mr1-card__sub", seen);
      if (battles) sub.append(battles);
      titles.append(sub);
    }
  }
  const close = button("btn btn--icon mr1-card__close");
  close.setAttribute("aria-label", "Close");
  close.append(icon("close", 18));
  close.addEventListener("click", handlers.onClose);
  head.append(avatar(target, variant === "sheet" ? "md" : "lg"), titles, close);
  card.append(head);

  if (target.kind === "tribe") {
    card.append(el("p", "mr1-card__blurb", tribeInfo(target.tribe).blurb));
    // A wrecked camp says so under its greyed Attack, with its countdown.
    if (respawnIn(target, state.now) === null) card.append(damageMeter(target.damage ?? 0));
  } else {
    const line = handlers.achievementsLine?.(target);
    if (line) card.append(line);
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
  tutTarget(attack, TutTarget.TARGET_ATTACK);
  // An online player: the green dot by the name says why, and no sentence does.
  const online = gate.reason?.key === ReasonKey.PLAYING;
  if (gate.reason) {
    attack.disabled = true;
    if (online) attack.title = gate.reason.title;
    else attack.setAttribute("aria-describedby", `mr1-why-${serial}`);
  } else {
    attack.addEventListener("click", () => handlers.onAttack(target));
  }
  actions.append(view, attack);
  card.append(actions);

  if (target.kind === "player") {
    const { onMessage, onTruce, addFriend } = handlers;
    // No Truce button while one already runs.
    const truceRuns = target.truceUntil !== null && target.truceUntil > state.now;
    const social = el("div", "mr1-card__social");
    if (onMessage) {
      const message = actionButton("Message", "mail", "btn btn--outline mr1-card__button mr1-card__message");
      message.title = "Write to this player";
      message.addEventListener("click", () => onMessage(target));
      social.append(message);
    }
    if (onTruce && !truceRuns) {
      const truce = actionButton("Truce", "truce", "btn btn--outline mr1-card__button mr1-card__truce");
      truce.title = "Propose a truce to this player";
      truce.addEventListener("click", () => onTruce(target));
      social.append(truce);
    }
    if (social.childElementCount > 0) card.append(social);
    if (addFriend) {
      const friend = el("div", "mr1-card__friend");
      friend.append(addFriend(target));
      card.append(friend);
    }
  }

  if (gate.reason && !online) {
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
